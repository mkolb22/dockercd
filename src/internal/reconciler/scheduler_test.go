package reconciler

import (
	"context"
	"testing"
	"time"
)

func TestScheduler_NextWakeTime_Empty(t *testing.T) {
	r := New(Deps{Logger: testLogger(), WorkerCount: 1})

	wake := r.nextWakeTime()
	if !wake.IsZero() {
		t.Errorf("expected zero time for empty schedule, got %v", wake)
	}
}

func TestScheduler_NextWakeTime_ReturnsEarliest(t *testing.T) {
	r := New(Deps{Logger: testLogger(), WorkerCount: 1})

	now := time.Now()
	r.scheduleMu.Lock()
	r.schedule["app1"] = now.Add(5 * time.Minute)
	r.schedule["app2"] = now.Add(1 * time.Minute)
	r.schedule["app3"] = now.Add(3 * time.Minute)
	r.scheduleMu.Unlock()

	wake := r.nextWakeTime()
	expected := now.Add(1 * time.Minute)

	// Allow 1ms tolerance
	if wake.Sub(expected) > time.Millisecond || expected.Sub(wake) > time.Millisecond {
		t.Errorf("expected wake at ~%v, got %v", expected, wake)
	}
}

func TestScheduler_EnqueueDueApps(t *testing.T) {
	r := New(Deps{Logger: testLogger(), WorkerCount: 1})

	now := time.Now()
	r.scheduleMu.Lock()
	r.schedule["due1"] = now.Add(-1 * time.Second)    // past due
	r.schedule["due2"] = now.Add(-5 * time.Second)    // past due
	r.schedule["future"] = now.Add(5 * time.Minute)   // not due
	r.scheduleMu.Unlock()

	r.enqueueDueApps()

	// Should have 2 items in the work queue
	timeout := time.After(100 * time.Millisecond)
	var received []string
	for {
		select {
		case name := <-r.workQueue:
			received = append(received, name)
			if len(received) == 2 {
				goto done
			}
		case <-timeout:
			goto done
		}
	}
done:

	if len(received) != 2 {
		t.Errorf("expected 2 due apps, got %d", len(received))
	}
}

func TestScheduler_Enqueue_FullQueue(t *testing.T) {
	r := New(Deps{Logger: testLogger(), WorkerCount: 1})
	// Queue capacity is workers*2 = 2

	r.enqueue("app1")
	r.enqueue("app2")
	// Queue should be full now
	r.enqueue("app3") // Should not block, just skip

	// Drain and verify
	var count int
	timeout := time.After(100 * time.Millisecond)
	for {
		select {
		case <-r.workQueue:
			count++
		case <-timeout:
			goto done
		}
	}
done:

	if count != 2 {
		t.Errorf("expected 2 items (queue capacity), got %d", count)
	}
}

func TestScheduler_AddApp(t *testing.T) {
	r := New(Deps{Logger: testLogger(), WorkerCount: 1})

	r.AddApp("new-app")

	r.scheduleMu.RLock()
	_, exists := r.schedule["new-app"]
	r.scheduleMu.RUnlock()

	if !exists {
		t.Error("expected new-app in schedule")
	}
}

func TestScheduler_RemoveApp(t *testing.T) {
	r := New(Deps{Logger: testLogger(), WorkerCount: 1})

	r.AddApp("to-remove")
	r.RemoveApp("to-remove")

	r.scheduleMu.RLock()
	_, exists := r.schedule["to-remove"]
	r.scheduleMu.RUnlock()

	if exists {
		t.Error("expected to-remove NOT in schedule")
	}
}

func TestScheduler_Reschedule(t *testing.T) {
	s := setupTestStore(t)
	createTestApp(t, s, "myapp", true, "")

	r := newTestReconciler(s, &mockGitSyncer{}, &mockParser{}, &mockInspector{}, &mockDiffer{}, &mockDeployer{})

	before := time.Now()
	r.reschedule(context.Background(), "myapp")
	after := time.Now()

	r.scheduleMu.RLock()
	nextTime := r.schedule["myapp"]
	r.scheduleMu.RUnlock()

	// Default poll interval is 3 minutes
	expectedMin := before.Add(3 * time.Minute)
	expectedMax := after.Add(3 * time.Minute)

	if nextTime.Before(expectedMin) || nextTime.After(expectedMax) {
		t.Errorf("next time should be ~3min from now, got %v (expected between %v and %v)",
			nextTime, expectedMin, expectedMax)
	}
}

func TestScheduler_TriggerReconcile(t *testing.T) {
	r := New(Deps{Logger: testLogger(), WorkerCount: 1})

	r.TriggerReconcile("myapp")

	select {
	case name := <-r.trigger:
		if name != "myapp" {
			t.Errorf("expected myapp, got %q", name)
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("expected trigger to be received")
	}
}

func TestScheduler_TriggerFull(t *testing.T) {
	r := New(Deps{Logger: testLogger(), WorkerCount: 1})

	// Fill the trigger channel (capacity 16)
	for i := 0; i < 16; i++ {
		r.TriggerReconcile("app")
	}

	// This should not block
	r.TriggerReconcile("overflow")

	// Drain
	for i := 0; i < 16; i++ {
		<-r.trigger
	}
}
