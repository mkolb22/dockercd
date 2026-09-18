package cli

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/mkolb22/dockercd/internal/app"
)

const maxAPIErrorBody = 64 << 10
const maxAPISuccessBody = 1 << 20

// responseError turns a non-success controller response into a bounded,
// operator-actionable error before a command attempts to decode it as a
// successful resource. The controller's standard error schema is intentionally
// the only response body data surfaced; arbitrary upstream response bodies are
// neither trusted nor printed.
func responseError(resp *http.Response) error {
	if resp.StatusCode >= http.StatusOK && resp.StatusCode < http.StatusMultipleChoices {
		return nil
	}

	var payload struct {
		Error string `json:"error"`
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxAPIErrorBody))
	if err == nil {
		_ = json.Unmarshal(data, &payload)
	}

	message := strings.TrimSpace(payload.Error)
	if message == "" {
		message = http.StatusText(resp.StatusCode)
	}
	return fmt.Errorf("controller request failed (HTTP %d): %s", resp.StatusCode, message)
}

// decodeResponse bounds successful controller responses before decoding them.
// A controller bug or an unexpected intermediary therefore cannot make a CLI
// status or recovery command allocate without limit.
func decodeResponse(body io.Reader, target any) error {
	data, err := io.ReadAll(io.LimitReader(body, maxAPISuccessBody+1))
	if err != nil {
		return fmt.Errorf("reading controller response: %w", err)
	}
	if len(data) > maxAPISuccessBody {
		return fmt.Errorf("controller response exceeds %d byte limit", maxAPISuccessBody)
	}
	if err := json.Unmarshal(data, target); err != nil {
		return fmt.Errorf("decoding response: %w", err)
	}
	return nil
}

// syncResultError preserves a successful transport response while ensuring a
// failed controller operation still produces a non-zero CLI exit status.
func syncResultError(operation string, result app.SyncResult) error {
	if result.Result == app.SyncResultSuccess {
		return nil
	}
	if operation == "sync" && result.Result == app.SyncResultSkipped &&
		strings.TrimSpace(result.Error) == "" && result.Diff != nil && result.Diff.InSync {
		return nil
	}
	if detail := strings.TrimSpace(result.Error); detail != "" {
		return fmt.Errorf("%s operation reported %q: %s", operation, result.Result, detail)
	}
	return fmt.Errorf("%s operation reported %q", operation, result.Result)
}
