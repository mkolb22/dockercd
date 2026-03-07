package reconciler

import (
	"context"
	"sync"
	"time"
)

// worker reads app names from the work queue and runs reconciliation.
func (r *ReconcilerImpl) worker(ctx context.Context, id int) {
	defer r.wg.Done()
	logger := r.logger.With("worker", id)

	for {
		select {
		case <-ctx.Done():
			return
		case appName, ok := <-r.workQueue:
			if !ok {
				return
			}

			// Acquire per-app lock (non-blocking)
			lock := r.getAppLock(appName)
			if !lock.TryLock() {
				logger.Debug("app already being reconciled, skipping", "app", appName)
				continue
			}

			logger.Debug("reconciling", "app", appName)
			result, err := r.reconcileApp(ctx, appName, false)
			lock.Unlock()

			// Reschedule for next poll interval
			r.reschedule(ctx, appName)

			if err != nil {
				logger.Error("reconciliation failed",
					"app", appName,
					"error", err,
				)
			} else if result != nil {
				logger.Debug("reconciliation complete",
					"app", appName,
					"result", result.Result,
					"duration_ms", result.DurationMs,
				)
			}
		}
	}
}

// CircuitState represents the state of a circuit breaker.
type CircuitState int

const (
	CircuitClosed   CircuitState = iota // normal operation
	CircuitOpen                         // failing, skip reconciliation
	CircuitHalfOpen                     // allow one attempt to see if it recovers
)

// CircuitBreaker prevents runaway reconciliation for broken apps.
// After maxFailures consecutive failures, the circuit opens.
// After resetTimeout, it moves to half-open and allows one attempt.
type CircuitBreaker struct {
	mu           sync.Mutex
	state        CircuitState
	failureCount int
	lastFailure  time.Time

	maxFailures  int
	resetTimeout time.Duration
}

// NewCircuitBreaker creates a new circuit breaker.
func NewCircuitBreaker(maxFailures int, resetTimeout time.Duration) *CircuitBreaker {
	return &CircuitBreaker{
		state:        CircuitClosed,
		maxFailures:  maxFailures,
		resetTimeout: resetTimeout,
	}
}

// Allow returns true if the circuit breaker allows an attempt.
func (cb *CircuitBreaker) Allow() bool {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	switch cb.state {
	case CircuitClosed:
		return true
	case CircuitOpen:
		// Check if reset timeout has elapsed
		if time.Since(cb.lastFailure) >= cb.resetTimeout {
			cb.state = CircuitHalfOpen
			return true
		}
		return false
	case CircuitHalfOpen:
		return true
	default:
		return true
	}
}

// RecordSuccess records a successful reconciliation, resetting the breaker.
func (cb *CircuitBreaker) RecordSuccess() {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	cb.failureCount = 0
	cb.state = CircuitClosed
}

// RecordFailure records a failed reconciliation. Opens the circuit after maxFailures.
func (cb *CircuitBreaker) RecordFailure() {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	cb.failureCount++
	cb.lastFailure = time.Now()

	if cb.state == CircuitHalfOpen {
		// Half-open attempt failed — re-open
		cb.state = CircuitOpen
		return
	}

	if cb.failureCount >= cb.maxFailures {
		cb.state = CircuitOpen
	}
}

// State returns the current circuit state.
func (cb *CircuitBreaker) State() CircuitState {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	return cb.state
}

// FailureCount returns the current consecutive failure count.
func (cb *CircuitBreaker) FailureCount() int {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	return cb.failureCount
}
