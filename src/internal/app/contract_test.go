// contract_test.go — Property-based contract tests for the app package.
// Generated from ZenSpecs "application-lifecycle" and "health-status".
//
// These tests verify the formal contracts (postconditions and properties)
// for Validate, ApplyDefaults, WorstHealth, and Severity.
package app

import (
	"strings"
	"testing"
	"time"

	"pgregory.net/rapid"
)

// --- Generators ---

// genDNSLabel generates a valid DNS label (lowercase alphanumeric, hyphens, 1-63 chars).
func genDNSLabel() *rapid.Generator[string] {
	return rapid.StringMatching(`[a-z0-9]([a-z0-9\-]{0,10}[a-z0-9])?`)
}

// genHealthStatus generates one of the four defined health statuses.
func genHealthStatus() *rapid.Generator[HealthStatus] {
	return rapid.SampledFrom([]HealthStatus{
		HealthStatusHealthy,
		HealthStatusProgressing,
		HealthStatusDegraded,
		HealthStatusUnknown,
	})
}

// validAppContract returns a minimal valid Application for testing.
func validAppContract() Application {
	return Application{
		APIVersion: "dockercd/v1",
		Kind:       "Application",
		Metadata:   AppMetadata{Name: "test-app"},
		Spec: AppSpec{
			Source: SourceSpec{
				RepoURL: "https://github.com/org/repo.git",
			},
		},
	}
}

// --- Contract: Validate Postconditions ---

// TestContract_ValidateMinimalApp verifies that a minimal valid app passes validation.
func TestContract_ValidateMinimalApp(t *testing.T) {
	a := validAppContract()
	if err := a.Validate(); err != nil {
		t.Fatalf("valid app should pass validation, got: %v", err)
	}
}

// TestContract_ValidateMissingAPIVersion verifies APIVersion is required.
func TestContract_ValidateMissingAPIVersion(t *testing.T) {
	a := validAppContract()
	a.APIVersion = "wrong/v2"
	err := a.Validate()
	if err == nil {
		t.Fatal("expected error for wrong apiVersion")
	}
	if !strings.Contains(err.Error(), "apiVersion") {
		t.Fatalf("error should mention apiVersion, got: %v", err)
	}
}

// TestContract_ValidateMissingKind verifies Kind is required.
func TestContract_ValidateMissingKind(t *testing.T) {
	a := validAppContract()
	a.Kind = "Deployment"
	err := a.Validate()
	if err == nil {
		t.Fatal("expected error for wrong kind")
	}
	if !strings.Contains(err.Error(), "kind") {
		t.Fatalf("error should mention kind, got: %v", err)
	}
}

// TestContract_ValidateMissingName verifies metadata.name is required.
func TestContract_ValidateMissingName(t *testing.T) {
	a := validAppContract()
	a.Metadata.Name = ""
	err := a.Validate()
	if err == nil {
		t.Fatal("expected error for empty name")
	}
	if !strings.Contains(err.Error(), "name") {
		t.Fatalf("error should mention name, got: %v", err)
	}
}

// TestContract_ValidateInvalidDNSName verifies name must be a valid DNS label.
func TestContract_ValidateInvalidDNSName(t *testing.T) {
	invalid := []string{"UPPER", "-leading", "trailing-", "with spaces", "with.dots"}
	for _, name := range invalid {
		a := validAppContract()
		a.Metadata.Name = name
		if err := a.Validate(); err == nil {
			t.Fatalf("expected error for invalid DNS name %q", name)
		}
	}
}

// TestContract_ValidateMissingRepoURL verifies repoURL is required.
func TestContract_ValidateMissingRepoURL(t *testing.T) {
	a := validAppContract()
	a.Spec.Source.RepoURL = ""
	err := a.Validate()
	if err == nil {
		t.Fatal("expected error for missing repoURL")
	}
	if !strings.Contains(err.Error(), "repoURL") {
		t.Fatalf("error should mention repoURL, got: %v", err)
	}
}

// TestContract_ValidateLowPollInterval verifies pollInterval >= 30s.
func TestContract_ValidateLowPollInterval(t *testing.T) {
	a := validAppContract()
	a.Spec.SyncPolicy.PollInterval = NewDuration(10 * time.Second)
	err := a.Validate()
	if err == nil {
		t.Fatal("expected error for low poll interval")
	}
	if !strings.Contains(err.Error(), "pollInterval") {
		t.Fatalf("error should mention pollInterval, got: %v", err)
	}
}

// TestContract_ValidateAcceptablePollInterval verifies >= 30s passes.
func TestContract_ValidateAcceptablePollInterval(t *testing.T) {
	a := validAppContract()
	a.Spec.SyncPolicy.PollInterval = NewDuration(30 * time.Second)
	if err := a.Validate(); err != nil {
		t.Fatalf("30s poll interval should be valid, got: %v", err)
	}
}

