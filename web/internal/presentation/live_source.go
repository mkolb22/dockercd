package presentation

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"sync"
	"time"

	"github.com/mkolb22/dockercd/web/internal/controlplane"
)

// scopedReader is the small, typed controller surface consumed by the live
// presentation mapper. It intentionally cannot call legacy administrator
// routes or return raw controller response maps.
type scopedReader interface {
	Capabilities(context.Context) (controlplane.Capabilities, error)
	Fleet(context.Context) (controlplane.Fleet, error)
	Activity(context.Context, int) (controlplane.Activity, error)
	Application(context.Context, string) (controlplane.Application, error)
	Controller(context.Context) (controlplane.Controller, error)
	Capacity(context.Context) (controlplane.Capacity, error)
}

// LiveSourceConfig accepts an already scoped, server-side reader. The caller
// must build it for an authenticated browser session; this package never reads
// a browser credential, cookie, header, or environment variable.
type LiveSourceConfig struct {
	Reader          scopedReader
	ControllerLabel string
	Environment     string
	Clock           func() time.Time
}

// LiveSource maps versioned controller DTOs into the redacted page models used
// by templates. The current server remains fixture-only until a
// session-to-subject boundary can create one of these per request.
type LiveSource struct {
	reader          scopedReader
	controllerLabel string
	environment     string
	now             func() time.Time
	capabilitiesMu  sync.Mutex
	capabilities    controlplane.Capabilities
	capabilitiesErr error
	capabilitiesSet bool
	freshnessMu     sync.RWMutex
	freshness       string
}

func NewLiveSource(config LiveSourceConfig) (*LiveSource, error) {
	if config.Reader == nil {
		return nil, errors.New("scoped controller reader is required")
	}
	clock := config.Clock
	if clock == nil {
		clock = time.Now
	}
	controllerLabel := strings.TrimSpace(config.ControllerLabel)
	if controllerLabel == "" {
		controllerLabel = "Scoped controller"
	}
	environment := strings.TrimSpace(config.Environment)
	if environment == "" {
		environment = "Scoped presentation session"
	}
	return &LiveSource{reader: config.Reader, controllerLabel: controllerLabel, environment: environment, now: clock}, nil
}

// LoadFleet performs compatibility preflight before returning the only fleet
// projection the templates need. It does not inspect services or synthesize a
// health observation beyond what the controller returned.
func (s *LiveSource) LoadFleet(ctx context.Context) (Fleet, error) {
	if err := s.requireFeature(ctx, "presentation.fleet"); err != nil {
		return Fleet{}, err
	}
	if err := s.requireFeature(ctx, "presentation.status-metadata"); err != nil {
		return Fleet{}, err
	}
	fleet := Fleet{
		Controller:      s.controllerLabel,
		Environment:     s.environment,
		FetchedAt:       "Fleet response unavailable",
		ObservationNote: "Application fleet evidence is unavailable; independent controller and capacity evidence remains below.",
		Connection:      State{Label: "Fleet response failed", Tone: "coral", Glyph: "!"},
		ErrorMessage:    "The scoped application fleet response is unavailable. No retained application state is shown as current.",
	}
	if response, err := s.reader.Fleet(ctx); err == nil {
		s.setFreshness(response.ResponseGeneratedAt)
		applications := make([]Application, 0, len(response.Applications))
		for _, application := range response.Applications {
			applications = append(applications, s.application(application))
		}
		fleet.FetchedAt = controllerResponseTime(response.ResponseGeneratedAt)
		fleet.ObservationNote = "Displayed health and observation times come from the scoped controller response."
		fleet.Connection = State{Label: "Scoped data loaded", Tone: "mint", Glyph: "✓"}
		fleet.ErrorMessage = ""
		fleet.Applications = applications
	}
	fleet.ControllerState = State{Label: "Controller status unavailable to this session", Tone: "slate", Glyph: "?"}
	if s.requireFeature(ctx, "presentation.controller") == nil {
		if controller, err := s.reader.Controller(ctx); err == nil {
			fleet.ControllerState, fleet.ControllerResponseAt = mapControllerState(controller)
		} else {
			fleet.ControllerState = State{Label: "Controller status request failed", Tone: "coral", Glyph: "!"}
		}
	}
	fleet.Capacity = Capacity{State: State{Label: "Capacity unavailable to this session", Tone: "slate", Glyph: "?"}}
	if s.requireFeature(ctx, "presentation.capacity") == nil {
		if capacity, err := s.reader.Capacity(ctx); err == nil {
			fleet.Capacity = mapCapacity(capacity)
		} else {
			fleet.Capacity = Capacity{State: State{Label: "Capacity collection unavailable", Tone: "coral", Glyph: "!"}}
		}
	}
	fleet.deriveCounts()
	return fleet, nil
}

