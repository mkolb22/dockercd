package inspector

import (
	"context"
	"fmt"
	"math"
	"sync"
	"time"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/filters"
	"github.com/mkolb22/dockercd/internal/app"
)

const (
	capacityMaxContainers = 64
	capacityWorkers       = 8
	capacityDeadline      = 4 * time.Second
	capacityStatDeadline  = time.Second
	capacityMaxBody       = 1 << 20
	capacityBaselineTTL   = 2 * time.Minute
)

type capacityCounters struct {
	total, system uint64
	online        int
	observedAt    time.Time
}
type capacityResult struct {
	id       string
	counters capacityCounters
	memory   float64
	ok       bool
}

// CapacitySample collects a deliberately bounded aggregate observation. It
// excludes disk/image work and never returns container identities.
func (d *DockerInspector) CapacitySample(ctx context.Context, dockerHost string) (*app.CapacitySample, error) {
	started := time.Now().UTC()
	ctx, cancel := context.WithTimeout(ctx, capacityDeadline)
	defer cancel()
	cli, err := d.getClient(dockerHost)
	if err != nil {
		return nil, err
	}
	metadata, ok := cli.(capacityMetadataClient)
	if !ok {
		return nil, fmt.Errorf("docker client does not support bounded capacity metadata")
	}
	info, err := metadata.CapacityInfo(ctx)
	if err != nil {
		return nil, err
	}
	containers, err := metadata.CapacityContainerList(ctx, container.ListOptions{All: true, Limit: capacityMaxContainers, Filters: filters.NewArgs(filters.Arg("status", "running"))})
	if err != nil {
		return nil, err
	}
	if len(containers) > capacityMaxContainers {
		return nil, fmt.Errorf("docker returned %d capacity containers, limit is %d", len(containers), capacityMaxContainers)
	}
	containerIDs := make([]string, 0, len(containers))
	seenIDs := make(map[string]struct{}, len(containers))
	for _, item := range containers {
		if item.ID == "" {
			return nil, fmt.Errorf("docker returned capacity container without an ID")
		}
		if _, duplicate := seenIDs[item.ID]; duplicate {
			return nil, fmt.Errorf("docker returned duplicate capacity container ID")
		}
		seenIDs[item.ID] = struct{}{}
		containerIDs = append(containerIDs, item.ID)
	}
	sample := &app.CapacitySample{CPUCores: info.NCPU, MemoryTotalMiB: math.Round(float64(info.MemTotal)/1024/1024*100) / 100, RunningContainers: info.ContainersRunning, EligibleContainers: len(containerIDs), SampleStartedAt: started}
	d.pruneCapacityBaselines(started)
	truncated := info.ContainersRunning > len(containers)
	jobs := make(chan string)
	results := make(chan capacityResult, len(containerIDs))
	workers := capacityWorkers
	if len(containerIDs) < workers {
		workers = len(containerIDs)
	}
	var wg sync.WaitGroup
	for range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for id := range jobs {
				results <- d.capacityContainerStat(ctx, cli, id)
			}
		}()
	}
	go func() {
		for _, id := range containerIDs {
			select {
			case jobs <- id:
			case <-ctx.Done():
				close(jobs)
				wg.Wait()
				close(results)
				return
			}
		}
		close(jobs)
		wg.Wait()
		close(results)
	}()
	partial := false
	for result := range results {
		if !result.ok {
			partial = true
			continue
		}
		sample.ObservedContainers++
		sample.MemoryUsageMiB += result.memory
		d.capacityMu.Lock()
		previous, found := d.capacityCPU[result.id]
		result.counters.observedAt = time.Now().UTC()
		d.capacityCPU[result.id] = result.counters
		d.capacityMu.Unlock()
		if found && result.counters.total >= previous.total && result.counters.system > previous.system && result.counters.online > 0 {
			sample.CPUPercent += float64(result.counters.total-previous.total) / float64(result.counters.system-previous.system) * float64(result.counters.online) * 100
		} else {
			partial = true
		}
	}
	if sample.CPUCores <= 0 {
		partial = true
	} else {
		sample.CPUPercent = math.Round(sample.CPUPercent/float64(sample.CPUCores)*100) / 100
	}
	sample.MemoryUsageMiB = math.Round(sample.MemoryUsageMiB*100) / 100
	sample.Completeness = "complete"
	if truncated {
		sample.Completeness = "truncated"
	} else if partial || sample.ObservedContainers != sample.EligibleContainers {
		sample.Completeness = "partial"
	}
	sample.SampleCompletedAt = time.Now().UTC()
	return sample, nil
}

func (d *DockerInspector) pruneCapacityBaselines(now time.Time) {
	d.capacityMu.Lock()
	defer d.capacityMu.Unlock()
	for id, counters := range d.capacityCPU {
		if now.Sub(counters.observedAt) > capacityBaselineTTL {
			delete(d.capacityCPU, id)
		}
	}
}

func (d *DockerInspector) capacityContainerStat(parent context.Context, cli DockerClient, id string) capacityResult {
	ctx, cancel := context.WithTimeout(parent, capacityStatDeadline)
	defer cancel()
	response, err := cli.ContainerStatsOneShot(ctx, id)
	if err != nil {
		return capacityResult{}
	}
	defer response.Body.Close()
	var stats container.StatsResponse
	if err := decodeCapacityJSON(response.Body, -1, &stats); err != nil {
		return capacityResult{}
	}
	return capacityResult{id: id, counters: capacityCounters{total: stats.CPUStats.CPUUsage.TotalUsage, system: stats.CPUStats.SystemUsage, online: int(stats.CPUStats.OnlineCPUs)}, memory: float64(stats.MemoryStats.Usage) / 1024 / 1024, ok: true}
}
