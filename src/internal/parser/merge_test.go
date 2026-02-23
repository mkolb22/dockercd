package parser

import (
	"reflect"
	"sort"
	"testing"
)

func TestMergeCompose_NilBase(t *testing.T) {
	override := &rawCompose{
		Services: map[string]rawService{"web": {Image: "nginx"}},
	}
	result := mergeCompose(nil, override)
	if result != override {
		t.Error("expected override returned when base is nil")
	}
}

func TestMergeCompose_NilOverride(t *testing.T) {
	base := &rawCompose{
		Services: map[string]rawService{"web": {Image: "nginx"}},
	}
	result := mergeCompose(base, nil)
	if result != base {
		t.Error("expected base returned when override is nil")
	}
}

func TestMergeCompose_NewServiceAdded(t *testing.T) {
	base := &rawCompose{
		Services: map[string]rawService{"web": {Image: "nginx"}},
		Networks: make(map[string]rawNetwork),
		Volumes:  make(map[string]rawVolume),
	}
	override := &rawCompose{
		Services: map[string]rawService{"redis": {Image: "redis:7"}},
		Networks: make(map[string]rawNetwork),
		Volumes:  make(map[string]rawVolume),
	}

	result := mergeCompose(base, override)
	if len(result.Services) != 2 {
		t.Fatalf("expected 2 services, got %d", len(result.Services))
	}
	if result.Services["web"].Image != "nginx" {
		t.Error("base service should be preserved")
	}
	if result.Services["redis"].Image != "redis:7" {
		t.Error("override service should be added")
	}
}

func TestMergeService_ScalarOverride(t *testing.T) {
	base := rawService{
		Image:   "nginx:1.25",
		Restart: "unless-stopped",
	}
	override := rawService{
		Image: "nginx:1.26",
	}

	result := mergeService(base, override)
	if result.Image != "nginx:1.26" {
		t.Errorf("image should be overridden: got %q", result.Image)
	}
	if result.Restart != "unless-stopped" {
		t.Errorf("restart should be preserved when not in override: got %q", result.Restart)
	}
}

func TestMergeService_PortsAppend(t *testing.T) {
	base := rawService{
		Image: "nginx",
		Ports: []string{"80:80"},
	}
	override := rawService{
		Ports: []string{"443:443"},
	}

	result := mergeService(base, override)
	if len(result.Ports) != 2 {
		t.Fatalf("expected 2 ports (appended), got %d", len(result.Ports))
	}
	if result.Ports[0] != "80:80" || result.Ports[1] != "443:443" {
		t.Errorf("unexpected ports: %v", result.Ports)
	}
}

func TestMergeService_VolumesAppend(t *testing.T) {
	base := rawService{
		Image:   "nginx",
		Volumes: []string{"./data:/data"},
	}
	override := rawService{
		Volumes: []string{"./logs:/logs"},
	}

	result := mergeService(base, override)
	if len(result.Volumes) != 2 {
		t.Fatalf("expected 2 volumes, got %d", len(result.Volumes))
	}
}

func TestMergeService_EnvironmentMapMerge(t *testing.T) {
	base := rawService{
		Image: "nginx",
		Environment: map[string]interface{}{
			"FOO":   "bar",
			"DEBUG": "true",
		},
	}
	override := rawService{
		Environment: map[string]interface{}{
			"FOO":  "baz",
			"PROD": "true",
		},
	}

	result := mergeService(base, override)
	envMap := toStringMap(result.Environment)

	if envMap["FOO"] != "baz" {
		t.Errorf("FOO should be overridden to 'baz', got %q", envMap["FOO"])
	}
	if envMap["DEBUG"] != "true" {
		t.Errorf("DEBUG should be preserved from base, got %q", envMap["DEBUG"])
	}
	if envMap["PROD"] != "true" {
		t.Errorf("PROD should be added from override, got %q", envMap["PROD"])
	}
}

func TestMergeService_CommandOverride(t *testing.T) {
	base := rawService{
		Image:   "nginx",
		Command: "start",
	}
	override := rawService{
		Command: []interface{}{"nginx", "-g", "daemon off;"},
	}

	result := mergeService(base, override)
	if !reflect.DeepEqual(result.Command, override.Command) {
		t.Errorf("command should be overridden: %v", result.Command)
	}
}

func TestMergeService_NilOverridePortsPreservesBase(t *testing.T) {
	base := rawService{
		Image: "nginx",
		Ports: []string{"80:80"},
	}
	override := rawService{}

	result := mergeService(base, override)
	if len(result.Ports) != 1 || result.Ports[0] != "80:80" {
		t.Errorf("ports should be preserved when override.Ports is nil: %v", result.Ports)
	}
}

func TestToStringMap_FromMap(t *testing.T) {
	input := map[string]interface{}{
		"FOO": "bar",
		"NUM": 42,
		"NIL": nil,
	}

	result := toStringMap(input)
	if result["FOO"] != "bar" {
		t.Errorf("expected FOO=bar, got %q", result["FOO"])
	}
	if result["NUM"] != "42" {
		t.Errorf("expected NUM=42, got %q", result["NUM"])
	}
	if result["NIL"] != "" {
		t.Errorf("expected NIL='', got %q", result["NIL"])
	}
}

func TestToStringMap_FromList(t *testing.T) {
	input := []interface{}{
		"FOO=bar",
		"BAZ=qux",
		"EMPTY",
	}

	result := toStringMap(input)
	if result["FOO"] != "bar" {
		t.Errorf("expected FOO=bar, got %q", result["FOO"])
	}
	if result["BAZ"] != "qux" {
		t.Errorf("expected BAZ=qux, got %q", result["BAZ"])
	}
	if result["EMPTY"] != "" {
		t.Errorf("expected EMPTY='', got %q", result["EMPTY"])
	}
}

func TestMergeListOrMap_ListMerge(t *testing.T) {
	base := []interface{}{"net1", "net2"}
	override := []interface{}{"net2", "net3"}

	result := mergeListOrMap(base, override)
	list, ok := result.([]interface{})
	if !ok {
		t.Fatalf("expected []interface{}, got %T", result)
	}

	// Convert to string slice and sort for comparison
	var names []string
	for _, v := range list {
		names = append(names, v.(string))
	}
	sort.Strings(names)

	expected := []string{"net1", "net2", "net3"}
	if !reflect.DeepEqual(names, expected) {
		t.Errorf("expected %v, got %v", expected, names)
	}
}

func TestAppendStringSlices(t *testing.T) {
	base := []string{"a", "b"}
	override := []string{"c", "d"}

	result := appendStringSlices(base, override)
	expected := []string{"a", "b", "c", "d"}
	if !reflect.DeepEqual(result, expected) {
		t.Errorf("expected %v, got %v", expected, result)
	}
}
