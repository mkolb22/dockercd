// Package presentation defines page-oriented, redacted view models for the
// dockercd Web presentation. FixtureSource is intentionally self-contained:
// it makes no network, Docker, credential, or controller calls.
package presentation

import (
	"context"
	"sort"
	"strings"
	"time"
)

type State struct {
	Label string
	Tone  string
	Glyph string
}

type Service struct {
	Name        string
	Image       string
	State       State
	Description string
	CPU         string
	Memory      string
}

type Event struct {
	Application string
	Kind        string
	Message     string
	Occurred    string
	OccurredAt  time.Time
	Tone        string
	Revision    string
	Operation   string
}

type Application struct {
	Name             string
	Project          string
	Repository       string
	Revision         string
	Sync             State
	Health           State
	Observation      string
	LastDeployment   string
	LastEvent        string
	Services         []Service
	IntentionalEmpty bool
	DesiredSummary   string
	LiveSummary      string
	Events           []Event
	LogPreview       []string
}

type Fleet struct {
	Controller           string
	Environment          string
	FetchedAt            string
	ObservationNote      string
	Connection           State
	ErrorMessage         string
	HealthyCount         int
	AttentionCount       int
	HealthArc            int
	Applications         []Application
	Attention            []Application
	EnvironmentAttention []EnvironmentIssue
	ControllerState      State
	ControllerResponseAt string
	Capacity             Capacity
}

// EnvironmentIssue is a non-application attention item. It preserves the
// relevant control-path destination instead of pretending every issue belongs
// to a deployed application.
type EnvironmentIssue struct {
	Name    string
	Summary string
	State   State
	Path    string
}

type Capacity struct {
	Available          bool
	State              State
	CPUPercent         float64
	CPUCores           int
	MemoryUsageMiB     float64
	MemoryTotalMiB     float64
	RunningContainers  int
	EligibleContainers int
	ObservedContainers int
	Completeness       string
	SampleCompletedAt  string
}

// ViewContext is non-sensitive rendering context available without a fleet
// read. It prevents layout chrome from requiring unrelated controller scopes.
type ViewContext struct {
	Controller  string
	Environment string
	Freshness   string
	Connection  State
	Fixture     bool
}

// Source is deliberately narrower than the future control-plane client. Page
// handlers only ask for presentation data, never raw API response maps.
type Source interface {
	ViewContext() ViewContext
	Fleet(context.Context) (Fleet, error)
	Applications(ctx context.Context, query, state string) (Fleet, []Application, error)
	Application(ctx context.Context, name string) (Application, bool, error)
	Activity(context.Context) ([]Event, error)
}

type FixtureSource struct {
	fleet Fleet
}

// Scenario returns a safe fixture variant for visual validation. It never
// reaches a controller and leaves the receiver untouched for concurrent use.
func (s *FixtureSource) Scenario(name string) Source {
	if name == "" || name == "attention" {
		return s
	}
	copy := *s
	copy.fleet.Applications = append([]Application(nil), s.fleet.Applications...)
	for index := range copy.fleet.Applications {
		copy.fleet.Applications[index].Services = append([]Service(nil), copy.fleet.Applications[index].Services...)
		copy.fleet.Applications[index].Events = append([]Event(nil), copy.fleet.Applications[index].Events...)
		copy.fleet.Applications[index].LogPreview = append([]string(nil), copy.fleet.Applications[index].LogPreview...)
	}

	switch name {
	case "healthy":
		for index := range copy.fleet.Applications {
			application := &copy.fleet.Applications[index]
			if application.IntentionalEmpty {
				continue
			}
			application.Sync = State{Label: "Synced", Tone: "mint", Glyph: "✓"}
			application.Health = State{Label: "Healthy", Tone: "mint", Glyph: "✓"}
			application.LastEvent = "Displayed services match the desired revision"
			application.LiveSummary = "Displayed services match the desired revision"
			for serviceIndex := range application.Services {
				application.Services[serviceIndex].State = State{Label: "Healthy", Tone: "mint", Glyph: "✓"}
			}
		}
		copy.fleet.ObservationNote = "Fixture simulates a fully healthy displayed fleet. It is not a live controller observation."
	case "stale":
		copy.fleet.Connection = State{Label: "Last data retained", Tone: "amber", Glyph: "~"}
		copy.fleet.FetchedAt = "Last successful fixture snapshot · 14:12 UTC"
		copy.fleet.ObservationNote = "Fixture simulates controller connection degradation. Displayed data may be stale."
	case "error":
		copy.fleet.Connection = State{Label: "Controller unavailable", Tone: "coral", Glyph: "!"}
		copy.fleet.FetchedAt = "No current fixture response"
		copy.fleet.ObservationNote = "Fixture simulates an unavailable controller. No displayed status is current."
		copy.fleet.ErrorMessage = "The fixture controller did not respond. Review retained evidence only after reconnection."
	default:
		return s
	}
	copy.fleet.deriveCounts()
	return &copy
}

