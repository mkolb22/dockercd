// contract_test.go — Property-based contract tests for the inspector package.
// Generated from ZenSpecs "health-status" and "inspector-mapping".
//
// Tests the pure mapping functions: mapHealth, mapRunningHealth,
// parseEnvList, filterComposeLabels, formatUptime.
package inspector

import (
	"strings"
	"testing"
	"time"

	"github.com/docker/docker/api/types/container"
	"github.com/mkolb22/dockercd/internal/app"
	"pgregory.net/rapid"
)

// --- Helpers ---

// inspectWithHealth creates an InspectResponse with a specific Health.Status.
func inspectWithHealth(status string) container.InspectResponse {
	return container.InspectResponse{
		ContainerJSONBase: &container.ContainerJSONBase{
			State: &container.State{
				Health: &container.Health{Status: status},
			},
		},
	}
}

// inspectWithState creates an InspectResponse with State but no Health.
func inspectWithState() container.InspectResponse {
	return container.InspectResponse{
		ContainerJSONBase: &container.ContainerJSONBase{
			State: &container.State{},
		},
	}
}

// emptyInspect creates an InspectResponse with no embedded base.
func emptyInspect() container.InspectResponse {
	return container.InspectResponse{}
}

// --- Generators ---

func genContainerState() *rapid.Generator[string] {
	return rapid.SampledFrom([]string{
		"running", "created", "paused", "restarting", "exited", "dead", "removing",
	})
}

func genHealthCheckStatus() *rapid.Generator[string] {
	return rapid.SampledFrom([]string{"healthy", "starting", "unhealthy", "none"})
}

func genEnvPair() *rapid.Generator[string] {
	return rapid.Custom(func(t *rapid.T) string {
		key := rapid.StringMatching(`[A-Z_][A-Z0-9_]{0,10}`).Draw(t, "key")
		val := rapid.StringMatching(`[a-zA-Z0-9_/\-]{0,20}`).Draw(t, "val")
		return key + "=" + val
	})
}

// --- Contract: mapHealth ---

// TestContract_MapHealthRunningHealthy verifies running + healthy → Healthy.
func TestContract_MapHealthRunningHealthy(t *testing.T) {
	detail := inspectWithHealth("healthy")
	if got := mapHealth("running", detail); got != app.HealthStatusHealthy {
		t.Fatalf("running+healthy: want Healthy, got %s", got)
	}
}

// TestContract_MapHealthRunningStarting verifies running + starting → Progressing.
func TestContract_MapHealthRunningStarting(t *testing.T) {
	detail := inspectWithHealth("starting")
	if got := mapHealth("running", detail); got != app.HealthStatusProgressing {
		t.Fatalf("running+starting: want Progressing, got %s", got)
	}
}

// TestContract_MapHealthRunningUnhealthy verifies running + unhealthy → Degraded.
func TestContract_MapHealthRunningUnhealthy(t *testing.T) {
	detail := inspectWithHealth("unhealthy")
	if got := mapHealth("running", detail); got != app.HealthStatusDegraded {
		t.Fatalf("running+unhealthy: want Degraded, got %s", got)
	}
}

// TestContract_MapHealthRunningNoHealthcheck verifies running + no healthcheck → Healthy.
func TestContract_MapHealthRunningNoHealthcheck(t *testing.T) {
	// State present but no Health — this is the normal case for containers without healthcheck
	detail := inspectWithState()
	if got := mapHealth("running", detail); got != app.HealthStatusHealthy {
		t.Fatalf("running+no healthcheck: want Healthy, got %s", got)
	}
}

// TestContract_MapHealthCreatedPaused verifies created/paused → Progressing.
func TestContract_MapHealthCreatedPaused(t *testing.T) {
	detail := emptyInspect()
	for _, state := range []string{"created", "paused"} {
		if got := mapHealth(state, detail); got != app.HealthStatusProgressing {
			t.Fatalf("%s: want Progressing, got %s", state, got)
		}
	}
}

// TestContract_MapHealthRestarting verifies restarting → Degraded.
func TestContract_MapHealthRestarting(t *testing.T) {
	detail := emptyInspect()
	if got := mapHealth("restarting", detail); got != app.HealthStatusDegraded {
		t.Fatalf("restarting: want Degraded, got %s", got)
	}
}

// TestContract_MapHealthExitedDead verifies exited/dead/removing → Unknown.
func TestContract_MapHealthExitedDead(t *testing.T) {
	detail := emptyInspect()
	for _, state := range []string{"exited", "dead", "removing"} {
		if got := mapHealth(state, detail); got != app.HealthStatusUnknown {
			t.Fatalf("%s: want Unknown, got %s", state, got)
		}
	}
}

