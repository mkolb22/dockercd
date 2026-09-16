package presentation

import (
	"context"
	"sync"
	"testing"
)

func TestFixtureActivityIsChronological(t *testing.T) {
	activity, err := NewFixtureSource().Activity(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for index := 1; index < len(activity); index++ {
		if activity[index-1].OccurredAt.Before(activity[index].OccurredAt) {
			t.Fatalf("events %q then %q are not newest-first", activity[index-1].Kind, activity[index].Kind)
		}
	}
}

func TestFixtureScenariosExpressKnownConnectionStates(t *testing.T) {
	source := NewFixtureSource()
	for name, expected := range map[string]string{
		"healthy": "Fixture connected",
		"stale":   "Last data retained",
		"error":   "Controller unavailable",
	} {
		fleet, err := source.Scenario(name).Fleet(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		if actual := fleet.Connection.Label; actual != expected {
			t.Fatalf("scenario %q connection=%q, want %q", name, actual, expected)
		}
	}
}

func TestFleetDerivesAttentionFromTheSameRuleAsTheFilter(t *testing.T) {
	fleet := Fleet{Applications: []Application{
		{Name: "healthy", Health: State{Tone: "mint"}, Sync: State{Tone: "mint"}},
		{Name: "health-alert", Health: State{Tone: "coral"}, Sync: State{Tone: "mint"}},
		{Name: "sync-alert", Health: State{Tone: "mint"}, Sync: State{Tone: "coral"}},
	}}
	fleet.deriveCounts()

	if fleet.HealthyCount != 2 || fleet.AttentionCount != 2 || len(fleet.Attention) != 2 {
		t.Fatalf("unexpected derived fleet counts: %#v", fleet)
	}
	if fleet.Attention[0].Name != "health-alert" || fleet.Attention[1].Name != "sync-alert" {
		t.Fatalf("attention queue did not preserve controller application names: %#v", fleet.Attention)
	}
	filtered := filterApplications(fleet.Applications, "", "attention")
	if len(filtered) != len(fleet.Attention) || filtered[0].Name != fleet.Attention[0].Name || filtered[1].Name != fleet.Attention[1].Name {
		t.Fatalf("attention filter diverged from fleet queue: filtered=%#v queue=%#v", filtered, fleet.Attention)
	}
}

func TestFixtureScenariosDoNotShareDerivedAttention(t *testing.T) {
	source := NewFixtureSource()
	var workers sync.WaitGroup
	for _, scenario := range []string{"attention", "healthy", "stale", "error"} {
		for range 16 {
			workers.Add(1)
			go func(name string) {
				defer workers.Done()
				for range 32 {
					fleet, err := source.Scenario(name).Fleet(context.Background())
					if err != nil {
						t.Errorf("scenario %q: %v", name, err)
						return
					}
					for _, application := range fleet.Attention {
						if !needsAttention(application) {
							t.Errorf("scenario %q retained a non-attention row: %#v", name, application)
							return
						}
					}
				}
			}(scenario)
		}
	}
	workers.Wait()
}
