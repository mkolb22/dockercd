package parser

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSubstituteVars_Simple(t *testing.T) {
	vars := map[string]string{"FOO": "bar", "BAZ": "qux"}

	tests := []struct {
		input    string
		expected string
	}{
		{"${FOO}", "bar"},
		{"prefix-${FOO}-suffix", "prefix-bar-suffix"},
		{"$FOO", "bar"},
		{"${FOO}:${BAZ}", "bar:qux"},
		{"no-vars-here", "no-vars-here"},
		{"$$FOO", "$bar"}, // double dollar first $ is literal, second is var
		{"${MISSING}", ""},
	}

	for _, tt := range tests {
		result := substituteVars(tt.input, vars)
		if result != tt.expected {
			t.Errorf("substituteVars(%q) = %q, want %q", tt.input, result, tt.expected)
		}
	}
}

func TestSubstituteVars_DefaultValue(t *testing.T) {
	vars := map[string]string{"SET": "value"}

	tests := []struct {
		input    string
		expected string
	}{
		{"${SET:-fallback}", "value"},
		{"${UNSET:-fallback}", "fallback"},
		{"${EMPTY:-fallback}", "fallback"},
	}

	for _, tt := range tests {
		result := substituteVars(tt.input, vars)
		if result != tt.expected {
			t.Errorf("substituteVars(%q) = %q, want %q", tt.input, result, tt.expected)
		}
	}
}

func TestSubstituteVars_DefaultIfUnset(t *testing.T) {
	vars := map[string]string{"SET": ""}

	// ${SET-fallback} with SET="" should return "" (set but empty)
	result := substituteVars("${SET-fallback}", vars)
	if result != "" {
		t.Errorf("expected empty string (var is set), got %q", result)
	}

	// ${UNSET-fallback} should return "fallback"
	result = substituteVars("${UNSET-fallback}", vars)
	if result != "fallback" {
		t.Errorf("expected 'fallback', got %q", result)
	}
}

func TestSubstituteVars_ErrorIfUnset(t *testing.T) {
	vars := map[string]string{"SET": "value"}

	// Should return the value when set
	result := substituteVars("${SET:?must be set}", vars)
	if result != "value" {
		t.Errorf("expected 'value', got %q", result)
	}

	// Should return error marker when unset
	result = substituteVars("${UNSET:?must be set}", vars)
	expected := "${UNSET:?must be set}"
	if result != expected {
		t.Errorf("expected error marker %q, got %q", expected, result)
	}
}

func TestSubstituteVars_BareVarName(t *testing.T) {
	vars := map[string]string{"MY_VAR": "hello"}

	result := substituteVars("$MY_VAR world", vars)
	if result != "hello world" {
		t.Errorf("expected 'hello world', got %q", result)
	}
}

func TestSubstituteVars_UnterminatedBrace(t *testing.T) {
	vars := map[string]string{}

	// Unterminated ${... should be written literally
	result := substituteVars("${UNTERMINATED", vars)
	if result != "${UNTERMINATED" {
		t.Errorf("expected literal '${UNTERMINATED', got %q", result)
	}
}

func TestSubstituteVars_OsEnvFallback(t *testing.T) {
	// Set an OS env var that's not in our vars map
	os.Setenv("DOCKERCD_TEST_VAR", "from-env")
	defer os.Unsetenv("DOCKERCD_TEST_VAR")

	vars := map[string]string{}
	result := substituteVars("${DOCKERCD_TEST_VAR}", vars)
	if result != "from-env" {
		t.Errorf("expected 'from-env' from os.Getenv, got %q", result)
	}
}

func TestLoadDotEnv_Basic(t *testing.T) {
	dir := t.TempDir()
	envContent := `# Comment
FOO=bar
BAZ=qux
QUOTED="hello world"
SINGLE='test'
EMPTY=
`
	if err := os.WriteFile(filepath.Join(dir, ".env"), []byte(envContent), 0644); err != nil {
		t.Fatalf("write .env: %v", err)
	}

	result := loadDotEnv(filepath.Join(dir, ".env"))

	tests := map[string]string{
		"FOO":    "bar",
		"BAZ":    "qux",
		"QUOTED": "hello world",
		"SINGLE": "test",
		"EMPTY":  "",
	}

	for k, expected := range tests {
		if result[k] != expected {
			t.Errorf("expected %s=%q, got %q", k, expected, result[k])
		}
	}
}

func TestLoadDotEnv_Missing(t *testing.T) {
	result := loadDotEnv("/nonexistent/path/.env")
	if len(result) != 0 {
		t.Errorf("expected empty map for missing file, got %v", result)
	}
}

func TestStripQuotes(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{`"hello"`, "hello"},
		{`'world'`, "world"},
		{`no quotes`, "no quotes"},
		{`"mismatched'`, `"mismatched'`},
		{`""`, ""},
		{`a`, "a"},
	}

	for _, tt := range tests {
		result := stripQuotes(tt.input)
		if result != tt.expected {
			t.Errorf("stripQuotes(%q) = %q, want %q", tt.input, result, tt.expected)
		}
	}
}

func TestIsVarNameChar(t *testing.T) {
	valid := "ABCZabcz019_"
	for _, c := range valid {
		if !isVarNameChar(byte(c)) {
			t.Errorf("expected %q to be valid var char", string(c))
		}
	}

	invalid := "-.:/ @!"
	for _, c := range invalid {
		if isVarNameChar(byte(c)) {
			t.Errorf("expected %q to be invalid var char", string(c))
		}
	}
}
