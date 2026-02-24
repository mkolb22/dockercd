// contract_test.go — Property-based contract tests for the reconciler package.
// Generated from ZenSpec "reconciliation-loop".
//
// Tests the pure helper functions: hasImageChanges, hasBlueGreenStrategy, groupByWave.
package reconciler

import (
	"sort"
	"strconv"
	"testing"

	"github.com/mkolb22/dockercd/internal/app"
	"github.com/mkolb22/dockercd/internal/differ"
	"pgregory.net/rapid"
)

// --- Generators ---

func genServiceName() *rapid.Generator[string] {
	return rapid.StringMatching(`[a-z][a-z0-9\-]{0,12}`)
}

func genImage() *rapid.Generator[string] {
	return rapid.Custom(func(t *rapid.T) string {
		name := rapid.StringMatching(`[a-z]{3,10}`).Draw(t, "imgName")
		tag := rapid.StringMatching(`[a-z0-9]{1,8}`).Draw(t, "imgTag")
		return name + ":" + tag
	})
}

func genServiceSpec() *rapid.Generator[app.ServiceSpec] {
	return rapid.Custom(func(t *rapid.T) app.ServiceSpec {
		return app.ServiceSpec{
			Name:  genServiceName().Draw(t, "name"),
			Image: genImage().Draw(t, "image"),
		}
	})
}

// --- Contract: hasImageChanges ---

// TestContract_HasImageChangesNilDiff verifies no panic on empty diff.
func TestContract_HasImageChangesNilDiff(t *testing.T) {
	result := hasImageChanges(&app.DiffResult{})
	if result {
		t.Fatal("empty diff should have no image changes")
	}
}

// TestContract_HasImageChangesWithCreate verifies ToCreate implies image changes.
func TestContract_HasImageChangesWithCreate(t *testing.T) {
	diff := &app.DiffResult{
		ToCreate: []app.ServiceDiff{
			{ServiceName: "web", ChangeType: app.ChangeTypeCreate},
		},
	}
	if !hasImageChanges(diff) {
		t.Fatal("ToCreate present should mean image changes")
	}
}

// TestContract_HasImageChangesWithImageField verifies image field diff detected.
func TestContract_HasImageChangesWithImageField(t *testing.T) {
	diff := &app.DiffResult{
		ToUpdate: []app.ServiceDiff{
			{
				ServiceName: "web",
				ChangeType:  app.ChangeTypeUpdate,
				Fields: []app.FieldDiff{
					{Field: "image", Desired: "nginx:latest", Live: "nginx:1.24"},
				},
			},
		},
	}
	if !hasImageChanges(diff) {
		t.Fatal("image field diff should be detected")
	}
}

// TestContract_HasImageChangesNonImageField verifies non-image field diff not detected.
func TestContract_HasImageChangesNonImageField(t *testing.T) {
	diff := &app.DiffResult{
		ToUpdate: []app.ServiceDiff{
			{
				ServiceName: "web",
				ChangeType:  app.ChangeTypeUpdate,
				Fields: []app.FieldDiff{
					{Field: "environment", Desired: "FOO=bar", Live: "FOO=baz"},
				},
			},
		},
	}
	if hasImageChanges(diff) {
		t.Fatal("non-image field diff should not count as image change")
	}
}

// TestContract_HasImageChangesRemoveOnly verifies ToRemove only → no image changes.
func TestContract_HasImageChangesRemoveOnly(t *testing.T) {
	diff := &app.DiffResult{
		ToRemove: []app.ServiceDiff{
			{ServiceName: "old-svc", ChangeType: app.ChangeTypeRemove},
		},
	}
	if hasImageChanges(diff) {
		t.Fatal("remove-only diff should not have image changes")
	}
}

// --- Contract: hasBlueGreenStrategy ---

// TestContract_HasBlueGreenStrategyEmpty verifies empty services → false.
func TestContract_HasBlueGreenStrategyEmpty(t *testing.T) {
	if hasBlueGreenStrategy(nil) {
		t.Fatal("nil services should not have blue-green strategy")
	}
	if hasBlueGreenStrategy([]app.ServiceSpec{}) {
		t.Fatal("empty services should not have blue-green strategy")
	}
}

