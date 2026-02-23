package events

import (
	"sync/atomic"
	"testing"
	"time"
)

func TestDebouncer_SingleEvent(t *testing.T) {
	d := NewDebouncer(20 * time.Millisecond)

	var called atomic.Int32
	d.Debounce("key", func() { called.Add(1) })

	time.Sleep(50 * time.Millisecond)

	if called.Load() != 1 {
		t.Errorf("expected 1 call, got %d", called.Load())
	}
}

func TestDebouncer_MultipleEvents_OnlyLastFires(t *testing.T) {
	d := NewDebouncer(30 * time.Millisecond)

	var called atomic.Int32
	// Rapid-fire 5 events within the window
	for i := 0; i < 5; i++ {
		d.Debounce("key", func() { called.Add(1) })
		time.Sleep(5 * time.Millisecond)
	}

	// Wait for the debounce window after last event
	time.Sleep(60 * time.Millisecond)

	if called.Load() != 1 {
		t.Errorf("expected exactly 1 call (debounced), got %d", called.Load())
	}
}

func TestDebouncer_DifferentKeys_Independent(t *testing.T) {
	d := NewDebouncer(20 * time.Millisecond)

	var countA, countB atomic.Int32
	d.Debounce("a", func() { countA.Add(1) })
	d.Debounce("b", func() { countB.Add(1) })

	time.Sleep(50 * time.Millisecond)

	if countA.Load() != 1 {
		t.Errorf("expected 1 call for key A, got %d", countA.Load())
	}
	if countB.Load() != 1 {
		t.Errorf("expected 1 call for key B, got %d", countB.Load())
	}
}

func TestDebouncer_StopAll(t *testing.T) {
	d := NewDebouncer(50 * time.Millisecond)

	var called atomic.Int32
	d.Debounce("key", func() { called.Add(1) })

	// Stop before the timer fires
	d.StopAll()
	time.Sleep(80 * time.Millisecond)

	if called.Load() != 0 {
		t.Errorf("expected 0 calls after StopAll, got %d", called.Load())
	}
}

func TestDebouncer_Pending(t *testing.T) {
	d := NewDebouncer(50 * time.Millisecond)

	if d.Pending() != 0 {
		t.Errorf("expected 0 pending, got %d", d.Pending())
	}

	d.Debounce("a", func() {})
	d.Debounce("b", func() {})

	if d.Pending() != 2 {
		t.Errorf("expected 2 pending, got %d", d.Pending())
	}

	// Wait for them to fire
	time.Sleep(80 * time.Millisecond)

	if d.Pending() != 0 {
		t.Errorf("expected 0 pending after firing, got %d", d.Pending())
	}
}

func TestDebouncer_ResetTimer(t *testing.T) {
	d := NewDebouncer(30 * time.Millisecond)

	var value atomic.Int32

	// First call
	d.Debounce("key", func() { value.Store(1) })

	// Reset before it fires
	time.Sleep(15 * time.Millisecond)
	d.Debounce("key", func() { value.Store(2) })

	// Wait for the new timer
	time.Sleep(50 * time.Millisecond)

	if value.Load() != 2 {
		t.Errorf("expected value=2 (last callback), got %d", value.Load())
	}
}
