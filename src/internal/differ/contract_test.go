// contract_test.go — Property-based contract tests for the differ package.
// Generated from ZenSpec "differ" (spec-1771898174990-6e5pru).
//
// These tests verify the formal contracts (postconditions and properties)
// defined in the differ specification using random input generation.
package differ

import (
	"sort"
	"testing"

	"github.com/mkolb22/dockercd/internal/app"
	"pgregory.net/rapid"
)

// --- Generators ---

// genServiceName generates a valid service name (lowercase alphanumeric, 1-20 chars).
func genServiceName() *rapid.Generator[string] {
	return rapid.StringMatching(`[a-z][a-z0-9\-]{0,19}`)
}

// genImage generates a Docker image reference.
func genImage() *rapid.Generator[string] {
	return rapid.Custom(func(t *rapid.T) string {
		name := rapid.StringMatching(`[a-z]{3,10}`).Draw(t, "imgName")
		tag := rapid.StringMatching(`[a-z0-9]{1,8}`).Draw(t, "imgTag")
		return name + ":" + tag
	})
}

// genServiceSpec generates a random ServiceSpec.
func genServiceSpec() *rapid.Generator[app.ServiceSpec] {
	return rapid.Custom(func(t *rapid.T) app.ServiceSpec {
		return app.ServiceSpec{
			Name:  genServiceName().Draw(t, "name"),
			Image: genImage().Draw(t, "image"),
		}
	})
}

// genServiceState generates a random ServiceState.
func genServiceState() *rapid.Generator[app.ServiceState] {
	return rapid.Custom(func(t *rapid.T) app.ServiceState {
		return app.ServiceState{
			Name:  genServiceName().Draw(t, "name"),
			Image: genImage().Draw(t, "image"),
		}
	})
}

// genUniqueServiceSpecs generates a slice of ServiceSpecs with unique names.
func genUniqueServiceSpecs() *rapid.Generator[[]app.ServiceSpec] {
	return rapid.Custom(func(t *rapid.T) []app.ServiceSpec {
		n := rapid.IntRange(0, 20).Draw(t, "count")
		seen := make(map[string]bool)
		var specs []app.ServiceSpec
		for len(specs) < n {
			s := genServiceSpec().Draw(t, "spec")
			if !seen[s.Name] {
				seen[s.Name] = true
				specs = append(specs, s)
			}
		}
		return specs
	})
}

// genUniqueServiceStates generates a slice of ServiceStates with unique names.
func genUniqueServiceStates() *rapid.Generator[[]app.ServiceState] {
	return rapid.Custom(func(t *rapid.T) []app.ServiceState {
		n := rapid.IntRange(0, 20).Draw(t, "count")
		seen := make(map[string]bool)
		var states []app.ServiceState
		for len(states) < n {
			s := genServiceState().Draw(t, "state")
			if !seen[s.Name] {
				seen[s.Name] = true
				states = append(states, s)
			}
		}
		return states
	})
}

// --- Contract: Postconditions ---

// TestContract_DiffResultNeverNil verifies: result != nil
func TestContract_DiffResultNeverNil(t *testing.T) {
	d := New()
	rapid.Check(t, func(t *rapid.T) {
		desired := genUniqueServiceSpecs().Draw(t, "desired")
		live := genUniqueServiceStates().Draw(t, "live")
		result := d.Diff(desired, live)
		if result == nil {
			t.Fatal("Diff must never return nil")
		}
	})
}

// TestContract_InSyncConsistency verifies:
// result.InSync == (len(ToCreate)==0 && len(ToUpdate)==0 && len(ToRemove)==0)
func TestContract_InSyncConsistency(t *testing.T) {
	d := New()
	rapid.Check(t, func(t *rapid.T) {
		desired := genUniqueServiceSpecs().Draw(t, "desired")
		live := genUniqueServiceStates().Draw(t, "live")
		result := d.Diff(desired, live)

		empty := len(result.ToCreate) == 0 && len(result.ToUpdate) == 0 && len(result.ToRemove) == 0
		if result.InSync != empty {
			t.Fatalf("InSync=%v but ToCreate=%d ToUpdate=%d ToRemove=%d",
				result.InSync, len(result.ToCreate), len(result.ToUpdate), len(result.ToRemove))
		}
	})
}