func mapCapacity(value controlplane.Capacity) Capacity {
	capacity := Capacity{State: State{Label: "Capacity sample unavailable", Tone: "slate", Glyph: "?"}, Completeness: value.Completeness, SampleCompletedAt: value.SampleCompletedAt, EligibleContainers: value.EligibleContainers, ObservedContainers: value.ObservedContainers}
	if value.Completeness == "unavailable" {
		return capacity
	}
	started, startedErr := time.Parse(time.RFC3339, value.SampleStartedAt)
	completed, completedErr := time.Parse(time.RFC3339, value.SampleCompletedAt)
	generated, generatedErr := time.Parse(time.RFC3339, value.ResponseGeneratedAt)
	if startedErr != nil || completedErr != nil || generatedErr != nil || started.IsZero() || completed.IsZero() {
		capacity.State = State{Label: "Capacity sample malformed", Tone: "coral", Glyph: "!"}
		return capacity
	}
	if completed.Before(started) || generated.Before(completed) {
		capacity.State = State{Label: "Capacity sample inconsistent", Tone: "coral", Glyph: "!"}
		return capacity
	}
	if generated.Sub(completed) > 15*time.Second {
		capacity.State = State{Label: "Capacity sample stale", Tone: "amber", Glyph: "~"}
		return capacity
	}
	if value.CPUCores <= 0 || value.CPUPercent < 0 || value.CPUPercent > 100 || math.IsNaN(value.CPUPercent) || math.IsInf(value.CPUPercent, 0) || value.MemoryUsageMiB < 0 || value.MemoryTotalMiB <= 0 || value.MemoryUsageMiB > value.MemoryTotalMiB || math.IsNaN(value.MemoryUsageMiB) || math.IsNaN(value.MemoryTotalMiB) || math.IsInf(value.MemoryUsageMiB, 0) || math.IsInf(value.MemoryTotalMiB, 0) || value.RunningContainers < 0 || value.EligibleContainers < 0 || value.EligibleContainers > 64 || value.ObservedContainers < 0 || value.ObservedContainers > value.EligibleContainers || value.RunningContainers < value.ObservedContainers {
		capacity.State = State{Label: "Capacity sample malformed", Tone: "coral", Glyph: "!"}
		return capacity
	}
	if value.Completeness == "truncated" {
		capacity.State = State{Label: "Capacity sample truncated", Tone: "amber", Glyph: "~"}
		return capacity
	}
	if value.Completeness == "partial" || value.ObservedContainers != value.EligibleContainers {
		capacity.State = State{Label: "Capacity sample partial", Tone: "amber", Glyph: "~"}
		return capacity
	}
	if value.Completeness != "complete" {
		capacity.State = State{Label: "Capacity sample malformed", Tone: "coral", Glyph: "!"}
		return capacity
	}
	if value.RunningContainers != value.EligibleContainers {
		capacity.State = State{Label: "Capacity sample inconsistent", Tone: "coral", Glyph: "!"}
		return capacity
	}
	capacity.Available = true
	capacity.State = State{Label: "Current container sample", Tone: "mint", Glyph: "✓"}
	capacity.CPUPercent = value.CPUPercent
	capacity.CPUCores = value.CPUCores
	capacity.MemoryUsageMiB = value.MemoryUsageMiB
	capacity.MemoryTotalMiB = value.MemoryTotalMiB
	capacity.RunningContainers = value.RunningContainers
	return capacity
}

func mapControllerState(value controlplane.Controller) (State, string) {
	generated, err := time.Parse(time.RFC3339, value.ResponseGeneratedAt)
	if err != nil || generated.IsZero() {
		return State{Label: "Controller status malformed", Tone: "coral", Glyph: "!"}, ""
	}
	responseAt := "Controller response · " + generated.UTC().Format(time.RFC3339)
	if value.StateDatabaseReady {
		return State{Label: "State database ready", Tone: "mint", Glyph: "✓"}, responseAt
	}
	return State{Label: "State database not ready", Tone: "coral", Glyph: "!"}, responseAt
}

