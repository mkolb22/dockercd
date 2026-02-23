package app

import (
	"fmt"
	"regexp"
	"strings"
	"time"
)

// dnsLabelRegex matches valid DNS labels: lowercase alphanumeric and hyphens,
// must start and end with alphanumeric, max 63 chars.
var dnsLabelRegex = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`)

// Validate checks an Application manifest for correctness.
// Returns nil if valid, or an error describing what's wrong.
func (a *Application) Validate() error {
	var errs []string

	// APIVersion
	if a.APIVersion != "dockercd/v1" {
		errs = append(errs, fmt.Sprintf("apiVersion must be \"dockercd/v1\", got %q", a.APIVersion))
	}

	// Kind
	if a.Kind != "Application" {
		errs = append(errs, fmt.Sprintf("kind must be \"Application\", got %q", a.Kind))
	}

	// Metadata
	if a.Metadata.Name == "" {
		errs = append(errs, "metadata.name is required")
	} else if !dnsLabelRegex.MatchString(a.Metadata.Name) {
		errs = append(errs, fmt.Sprintf("metadata.name must be a valid DNS label (lowercase alphanumeric and hyphens, 1-63 chars), got %q", a.Metadata.Name))
	}

	// Source
	if a.Spec.Source.RepoURL == "" {
		errs = append(errs, "spec.source.repoURL is required")
	}

	// SyncPolicy
	if a.Spec.SyncPolicy.PollInterval.Duration > 0 && a.Spec.SyncPolicy.PollInterval.Duration < 30*time.Second {
		errs = append(errs, fmt.Sprintf("spec.syncPolicy.pollInterval must be >= 30s, got %s", a.Spec.SyncPolicy.PollInterval.Duration))
	}

	if len(errs) > 0 {
		return fmt.Errorf("validation failed: %s", strings.Join(errs, "; "))
	}
	return nil
}

// ApplyDefaults fills in default values for optional fields.
func (a *Application) ApplyDefaults() {
	if a.Spec.Source.TargetRevision == "" {
		a.Spec.Source.TargetRevision = "main"
	}
	if a.Spec.Source.Path == "" {
		a.Spec.Source.Path = "."
	}
	if len(a.Spec.Source.ComposeFiles) == 0 {
		a.Spec.Source.ComposeFiles = []string{"docker-compose.yml"}
	}
	if a.Spec.Destination.DockerHost == "" {
		a.Spec.Destination.DockerHost = "unix:///var/run/docker.sock"
	}
	if a.Spec.Destination.ProjectName == "" {
		a.Spec.Destination.ProjectName = a.Metadata.Name
	}
	if a.Spec.SyncPolicy.PollInterval.Duration == 0 {
		a.Spec.SyncPolicy.PollInterval = NewDuration(180 * time.Second)
	}
	if a.Spec.SyncPolicy.SyncTimeout.Duration == 0 {
		a.Spec.SyncPolicy.SyncTimeout = NewDuration(300 * time.Second)
	}
	if a.Spec.SyncPolicy.HealthTimeout.Duration == 0 {
		a.Spec.SyncPolicy.HealthTimeout = NewDuration(120 * time.Second)
	}
}
