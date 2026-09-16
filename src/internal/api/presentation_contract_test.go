package api

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestPresentationV1FixturesAreStrictAndRedacted keeps the controller DTO
// serialization aligned with the fixture contract consumed by the separate
// Web Go module. The production handlers have their own authorization and
// response tests; this test detects wire-shape drift between modules.
func TestPresentationV1FixturesAreStrictAndRedacted(t *testing.T) {
	for _, test := range []struct {
		name string
		file string
		new  func() any
	}{
		{name: "capabilities", file: "capabilities.json", new: func() any { return &PresentationCapabilitiesResponse{} }},
		{name: "fleet", file: "fleet.json", new: func() any { return &PresentationFleetResponse{} }},
		{name: "application", file: "application.json", new: func() any { return &PresentationApplicationResponse{} }},
		{name: "activity", file: "activity.json", new: func() any { return &PresentationActivityResponse{} }},
	} {
		t.Run(test.name, func(t *testing.T) {
			raw := presentationFixture(t, test.file)
			for _, forbidden := range []string{"token", "password", "secret", "manifest", "repository", "service", "log", "error", "environment"} {
				if strings.Contains(strings.ToLower(string(raw)), forbidden) {
					t.Fatalf("fixture %s contains forbidden presentation data %q", test.file, forbidden)
				}
			}
			decoded := test.new()
			decoder := json.NewDecoder(bytes.NewReader(raw))
			decoder.DisallowUnknownFields()
			if err := decoder.Decode(decoded); err != nil {
				t.Fatalf("decode %s: %v", test.file, err)
			}
			if err := requireJSONEOF(decoder); err != nil {
				t.Fatalf("trailing %s data: %v", test.file, err)
			}
			encoded, err := json.Marshal(decoded)
			if err != nil {
				t.Fatalf("marshal %s: %v", test.file, err)
			}
			if !bytes.Equal(encoded, bytes.TrimSpace(raw)) {
				t.Fatalf("controller DTO shape drifted for %s\nwant: %s\n got: %s", test.file, bytes.TrimSpace(raw), encoded)
			}
		})
	}
}

func presentationFixture(t *testing.T, name string) []byte {
	t.Helper()
	// go test executes each package from its source directory. This deliberate
	// package-relative path works with -trimpath, unlike runtime.Caller paths.
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "contracts", "presentation", "v1", name))
	if err != nil {
		t.Fatalf("read %s: %v", name, err)
	}
	return raw
}
