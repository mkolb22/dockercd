// Package differ computes the difference between desired state (from compose files)
// and live state (from Docker). This is a pure function module — no I/O.
package differ

import (
	"sort"

	"github.com/mkolb22/dockercd/internal/app"
)

// IgnoreDriftLabel is the Docker Compose label that excludes a service from
// diff comparison and self-heal triggers.
const IgnoreDriftLabel = "com.dockercd.ignore-drift"

// HookLabel is the Docker Compose label that marks a service as a one-shot hook.
// Hook services are excluded from diff comparison since they are not long-running
// containers — they run via `docker compose run --rm` at sync time.
// Valid values: "pre-sync" or "post-sync".
const HookLabel = "com.dockercd.hook"

// SyncWaveLabel is the Docker Compose label that assigns a service to a named
// deployment wave. Services are deployed in ascending numeric wave order.
// Services without this label default to wave 0.
// Example: "com.dockercd.sync-wave": "1"
const SyncWaveLabel = "com.dockercd.sync-wave"

// StrategyLabel is the Docker Compose label that sets the deployment strategy
// for a service. Valid values: "blue-green".
// When any service in the compose spec has this label set to "blue-green",
// the BlueGreenDeployer is used for the entire application deployment.
const StrategyLabel = "com.dockercd.strategy"

// StateDiffer computes the difference between desired and live state.
type StateDiffer interface {
	// Diff compares the desired service specs against the live service states
	// and returns a structured diff result.
	Diff(desired []app.ServiceSpec, live []app.ServiceState) *app.DiffResult
}

// Differ is the default StateDiffer implementation.
type Differ struct{}

// New creates a new Differ.
func New() *Differ {
	return &Differ{}
}

// Diff compares desired state against live state and returns a structured diff.
// Services in the desired state with the IgnoreDriftLabel set to "true" are
// excluded from comparison and will not appear in the diff result.
func (d *Differ) Diff(desired []app.ServiceSpec, live []app.ServiceState) *app.DiffResult {
	result := &app.DiffResult{}

	// Filter out services with the ignore-drift or hook label before building maps.
	// Hook services are one-shot containers and should not appear in diff comparisons.
	filtered := make([]app.ServiceSpec, 0, len(desired))
	ignoredNames := make(map[string]bool)
	for _, s := range desired {
		if s.Labels[IgnoreDriftLabel] == "true" {
			ignoredNames[s.Name] = true
			continue
		}
		if _, isHook := s.Labels[HookLabel]; isHook {
			ignoredNames[s.Name] = true
			continue
		}
		filtered = append(filtered, s)
	}

	// Also filter live services that have an ignored name from desired.
	filteredLive := make([]app.ServiceState, 0, len(live))
	for _, s := range live {
		if ignoredNames[s.Name] {
			continue
		}
		filteredLive = append(filteredLive, s)
	}

	desiredMap := indexDesiredByName(filtered)
	liveMap := indexLiveByName(filteredLive)

	// Services to create: in desired but not in live
	for name, spec := range desiredMap {
		if _, exists := liveMap[name]; !exists {
			s := spec
			result.ToCreate = append(result.ToCreate, app.ServiceDiff{
				ServiceName:  name,
				ChangeType:   app.ChangeTypeCreate,
				DesiredState: &s,
			})
		}
	}

	// Services to remove: in live but not in desired
	for name, state := range liveMap {
		if _, exists := desiredMap[name]; !exists {
			s := state
			result.ToRemove = append(result.ToRemove, app.ServiceDiff{
				ServiceName: name,
				ChangeType:  app.ChangeTypeRemove,
				LiveState:   &s,
			})
		}
	}

	// Services to update: in both but different
	for name, spec := range desiredMap {
		if state, exists := liveMap[name]; exists {
			fields := compareService(spec, state)
			if len(fields) > 0 {
				s := spec
				st := state
				result.ToUpdate = append(result.ToUpdate, app.ServiceDiff{
					ServiceName:  name,
					ChangeType:   app.ChangeTypeUpdate,
					Fields:       fields,
					DesiredState: &s,
					LiveState:    &st,
				})
			}
		}
	}

	// Sort diff entries by service name for deterministic output
	sortDiffs(result.ToCreate)
	sortDiffs(result.ToUpdate)
	sortDiffs(result.ToRemove)

	result.InSync = len(result.ToCreate) == 0 &&
		len(result.ToUpdate) == 0 &&
		len(result.ToRemove) == 0

	result.Summary = buildSummary(result)

	return result
}

func indexDesiredByName(services []app.ServiceSpec) map[string]app.ServiceSpec {
	m := make(map[string]app.ServiceSpec, len(services))
	for _, s := range services {
		m[s.Name] = s
	}
	return m
}

func indexLiveByName(services []app.ServiceState) map[string]app.ServiceState {
	m := make(map[string]app.ServiceState, len(services))
	for _, s := range services {
		m[s.Name] = s
	}
	return m
}

func sortDiffs(diffs []app.ServiceDiff) {
	sort.Slice(diffs, func(i, j int) bool {
		return diffs[i].ServiceName < diffs[j].ServiceName
	})
}
