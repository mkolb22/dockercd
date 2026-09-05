package app

import "testing"

func TestRedactComposeSpec(t *testing.T) {
	spec := &ComposeSpec{Services: []ServiceSpec{{
		Name:        "api",
		Environment: map[string]string{"PASSWORD": "secret", "EMPTY": ""},
	}}}

	redacted := RedactComposeSpec(spec)
	if got := redacted.Services[0].Environment["PASSWORD"]; got != RedactedValue {
		t.Fatalf("password = %q, want %q", got, RedactedValue)
	}
	if got := redacted.Services[0].Environment["EMPTY"]; got != "" {
		t.Fatalf("empty value = %q, want empty", got)
	}
	if got := spec.Services[0].Environment["PASSWORD"]; got != "secret" {
		t.Fatalf("source spec was modified: %q", got)
	}
}

func TestRedactDiff(t *testing.T) {
	diff := &DiffResult{ToUpdate: []ServiceDiff{{
		Fields:       []FieldDiff{{Field: "environment.TOKEN", Desired: "desired", Live: "live"}},
		DesiredState: &ServiceSpec{Environment: map[string]string{"TOKEN": "desired"}},
		LiveState:    &ServiceState{Environment: map[string]string{"TOKEN": "live"}},
	}}}

	redacted := RedactDiff(diff)
	got := redacted.ToUpdate[0]
	if got.Fields[0].Desired != RedactedValue || got.Fields[0].Live != RedactedValue {
		t.Fatalf("field diff was not redacted: %#v", got.Fields[0])
	}
	if got.DesiredState.Environment["TOKEN"] != RedactedValue || got.LiveState.Environment["TOKEN"] != RedactedValue {
		t.Fatal("service states were not redacted")
	}
}

func TestRedactRepoURL(t *testing.T) {
	if got, want := RedactRepoURL("https://user:password@example.com/org/repo.git"), "https://example.com/org/repo.git"; got != want {
		t.Fatalf("RedactRepoURL() = %q, want %q", got, want)
	}
}
