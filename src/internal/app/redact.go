package app

import (
	"net/url"
	"strings"
)

// RedactedValue replaces secret material in data that crosses a persistence or
// API boundary. Environment variable names remain available for diagnostics.
const RedactedValue = "[REDACTED]"

// RedactRepoURL removes embedded userinfo while preserving the repository
// location for display and webhook matching.
func RedactRepoURL(repoURL string) string {
	u, err := url.Parse(repoURL)
	if err != nil || u.User == nil {
		return repoURL
	}
	u.User = nil
	return u.String()
}

// RedactComposeSpec returns a copy whose environment values are redacted.
func RedactComposeSpec(spec *ComposeSpec) *ComposeSpec {
	if spec == nil {
		return nil
	}
	out := *spec
	out.Services = make([]ServiceSpec, len(spec.Services))
	for i, service := range spec.Services {
		out.Services[i] = service
		out.Services[i].Environment = redactEnvironment(service.Environment)
	}
	return &out
}

// RedactServiceDetail returns a copy whose environment values are redacted.
func RedactServiceDetail(detail *ServiceDetail) *ServiceDetail {
	if detail == nil {
		return nil
	}
	out := *detail
	out.Environment = redactEnvironment(detail.Environment)
	return &out
}

// RedactDiff returns a copy with all environment values removed from desired,
// live, and field-level state. It preserves variable names and change shape.
func RedactDiff(diff *DiffResult) *DiffResult {
	if diff == nil {
		return nil
	}
	out := *diff
	out.ToCreate = redactServiceDiffs(diff.ToCreate)
	out.ToUpdate = redactServiceDiffs(diff.ToUpdate)
	out.ToRemove = redactServiceDiffs(diff.ToRemove)
	return &out
}

// RedactSyncResult returns an API-safe copy of a sync result.
func RedactSyncResult(result *SyncResult) *SyncResult {
	if result == nil {
		return nil
	}
	out := *result
	out.Diff = RedactDiff(result.Diff)
	out.ComposeSpecJSON = ""
	return &out
}

func redactServiceDiffs(diffs []ServiceDiff) []ServiceDiff {
	if diffs == nil {
		return nil
	}
	out := make([]ServiceDiff, len(diffs))
	for i, diff := range diffs {
		out[i] = diff
		out[i].Fields = append([]FieldDiff(nil), diff.Fields...)
		for j := range out[i].Fields {
			if strings.HasPrefix(out[i].Fields[j].Field, "environment.") {
				out[i].Fields[j].Desired = redactValue(out[i].Fields[j].Desired)
				out[i].Fields[j].Live = redactValue(out[i].Fields[j].Live)
			}
		}
		if diff.DesiredState != nil {
			redacted := *diff.DesiredState
			redacted.Environment = redactEnvironment(diff.DesiredState.Environment)
			out[i].DesiredState = &redacted
		}
		if diff.LiveState != nil {
			redacted := *diff.LiveState
			redacted.Environment = redactEnvironment(diff.LiveState.Environment)
			out[i].LiveState = &redacted
		}
	}
	return out
}

func redactEnvironment(environment map[string]string) map[string]string {
	if environment == nil {
		return nil
	}
	out := make(map[string]string, len(environment))
	for key, value := range environment {
		out[key] = redactValue(value)
	}
	return out
}

func redactValue(value string) string {
	if value == "" {
		return ""
	}
	return RedactedValue
}
