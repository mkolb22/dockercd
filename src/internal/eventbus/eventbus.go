// Package eventbus provides a simple in-process event broadcast mechanism
// for streaming real-time events to SSE subscribers.
package eventbus

import (
	"encoding/json"
	"sync"
	"time"
)

// Event represents a broadcasted event.
type Event struct {
	Type      string      `json:"type"`
	AppName   string      `json:"appName,omitempty"`
	Data      interface{} `json:"data,omitempty"`
	Timestamp time.Time   `json:"timestamp"`
}

// Broadcaster broadcasts events to multiple subscribers.
type Broadcaster interface {
	Subscribe() (<-chan Event, func())
	Broadcast(event Event)
}

// Hub is the default Broadcaster implementation.
type Hub struct {
	mu          sync.RWMutex
	subscribers map[uint64]chan Event
	nextID      uint64
}

// NewHub creates a new Hub.
func NewHub() *Hub {
	return &Hub{
		subscribers: make(map[uint64]chan Event),
	}
}

// Subscribe returns an event channel and an unsubscribe function.
func (h *Hub) Subscribe() (<-chan Event, func()) {
	h.mu.Lock()
	id := h.nextID
	h.nextID++
	ch := make(chan Event, 64)
	h.subscribers[id] = ch
	h.mu.Unlock()

	unsubscribe := func() {
		h.mu.Lock()
		delete(h.subscribers, id)
		close(ch)
		h.mu.Unlock()
	}

	return ch, unsubscribe
}

// Broadcast sends an event to all subscribers (non-blocking).
func (h *Hub) Broadcast(event Event) {
	if event.Timestamp.IsZero() {
		event.Timestamp = time.Now()
	}
	h.mu.RLock()
	defer h.mu.RUnlock()

	for _, ch := range h.subscribers {
		select {
		case ch <- event:
		default:
			// Drop event if subscriber is slow
		}
	}
}

// MarshalEvent serializes an event to JSON bytes for use in SSE data fields.
func MarshalEvent(event Event) ([]byte, error) {
	data, err := json.Marshal(event)
	if err != nil {
		return nil, err
	}
	return data, nil
}