// TestContract_ValidateCollectsAllErrors verifies all errors are reported.
func TestContract_ValidateCollectsAllErrors(t *testing.T) {
	a := Application{} // everything wrong
	err := a.Validate()
	if err == nil {
		t.Fatal("expected error for empty app")
	}
	msg := err.Error()
	if !strings.Contains(msg, "apiVersion") {
		t.Error("should report apiVersion error")
	}
	if !strings.Contains(msg, "kind") {
		t.Error("should report kind error")
	}
	if !strings.Contains(msg, "name") {
		t.Error("should report name error")
	}
	if !strings.Contains(msg, "repoURL") {
		t.Error("should report repoURL error")
	}
}

// TestContract_ValidateDNSLabelProperty verifies valid DNS labels pass.
func TestContract_ValidateDNSLabelProperty(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		name := genDNSLabel().Draw(t, "name")
		a := validAppContract()
		a.Metadata.Name = name
		if err := a.Validate(); err != nil {
			t.Fatalf("valid DNS label %q should pass validation, got: %v", name, err)
		}
	})
}

// --- Contract: ApplyDefaults Postconditions ---

// TestContract_ApplyDefaultsFillsAllDefaults verifies all defaults are set.
func TestContract_ApplyDefaultsFillsAllDefaults(t *testing.T) {
	a := Application{}
	a.ApplyDefaults()

	if a.Spec.Source.TargetRevision != "main" {
		t.Fatalf("TargetRevision: want \"main\", got %q", a.Spec.Source.TargetRevision)
	}
	if a.Spec.Source.Path != "." {
		t.Fatalf("Path: want \".\", got %q", a.Spec.Source.Path)
	}
	if len(a.Spec.Source.ComposeFiles) != 1 || a.Spec.Source.ComposeFiles[0] != "docker-compose.yml" {
		t.Fatalf("ComposeFiles: want [docker-compose.yml], got %v", a.Spec.Source.ComposeFiles)
	}
	if a.Spec.Destination.DockerHost != "unix:///var/run/docker.sock" {
		t.Fatalf("DockerHost: want default, got %q", a.Spec.Destination.DockerHost)
	}
	if a.Spec.SyncPolicy.PollInterval.Duration != 180*time.Second {
		t.Fatalf("PollInterval: want 180s, got %s", a.Spec.SyncPolicy.PollInterval.Duration)
	}
	if a.Spec.SyncPolicy.SyncTimeout.Duration != 300*time.Second {
		t.Fatalf("SyncTimeout: want 300s, got %s", a.Spec.SyncPolicy.SyncTimeout.Duration)
	}
	if a.Spec.SyncPolicy.HealthTimeout.Duration != 120*time.Second {
		t.Fatalf("HealthTimeout: want 120s, got %s", a.Spec.SyncPolicy.HealthTimeout.Duration)
	}
}

// TestContract_ApplyDefaultsDoesNotOverwrite verifies existing values are preserved.
func TestContract_ApplyDefaultsDoesNotOverwrite(t *testing.T) {
	a := Application{
		Spec: AppSpec{
			Source: SourceSpec{
				TargetRevision: "develop",
				Path:           "deploy/",
				ComposeFiles:   []string{"compose.yml"},
			},
			Destination: DestinationSpec{
				DockerHost:  "tcp://remote:2376",
				ProjectName: "my-project",
			},
			SyncPolicy: SyncPolicy{
				PollInterval:  NewDuration(60 * time.Second),
				SyncTimeout:   NewDuration(600 * time.Second),
				HealthTimeout: NewDuration(240 * time.Second),
			},
		},
	}
	a.ApplyDefaults()

	if a.Spec.Source.TargetRevision != "develop" {
		t.Fatalf("TargetRevision overwritten: got %q", a.Spec.Source.TargetRevision)
	}
	if a.Spec.Source.Path != "deploy/" {
		t.Fatalf("Path overwritten: got %q", a.Spec.Source.Path)
	}
	if a.Spec.Source.ComposeFiles[0] != "compose.yml" {
		t.Fatalf("ComposeFiles overwritten: got %v", a.Spec.Source.ComposeFiles)
	}
	if a.Spec.Destination.DockerHost != "tcp://remote:2376" {
		t.Fatalf("DockerHost overwritten: got %q", a.Spec.Destination.DockerHost)
	}
	if a.Spec.Destination.ProjectName != "my-project" {
		t.Fatalf("ProjectName overwritten: got %q", a.Spec.Destination.ProjectName)
	}
	if a.Spec.SyncPolicy.PollInterval.Duration != 60*time.Second {
		t.Fatalf("PollInterval overwritten: got %s", a.Spec.SyncPolicy.PollInterval.Duration)
	}
}

// TestContract_ApplyDefaultsIdempotent verifies calling twice produces same result.
func TestContract_ApplyDefaultsIdempotent(t *testing.T) {
	a := Application{}
	a.ApplyDefaults()
	// Snapshot values after first call
	rev := a.Spec.Source.TargetRevision
	path := a.Spec.Source.Path
	host := a.Spec.Destination.DockerHost
	poll := a.Spec.SyncPolicy.PollInterval.Duration

	a.ApplyDefaults()
	if a.Spec.Source.TargetRevision != rev {
		t.Fatal("ApplyDefaults not idempotent: TargetRevision changed")
	}
	if a.Spec.Source.Path != path {
		t.Fatal("ApplyDefaults not idempotent: Path changed")
	}
	if a.Spec.Destination.DockerHost != host {
		t.Fatal("ApplyDefaults not idempotent: DockerHost changed")
	}
	if a.Spec.SyncPolicy.PollInterval.Duration != poll {
		t.Fatal("ApplyDefaults not idempotent: PollInterval changed")
	}
}