// TestContract_HasBlueGreenStrategyWithLabel verifies detection of blue-green label.
func TestContract_HasBlueGreenStrategyWithLabel(t *testing.T) {
	services := []app.ServiceSpec{
		{
			Name:  "web",
			Image: "nginx:latest",
			Labels: map[string]string{
				differ.StrategyLabel: string(app.DeployStrategyBlueGreen),
			},
		},
	}
	if !hasBlueGreenStrategy(services) {
		t.Fatal("service with blue-green label should be detected")
	}
}

// TestContract_HasBlueGreenStrategyWithoutLabel verifies no false positives.
func TestContract_HasBlueGreenStrategyWithoutLabel(t *testing.T) {
	services := []app.ServiceSpec{
		{Name: "web", Image: "nginx:latest"},
		{Name: "api", Image: "api:latest", Labels: map[string]string{"foo": "bar"}},
	}
	if hasBlueGreenStrategy(services) {
		t.Fatal("services without blue-green label should not be detected")
	}
}

// TestContract_HasBlueGreenStrategyProperty verifies label detection with random inputs.
func TestContract_HasBlueGreenStrategyProperty(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		n := rapid.IntRange(1, 10).Draw(t, "count")
		addBG := rapid.Bool().Draw(t, "addBlueGreen")

		var services []app.ServiceSpec
		for i := 0; i < n; i++ {
			services = append(services, genServiceSpec().Draw(t, "svc"))
		}

		if addBG {
			// Add the label to one random service
			idx := rapid.IntRange(0, len(services)-1).Draw(t, "bgIdx")
			if services[idx].Labels == nil {
				services[idx].Labels = make(map[string]string)
			}
			services[idx].Labels[differ.StrategyLabel] = string(app.DeployStrategyBlueGreen)
		}

		result := hasBlueGreenStrategy(services)
		if addBG && !result {
			t.Fatal("should detect blue-green when label present")
		}
	})
}

// --- Contract: groupByWave ---

// TestContract_GroupByWaveEmpty verifies empty input → empty output.
func TestContract_GroupByWaveEmpty(t *testing.T) {
	groups := groupByWave(nil)
	if len(groups) != 0 {
		t.Fatalf("nil services: want 0 groups, got %d", len(groups))
	}
	groups = groupByWave([]app.ServiceSpec{})
	if len(groups) != 0 {
		t.Fatalf("empty services: want 0 groups, got %d", len(groups))
	}
}

// TestContract_GroupByWaveDefaultWave0 verifies services without wave label default to wave 0.
func TestContract_GroupByWaveDefaultWave0(t *testing.T) {
	services := []app.ServiceSpec{
		{Name: "web", Image: "nginx:latest"},
		{Name: "api", Image: "api:latest"},
	}
	groups := groupByWave(services)
	if len(groups) != 1 {
		t.Fatalf("want 1 wave group, got %d", len(groups))
	}
	if groups[0].Wave != 0 {
		t.Fatalf("default wave should be 0, got %d", groups[0].Wave)
	}
	if len(groups[0].Services) != 2 {
		t.Fatalf("want 2 services in wave 0, got %d", len(groups[0].Services))
	}
}

// TestContract_GroupByWaveSortedAscending verifies groups sorted by wave ascending.
func TestContract_GroupByWaveSortedAscending(t *testing.T) {
	services := []app.ServiceSpec{
		{Name: "db", Image: "postgres:16", Labels: map[string]string{differ.SyncWaveLabel: "0"}},
		{Name: "migrate", Image: "migrate:latest", Labels: map[string]string{differ.SyncWaveLabel: "-1"}},
		{Name: "web", Image: "nginx:latest", Labels: map[string]string{differ.SyncWaveLabel: "2"}},
		{Name: "api", Image: "api:latest", Labels: map[string]string{differ.SyncWaveLabel: "1"}},
	}
	groups := groupByWave(services)
	for i := 1; i < len(groups); i++ {
		if groups[i-1].Wave >= groups[i].Wave {
			t.Fatalf("groups not sorted: wave %d >= %d", groups[i-1].Wave, groups[i].Wave)
		}
	}
}