// TestContract_ChangeTypesCorrect verifies:
// all ToCreate have ChangeTypeCreate, ToUpdate have ChangeTypeUpdate, ToRemove have ChangeTypeRemove
func TestContract_ChangeTypesCorrect(t *testing.T) {
	d := New()
	rapid.Check(t, func(t *rapid.T) {
		desired := genUniqueServiceSpecs().Draw(t, "desired")
		live := genUniqueServiceStates().Draw(t, "live")
		result := d.Diff(desired, live)

		for _, sd := range result.ToCreate {
			if sd.ChangeType != app.ChangeTypeCreate {
				t.Fatalf("ToCreate item %q has ChangeType %q, want %q",
					sd.ServiceName, sd.ChangeType, app.ChangeTypeCreate)
			}
		}
		for _, sd := range result.ToUpdate {
			if sd.ChangeType != app.ChangeTypeUpdate {
				t.Fatalf("ToUpdate item %q has ChangeType %q, want %q",
					sd.ServiceName, sd.ChangeType, app.ChangeTypeUpdate)
			}
		}
		for _, sd := range result.ToRemove {
			if sd.ChangeType != app.ChangeTypeRemove {
				t.Fatalf("ToRemove item %q has ChangeType %q, want %q",
					sd.ServiceName, sd.ChangeType, app.ChangeTypeRemove)
			}
		}
	})
}

// TestContract_NoServiceInMultipleCategories verifies:
// no service name appears in more than one of ToCreate, ToUpdate, ToRemove
func TestContract_NoServiceInMultipleCategories(t *testing.T) {
	d := New()
	rapid.Check(t, func(t *rapid.T) {
		desired := genUniqueServiceSpecs().Draw(t, "desired")
		live := genUniqueServiceStates().Draw(t, "live")
		result := d.Diff(desired, live)

		seen := make(map[string]string)
		for _, sd := range result.ToCreate {
			if cat, ok := seen[sd.ServiceName]; ok {
				t.Fatalf("service %q appears in both ToCreate and %s", sd.ServiceName, cat)
			}
			seen[sd.ServiceName] = "ToCreate"
		}
		for _, sd := range result.ToUpdate {
			if cat, ok := seen[sd.ServiceName]; ok {
				t.Fatalf("service %q appears in both ToUpdate and %s", sd.ServiceName, cat)
			}
			seen[sd.ServiceName] = "ToUpdate"
		}
		for _, sd := range result.ToRemove {
			if cat, ok := seen[sd.ServiceName]; ok {
				t.Fatalf("service %q appears in both ToRemove and %s", sd.ServiceName, cat)
			}
			seen[sd.ServiceName] = "ToRemove"
		}
	})
}

// TestContract_ResultsSortedByServiceName verifies:
// result is sorted by service name within each category
func TestContract_ResultsSortedByServiceName(t *testing.T) {
	d := New()
	rapid.Check(t, func(t *rapid.T) {
		desired := genUniqueServiceSpecs().Draw(t, "desired")
		live := genUniqueServiceStates().Draw(t, "live")
		result := d.Diff(desired, live)

		assertSorted := func(diffs []app.ServiceDiff, category string) {
			for i := 1; i < len(diffs); i++ {
				if diffs[i-1].ServiceName > diffs[i].ServiceName {
					t.Fatalf("%s not sorted: %q > %q at index %d",
						category, diffs[i-1].ServiceName, diffs[i].ServiceName, i)
				}
			}
		}
		assertSorted(result.ToCreate, "ToCreate")
		assertSorted(result.ToUpdate, "ToUpdate")
		assertSorted(result.ToRemove, "ToRemove")
	})
}