// TestContract_ApplyDefaultsProjectNameFromMetadata verifies ProjectName defaults to metadata name.
func TestContract_ApplyDefaultsProjectNameFromMetadata(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		name := genDNSLabel().Draw(t, "name")
		a := Application{Metadata: AppMetadata{Name: name}}
		a.ApplyDefaults()
		if a.Spec.Destination.ProjectName != name {
			t.Fatalf("ProjectName should default to metadata.name %q, got %q",
				name, a.Spec.Destination.ProjectName)
		}
	})
}

// --- Contract: WorstHealth Properties ---

// TestContract_WorstHealthCommutative verifies: WorstHealth(a, b) == WorstHealth(b, a)
func TestContract_WorstHealthCommutative(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		a := genHealthStatus().Draw(t, "a")
		b := genHealthStatus().Draw(t, "b")
		if WorstHealth(a, b) != WorstHealth(b, a) {
			t.Fatalf("WorstHealth not commutative: WorstHealth(%s, %s) = %s, WorstHealth(%s, %s) = %s",
				a, b, WorstHealth(a, b), b, a, WorstHealth(b, a))
		}
	})
}

// TestContract_WorstHealthAssociative verifies: WorstHealth(a, WorstHealth(b, c)) == WorstHealth(WorstHealth(a, b), c)
func TestContract_WorstHealthAssociative(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		a := genHealthStatus().Draw(t, "a")
		b := genHealthStatus().Draw(t, "b")
		c := genHealthStatus().Draw(t, "c")
		lhs := WorstHealth(a, WorstHealth(b, c))
		rhs := WorstHealth(WorstHealth(a, b), c)
		if lhs != rhs {
			t.Fatalf("WorstHealth not associative: (%s, (%s, %s))=%s != ((%s, %s), %s)=%s",
				a, b, c, lhs, a, b, c, rhs)
		}
	})
}

// TestContract_WorstHealthIdentity verifies: WorstHealth(x, Healthy) == x
func TestContract_WorstHealthIdentity(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		x := genHealthStatus().Draw(t, "x")
		result := WorstHealth(x, HealthStatusHealthy)
		if result != x {
			t.Fatalf("WorstHealth(%s, Healthy) = %s, want %s", x, result, x)
		}
	})
}

// TestContract_WorstHealthSeverityOrdering verifies result severity >= both input severities.
func TestContract_WorstHealthSeverityOrdering(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		a := genHealthStatus().Draw(t, "a")
		b := genHealthStatus().Draw(t, "b")
		result := WorstHealth(a, b)
		if result.Severity() < a.Severity() || result.Severity() < b.Severity() {
			t.Fatalf("WorstHealth(%s, %s) = %s with severity %d, but inputs have %d and %d",
				a, b, result, result.Severity(), a.Severity(), b.Severity())
		}
	})
}

// TestContract_WorstHealthIdempotent verifies: WorstHealth(x, x) == x
func TestContract_WorstHealthIdempotent(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		x := genHealthStatus().Draw(t, "x")
		if WorstHealth(x, x) != x {
			t.Fatalf("WorstHealth(%s, %s) should be %s", x, x, x)
		}
	})
}

// --- Contract: Severity Properties ---

// TestContract_SeverityKnownValues verifies the severity ordering: Healthy < Progressing < Degraded < Unknown.
func TestContract_SeverityKnownValues(t *testing.T) {
	if HealthStatusHealthy.Severity() >= HealthStatusProgressing.Severity() {
		t.Fatal("Healthy should be less severe than Progressing")
	}
	if HealthStatusProgressing.Severity() >= HealthStatusDegraded.Severity() {
		t.Fatal("Progressing should be less severe than Degraded")
	}
	if HealthStatusDegraded.Severity() >= HealthStatusUnknown.Severity() {
		t.Fatal("Degraded should be less severe than Unknown")
	}
}

// TestContract_SeverityNonNegative verifies all severities are >= 0.
func TestContract_SeverityNonNegative(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		h := genHealthStatus().Draw(t, "health")
		if h.Severity() < 0 {
			t.Fatalf("Severity(%s) = %d, want >= 0", h, h.Severity())
		}
	})
}

// TestContract_SeverityUnknownDefault verifies unknown strings default to max severity.
func TestContract_SeverityUnknownDefault(t *testing.T) {
	unknown := HealthStatus("bogus")
	if unknown.Severity() != HealthStatusUnknown.Severity() {
		t.Fatalf("unknown HealthStatus severity = %d, want %d",
			unknown.Severity(), HealthStatusUnknown.Severity())
	}
}
