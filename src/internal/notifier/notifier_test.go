package notifier

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"
)

func testLogger() *slog.Logger {
	return slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))
}

func TestSlackNotifier(t *testing.T) {
	var received map[string]interface{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewDecoder(r.Body).Decode(&received) //nolint:errcheck
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	n := NewSlack(server.URL)
	err := n.Notify(context.Background(), NotificationEvent{
		Type:    "sync.success",
		AppName: "myapp",
		Message: "Deployed abc1234 via manual",
		Time:    time.Now(),
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if received == nil {
		t.Fatal("expected payload to be received")
	}
}

func TestSlackNotifier_ServerError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	n := NewSlack(server.URL)
	err := n.Notify(context.Background(), NotificationEvent{
		Type:    "sync.failure",
		AppName: "myapp",
		Message: "Sync failed",
		Time:    time.Now(),
	})
	if err == nil {
		t.Fatal("expected error for server error response")
	}
}

func TestWebhookNotifier(t *testing.T) {
	var received NotificationEvent
	var gotHeaders http.Header
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotHeaders = r.Header
		json.NewDecoder(r.Body).Decode(&received) //nolint:errcheck
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	n := NewWebhook(server.URL, map[string]string{"X-Custom": "test"})
	err := n.Notify(context.Background(), NotificationEvent{
		Type:    "sync.success",
		AppName: "myapp",
		Message: "Deployed",
		Time:    time.Now(),
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if received.AppName != "myapp" {
		t.Errorf("expected appName=myapp, got %q", received.AppName)
	}
	if gotHeaders.Get("X-Custom") != "test" {
		t.Error("expected custom header")
	}
}

func TestWebhookNotifier_ServerError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer server.Close()

	n := NewWebhook(server.URL, nil)
	err := n.Notify(context.Background(), NotificationEvent{
		Type:    "sync.failure",
		AppName: "myapp",
		Message: "test",
		Time:    time.Now(),
	})
	if err == nil {
		t.Fatal("expected error for server error response")
	}
}

func TestMultiNotifier(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	n1 := NewSlack(server.URL)
	n2 := NewWebhook(server.URL, nil)
	multi := NewMulti(testLogger(), n1, n2)

	err := multi.Notify(context.Background(), NotificationEvent{
		Type:    "sync.success",
		AppName: "myapp",
		Message: "test",
		Time:    time.Now(),
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if calls != 2 {
		t.Errorf("expected 2 calls, got %d", calls)
	}
}

func TestMultiNotifier_ContinuesOnError(t *testing.T) {
	calls := 0
	// First server: always fails
	failServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer failServer.Close()

	// Second server: always succeeds
	okServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.WriteHeader(http.StatusOK)
	}))
	defer okServer.Close()

	n1 := NewSlack(failServer.URL)
	n2 := NewWebhook(okServer.URL, nil)
	multi := NewMulti(testLogger(), n1, n2)

	// MultiNotifier should return nil even when a notifier fails
	err := multi.Notify(context.Background(), NotificationEvent{
		Type:    "sync.success",
		AppName: "myapp",
		Message: "test",
		Time:    time.Now(),
	})
	if err != nil {
		t.Fatalf("MultiNotifier should not return error: %v", err)
	}
	// The second notifier should still have been called
	if calls != 1 {
		t.Errorf("expected second notifier to be called once, got %d", calls)
	}
}