// TestContract_MapHealthUnknownState verifies unknown state → Unknown.
func TestContract_MapHealthUnknownState(t *testing.T) {
	detail := emptyInspect()
	if got := mapHealth("bogus", detail); got != app.HealthStatusUnknown {
		t.Fatalf("bogus state: want Unknown, got %s", got)
	}
}

// TestContract_MapHealthAlwaysValidStatus verifies output is always a known HealthStatus.
func TestContract_MapHealthAlwaysValidStatus(t *testing.T) {
	valid := map[app.HealthStatus]bool{
		app.HealthStatusHealthy:     true,
		app.HealthStatusProgressing: true,
		app.HealthStatusDegraded:    true,
		app.HealthStatusUnknown:     true,
	}
	rapid.Check(t, func(t *rapid.T) {
		state := genContainerState().Draw(t, "state")
		var detail container.InspectResponse
		if rapid.Bool().Draw(t, "hasHealthCheck") {
			hcs := genHealthCheckStatus().Draw(t, "healthStatus")
			detail = inspectWithHealth(hcs)
		} else {
			// Use inspectWithState (not emptyInspect) to avoid nil pointer
			// when mapHealth calls mapRunningHealth which accesses detail.State
			detail = inspectWithState()
		}
		result := mapHealth(state, detail)
		if !valid[result] {
			t.Fatalf("mapHealth(%q, ...) returned invalid status %q", state, result)
		}
	})
}

// --- Contract: mapRunningHealth ---

// TestContract_MapRunningHealthNilHealth verifies state with nil Health → Healthy.
func TestContract_MapRunningHealthNilHealthField(t *testing.T) {
	// State exists but Health is nil (no healthcheck configured)
	detail := inspectWithState()
	if got := mapRunningHealth(detail); got != app.HealthStatusHealthy {
		t.Fatalf("nil health field: want Healthy, got %s", got)
	}
}

// TestContract_MapRunningHealthStateNoHealth verifies State present but Health nil → Healthy.
func TestContract_MapRunningHealthStateNoHealth(t *testing.T) {
	detail := inspectWithState()
	if got := mapRunningHealth(detail); got != app.HealthStatusHealthy {
		t.Fatalf("state present but health nil: want Healthy, got %s", got)
	}
}

// --- Contract: parseEnvList ---

// TestContract_ParseEnvListNil verifies nil input → nil output.
func TestContract_ParseEnvListNil(t *testing.T) {
	if got := parseEnvList(nil); got != nil {
		t.Fatalf("parseEnvList(nil) = %v, want nil", got)
	}
}

// TestContract_ParseEnvListEmpty verifies empty input → nil output.
func TestContract_ParseEnvListEmpty(t *testing.T) {
	if got := parseEnvList([]string{}); got != nil {
		t.Fatalf("parseEnvList([]) = %v, want nil", got)
	}
}

// TestContract_ParseEnvListPreservesKeyValue verifies KEY=VALUE parsing.
func TestContract_ParseEnvListPreservesKeyValue(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		n := rapid.IntRange(1, 10).Draw(t, "count")
		var env []string
		expected := make(map[string]string)
		for i := 0; i < n; i++ {
			pair := genEnvPair().Draw(t, "pair")
			env = append(env, pair)
			idx := strings.IndexByte(pair, '=')
			expected[pair[:idx]] = pair[idx+1:]
		}
		result := parseEnvList(env)
		for k, v := range expected {
			if result[k] != v {
				t.Fatalf("parseEnvList: key %q want %q, got %q", k, v, result[k])
			}
		}
	})
}

// TestContract_ParseEnvListNoEquals verifies entries without = are skipped.
func TestContract_ParseEnvListNoEquals(t *testing.T) {
	result := parseEnvList([]string{"NOEQUALS"})
	if _, ok := result["NOEQUALS"]; ok {
		t.Fatal("entries without = should be skipped")
	}
}

// TestContract_ParseEnvListEmptyValue verifies KEY= produces empty value.
func TestContract_ParseEnvListEmptyValue(t *testing.T) {
	result := parseEnvList([]string{"KEY="})
	if result["KEY"] != "" {
		t.Fatalf("KEY= should produce empty value, got %q", result["KEY"])
	}
}

// --- Contract: filterComposeLabels ---

