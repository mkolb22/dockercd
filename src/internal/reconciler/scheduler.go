package reconciler

import (
	"context"
	"encoding/json"
	"time"

	"github.com/mkolb22/dockercd/internal/app"
)

// schedulerLoop runs the scheduling loop that pushes app names onto the work queue
// when their poll interval expires or when a manual trigger is received.
// Uses a single reusable timer to avoid per-iteration allocation.
func (r *ReconcilerImpl) schedulerLoop(ctx context.Context) {
	defer r.wg.Done()

	timer := time.NewTimer(10 * time.Second)
	defer timer.Stop()

	for {
		// Compute next wake time and reset the timer
		nextWake := r.nextWakeTime()
		if !timer.Stop() {
			select {
			case <-timer.C:
			default:
			}
		}
		if nextWake.IsZero() {
			timer.Reset(10 * time.Second)
		} else {
			wait := time.Until(nextWake)
			if wait < 0 {
				wait = 0
			}
			timer.Reset(wait)
		}

		select {
		case <-ctx.Done():
			return

		case appName := <-r.trigger:
			// Immediate reconciliation requested
			r.scheduleMu.Lock()
			r.schedule[appName] = time.Now()
			r.scheduleMu.Unlock()
			r.enqueueDueApps()

		case <-timer.C:
			// Sync config directory: register new manifests, remove deleted ones
			r.syncConfigManifests(ctx)
			// Check for due apps
			r.enqueueDueApps()
		}
	}
}

// nextWakeTime returns the earliest scheduled time across all apps.
func (r *ReconcilerImpl) nextWakeTime() time.Time {
	r.scheduleMu.RLock()
	defer r.scheduleMu.RUnlock()

	var earliest time.Time
	for name, t := range r.schedule {
		if r.queued[name] {
			continue
		}
		if earliest.IsZero() || t.Before(earliest) {
			earliest = t
		}
	}
	return earliest
}

// enqueueDueApps checks all scheduled apps and enqueues those whose time has arrived.
func (r *ReconcilerImpl) enqueueDueApps() {
	now := time.Now()

	r.scheduleMu.Lock()
	var due []string
	for name, t := range r.schedule {
		if !t.After(now) && !r.queued[name] {
			r.queued[name] = true
			due = append(due, name)
		}
	}
	r.scheduleMu.Unlock()

	for _, name := range due {
		if !r.enqueue(name) {
			// A full queue must not leave this app immediately due, or the
			// scheduler will spin while workers are busy. Retry shortly instead.
			r.scheduleMu.Lock()
			r.queued[name] = false
			r.schedule[name] = time.Now().Add(queueRetryInterval)
			r.scheduleMu.Unlock()
		}
	}
}

// enqueue pushes an app name onto the work queue if not full.
func (r *ReconcilerImpl) enqueue(appName string) bool {
	select {
	case r.workQueue <- appName:
		return true
	default:
		r.logger.Debug("work queue full, skipping", "app", appName)
		return false
	}
}

// reschedule sets the next reconciliation time for an app based on its poll interval.
func (r *ReconcilerImpl) reschedule(ctx context.Context, appName string) {
	interval := r.getAppPollInterval(ctx, appName)

	r.scheduleMu.Lock()
	r.schedule[appName] = time.Now().Add(interval)
	delete(r.queued, appName)
	r.scheduleMu.Unlock()
}

// getAppPollInterval loads the poll interval for an app from its manifest.
// A global override (if set) takes precedence over per-app intervals.
// Returns a default of 3 minutes if the app or interval can't be read.
func (r *ReconcilerImpl) getAppPollInterval(ctx context.Context, appName string) time.Duration {
	defaultInterval := r.deps.DefaultPollInterval
	if defaultInterval <= 0 {
		defaultInterval = 3 * time.Minute
	}

	// Check global override first
	r.pollOverrideMu.RLock()
	override := r.pollOverride
	r.pollOverrideMu.RUnlock()
	if override > 0 {
		return override
	}

	appRec, err := r.deps.Store.GetApplication(ctx, appName)
	if err != nil || appRec == nil {
		return defaultInterval
	}

	var application app.Application
	if err := json.Unmarshal([]byte(appRec.Manifest), &application); err != nil {
		return defaultInterval
	}

	if application.Spec.SyncPolicy.PollInterval.Duration > 0 {
		return application.Spec.SyncPolicy.PollInterval.Duration
	}

	return defaultInterval
}

// AddApp adds a new application to the schedule for immediate reconciliation.
func (r *ReconcilerImpl) AddApp(appName string) {
	r.scheduleMu.Lock()
	r.schedule[appName] = time.Now()
	r.scheduleMu.Unlock()
}

// RemoveApp removes an application from the schedule and cleans up associated
// per-app state (locks, circuit breakers) to prevent unbounded map growth.
func (r *ReconcilerImpl) RemoveApp(appName string) {
	r.scheduleMu.Lock()
	delete(r.schedule, appName)
	delete(r.queued, appName)
	r.scheduleMu.Unlock()

	r.appLocks.Delete(appName)
	r.breakers.Delete(appName)
}
