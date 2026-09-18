package cli

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestRecoveryCommandsReturnControllerErrors(t *testing.T) {
	t.Setenv("DOCKERCD_API_TOKEN", "")
	previousToken := apiToken
	apiToken = ""
	t.Cleanup(func() { apiToken = previousToken })

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":"authentication required","code":"Unauthorized"}`))
	}))
	defer server.Close()

	commands := map[string]func() error{
		"list":     func() error { return runAppList(server.URL, false) },
		"get":      func() error { return runAppGet(server.URL, "my-app") },
		"sync":     func() error { return runAppSync(server.URL, "my-app") },
		"diff":     func() error { return runAppDiff(server.URL, "my-app", false) },
		"desired":  func() error { return runAppDesired(server.URL, "my-app") },
		"rollback": func() error { return runAppRollback(server.URL, "my-app", "known-good") },
		"adopt":    func() error { return runAppAdopt(server.URL, "my-app") },
	}

	for name, run := range commands {
		t.Run(name, func(t *testing.T) {
			err := run()
			if err == nil {
				t.Fatal("expected controller error, got nil")
			}
			want := "controller request failed (HTTP 401): authentication required"
			if err.Error() != want {
				t.Fatalf("error = %q, want %q", err, want)
			}
		})
	}
}

func TestResponseErrorBoundsAndDoesNotEchoUnexpectedBodies(t *testing.T) {
	body := strings.Repeat("sensitive-unstructured-body", maxAPIErrorBody)
	response := &http.Response{
		StatusCode: http.StatusBadGateway,
		Body:       ioNopCloser(strings.NewReader(body)),
	}

	err := responseError(response)
	if err == nil {
		t.Fatal("expected error")
	}
	if got, want := err.Error(), fmt.Sprintf("controller request failed (HTTP %d): %s", http.StatusBadGateway, http.StatusText(http.StatusBadGateway)); got != want {
		t.Fatalf("error = %q, want %q", got, want)
	}
}

func TestRecoveryCommandRejectsRedirectWithoutFollowingIt(t *testing.T) {
	t.Setenv("DOCKERCD_API_TOKEN", "")
	previousToken := apiToken
	apiToken = ""
	t.Cleanup(func() { apiToken = previousToken })

	var redirected atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/redirect-target" {
			redirected.Store(true)
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"result":"success"}`))
			return
		}
		http.Redirect(w, r, "/redirect-target", http.StatusFound)
	}))
	defer server.Close()

	err := runAppSync(server.URL, "my-app")
	if err == nil {
		t.Fatal("expected redirect to be an error")
	}
	if got, want := err.Error(), "controller request failed (HTTP 302): Found"; got != want {
		t.Fatalf("error = %q, want %q", got, want)
	}
	if redirected.Load() {
		t.Fatal("CLI followed a redirect instead of reporting the original response")
	}
}

func TestSyncAndRollbackReturnErrorForReportedOperationFailure(t *testing.T) {
	t.Setenv("DOCKERCD_API_TOKEN", "")
	previousToken := apiToken
	apiToken = ""
	t.Cleanup(func() { apiToken = previousToken })

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"result":"failure","error":"deployment health check failed"}`))
	}))
	defer server.Close()

	commands := map[string]func() error{
		"sync":     func() error { return runAppSync(server.URL, "my-app") },
		"rollback": func() error { return runAppRollback(server.URL, "my-app", "known-good") },
	}
	for name, run := range commands {
		t.Run(name, func(t *testing.T) {
			err := run()
			if err == nil {
				t.Fatal("expected operation failure, got nil")
			}
			want := name + ` operation reported "failure": deployment health check failed`
			if err.Error() != want {
				t.Fatalf("error = %q, want %q", err, want)
			}
		})
	}
}

func TestSyncAcceptsEvidencedNoOpButRejectsBlockedSkip(t *testing.T) {
	t.Setenv("DOCKERCD_API_TOKEN", "")
	previousToken := apiToken
	apiToken = ""
	t.Cleanup(func() { apiToken = previousToken })

	tests := []struct {
		name    string
		result  string
		diff    string
		error   string
		wantErr string
	}{
		{
			name:   "already in sync",
			result: "skipped",
			diff:   `,"diff":{"inSync":true}`,
		},
		{
			name:    "circuit breaker skip",
			result:  "skipped",
			error:   `,"error":"circuit breaker open"`,
			wantErr: `sync operation reported "skipped": circuit breaker open`,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_, _ = fmt.Fprintf(w, `{"result":%q%s%s}`, test.result, test.diff, test.error)
			}))
			defer server.Close()

			err := runAppSync(server.URL, "my-app")
			if test.wantErr == "" && err != nil {
				t.Fatalf("error = %v, want nil", err)
			}
			if test.wantErr != "" && (err == nil || err.Error() != test.wantErr) {
				t.Fatalf("error = %v, want %q", err, test.wantErr)
			}
		})
	}
}

func TestRollbackSuccessAndSuccessfulResponseBound(t *testing.T) {
	t.Setenv("DOCKERCD_API_TOKEN", "")
	previousToken := apiToken
	apiToken = ""
	t.Cleanup(func() { apiToken = previousToken })

	t.Run("success", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"result":"success","commitSHA":"known-good"}`))
		}))
		defer server.Close()
		if err := runAppRollback(server.URL, "my-app", "known-good"); err != nil {
			t.Fatalf("rollback error = %v, want nil", err)
		}
	})

	t.Run("oversized", func(t *testing.T) {
		payload, err := json.Marshal(map[string]string{
			"result": "success",
			"error":  strings.Repeat("x", maxAPISuccessBody),
		})
		if err != nil {
			t.Fatalf("marshal payload: %v", err)
		}
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write(payload)
		}))
		defer server.Close()

		err = runAppRollback(server.URL, "my-app", "known-good")
		want := fmt.Sprintf("controller response exceeds %d byte limit", maxAPISuccessBody)
		if err == nil || err.Error() != want {
			t.Fatalf("error = %v, want %q", err, want)
		}
	})
}

func ioNopCloser(reader *strings.Reader) io.ReadCloser { return io.NopCloser(reader) }