// LoadActivity returns only the bounded, redacted controller activity window.
// It never presents the result as complete historical evidence.
func (s *LiveSource) LoadActivity(ctx context.Context, limit int) ([]Event, error) {
	if limit < 1 || limit > 100 {
		return nil, controlplane.ErrFeatureUnavailable
	}
	if err := s.requireFeature(ctx, "presentation.activity"); err != nil {
		return nil, err
	}
	if err := s.requireFeature(ctx, "presentation.status-metadata"); err != nil {
		return nil, err
	}
	response, err := s.reader.Activity(ctx, limit)
	if err != nil {
		return nil, fmt.Errorf("loading scoped activity: %w", err)
	}
	s.setFreshness(response.ResponseGeneratedAt)
	events := make([]Event, 0, len(response.Events))
	for _, event := range response.Events {
		events = append(events, s.activity(event))
	}
	return events, nil
}

// LoadApplication preflights the separate application feature. It makes no
// request for desired topology, diffs, logs, or historical events because
// those source contracts are not implemented for live browser rendering.
func (s *LiveSource) LoadApplication(ctx context.Context, name string) (Application, error) {
	if err := s.requireFeature(ctx, "presentation.application"); err != nil {
		return Application{}, err
	}
	if err := s.requireFeature(ctx, "presentation.status-metadata"); err != nil {
		return Application{}, err
	}
	response, err := s.reader.Application(ctx, name)
	if err != nil {
		return Application{}, fmt.Errorf("loading scoped application: %w", err)
	}
	s.setFreshness(response.ResponseGeneratedAt)
	return s.application(response), nil
}

// Fleet implements Source for a live, session-scoped request.
func (s *LiveSource) Fleet(ctx context.Context) (Fleet, error) { return s.LoadFleet(ctx) }

func (s *LiveSource) ViewContext() ViewContext {
	s.freshnessMu.RLock()
	freshness := s.freshness
	s.freshnessMu.RUnlock()
	if freshness == "" {
		freshness = "Awaiting controller response"
	}
	return ViewContext{
		Controller: s.controllerLabel, Environment: s.environment,
		Freshness: freshness, Connection: State{Label: "Scoped session", Tone: "mint", Glyph: "✓"},
	}
}

// IsFeatureUnavailable lets the renderer omit an optional, independently
// scoped panel without conflating it with an authentication or controller
// failure.
func IsFeatureUnavailable(err error) bool { return errors.Is(err, controlplane.ErrFeatureUnavailable) }

// Applications implements Source without issuing an application detail call
// for every row. The fleet DTO is the deliberate bounded list projection.
func (s *LiveSource) Applications(ctx context.Context, query, state string) (Fleet, []Application, error) {
	fleet, err := s.LoadFleet(ctx)
	if err != nil {
		return Fleet{}, nil, err
	}
	return fleet, filterApplications(fleet.Applications, query, state), nil
}

// Application implements Source and makes the one permitted detail request.
// A scoped 404 remains indistinguishable from a missing application.
func (s *LiveSource) Application(ctx context.Context, name string) (Application, bool, error) {
	application, err := s.LoadApplication(ctx, name)
	if errors.Is(err, controlplane.ErrNotFound) {
		return Application{}, false, nil
	}
	if err != nil {
		return Application{}, false, err
	}
	return application, true, nil
}

// Activity implements Source using the controller's documented recent window.
func (s *LiveSource) Activity(ctx context.Context) ([]Event, error) {
	return s.LoadActivity(ctx, 50)
}

func (s *LiveSource) requireFeature(ctx context.Context, feature string) error {
	if s == nil || s.reader == nil {
		return controlplane.ErrFeatureUnavailable
	}
	capabilities, err := s.loadCapabilities(ctx)
	if err != nil {
		return fmt.Errorf("preflighting scoped controller: %w", err)
	}
	for _, available := range capabilities.Features {
		if available == feature {
			return nil
		}
	}
	return controlplane.ErrFeatureUnavailable
}

// loadCapabilities caches only within one live-source instance, which is
// created per browser request by SessionSourceProvider. It therefore coalesces
// route-local preflights without sharing permissions across sessions.
func (s *LiveSource) loadCapabilities(ctx context.Context) (controlplane.Capabilities, error) {
	s.capabilitiesMu.Lock()
	defer s.capabilitiesMu.Unlock()
	if !s.capabilitiesSet {
		s.capabilities, s.capabilitiesErr = s.reader.Capabilities(ctx)
		s.capabilitiesSet = true
	}
	return s.capabilities, s.capabilitiesErr
}

