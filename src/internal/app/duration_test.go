package app

import (
	"encoding/json"
	"testing"
	"time"

	"gopkg.in/yaml.v3"
)

func TestDuration_YAMLUnmarshal_String(t *testing.T) {
	type wrapper struct {
		D Duration `yaml:"d"`
	}

	input := `d: 180s`
	var w wrapper
	if err := yaml.Unmarshal([]byte(input), &w); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}
	if w.D.Duration != 180*time.Second {
		t.Errorf("expected 180s, got %s", w.D.Duration)
	}
}

func TestDuration_YAMLUnmarshal_Minutes(t *testing.T) {
	type wrapper struct {
		D Duration `yaml:"d"`
	}

	input := `d: 3m`
	var w wrapper
	if err := yaml.Unmarshal([]byte(input), &w); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}
	if w.D.Duration != 3*time.Minute {
		t.Errorf("expected 3m, got %s", w.D.Duration)
	}
}

func TestDuration_YAMLUnmarshal_Integer(t *testing.T) {
	type wrapper struct {
		D Duration `yaml:"d"`
	}

	input := `d: 60`
	var w wrapper
	if err := yaml.Unmarshal([]byte(input), &w); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}
	if w.D.Duration != 60*time.Second {
		t.Errorf("expected 60s, got %s", w.D.Duration)
	}
}

func TestDuration_YAMLMarshal(t *testing.T) {
	type wrapper struct {
		D Duration `yaml:"d"`
	}

	w := wrapper{D: NewDuration(180 * time.Second)}
	out, err := yaml.Marshal(&w)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}
	if string(out) != "d: 3m0s\n" {
		t.Errorf("expected 'd: 3m0s\\n', got %q", string(out))
	}
}

func TestDuration_JSONRoundTrip(t *testing.T) {
	type wrapper struct {
		D Duration `json:"d"`
	}

	original := wrapper{D: NewDuration(5 * time.Minute)}
	data, err := json.Marshal(&original)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}

	var decoded wrapper
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}

	if decoded.D.Duration != original.D.Duration {
		t.Errorf("expected %s, got %s", original.D.Duration, decoded.D.Duration)
	}
}

func TestDuration_JSONUnmarshal_Number(t *testing.T) {
	type wrapper struct {
		D Duration `json:"d"`
	}

	input := `{"d": 120}`
	var w wrapper
	if err := json.Unmarshal([]byte(input), &w); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}
	if w.D.Duration != 120*time.Second {
		t.Errorf("expected 120s, got %s", w.D.Duration)
	}
}

func TestDuration_Invalid(t *testing.T) {
	type wrapper struct {
		D Duration `yaml:"d"`
	}

	input := `d: "not-a-duration"`
	var w wrapper
	if err := yaml.Unmarshal([]byte(input), &w); err == nil {
		t.Fatal("expected error for invalid duration")
	}
}