// TestContract_FilterComposeLabelsNil verifies nil input → nil output.
func TestContract_FilterComposeLabelsNil(t *testing.T) {
	if got := filterComposeLabels(nil); got != nil {
		t.Fatalf("filterComposeLabels(nil) = %v, want nil", got)
	}
}

// TestContract_FilterComposeLabelsEmpty verifies empty input → nil output.
func TestContract_FilterComposeLabelsEmpty(t *testing.T) {
	if got := filterComposeLabels(map[string]string{}); got != nil {
		t.Fatalf("filterComposeLabels({}) = %v, want nil", got)
	}
}

// TestContract_FilterComposeLabelsRemovesComposeKeys verifies com.docker.compose.* removed.
func TestContract_FilterComposeLabelsRemovesComposeKeys(t *testing.T) {
	labels := map[string]string{
		"com.docker.compose.project":          "myapp",
		"com.docker.compose.service":          "web",
		"com.docker.compose.config-hash":      "abc123",
		"com.docker.compose.oneoff":           "False",
		"com.docker.compose.container-number": "1",
		"my.custom.label":                     "value",
	}
	result := filterComposeLabels(labels)
	for k := range result {
		if strings.HasPrefix(k, "com.docker.compose.") {
			t.Fatalf("compose label %q should be filtered", k)
		}
	}
	if result["my.custom.label"] != "value" {
		t.Fatal("user label should be preserved")
	}
}

// TestContract_FilterComposeLabelsOnlyCompose verifies all-compose labels → nil.
func TestContract_FilterComposeLabelsOnlyCompose(t *testing.T) {
	labels := map[string]string{
		"com.docker.compose.project": "myapp",
		"com.docker.compose.service": "web",
	}
	if got := filterComposeLabels(labels); got != nil {
		t.Fatalf("all-compose labels should return nil, got %v", got)
	}
}

// TestContract_FilterComposeLabelsPreservesUserLabels verifies non-compose labels preserved.
func TestContract_FilterComposeLabelsPreservesUserLabels(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		n := rapid.IntRange(1, 5).Draw(t, "count")
		labels := map[string]string{
			"com.docker.compose.project": "test",
		}
		var userKeys []string
		for i := 0; i < n; i++ {
			key := rapid.StringMatching(`app\.[a-z]{3,8}`).Draw(t, "key")
			val := rapid.StringMatching(`[a-z]{1,10}`).Draw(t, "val")
			labels[key] = val
			userKeys = append(userKeys, key)
		}
		result := filterComposeLabels(labels)
		for _, k := range userKeys {
			if _, ok := result[k]; !ok {
				t.Fatalf("user label %q should be preserved", k)
			}
		}
	})
}

// --- Contract: formatUptime ---

// TestContract_FormatUptimeDays verifies days format when >= 24h.
func TestContract_FormatUptimeDays(t *testing.T) {
	d := 50*time.Hour + 30*time.Minute
	result := formatUptime(d)
	if !strings.HasPrefix(result, "2d") {
		t.Fatalf("50h30m should start with 2d, got %q", result)
	}
}

// TestContract_FormatUptimeHours verifies hours format when < 24h but >= 1h.
func TestContract_FormatUptimeHours(t *testing.T) {
	d := 3*time.Hour + 15*time.Minute
	result := formatUptime(d)
	if !strings.HasPrefix(result, "3h") {
		t.Fatalf("3h15m should start with 3h, got %q", result)
	}
	if strings.Contains(result, "d") {
		t.Fatalf("3h15m should not contain days, got %q", result)
	}
}

// TestContract_FormatUptimeMinutes verifies minutes-only format when < 1h.
func TestContract_FormatUptimeMinutes(t *testing.T) {
	d := 45 * time.Minute
	result := formatUptime(d)
	if result != "45m" {
		t.Fatalf("45m: want \"45m\", got %q", result)
	}
}

// TestContract_FormatUptimeZero verifies 0 duration → "0m".
func TestContract_FormatUptimeZero(t *testing.T) {
	result := formatUptime(0)
	if result != "0m" {
		t.Fatalf("0 duration: want \"0m\", got %q", result)
	}
}

// TestContract_FormatUptimeNonEmpty verifies output is always non-empty.
func TestContract_FormatUptimeNonEmpty(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		hours := rapid.IntRange(0, 1000).Draw(t, "hours")
		mins := rapid.IntRange(0, 59).Draw(t, "mins")
		d := time.Duration(hours)*time.Hour + time.Duration(mins)*time.Minute
		result := formatUptime(d)
		if result == "" {
			t.Fatalf("formatUptime(%v) returned empty string", d)
		}
	})
}
