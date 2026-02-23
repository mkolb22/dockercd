package registry

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestParseImageRef(t *testing.T) {
	tests := []struct {
		input    string
		wantName string
		wantTag  string
	}{
		{"nginx:1.26", "nginx", "1.26"},
		{"nginx", "nginx", "latest"},
		{"myregistry.com/app:v1.0", "myregistry.com/app", "v1.0"},
		{"registry:5000/myapp:2.0", "registry:5000/myapp", "2.0"},
	}

	for _, tt := range tests {
		name, tag := ParseImageRef(tt.input)
		if name != tt.wantName || tag != tt.wantTag {
			t.Errorf("ParseImageRef(%q) = (%q, %q), want (%q, %q)",
				tt.input, name, tag, tt.wantName, tt.wantTag)
		}
	}
}

func TestSemVer_Parse(t *testing.T) {
	tests := []struct {
		input string
		major int
		minor int
		patch int
	}{
		{"1.26.0", 1, 26, 0},
		{"v2.0.1", 2, 0, 1},
		{"1.26", 1, 26, 0},
	}

	for _, tt := range tests {
		sv, err := ParseSemVer(tt.input)
		if err != nil {
			t.Errorf("ParseSemVer(%q): %v", tt.input, err)
			continue
		}
		if sv.Major != tt.major || sv.Minor != tt.minor || sv.Patch != tt.patch {
			t.Errorf("ParseSemVer(%q) = %d.%d.%d, want %d.%d.%d",
				tt.input, sv.Major, sv.Minor, sv.Patch, tt.major, tt.minor, tt.patch)
		}
	}
}

func TestFindLatestTag_Semver(t *testing.T) {
	tags := []string{"1.24.0", "1.25.0", "1.26.0", "1.26.1", "1.27.0", "2.0.0", "latest", "alpine"}

	// PolicySemver: any newer version
	tag, found := FindLatestTag(tags, "1.26.0", PolicySemver)
	if !found || tag != "2.0.0" {
		t.Errorf("semver: expected 2.0.0, got %q (found=%v)", tag, found)
	}

	// PolicyMajor: same major only
	tag, found = FindLatestTag(tags, "1.26.0", PolicyMajor)
	if !found || tag != "1.27.0" {
		t.Errorf("major: expected 1.27.0, got %q (found=%v)", tag, found)
	}

	// PolicyMinor: same major.minor only
	tag, found = FindLatestTag(tags, "1.26.0", PolicyMinor)
	if !found || tag != "1.26.1" {
		t.Errorf("minor: expected 1.26.1, got %q (found=%v)", tag, found)
	}

	// No update available
	_, found = FindLatestTag(tags, "2.0.0", PolicySemver)
	if found {
		t.Error("expected no update for 2.0.0")
	}
}

func TestGenericRegistryChecker_ListTags(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"name": "myapp",
			"tags": []string{"1.0.0", "1.1.0", "2.0.0"},
		})
	}))
	defer srv.Close()

	checker := NewGenericRegistryChecker(srv.URL)
	tags, err := checker.ListTags(context.Background(), "myapp")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(tags) != 3 {
		t.Errorf("expected 3 tags, got %d", len(tags))
	}
}
