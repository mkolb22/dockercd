package reconciler

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"time"

	"github.com/mkolb22/dockercd/internal/app"
	"github.com/mkolb22/dockercd/internal/deployer"
	"github.com/mkolb22/dockercd/internal/store"
	yaml "gopkg.in/yaml.v3"
)

// syncConfigManifests compares manifest files against the store.
// It scans two sources for app manifests:
//  1. The local configDir (if set and exists) — used with mounted YAML files.
//  2. The "applications/" subfolder of any git-synced repo referenced by a
//     registered app — handles the case where manifests live in the git repo.
//
// New manifests are registered and scheduled. Manifest-sourced apps whose files
// have been removed from all sources are torn down and deleted from the store.
func (r *ReconcilerImpl) syncConfigManifests(ctx context.Context) {
	// Build set of app names present in any manifest source.
	diskApps := make(map[string]app.Application)

	// Source 1: local configDir (e.g. bind-mounted YAML files).
	if r.deps.ConfigDir != "" {
		r.scanManifestDir(r.deps.ConfigDir, diskApps)
	}

	// Get all store apps — needed both for the git repo scan and the removal check.
	apps, err := r.deps.Store.ListApplications(ctx)
	if err != nil {
		r.logger.Warn("listing applications for config sync", "error", err)
		return
	}

	storeApps := make(map[string]store.ApplicationRecord, len(apps))
	for _, a := range apps {
		storeApps[a.Name] = a
	}

	// Source 2: applications/ subfolder within each unique git-synced repo.
	// This lets manifest YAMLs live in the same git repo as the compose files.
	seenRepos := make(map[string]struct{})
	for _, a := range apps {
		var application app.Application
		if err := json.Unmarshal([]byte(a.Manifest), &application); err != nil {
			continue
		}
		repoURL := application.Spec.Source.RepoURL
		if repoURL == "" {
			continue
		}
		if _, seen := seenRepos[repoURL]; seen {
			continue
		}
		seenRepos[repoURL] = struct{}{}

		repoPath := r.deps.GitSyncer.RepoPath(repoURL)
		if repoPath == "" {
			continue // repo not yet synced
		}
		r.scanManifestDir(filepath.Join(repoPath, "applications"), diskApps)
	}

	r.logger.Debug("config sync check", "diskApps", len(diskApps), "storeApps", len(apps))

	// Register new manifest apps; update existing ones when YAML content changes.
	for name, application := range diskApps {
		manifestJSON, err := json.Marshal(application)
		if err != nil {
			r.logger.Warn("serializing manifest", "name", name, "error", err)
			continue
		}

		existing, exists := storeApps[name]
		if !exists {
			rec := &store.ApplicationRecord{
				Name:         name,
				Manifest:     string(manifestJSON),
				Source:       "manifest",
				SyncStatus:   string(app.SyncStatusUnknown),
				HealthStatus: string(app.HealthStatusUnknown),
			}
			if err := r.deps.Store.CreateApplication(ctx, rec); err != nil {
				r.logger.Warn("registering new manifest app", "name", name, "error", err)
				continue
			}
			r.AddApp(name)
			r.logger.Info("registered new application from manifest", "name", name)
			continue
		}

		// Update manifest in store if the YAML content has changed.
		if existing.Source == "manifest" && existing.Manifest != string(manifestJSON) {
			if err := r.deps.Store.UpdateManifest(ctx, name, string(manifestJSON)); err != nil {
				r.logger.Warn("updating changed manifest app", "name", name, "error", err)
				continue
			}
			r.AddApp(name)
			r.logger.Info("updated application from changed manifest", "name", name)
		}
	}

	// Remove manifest-sourced apps absent from all sources.
	for name, rec := range storeApps {
		if rec.Source != "manifest" {
			continue
		}
		if _, onDisk := diskApps[name]; onDisk {
			continue
		}

		r.logger.Info("manifest removed, tearing down application", "name", name)

		var application app.Application
		if err := json.Unmarshal([]byte(rec.Manifest), &application); err != nil {
			r.logger.Warn("parsing stored manifest for teardown", "name", name, "error", err)
		} else {
			r.tearDownApp(ctx, name, application)
		}

		if err := r.deps.Store.DeleteApplication(ctx, name); err != nil {
			r.logger.Warn("deleting removed manifest app", "name", name, "error", err)
			continue
		}
		r.RemoveApp(name)
		r.logger.Info("removed application (manifest deleted)", "name", name)
	}
}

// scanManifestDir reads all *.yaml / *.yml files from dir and populates dst
// with any valid Application manifests found. Errors are logged and skipped.
func (r *ReconcilerImpl) scanManifestDir(dir string, dst map[string]app.Application) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if !os.IsNotExist(err) {
			r.logger.Warn("reading manifest directory", "dir", dir, "error", err)
		}
		return
	}

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		ext := filepath.Ext(entry.Name())
		if ext != ".yaml" && ext != ".yml" {
			continue
		}

		path := filepath.Join(dir, entry.Name())
		data, err := os.ReadFile(path)
		if err != nil {
			r.logger.Warn("reading manifest file", "path", path, "error", err)
			continue
		}

		var application app.Application
		if err := yaml.Unmarshal(data, &application); err != nil {
			r.logger.Warn("parsing manifest file", "path", path, "error", err)
			continue
		}

		if application.Kind != "Application" || application.Metadata.Name == "" {
			continue
		}

		dst[application.Metadata.Name] = application
	}
}

// tearDownApp runs docker compose down for an application.
// Uses project-name-only teardown since compose files may no longer exist on disk.
func (r *ReconcilerImpl) tearDownApp(ctx context.Context, name string, application app.Application) {
	deployReq := deployer.DeployRequest{
		ProjectName: application.Spec.Destination.ProjectName,
		DockerHost:  application.Spec.Destination.DockerHost,
	}

	if r.deps.TLSLookup != nil && deployReq.DockerHost != "" {
		deployReq.TLSCertPath = r.deps.TLSLookup(deployReq.DockerHost)
	}

	teardownCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	if err := r.deps.Deployer.Down(teardownCtx, deployReq); err != nil {
		r.logger.Warn("teardown failed for removed app", "name", name, "error", err)
	}
}
