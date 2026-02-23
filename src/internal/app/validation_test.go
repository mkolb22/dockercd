package app

import (
	"testing"
	"time"
)

func validApp() Application {
	return Application{
		APIVersion: "dockercd/v1",
		Kind:       "Application",
		Metadata:   AppMetadata{Name: "my-app"},
		Spec: AppSpec{
			Source: SourceSpec{
				RepoURL: "https://github.com/org/repo.git",
			},
		},
	}
}

func TestValidate_ValidMinimal(t *testing.T) {
	app := validApp()
	if err := app.Validate(); err != nil {
		t.Fatalf("expected valid, got error: %v", err)
	}
}

func TestValidate_MissingAPIVersion(t *testing.T) {
	app := validApp()
	app.APIVersion = ""
	err := app.Validate()
	if err == nil {
		t.Fatal("expected error for missing apiVersion")
	}
}

func TestValidate_WrongAPIVersion(t *testing.T) {
	app := validApp()
	app.APIVersion = "v2"
	err := app.Validate()
	if err == nil {
		t.Fatal("expected error for wrong apiVersion")
	}
}

func TestValidate_WrongKind(t *testing.T) {
	app := validApp()
	app.Kind = "Deployment"
	err := app.Validate()
	if err == nil {
		t.Fatal("expected error for wrong kind")
	}
}

func TestValidate_MissingName(t *testing.T) {
	app := validApp()
	app.Metadata.Name = ""
	err := app.Validate()
	if err == nil {
		t.Fatal("expected error for missing name")
	}
}

func TestValidate_InvalidDNSName(t *testing.T) {
	cases := []string{
		"My-App",       // uppercase
		"-starts-dash", // starts with dash
		"ends-dash-",   // ends with dash
		"has spaces",   // spaces
		"has_underscore", // underscores
		"a",            // valid single char — should pass
	}

	for _, name := range cases[:5] {
		app := validApp()
		app.Metadata.Name = name
		if err := app.Validate(); err == nil {
			t.Errorf("expected error for name %q", name)
		}
	}

	// Single char is valid
	app := validApp()
	app.Metadata.Name = "a"
	if err := app.Validate(); err != nil {
		t.Errorf("single char name should be valid: %v", err)
	}
}

func TestValidate_MissingRepoURL(t *testing.T) {
	app := validApp()
	app.Spec.Source.RepoURL = ""
	err := app.Validate()
	if err == nil {
		t.Fatal("expected error for missing repoURL")
	}
}

func TestValidate_PollIntervalTooShort(t *testing.T) {
	app := validApp()
	app.Spec.SyncPolicy.PollInterval = NewDuration(10 * time.Second)
	err := app.Validate()
	if err == nil {
		t.Fatal("expected error for pollInterval < 30s")
	}
}

func TestValidate_PollIntervalZero(t *testing.T) {
	// Zero means "use default" — should be valid
	app := validApp()
	app.Spec.SyncPolicy.PollInterval = NewDuration(0)
	if err := app.Validate(); err != nil {
		t.Fatalf("zero pollInterval (use default) should be valid: %v", err)
	}
}

func TestApplyDefaults(t *testing.T) {
	app := validApp()
	app.ApplyDefaults()

	if app.Spec.Source.TargetRevision != "main" {
		t.Errorf("expected targetRevision=main, got %q", app.Spec.Source.TargetRevision)
	}
	if app.Spec.Source.Path != "." {
		t.Errorf("expected path=., got %q", app.Spec.Source.Path)
	}
	if len(app.Spec.Source.ComposeFiles) != 1 || app.Spec.Source.ComposeFiles[0] != "docker-compose.yml" {
		t.Errorf("expected composeFiles=[docker-compose.yml], got %v", app.Spec.Source.ComposeFiles)
	}
	if app.Spec.Destination.DockerHost != "unix:///var/run/docker.sock" {
		t.Errorf("expected dockerHost=unix:///var/run/docker.sock, got %q", app.Spec.Destination.DockerHost)
	}
	if app.Spec.Destination.ProjectName != "my-app" {
		t.Errorf("expected projectName=my-app, got %q", app.Spec.Destination.ProjectName)
	}
	if app.Spec.SyncPolicy.PollInterval.Duration != 180*time.Second {
		t.Errorf("expected pollInterval=3m0s, got %s", app.Spec.SyncPolicy.PollInterval.Duration)
	}
	if app.Spec.SyncPolicy.SyncTimeout.Duration != 300*time.Second {
		t.Errorf("expected syncTimeout=5m0s, got %s", app.Spec.SyncPolicy.SyncTimeout.Duration)
	}
	if app.Spec.SyncPolicy.HealthTimeout.Duration != 120*time.Second {
		t.Errorf("expected healthTimeout=2m0s, got %s", app.Spec.SyncPolicy.HealthTimeout.Duration)
	}
}

func TestApplyDefaults_PreservesExisting(t *testing.T) {
	app := validApp()
	app.Spec.Source.TargetRevision = "develop"
	app.Spec.Source.Path = "deploy/"
	app.Spec.Source.ComposeFiles = []string{"compose.yml"}
	app.Spec.SyncPolicy.PollInterval = NewDuration(60 * time.Second)

	app.ApplyDefaults()

	if app.Spec.Source.TargetRevision != "develop" {
		t.Errorf("should preserve targetRevision=develop")
	}
	if app.Spec.Source.Path != "deploy/" {
		t.Errorf("should preserve path=deploy/")
	}
	if app.Spec.Source.ComposeFiles[0] != "compose.yml" {
		t.Errorf("should preserve composeFiles")
	}
	if app.Spec.SyncPolicy.PollInterval.Duration != 60*time.Second {
		t.Errorf("should preserve pollInterval=60s")
	}
}

func TestHealthStatus_Severity(t *testing.T) {
	if HealthStatusHealthy.Severity() >= HealthStatusProgressing.Severity() {
		t.Error("Healthy should have lower severity than Progressing")
	}
	if HealthStatusProgressing.Severity() >= HealthStatusDegraded.Severity() {
		t.Error("Progressing should have lower severity than Degraded")
	}
	if HealthStatusDegraded.Severity() >= HealthStatusUnknown.Severity() {
		t.Error("Degraded should have lower severity than Unknown")
	}
}

func TestWorstHealth(t *testing.T) {
	cases := []struct {
		a, b     HealthStatus
		expected HealthStatus
	}{
		{HealthStatusHealthy, HealthStatusHealthy, HealthStatusHealthy},
		{HealthStatusHealthy, HealthStatusDegraded, HealthStatusDegraded},
		{HealthStatusDegraded, HealthStatusHealthy, HealthStatusDegraded},
		{HealthStatusProgressing, HealthStatusUnknown, HealthStatusUnknown},
	}

	for _, tc := range cases {
		result := WorstHealth(tc.a, tc.b)
		if result != tc.expected {
			t.Errorf("WorstHealth(%s, %s) = %s, want %s", tc.a, tc.b, result, tc.expected)
		}
	}
}
