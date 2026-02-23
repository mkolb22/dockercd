package events

import (
	"sync"
	"time"
)

// Debouncer groups rapid events for the same key into a single callback
// after a configurable quiet window.
type Debouncer struct {
	window time.Duration
	timers map[string]*time.Timer
	mu     sync.Mutex
}

// NewDebouncer creates a Debouncer with the given quiet window.
func NewDebouncer(window time.Duration) *Debouncer {
	return &Debouncer{
		window: window,
		timers: make(map[string]*time.Timer),
	}
}

// Debounce schedules fn to be called after the quiet window elapses for the
// given key. If Debounce is called again for the same key before the window
// expires, the timer is reset.
func (d *Debouncer) Debounce(key string, fn func()) {
	d.mu.Lock()
	defer d.mu.Unlock()

	if t, exists := d.timers[key]; exists {
		t.Stop()
	}

	d.timers[key] = time.AfterFunc(d.window, func() {
		d.mu.Lock()
		delete(d.timers, key)
		d.mu.Unlock()
		fn()
	})
}

// StopAll cancels all pending debounce timers.
func (d *Debouncer) StopAll() {
	d.mu.Lock()
	defer d.mu.Unlock()

	for key, t := range d.timers {
		t.Stop()
		delete(d.timers, key)
	}
}

// Pending returns the number of pending debounce timers.
func (d *Debouncer) Pending() int {
	d.mu.Lock()
	defer d.mu.Unlock()
	return len(d.timers)
}
