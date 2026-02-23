// Package notifier provides structured notification delivery for application events.
// It supports multiple backends (Slack, generic webhooks) via a composable MultiNotifier.
package notifier

import (
	"context"
	"log/slog"
	"time"
)

// NotificationEvent represents an event to be notified about.
type NotificationEvent struct {
	Type    string      `json:"type"`    // e.g., "sync.success", "sync.failure", "health.degraded", "rollback"
	AppName string      `json:"appName"`
	Message string      `json:"message"`
	Data    interface{} `json:"data,omitempty"`
	Time    time.Time   `json:"time"`
}

// Notifier sends notifications for application events.
type Notifier interface {
	Notify(ctx context.Context, event NotificationEvent) error
}

// MultiNotifier dispatches notifications to multiple backends.
type MultiNotifier struct {
	notifiers []Notifier
	logger    *slog.Logger
}

// NewMulti creates a MultiNotifier that dispatches to all given notifiers.
func NewMulti(logger *slog.Logger, notifiers ...Notifier) *MultiNotifier {
	return &MultiNotifier{notifiers: notifiers, logger: logger}
}

// Notify sends the event to all registered notifiers, logging errors but not failing.
func (m *MultiNotifier) Notify(ctx context.Context, event NotificationEvent) error {
	for _, n := range m.notifiers {
		if err := n.Notify(ctx, event); err != nil {
			m.logger.Error("notification failed",
				"error", err,
				"app", event.AppName,
				"type", event.Type,
			)
		}
	}
	return nil
}
