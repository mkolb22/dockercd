// contract_test.go — Property-based contract tests for the api package.
// Generated from ZenSpec "api-responses".
//
// Tests the pure utility functions: writeJSON, writeError, queryInt.
package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"testing"

	"pgregory.net/rapid"
)

// --- Contract: writeJSON ---

// TestContract_WriteJSONSetsStatusCode verifies the HTTP status code is set.
func TestContract_WriteJSONSetsStatusCode(t *testing.T) {
	codes := []int{200, 201, 204, 400, 404, 500}
	for _, code := range codes {
		w := httptest.NewRecorder()
		writeJSON(w, code, map[string]string{"test": "value"})
		if w.Code != code {
			t.Fatalf("writeJSON status: want %d, got %d", code, w.Code)
		}
	}
}

// TestContract_WriteJSONEncodesBody verifies the response body is valid JSON.
func TestContract_WriteJSONEncodesBody(t *testing.T) {
	w := httptest.NewRecorder()
	data := map[string]string{"key": "value"}
	writeJSON(w, http.StatusOK, data)

	var decoded map[string]string
	if err := json.NewDecoder(w.Body).Decode(&decoded); err != nil {
		t.Fatalf("response body is not valid JSON: %v", err)
	}
	if decoded["key"] != "value" {
		t.Fatalf("decoded body: want key=value, got %v", decoded)
	}
}

// TestContract_WriteJSONStatusCodeProperty verifies random status codes are set correctly.
func TestContract_WriteJSONStatusCodeProperty(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		code := rapid.IntRange(100, 599).Draw(t, "code")
		w := httptest.NewRecorder()
		writeJSON(w, code, map[string]bool{"ok": true})
		if w.Code != code {
			t.Fatalf("writeJSON: want status %d, got %d", code, w.Code)
		}
	})
}

// --- Contract: writeError ---

// TestContract_WriteErrorSetsStatusCode verifies the HTTP status code is set.
func TestContract_WriteErrorSetsStatusCode(t *testing.T) {
	w := httptest.NewRecorder()
	writeError(w, http.StatusNotFound, "not found", CodeNotFound)
	if w.Code != http.StatusNotFound {
		t.Fatalf("writeError status: want 404, got %d", w.Code)
	}
}

// TestContract_WriteErrorEncodesErrorResponse verifies error response structure.
func TestContract_WriteErrorEncodesErrorResponse(t *testing.T) {
	w := httptest.NewRecorder()
	writeError(w, http.StatusBadRequest, "invalid input", CodeBadRequest)

	var resp ErrorResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("response body is not valid JSON: %v", err)
	}
	if resp.Error != "invalid input" {
		t.Fatalf("error message: want \"invalid input\", got %q", resp.Error)
	}
	if resp.Code != CodeBadRequest {
		t.Fatalf("error code: want %q, got %q", CodeBadRequest, resp.Code)
	}
}

// TestContract_WriteErrorPreservesMessage verifies the error message is preserved.
func TestContract_WriteErrorPreservesMessage(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		msg := rapid.StringMatching(`[a-zA-Z0-9 ]{1,50}`).Draw(t, "msg")
		code := rapid.SampledFrom([]string{
			CodeNotFound, CodeBadRequest, CodeInternalError, CodeConflict,
		}).Draw(t, "code")
		status := rapid.SampledFrom([]int{400, 404, 409, 500}).Draw(t, "status")

		w := httptest.NewRecorder()
		writeError(w, status, msg, code)

		var resp ErrorResponse
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatalf("invalid JSON: %v", err)
		}
		if resp.Error != msg {
			t.Fatalf("message not preserved: want %q, got %q", msg, resp.Error)
		}
		if resp.Code != code {
			t.Fatalf("code not preserved: want %q, got %q", code, resp.Code)
		}
	})
}

// --- Contract: queryInt ---

// TestContract_QueryIntMissingKey verifies missing key returns default.
func TestContract_QueryIntMissingKey(t *testing.T) {
	r := &http.Request{URL: &url.URL{RawQuery: ""}}
	result := queryInt(r, "limit", 50)
	if result != 50 {
		t.Fatalf("missing key: want 50, got %d", result)
	}
}

// TestContract_QueryIntValidValue verifies valid integer is returned.
func TestContract_QueryIntValidValue(t *testing.T) {
	r := &http.Request{URL: &url.URL{RawQuery: "limit=25"}}
	result := queryInt(r, "limit", 50)
	if result != 25 {
		t.Fatalf("valid value: want 25, got %d", result)
	}
}

// TestContract_QueryIntInvalidValue verifies non-integer returns default.
func TestContract_QueryIntInvalidValue(t *testing.T) {
	r := &http.Request{URL: &url.URL{RawQuery: "limit=abc"}}
	result := queryInt(r, "limit", 50)
	if result != 50 {
		t.Fatalf("invalid value: want default 50, got %d", result)
	}
}

// TestContract_QueryIntZeroValue verifies zero returns default (< 1 guard).
func TestContract_QueryIntZeroValue(t *testing.T) {
	r := &http.Request{URL: &url.URL{RawQuery: "limit=0"}}
	result := queryInt(r, "limit", 50)
	if result != 50 {
		t.Fatalf("zero value: want default 50, got %d", result)
	}
}

// TestContract_QueryIntNegativeValue verifies negative returns default.
func TestContract_QueryIntNegativeValue(t *testing.T) {
	r := &http.Request{URL: &url.URL{RawQuery: "limit=-5"}}
	result := queryInt(r, "limit", 50)
	if result != 50 {
		t.Fatalf("negative value: want default 50, got %d", result)
	}
}

// TestContract_QueryIntProperty verifies valid positive integers are returned, others default.
func TestContract_QueryIntProperty(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		val := rapid.IntRange(-100, 200).Draw(t, "value")
		def := rapid.IntRange(1, 100).Draw(t, "default")
		r := &http.Request{
			URL: &url.URL{RawQuery: "n=" + strconv.Itoa(val)},
		}
		result := queryInt(r, "n", def)
		if val >= 1 {
			if result != val {
				t.Fatalf("valid positive %d: want %d, got %d", val, val, result)
			}
		} else {
			if result != def {
				t.Fatalf("non-positive %d: want default %d, got %d", val, def, result)
			}
		}
	})
}

// TestContract_QueryIntDefaultReturnedForEmptyString verifies empty value returns default.
func TestContract_QueryIntDefaultReturnedForEmptyString(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		def := rapid.IntRange(1, 1000).Draw(t, "default")
		key := rapid.StringMatching(`[a-z]{2,6}`).Draw(t, "key")
		r := &http.Request{URL: &url.URL{RawQuery: ""}}
		result := queryInt(r, key, def)
		if result != def {
			t.Fatalf("missing key %q: want default %d, got %d", key, def, result)
		}
	})
}
