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

// syncConfigManifests compares manifest files in configDir against the store.
// New manifests are registered and scheduled. Manifest-sourced apps whose files
// have been removed are torn down and deleted from the store.
func (r *ReconcilerImpl) syncConfigManifests(ctx context.Context) {
	if r.deps.ConfigDir == "" {
		return
	}

	entries, err := os.ReadDir(r.deps.ConfigDir)
	if err != nil {
		if os.IsNotExist(err) {
			return
		}
		r.logger.Warn("reading config directory for sync", "dir", r.deps.ConfigDir, "error", err)
		return
	}

	// Build set of app names from manifest files on disk
	diskApps := make(map[string]app.Application)
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		ext := filepath.Ext(entry.Name())
		if ext != ".yaml" && ext != ".yml" {
			continue
		}

		path := filepath.Join(r.deps.ConfigDir, entry.Name())
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

		diskApps[application.Metadata.Name] = application
	}

	// Get all apps from store
	apps, err := r.deps.Store.ListApplications(ctx)
	if err != nil {
		r.logger.Warn("listing applications for config sync", "error", err)
		return
	}

	r.logger.Debug("config sync check", "diskApps", len(diskApps), "storeApps", len(apps))

	storeApps := make(map[string]store.ApplicationRecord, len(apps))
	for _, a := range apps {
		storeApps[a.Name] = a
	}

	// Register new manifest apps
	for name, application := range diskApps {
		if _, exists := storeApps[name]; exists {
			continue
		}

		manifestJSON, err := json.Marshal(application)
		if err != nil {
			r.logger.Warn("serializing manifest", "name", name, "error", err)
			continue
		}

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
	}

	// Remove manifest-sourced apps whose files are gone
	for name, rec := range storeApps {
		if rec.Source != "manifest" {
			continue
		}
		if _, onDisk := diskApps[name]; onDisk {
			continue
		}

		r.logger.Info("manifest removed, tearing down application", "name", name)

		// Parse manifest to get deploy request for teardown
		var application app.Application
		if err := json.Unmarshal([]byte(rec.Manifest), &application); err != nil {
			r.logger.Warn("parsing stored manifest for teardown", "name", name, "error", err)
		} else {
			r.tearDownApp(ctx, name, application)
		}

		// Delete from store and remove from schedule
		if err := r.deps.Store.DeleteApplication(ctx, name); err != nil {
			r.logger.Warn("deleting removed manifest app", "name", name, "error", err)
			continue
		}
		r.RemoveApp(name)
		r.logger.Info("removed application (manifest deleted)", "name", name)
	}
}

// tearDownApp runs docker compose down for an application.
// Uses project-name-only teardown since compose files may no longer exist on disk.
func (r *ReconcilerImpl) tearDownApp(ctx context.Context, name string, application app.Application) {
	// docker compose -p <project> down --remove-orphans works without compose files
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