func NewFixtureSource() *FixtureSource {
	fixtureNow := time.Date(2026, time.September, 15, 14, 32, 0, 0, time.UTC)
	at := func(minutesAgo int) time.Time { return fixtureNow.Add(-time.Duration(minutesAgo) * time.Minute) }
	healthy := func() State { return State{Label: "Healthy", Tone: "mint", Glyph: "✓"} }
	synced := func() State { return State{Label: "Synced", Tone: "mint", Glyph: "✓"} }
	degraded := func() State { return State{Label: "Degraded", Tone: "coral", Glyph: "!"} }
	outOfSync := func() State { return State{Label: "Out of sync", Tone: "amber", Glyph: "~"} }
	unknown := func() State { return State{Label: "Unknown", Tone: "slate", Glyph: "?"} }

	applications := []Application{
		{
			Name:           "signal",
			Project:        "signal",
			Repository:     "github.com/acme/signal",
			Revision:       "9b84c0d1",
			Sync:           synced(),
			Health:         healthy(),
			Observation:    "Observed 18 sec ago",
			LastDeployment: "Deployed 22 min ago",
			LastEvent:      "Deployment completed with all services healthy",
			DesiredSummary: "2 Compose services declared",
			LiveSummary:    "2 running services match the displayed revision",
			Services: []Service{
				{Name: "signal", Image: "ghcr.io/acme/signal:2026.09.15", State: healthy(), Description: "Owner-facing operations workspace", CPU: "4.2%", Memory: "138 MB"},
				{Name: "signal-worker", Image: "ghcr.io/acme/signal:2026.09.15", State: healthy(), Description: "Background delivery worker", CPU: "1.1%", Memory: "82 MB"},
			},
			Events: []Event{
				{Kind: "Sync succeeded", Message: "Reconciled revision 9b84c0d1", Occurred: "22 min ago", OccurredAt: at(22), Tone: "mint", Revision: "9b84c0d1", Operation: "Sync"},
				{Kind: "Health confirmed", Message: "signal-worker reported healthy", Occurred: "21 min ago", OccurredAt: at(21), Tone: "mint", Revision: "9b84c0d1", Operation: "Observe"},
			},
			LogPreview: []string{"14:11:48Z signal-worker completed delivery batch", "14:11:49Z health check returned 200", "14:12:00Z fixture log preview only — no controller log was requested"},
		},
		{
			Name:           "edge-api",
			Project:        "edge-api",
			Repository:     "github.com/acme/edge-api",
			Revision:       "e713ab42",
			Sync:           outOfSync(),
			Health:         degraded(),
			Observation:    "Observed 43 sec ago",
			LastDeployment: "Deployment failed 8 min ago",
			LastEvent:      "api did not become healthy before the deployment timeout",
			DesiredSummary: "3 Compose services declared",
			LiveSummary:    "1 service needs review before another deployment",
			Services: []Service{
				{Name: "api", Image: "ghcr.io/acme/edge-api:2026.09.15", State: degraded(), Description: "Public request service", CPU: "0.0%", Memory: "—"},
				{Name: "migrations", Image: "ghcr.io/acme/edge-api:2026.09.15", State: healthy(), Description: "One-shot schema migration", CPU: "—", Memory: "Completed"},
				{Name: "cache", Image: "redis:7.4-alpine", State: healthy(), Description: "Request cache", CPU: "0.8%", Memory: "64 MB"},
			},
			Events: []Event{
				{Kind: "Sync failed", Message: "api exceeded the health timeout", Occurred: "8 min ago", OccurredAt: at(8), Tone: "coral", Revision: "e713ab42", Operation: "Sync"},
				{Kind: "Diff available", Message: "Desired revision differs from live state", Occurred: "9 min ago", OccurredAt: at(9), Tone: "amber", Revision: "e713ab42", Operation: "Inspect"},
			},
			LogPreview: []string{"14:23:11Z api waiting for health endpoint", "14:23:41Z health check deadline exceeded", "14:24:02Z fixture log preview only — no controller log was requested"},
		},
		{
			Name:           "registry",
			Project:        "registry",
			Repository:     "github.com/acme/registry",
			Revision:       "9b84c0d1",
			Sync:           synced(),
			Health:         healthy(),
			Observation:    "Observed 31 sec ago",
			LastDeployment: "Deployed yesterday",
			LastEvent:      "Registry catalog reconciled without drift",
			DesiredSummary: "1 Compose service declared",
			LiveSummary:    "Registry service matches the displayed revision",
			Services:       []Service{{Name: "registry", Image: "registry:3.0", State: healthy(), Description: "Private OCI image registry", CPU: "0.4%", Memory: "96 MB"}},
			Events:         []Event{{Kind: "Sync succeeded", Message: "Registry is current", Occurred: "1 day ago", OccurredAt: at(1440), Tone: "mint", Revision: "9b84c0d1", Operation: "Sync"}},
			LogPreview:     []string{"14:08:27Z registry catalog reconciled", "14:08:28Z fixture log preview only — no controller log was requested"},
		},
		{
			Name:             "infra",
			Project:          "infra",
			Repository:       "github.com/acme/infra",
			Revision:         "9b84c0d1",
			Sync:             synced(),
			Health:           unknown(),
			Observation:      "No service observation",
			LastDeployment:   "No deployment required",
			LastEvent:        "Manifest declares no managed Compose services",
			IntentionalEmpty: true,
			DesiredSummary:   "No Compose services declared",
			LiveSummary:      "Context-only manifest; no health inference is made",
			Events:           []Event{{Kind: "Manifest context", Message: "No managed services declared", Occurred: "2 days ago", OccurredAt: at(2880), Tone: "slate", Revision: "9b84c0d1", Operation: "Observe"}},
		},
	}

	source := &FixtureSource{fleet: Fleet{
		Controller:           "My Apps",
		Environment:          "Development controller",
		FetchedAt:            "Fixture snapshot · 14:32 UTC",
		ObservationNote:      "Displayed state is fixture data. It is not a live controller observation.",
		Connection:           State{Label: "Fixture connected", Tone: "mint", Glyph: "✓"},
		ControllerState:      State{Label: "State database ready", Tone: "mint", Glyph: "✓"},
		ControllerResponseAt: "Fixture controller response · 14:32 UTC",
		Capacity:             Capacity{Available: true, State: State{Label: "Current fixture container sample", Tone: "mint", Glyph: "✓"}, CPUPercent: 14.2, CPUCores: 10, MemoryUsageMiB: 812, MemoryTotalMiB: 7936, RunningContainers: 13, EligibleContainers: 13, ObservedContainers: 13, Completeness: "complete", SampleCompletedAt: "Fixture sample · 14:32 UTC"},
		Applications:         applications,
	}}
	source.fleet.deriveCounts()
	return source
}