// --- Properties ---

// TestProperty_EmptyInputsInSync verifies:
// Diff([], []).InSync == true
func TestProperty_EmptyInputsInSync(t *testing.T) {
	d := New()
	result := d.Diff(nil, nil)
	if !result.InSync {
		t.Fatal("Diff(nil, nil) must be InSync")
	}
	result = d.Diff([]app.ServiceSpec{}, []app.ServiceState{})
	if !result.InSync {
		t.Fatal("Diff([], []) must be InSync")
	}
}

// TestProperty_DesiredOnlyCreates verifies:
// len(d) > 0 implies len(Diff(d, []).ToCreate) == len(d)
func TestProperty_DesiredOnlyCreates(t *testing.T) {
	d := New()
	rapid.Check(t, func(t *rapid.T) {
		desired := genUniqueServiceSpecs().Draw(t, "desired")
		if len(desired) == 0 {
			return
		}
		result := d.Diff(desired, nil)
		if len(result.ToCreate) != len(desired) {
			t.Fatalf("Diff(desired[%d], nil).ToCreate has %d items, want %d",
				len(desired), len(result.ToCreate), len(desired))
		}
		if len(result.ToUpdate) != 0 {
			t.Fatalf("expected no ToUpdate, got %d", len(result.ToUpdate))
		}
		if len(result.ToRemove) != 0 {
			t.Fatalf("expected no ToRemove, got %d", len(result.ToRemove))
		}
	})
}

// TestProperty_LiveOnlyRemoves verifies:
// len(l) > 0 implies len(Diff([], l).ToRemove) == len(l)
func TestProperty_LiveOnlyRemoves(t *testing.T) {
	d := New()
	rapid.Check(t, func(t *rapid.T) {
		live := genUniqueServiceStates().Draw(t, "live")
		if len(live) == 0 {
			return
		}
		result := d.Diff(nil, live)
		if len(result.ToRemove) != len(live) {
			t.Fatalf("Diff(nil, live[%d]).ToRemove has %d items, want %d",
				len(live), len(result.ToRemove), len(live))
		}
		if len(result.ToCreate) != 0 {
			t.Fatalf("expected no ToCreate, got %d", len(result.ToCreate))
		}
		if len(result.ToUpdate) != 0 {
			t.Fatalf("expected no ToUpdate, got %d", len(result.ToUpdate))
		}
	})
}

// TestProperty_DiffDeterministic verifies:
// Diff(d, l) == Diff(d, l) — same inputs always produce the same output
func TestProperty_DiffDeterministic(t *testing.T) {
	d := New()
	rapid.Check(t, func(t *rapid.T) {
		desired := genUniqueServiceSpecs().Draw(t, "desired")
		live := genUniqueServiceStates().Draw(t, "live")

		r1 := d.Diff(desired, live)
		r2 := d.Diff(desired, live)

		if r1.InSync != r2.InSync {
			t.Fatal("Diff not deterministic: InSync differs")
		}
		if len(r1.ToCreate) != len(r2.ToCreate) {
			t.Fatalf("Diff not deterministic: ToCreate %d vs %d",
				len(r1.ToCreate), len(r2.ToCreate))
		}
		if len(r1.ToUpdate) != len(r2.ToUpdate) {
			t.Fatalf("Diff not deterministic: ToUpdate %d vs %d",
				len(r1.ToUpdate), len(r2.ToUpdate))
		}
		if len(r1.ToRemove) != len(r2.ToRemove) {
			t.Fatalf("Diff not deterministic: ToRemove %d vs %d",
				len(r1.ToRemove), len(r2.ToRemove))
		}
		if r1.Summary != r2.Summary {
			t.Fatalf("Diff not deterministic: Summary %q vs %q",
				r1.Summary, r2.Summary)
		}

		// Verify individual service names match
		for i := range r1.ToCreate {
			if r1.ToCreate[i].ServiceName != r2.ToCreate[i].ServiceName {
				t.Fatalf("Diff not deterministic: ToCreate[%d] name %q vs %q",
					i, r1.ToCreate[i].ServiceName, r2.ToCreate[i].ServiceName)
			}
		}
	})
}