// TestContract_GroupByWaveExcludesHooks verifies hook services are excluded.
func TestContract_GroupByWaveExcludesHooks(t *testing.T) {
	services := []app.ServiceSpec{
		{Name: "web", Image: "nginx:latest"},
		{Name: "pre-migrate", Image: "migrate:latest", Labels: map[string]string{differ.HookLabel: "pre-sync"}},
		{Name: "post-notify", Image: "notify:latest", Labels: map[string]string{differ.HookLabel: "post-sync"}},
	}
	groups := groupByWave(services)
	for _, g := range groups {
		for _, svc := range g.Services {
			if svc == "pre-migrate" || svc == "post-notify" {
				t.Fatalf("hook service %q should be excluded from wave groups", svc)
			}
		}
	}
	// Should only have "web" in wave 0
	if len(groups) != 1 || len(groups[0].Services) != 1 || groups[0].Services[0] != "web" {
		t.Fatalf("expected only [web] in wave 0, got %v", groups)
	}
}

// TestContract_GroupByWaveServicesWithinWaveSorted verifies services sorted within each wave.
func TestContract_GroupByWaveServicesWithinWaveSorted(t *testing.T) {
	services := []app.ServiceSpec{
		{Name: "zebra", Image: "z:1"},
		{Name: "alpha", Image: "a:1"},
		{Name: "middle", Image: "m:1"},
	}
	groups := groupByWave(services)
	if len(groups) != 1 {
		t.Fatalf("want 1 group, got %d", len(groups))
	}
	if !sort.StringsAreSorted(groups[0].Services) {
		t.Fatalf("services not sorted: %v", groups[0].Services)
	}
}

// TestContract_GroupByWavePreservesAllNonHookServices verifies all non-hook services appear exactly once.
func TestContract_GroupByWavePreservesAllNonHookServices(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		n := rapid.IntRange(0, 15).Draw(t, "count")
		seen := make(map[string]bool)
		var services []app.ServiceSpec
		var expectedNames []string

		for len(services) < n {
			svc := genServiceSpec().Draw(t, "svc")
			if seen[svc.Name] {
				continue
			}
			seen[svc.Name] = true

			// Random: make some hooks
			isHook := rapid.Bool().Draw(t, "isHook")
			if isHook {
				svc.Labels = map[string]string{differ.HookLabel: "pre-sync"}
			} else {
				// Random wave
				wave := rapid.IntRange(0, 3).Draw(t, "wave")
				if wave > 0 {
					if svc.Labels == nil {
						svc.Labels = make(map[string]string)
					}
					svc.Labels[differ.SyncWaveLabel] = strconv.Itoa(wave)
				}
				expectedNames = append(expectedNames, svc.Name)
			}
			services = append(services, svc)
		}

		groups := groupByWave(services)

		// Collect all names from groups
		var gotNames []string
		for _, g := range groups {
			gotNames = append(gotNames, g.Services...)
		}

		sort.Strings(expectedNames)
		sort.Strings(gotNames)

		if len(gotNames) != len(expectedNames) {
			t.Fatalf("count mismatch: expected %d non-hook services, got %d",
				len(expectedNames), len(gotNames))
		}
		for i := range expectedNames {
			if gotNames[i] != expectedNames[i] {
				t.Fatalf("name mismatch at %d: expected %q, got %q",
					i, expectedNames[i], gotNames[i])
			}
		}
	})
}

// TestContract_GroupByWaveAllGroupsSortedAscending verifies sorted waves with random input.
func TestContract_GroupByWaveAllGroupsSortedAscending(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		n := rapid.IntRange(0, 10).Draw(t, "count")
		seen := make(map[string]bool)
		var services []app.ServiceSpec

		for len(services) < n {
			svc := genServiceSpec().Draw(t, "svc")
			if seen[svc.Name] {
				continue
			}
			seen[svc.Name] = true
			wave := rapid.IntRange(-2, 5).Draw(t, "wave")
			if wave != 0 {
				if svc.Labels == nil {
					svc.Labels = make(map[string]string)
				}
				svc.Labels[differ.SyncWaveLabel] = strconv.Itoa(wave)
			}
			services = append(services, svc)
		}

		groups := groupByWave(services)
		for i := 1; i < len(groups); i++ {
			if groups[i-1].Wave >= groups[i].Wave {
				t.Fatalf("groups not ascending: wave[%d]=%d >= wave[%d]=%d",
					i-1, groups[i-1].Wave, i, groups[i].Wave)
			}
		}
	})
}