func (f *Fleet) deriveCounts() {
	f.HealthyCount = 0
	f.AttentionCount = 0
	// Attention is derived per response. Allocate rather than reuse any backing
	// array: scenario copies intentionally share no mutable presentation data
	// with the immutable base fixture or concurrent scenario requests.
	f.Attention = make([]Application, 0, len(f.Applications))
	f.EnvironmentAttention = make([]EnvironmentIssue, 0, 2)
	for _, application := range f.Applications {
		if application.Health.Tone == "mint" {
			f.HealthyCount++
		}
		if needsAttention(application) {
			f.AttentionCount++
			f.Attention = append(f.Attention, application)
		}
	}
	if len(f.Applications) > 0 {
		f.HealthArc = 302 * f.HealthyCount / len(f.Applications)
	}
	if f.ControllerState.Tone == "coral" || f.ControllerState.Tone == "amber" {
		f.EnvironmentAttention = append(f.EnvironmentAttention, EnvironmentIssue{Name: "Controller evidence", Summary: f.ControllerState.Label, State: f.ControllerState, Path: "/controller"})
	}
	if f.Connection.Tone == "coral" || f.Connection.Tone == "amber" {
		f.EnvironmentAttention = append(f.EnvironmentAttention, EnvironmentIssue{Name: "Fleet connection", Summary: f.Connection.Label, State: f.Connection, Path: "/controller"})
	}
	if f.Capacity.State.Tone == "coral" || f.Capacity.State.Tone == "amber" {
		f.EnvironmentAttention = append(f.EnvironmentAttention, EnvironmentIssue{Name: "Capacity evidence", Summary: f.Capacity.State.Label, State: f.Capacity.State, Path: "/fleet#capacity-evidence"})
	}
}

