package reconciler

import (
	"context"
	"encoding/json"
	"time"

	"github.com/mkolb22/dockercd/internal/app"
)

// schedulerLoop runs the scheduling loop that pushes app names onto the work queue
// when their poll interval expires or when a manual trigger is received.
func (r *ReconcilerImpl) schedulerLoop(ctx context.Context) {
	defer r.wg.Done()

	for {
		// Compute next wake time
		nextWake := r.nextWakeTime()
		var timer *time.Timer
		if nextWake.IsZero() {
			// No apps scheduled — wait for trigger or context cancel
			timer = time.NewTimer(10 * time.Second)
		} else {
			wait := time.Until(nextWake)
			if wait < 0 {
				wait = 0
			}
			timer = time.NewTimer(wait)
		}

		select {
		case <-ctx.Done():
			timer.Stop()
			return

		case appName := <-r.trigger:
			timer.Stop()
			// Immediate reconciliation requested
			r.scheduleMu.Lock()
			r.schedule[appName] = time.Now()
			r.scheduleMu.Unlock()
			r.enqueue(appName)

		case <-timer.C:
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
	for _, t := range r.schedule {
		if earliest.IsZero() || t.Before(earliest) {
			earliest = t
		}
	}
	return earliest
}

// enqueueDueApps checks all scheduled apps and enqueues those whose time has arrived.
func (r *ReconcilerImpl) enqueueDueApps() {
	now := time.Now()

	r.scheduleMu.RLock()
	var due []string
	for name, t := range r.schedule {
		if !t.After(now) {
			due = append(due, name)
		}
	}
	r.scheduleMu.RUnlock()

	for _, name := range due {
		r.enqueue(name)
	}
}

// enqueue pushes an app name onto the work queue if not full.
func (r *ReconcilerImpl) enqueue(appName string) {
	select {
	case r.workQueue <- appName:
	default:
		r.logger.Debug("work queue full, skipping", "app", appName)
	}
}

// reschedule sets the next reconciliation time for an app based on its poll interval.
func (r *ReconcilerImpl) reschedule(appName string) {
	interval := r.getAppPollInterval(appName)

	r.scheduleMu.Lock()
	r.schedule[appName] = time.Now().Add(interval)
	r.scheduleMu.Unlock()
}

// getAppPollInterval loads the poll interval for an app from its manifest.
// A global override (if set) takes precedence over per-app intervals.
// Returns a default of 3 minutes if the app or interval can't be read.
func (r *ReconcilerImpl) getAppPollInterval(appName string) time.Duration {
	const defaultInterval = 3 * time.Minute

	// Check global override first
	r.pollOverrideMu.RLock()
	override := r.pollOverride
	r.pollOverrideMu.RUnlock()
	if override > 0 {
		return override
	}

	appRec, err := r.deps.Store.GetApplication(context.Background(), appName)
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

// RemoveApp removes an application from the schedule.
func (r *ReconcilerImpl) RemoveApp(appName string) {
	r.scheduleMu.Lock()
	delete(r.schedule, appName)
	r.scheduleMu.Unlock()
}
