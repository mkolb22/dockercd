package presentation

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/mkolb22/dockercd/web/internal/controlplane"
)

type fakeScopedReader struct {
	capabilities  controlplane.Capabilities
	fleet         controlplane.Fleet
	activity      controlplane.Activity
	application   controlplane.Application
	err           error
	controller    controlplane.Controller
	capacity      controlplane.Capacity
	controllerErr error
	capacityErr   error
	fleetErr      error
	fleetCalls    int
	activityCalls int
	appCalls      int
	capCalls      int
}

func (f *fakeScopedReader) Capabilities(context.Context) (controlplane.Capabilities, error) {
	f.capCalls++
	return f.capabilities, f.err
}
func (f *fakeScopedReader) Fleet(context.Context) (controlplane.Fleet, error) {
	f.fleetCalls++
	if f.fleetErr != nil {
		return controlplane.Fleet{}, f.fleetErr
	}
	return f.fleet, f.err
}
func (f *fakeScopedReader) Activity(context.Context, int) (controlplane.Activity, error) {
	f.activityCalls++
	return f.activity, f.err
}
func (f *fakeScopedReader) Application(context.Context, string) (controlplane.Application, error) {
	f.appCalls++
	return f.application, f.err
}

func (f *fakeScopedReader) Controller(context.Context) (controlplane.Controller, error) {
	return f.controller, f.controllerErr
}
func (f *fakeScopedReader) Capacity(context.Context) (controlplane.Capacity, error) {
	return f.capacity, f.capacityErr
}