// --- Additional structural contracts ---

// TestContract_DesiredStateSetOnCreates verifies that ToCreate items have DesiredState set.
func TestContract_DesiredStateSetOnCreates(t *testing.T) {
	d := New()
	rapid.Check(t, func(t *rapid.T) {
		desired := genUniqueServiceSpecs().Draw(t, "desired")
		if len(desired) == 0 {
			return
		}
		result := d.Diff(desired, nil)
		for _, sd := range result.ToCreate {
			if sd.DesiredState == nil {
				t.Fatalf("ToCreate item %q has nil DesiredState", sd.ServiceName)
			}
		}
	})
}

// TestContract_LiveStateSetOnRemoves verifies that ToRemove items have LiveState set.
func TestContract_LiveStateSetOnRemoves(t *testing.T) {
	d := New()
	rapid.Check(t, func(t *rapid.T) {
		live := genUniqueServiceStates().Draw(t, "live")
		if len(live) == 0 {
			return
		}
		result := d.Diff(nil, live)
		for _, sd := range result.ToRemove {
			if sd.LiveState == nil {
				t.Fatalf("ToRemove item %q has nil LiveState", sd.ServiceName)
			}
		}
	})
}

// TestContract_MatchingNamesAreSynced verifies:
// When desired and live have the same names and same images, result is InSync.
func TestContract_MatchingNamesAreSynced(t *testing.T) {
	d := New()
	rapid.Check(t, func(t *rapid.T) {
		specs := genUniqueServiceSpecs().Draw(t, "specs")
		if len(specs) == 0 {
			return
		}

		// Build live state that matches desired (with Docker Hub normalization)
		live := make([]app.ServiceState, len(specs))
		for i, s := range specs {
			live[i] = app.ServiceState{
				Name:  s.Name,
				Image: "docker.io/library/" + s.Image,
			}
		}

		result := d.Diff(specs, live)
		if !result.InSync {
			t.Fatalf("Identical desired+live should be InSync, got: %s", result.Summary)
		}
	})
}

// TestContract_IndexDesiredPreservesCount verifies:
// len(indexDesiredByName(specs)) == len(unique names in specs)
func TestContract_IndexDesiredPreservesCount(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		specs := genUniqueServiceSpecs().Draw(t, "specs")
		m := indexDesiredByName(specs)
		if len(m) != len(specs) {
			t.Fatalf("indexDesiredByName: got %d entries for %d unique specs", len(m), len(specs))
		}
	})
}

// TestContract_IndexLivePreservesCount verifies:
// len(indexLiveByName(states)) == len(unique names in states)
func TestContract_IndexLivePreservesCount(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		states := genUniqueServiceStates().Draw(t, "states")
		m := indexLiveByName(states)
		if len(m) != len(states) {
			t.Fatalf("indexLiveByName: got %d entries for %d unique states", len(m), len(states))
		}
	})
}

// TestContract_SortDiffsOrders verifies:
// after sortDiffs, items are sorted by ServiceName ascending
func TestContract_SortDiffsOrders(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		n := rapid.IntRange(0, 30).Draw(t, "count")
		diffs := make([]app.ServiceDiff, n)
		for i := range diffs {
			diffs[i].ServiceName = genServiceName().Draw(t, "name")
		}
		sortDiffs(diffs)
		if !sort.SliceIsSorted(diffs, func(i, j int) bool {
			return diffs[i].ServiceName < diffs[j].ServiceName
		}) {
			t.Fatal("sortDiffs did not produce sorted output")
		}
	})
}