func needsAttention(application Application) bool {
	return application.Health.Tone == "coral" || application.Sync.Tone == "amber" || application.Sync.Tone == "coral"
}

func (s *FixtureSource) Fleet(context.Context) (Fleet, error) { return s.fleet, nil }

func (s *FixtureSource) ViewContext() ViewContext {
	return ViewContext{
		Controller: s.fleet.Controller, Environment: s.fleet.Environment, Freshness: s.fleet.FetchedAt,
		Connection: s.fleet.Connection, Fixture: true,
	}
}

func (s *FixtureSource) Applications(_ context.Context, query, state string) (Fleet, []Application, error) {
	return s.fleet, filterApplications(s.fleet.Applications, query, state), nil
}

func filterApplications(applications []Application, query, state string) []Application {
	query = strings.ToLower(strings.TrimSpace(query))
	state = strings.ToLower(strings.TrimSpace(state))
	filtered := make([]Application, 0, len(applications))
	for _, application := range applications {
		matchesQuery := query == "" || strings.Contains(strings.ToLower(application.Name), query) || strings.Contains(strings.ToLower(application.Project), query)
		matchesState := state == "" || (state == "attention" && needsAttention(application)) || (state == "healthy" && application.Health.Tone == "mint") || (state == "context" && application.IntentionalEmpty)
		if matchesQuery && matchesState {
			filtered = append(filtered, application)
		}
	}
	return filtered
}

func (s *FixtureSource) Application(_ context.Context, name string) (Application, bool, error) {
	for _, application := range s.fleet.Applications {
		if application.Name == name {
			return application, true, nil
		}
	}
	return Application{}, false, nil
}

func (s *FixtureSource) Activity(context.Context) ([]Event, error) {
	activity := make([]Event, 0)
	for _, application := range s.fleet.Applications {
		for _, event := range application.Events {
			event.Application = application.Name
			event.Message = application.Name + " · " + event.Message
			activity = append(activity, event)
		}
	}
	sort.SliceStable(activity, func(left, right int) bool {
		return activity[left].OccurredAt.After(activity[right].OccurredAt)
	})
	return activity, nil
}