func TestLiveSourceMapsOnlyScopedReadModels(t *testing.T) {
	now := time.Date(2026, 9, 15, 14, 32, 0, 0, time.UTC)
	reader := &fakeScopedReader{
		capabilities: controlplane.Capabilities{APIVersion: "v1", Features: []string{"presentation.fleet", "presentation.activity", "presentation.application", "presentation.status-metadata"}},
		fleet: controlplane.Fleet{Applications: []controlplane.Application{
			{Name: "healthy", SyncStatus: "Synced", HealthStatus: "Healthy", ObservedHealthStatus: "Healthy", ObservationCompleteness: "complete", LastSyncedSHA: "abc123", LastObservedAt: now.Add(-18 * time.Second).Format(time.RFC3339), LastSyncTime: now.Add(-time.Minute).Format(time.RFC3339)},
			{Name: "unknown", SyncStatus: "Unknown", HealthStatus: "Healthy", ObservationCompleteness: "unavailable"},
		}, ResponseGeneratedAt: now.Format(time.RFC3339)},
		activity:    controlplane.Activity{Events: []controlplane.ActivityEvent{{Application: "healthy", Type: "SyncSuccess", Severity: "info", OccurredAt: now.Add(-time.Minute).Format(time.RFC3339)}}},
		application: controlplane.Application{Name: "healthy", SyncStatus: "Synced", HealthStatus: "Healthy", ObservedHealthStatus: "Healthy", ObservationCompleteness: "complete", HeadSHA: "def456", LastObservedAt: now.Add(-18 * time.Second).Format(time.RFC3339), ResponseGeneratedAt: now.Format(time.RFC3339)},
	}
	source, err := NewLiveSource(LiveSourceConfig{Reader: reader, ControllerLabel: "My Apps", Environment: "Development", Clock: func() time.Time { return now }})
	if err != nil {
		t.Fatal(err)
	}
	fleet, err := source.LoadFleet(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if reader.fleetCalls != 1 || fleet.Controller != "My Apps" || fleet.FetchedAt != "Controller response · 2026-09-15T14:32:00Z" || fleet.HealthyCount != 1 || fleet.Applications[0].Observation != "Observed 18 sec ago" || fleet.Applications[1].Health.Label != "Not observed" {
		t.Fatalf("unexpected fleet mapping: %#v", fleet)
	}
	activity, err := source.LoadActivity(t.Context(), 50)
	if err != nil || reader.activityCalls != 1 || len(activity) != 1 || activity[0].Kind != "Sync succeeded" || activity[0].Message != "Redacted controller activity metadata." {
		t.Fatalf("unexpected activity mapping: %#v, %v", activity, err)
	}
	application, err := source.LoadApplication(t.Context(), "healthy")
	if err != nil || reader.appCalls != 1 || application.Revision != "def456" || application.Services != nil || application.LogPreview != nil {
		t.Fatalf("unexpected application mapping: %#v, %v", application, err)
	}
	if reader.capCalls != 1 {
		t.Fatalf("capabilities handshakes = %d, want one per live request source", reader.capCalls)
	}
}

func TestLiveSourceFailsClosedForMissingFeatureOrReader(t *testing.T) {
	if _, err := NewLiveSource(LiveSourceConfig{}); err == nil {
		t.Fatal("expected missing reader to fail")
	}
	reader := &fakeScopedReader{capabilities: controlplane.Capabilities{APIVersion: "v1", Features: []string{"presentation.fleet", "presentation.status-metadata"}}}
	source, err := NewLiveSource(LiveSourceConfig{Reader: reader})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := source.LoadActivity(t.Context(), 50); !errors.Is(err, controlplane.ErrFeatureUnavailable) || reader.activityCalls != 0 {
		t.Fatalf("missing activity feature = %v, calls=%d", err, reader.activityCalls)
	}
	if _, err := source.LoadFleet(t.Context()); err != nil {
		t.Fatalf("available fleet failed: %v", err)
	}
	if _, err := source.LoadApplication(t.Context(), "app"); !errors.Is(err, controlplane.ErrFeatureUnavailable) || reader.appCalls != 0 {
		t.Fatalf("missing application feature = %v, calls=%d", err, reader.appCalls)
	}
	withoutMetadata := &fakeScopedReader{capabilities: controlplane.Capabilities{APIVersion: "v1", Features: []string{"presentation.fleet"}}}
	metadataSource, err := NewLiveSource(LiveSourceConfig{Reader: withoutMetadata})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := metadataSource.LoadFleet(t.Context()); !errors.Is(err, controlplane.ErrFeatureUnavailable) || withoutMetadata.fleetCalls != 0 {
		t.Fatalf("missing status metadata = %v, fleet calls=%d", err, withoutMetadata.fleetCalls)
	}
}

func TestLiveSourceRequiresCompleteObservedHealthAndCountsSyncFailure(t *testing.T) {
	now := time.Date(2026, 9, 15, 14, 32, 0, 0, time.UTC)
	reader := &fakeScopedReader{
		capabilities: controlplane.Capabilities{APIVersion: "v1", Features: []string{"presentation.fleet", "presentation.status-metadata"}},
		fleet: controlplane.Fleet{Applications: []controlplane.Application{
			{Name: "malformed-time", SyncStatus: "Synced", HealthStatus: "Healthy", ObservedHealthStatus: "Healthy", ObservationCompleteness: "complete", LastObservedAt: "not-a-timestamp"},
			{Name: "unpaired-health", SyncStatus: "Synced", HealthStatus: "Healthy", ObservationCompleteness: "complete", LastObservedAt: now.Format(time.RFC3339)},
			{Name: "sync-error", SyncStatus: "Error", HealthStatus: "Healthy", ObservedHealthStatus: "Healthy", ObservationCompleteness: "complete", LastObservedAt: now.Format(time.RFC3339)},
		}, ResponseGeneratedAt: now.Format(time.RFC3339)},
	}
	source, err := NewLiveSource(LiveSourceConfig{Reader: reader, Clock: func() time.Time { return now }})
	if err != nil {
		t.Fatal(err)
	}
	fleet, err := source.LoadFleet(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if fleet.Applications[0].Health.Label != "Observation incomplete" || fleet.Applications[1].Health.Label != "Observation incomplete" {
		t.Fatalf("incomplete observations received health claims: %#v", fleet.Applications)
	}
	if fleet.Applications[1].Observation != "No service observation" {
		t.Fatalf("incomplete observation retained an age claim: %#v", fleet.Applications[1])
	}
	if fleet.Applications[2].Sync.Tone != "coral" || fleet.AttentionCount != 1 {
		t.Fatalf("sync failure did not enter attention queue: %#v", fleet)
	}
}

func TestCapacityMappingRejectsPartialAndInconsistentEvidence(t *testing.T) {
	now := time.Date(2026, 9, 18, 12, 0, 0, 0, time.UTC)
	valid := controlplane.Capacity{CPUPercent: 12.5, CPUCores: 8, MemoryUsageMiB: 512, MemoryTotalMiB: 4096, RunningContainers: 3, EligibleContainers: 3, ObservedContainers: 3, Completeness: "complete", SampleStartedAt: now.Add(-6 * time.Second).Format(time.RFC3339), SampleCompletedAt: now.Add(-5 * time.Second).Format(time.RFC3339), ResponseGeneratedAt: now.Format(time.RFC3339)}
	if mapped := mapCapacity(valid); !mapped.Available || mapped.State.Label != "Current container sample" {
		t.Fatalf("valid capacity was not displayed: %#v", mapped)
	}
	valid.Completeness = "partial"
	if mapped := mapCapacity(valid); mapped.Available || mapped.State.Label != "Capacity sample partial" {
		t.Fatalf("partial capacity was displayed: %#v", mapped)
	}
	valid.Completeness = "complete"
	valid.SampleCompletedAt = now.Add(time.Second).Format(time.RFC3339)
	if mapped := mapCapacity(valid); mapped.Available || mapped.State.Label != "Capacity sample inconsistent" {
		t.Fatalf("future capacity sample was displayed: %#v", mapped)
	}
	valid.SampleCompletedAt = now.Add(-5 * time.Second).Format(time.RFC3339)
	valid.CPUPercent = 101
	if mapped := mapCapacity(valid); mapped.Available || mapped.State.Label != "Capacity sample malformed" {
		t.Fatalf("impossible CPU reading was displayed: %#v", mapped)
	}
	if mapped := mapCapacity(controlplane.Capacity{Completeness: "unavailable"}); mapped.Available || mapped.State.Label != "Capacity sample unavailable" {
		t.Fatalf("unavailable capacity was misclassified: %#v", mapped)
	}
}

func TestControllerStateRejectsMalformedControllerTimestamp(t *testing.T) {
	state, timestamp := mapControllerState(controlplane.Controller{StateDatabaseReady: true, ResponseGeneratedAt: "not-a-time"})
	if state.Label != "Controller status malformed" || timestamp != "" {
		t.Fatalf("malformed controller timestamp was trusted: %#v %q", state, timestamp)
	}
}

func TestLiveSourceNamesOptionalControllerAndCapacityFailureStates(t *testing.T) {
	now := time.Date(2026, 9, 18, 12, 0, 0, 0, time.UTC)
	reader := &fakeScopedReader{
		capabilities: controlplane.Capabilities{Features: []string{"presentation.fleet", "presentation.status-metadata", "presentation.controller", "presentation.capacity"}},
		fleet:        controlplane.Fleet{ResponseGeneratedAt: now.Format(time.RFC3339)},
		controller:   controlplane.Controller{StateDatabaseReady: false, ResponseGeneratedAt: now.Format(time.RFC3339)},
		capacity: controlplane.Capacity{CPUPercent: 10, CPUCores: 8, MemoryUsageMiB: 512, MemoryTotalMiB: 4096, RunningContainers: 65, Completeness: "truncated", EligibleContainers: 64, ObservedContainers: 64,
			SampleStartedAt: now.Add(-2 * time.Second).Format(time.RFC3339), SampleCompletedAt: now.Add(-time.Second).Format(time.RFC3339), ResponseGeneratedAt: now.Format(time.RFC3339)},
	}
	source, err := NewLiveSource(LiveSourceConfig{Reader: reader})
	if err != nil {
		t.Fatal(err)
	}
	fleet, err := source.LoadFleet(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if fleet.ControllerState.Label != "State database not ready" || fleet.Capacity.State.Label != "Capacity sample truncated" {
		t.Fatalf("optional evidence states not named: %#v", fleet)
	}
	reader.controllerErr = errors.New("controller unavailable")
	reader.capacityErr = errors.New("capacity unavailable")
	source, err = NewLiveSource(LiveSourceConfig{Reader: reader})
	if err != nil {
		t.Fatal(err)
	}
	fleet, err = source.LoadFleet(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if fleet.ControllerState.Label != "Controller status request failed" || fleet.Capacity.State.Label != "Capacity collection unavailable" {
		t.Fatalf("request failures were hidden: %#v", fleet)
	}
}

func TestLiveSourcePreservesControlPathWhenFleetFails(t *testing.T) {
	now := time.Date(2026, 9, 18, 12, 0, 0, 0, time.UTC)
	reader := &fakeScopedReader{
		capabilities: controlplane.Capabilities{Features: []string{"presentation.fleet", "presentation.status-metadata", "presentation.controller", "presentation.capacity"}},
		fleetErr:     errors.New("fleet endpoint unavailable"),
		controller:   controlplane.Controller{StateDatabaseReady: true, ResponseGeneratedAt: now.Format(time.RFC3339)},
		capacity: controlplane.Capacity{CPUPercent: 10, CPUCores: 8, MemoryUsageMiB: 512, MemoryTotalMiB: 4096, RunningContainers: 3, EligibleContainers: 3, ObservedContainers: 3, Completeness: "complete",
			SampleStartedAt: now.Add(-2 * time.Second).Format(time.RFC3339), SampleCompletedAt: now.Add(-time.Second).Format(time.RFC3339), ResponseGeneratedAt: now.Format(time.RFC3339)},
	}
	source, err := NewLiveSource(LiveSourceConfig{Reader: reader})
	if err != nil {
		t.Fatal(err)
	}
	fleet, err := source.LoadFleet(t.Context())
	if err != nil {
		t.Fatalf("fleet failure hid control path: %v", err)
	}
	if fleet.Connection.Tone != "coral" || fleet.ControllerState.Label != "State database ready" || !fleet.Capacity.Available || fleet.ErrorMessage == "" {
		t.Fatalf("control-path evidence was not retained: %#v", fleet)
	}
}

func TestHealthStateRejectsZeroObservationTime(t *testing.T) {
	if state := healthState("Healthy", time.Time{}.Format(time.RFC3339), "complete"); state.Label != "Observation incomplete" {
		t.Fatalf("zero observation time produced %#v", state)
	}
}

func TestRelativeTimeDoesNotTreatFutureObservationAsFresh(t *testing.T) {
	now := time.Date(2026, 9, 15, 14, 32, 0, 0, time.UTC)
	future := now.Add(time.Minute)
	if actual := relativeTime(future, now); actual != "at 2026-09-15T14:33:00Z (controller clock ahead)" {
		t.Fatalf("future time = %q", actual)
	}
}