func (s *LiveSource) application(source controlplane.Application) Application {
	revision := strings.TrimSpace(source.HeadSHA)
	if revision == "" {
		revision = strings.TrimSpace(source.LastSyncedSHA)
	}
	if revision == "" {
		revision = "No displayed revision"
	}
	return Application{
		Name:           source.Name,
		Project:        source.Name,
		Revision:       revision,
		Sync:           syncState(source.SyncStatus),
		Health:         healthState(source.ObservedHealthStatus, source.LastObservedAt, source.ObservationCompleteness),
		Observation:    observation(source.ObservedHealthStatus, source.LastObservedAt, source.ObservationCompleteness, s.now()),
		LastDeployment: deploymentTime(source.LastSyncTime, s.now()),
		LastEvent:      "Live status is limited to the scoped controller response.",
		DesiredSummary: "Desired topology is not requested in this live read.",
		LiveSummary:    "No service-level inference is made from fleet status.",
	}
}

func (s *LiveSource) activity(source controlplane.ActivityEvent) Event {
	occurredAt, err := time.Parse(time.RFC3339, source.OccurredAt)
	if err != nil {
		occurredAt = time.Time{}
	}
	return Event{
		Application: source.Application,
		Kind:        activityKind(source.Type),
		Message:     "Redacted controller activity metadata.",
		Occurred:    relativeTime(occurredAt, s.now()),
		OccurredAt:  occurredAt,
		Tone:        severityTone(source.Severity),
		Operation:   "Controller event",
	}
}

func syncState(status string) State {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "synced":
		return State{Label: "Synced", Tone: "mint", Glyph: "✓"}
	case "outofsync", "out of sync":
		return State{Label: "Out of sync", Tone: "amber", Glyph: "~"}
	case "failed", "error":
		return State{Label: "Sync failed", Tone: "coral", Glyph: "!"}
	default:
		return State{Label: "Sync unknown", Tone: "slate", Glyph: "?"}
	}
}

func healthState(observedStatus, observedAt, completeness string) State {
	switch completeness {
	case "unavailable":
		return State{Label: "Not observed", Tone: "slate", Glyph: "?"}
	case "complete":
		parsedObservedAt, err := time.Parse(time.RFC3339, observedAt)
		if err != nil || parsedObservedAt.IsZero() || strings.TrimSpace(observedStatus) == "" {
			return State{Label: "Observation incomplete", Tone: "slate", Glyph: "?"}
		}
	default:
		return State{Label: "Observation availability unknown", Tone: "slate", Glyph: "?"}
	}
	switch strings.ToLower(strings.TrimSpace(observedStatus)) {
	case "healthy":
		return State{Label: "Healthy", Tone: "mint", Glyph: "✓"}
	case "degraded", "unhealthy", "failed":
		return State{Label: "Needs review", Tone: "coral", Glyph: "!"}
	default:
		return State{Label: "Health unknown", Tone: "slate", Glyph: "?"}
	}
}

func controllerResponseTime(value string) string {
	generatedAt, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return "Controller response time unavailable"
	}
	return "Controller response · " + generatedAt.UTC().Format(time.RFC3339)
}

func (s *LiveSource) setFreshness(value string) {
	s.freshnessMu.Lock()
	s.freshness = controllerResponseTime(value)
	s.freshnessMu.Unlock()
}

func observation(status, value, completeness string, now time.Time) string {
	if completeness != "complete" || strings.TrimSpace(status) == "" {
		return "No service observation"
	}
	observedAt, err := time.Parse(time.RFC3339, value)
	if err != nil || observedAt.IsZero() {
		return "No service observation"
	}
	return "Observed " + relativeTime(observedAt, now)
}

func deploymentTime(value string, now time.Time) string {
	timestamp, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return "No recorded deployment"
	}
	return "Deployed " + relativeTime(timestamp, now)
}

func relativeTime(value, now time.Time) string {
	if value.IsZero() {
		return "at an unavailable time"
	}
	age := now.Sub(value)
	if age < 0 {
		return "at " + value.UTC().Format(time.RFC3339) + " (controller clock ahead)"
	}
	if age == 0 {
		return "just now"
	}
	switch {
	case age < time.Minute:
		return fmt.Sprintf("%d sec ago", int(age.Seconds()))
	case age < time.Hour:
		return fmt.Sprintf("%d min ago", int(age.Minutes()))
	case age < 24*time.Hour:
		return fmt.Sprintf("%d hr ago", int(age.Hours()))
	default:
		return fmt.Sprintf("%d days ago", int(age.Hours()/24))
	}
}

func severityTone(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "error", "critical":
		return "coral"
	case "warning", "warn":
		return "amber"
	default:
		return "mint"
	}
}

func activityKind(value string) string {
	switch value {
	case "SyncSuccess":
		return "Sync succeeded"
	case "SyncError", "SyncFailed":
		return "Sync failed"
	case "HealthObservation":
		return "Health observed"
	default:
		return "Controller event"
	}
}
