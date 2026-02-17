package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/spf13/cobra"
	"gopkg.in/yaml.v3"

	"github.com/docker/docker/client"
	"github.com/mkolb22/dockercd/internal/api"
	"github.com/mkolb22/dockercd/internal/app"
	"github.com/mkolb22/dockercd/internal/config"
	"github.com/mkolb22/dockercd/internal/deployer"
	"github.com/mkolb22/dockercd/internal/differ"
	"github.com/mkolb22/dockercd/internal/events"
	"github.com/mkolb22/dockercd/internal/gitsync"
	"github.com/mkolb22/dockercd/internal/health"
	"github.com/mkolb22/dockercd/internal/inspector"
	"github.com/mkolb22/dockercd/internal/parser"
	"github.com/mkolb22/dockercd/internal/reconciler"
	"github.com/mkolb22/dockercd/internal/store"
)

func newServeCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "serve",
		Short: "Start the dockercd daemon",
		Long:  "Start the API server, reconciler, health monitor, and event watcher.",
		RunE:  runServe,
	}
}

func runServe(_ *cobra.Command, _ []string) error {
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level:     cfg.SlogLevel(),
		AddSource: cfg.LogLevel == "debug",
	}))

	logger.Info("starting dockercd",
		"version", version,
		"commit", commit,
		"data_dir", cfg.DataDir,
		"api_port", cfg.APIPort,
	)

	// Ensure data directory exists
	if err := os.MkdirAll(cfg.DataDir, 0750); err != nil {
		return fmt.Errorf("creating data directory: %w", err)
	}

	// Initialize store
	st, err := store.New(cfg.DataDir, logger)
	if err != nil {
		return fmt.Errorf("initializing store: %w", err)
	}
	defer st.Close()

	// Load application manifests from config directory
	if err := loadApplicationManifests(context.Background(), cfg.ConfigDir, st, logger); err != nil {
		logger.Warn("loading application manifests", "error", err)
	}

	// Initialize components
	gitSyncer, err := gitsync.New(cfg.DataDir, logger, cfg.GitToken)
	if err != nil {
		return fmt.Errorf("initializing git syncer: %w", err)
	}

	insp := inspector.New()
	p := parser.New()
	d := differ.New()
	dep := deployer.New(logger)
	healthMon := health.New(insp, st, logger, health.DefaultConfig())

	// Initialize reconciler
	rec := reconciler.New(reconciler.Deps{
		GitSyncer:     gitSyncer,
		Parser:        p,
		Inspector:     insp,
		Differ:        d,
		Deployer:      dep,
		HealthMonitor: healthMon,
		Store:         st,
		Logger:        logger,
		WorkerCount:   cfg.WorkerCount,
	})

	// Initialize event watcher for self-healing
	eventClientFactory := func(host string) (events.EventClient, error) {
		opts := []client.Opt{client.WithAPIVersionNegotiation()}
		if host != "" {
			opts = append(opts, client.WithHost(host))
		}
		return client.NewClientWithOpts(opts...)
	}
	eventWatcher := events.NewWatcher(eventClientFactory, rec, st, logger, events.DefaultWatcherConfig())

	// Set up context with signal handling
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	// Start API server
	addr := fmt.Sprintf(":%d", cfg.APIPort)
	apiServer := api.NewServer(addr, api.ServerDeps{
		Store:      st,
		Reconciler: rec,
		Inspector:  insp,
		Logger:     logger,
	})
	if err := apiServer.Start(); err != nil {
		return fmt.Errorf("starting API server: %w", err)
	}

	// Start health monitor in background
	go func() {
		if err := healthMon.Start(ctx); err != nil {
			logger.Error("health monitor error", "error", err)
		}
	}()

	// Start event watcher in background (Docker event stream for self-healing)
	go func() {
		if err := eventWatcher.Start(ctx); err != nil {
			logger.Error("event watcher error", "error", err)
		}
	}()

	// Start reconciler (blocks until ctx is canceled)
	logger.Info("dockercd ready", "api_addr", addr)
	err = rec.Start(ctx)

	// Graceful shutdown
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer shutdownCancel()

	eventWatcher.Stop()
	healthMon.Stop()
	apiServer.Stop(shutdownCtx)
	gitSyncer.Close()

	if err != nil && ctx.Err() == nil {
		return fmt.Errorf("reconciler error: %w", err)
	}

	logger.Info("dockercd stopped")
	return nil
}

// loadApplicationManifests scans configDir for *.yaml files, parses them as
// Application manifests, and registers them in the store (upsert pattern).
func loadApplicationManifests(ctx context.Context, configDir string, st *store.SQLiteStore, logger *slog.Logger) error {
	entries, err := os.ReadDir(configDir)
	if err != nil {
		if os.IsNotExist(err) {
			logger.Debug("config directory does not exist, skipping manifest loading", "dir", configDir)
			return nil
		}
		return fmt.Errorf("reading config directory %q: %w", configDir, err)
	}

	loaded := 0
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		ext := filepath.Ext(entry.Name())
		if ext != ".yaml" && ext != ".yml" {
			continue
		}

		path := filepath.Join(configDir, entry.Name())
		data, err := os.ReadFile(path)
		if err != nil {
			logger.Warn("reading manifest file", "path", path, "error", err)
			continue
		}

		var application app.Application
		if err := yaml.Unmarshal(data, &application); err != nil {
			logger.Warn("parsing manifest file", "path", path, "error", err)
			continue
		}

		if application.Kind != "Application" || application.Metadata.Name == "" {
			logger.Debug("skipping non-application file", "path", path)
			continue
		}

		// Check if already registered
		existing, err := st.GetApplication(ctx, application.Metadata.Name)
		if err != nil {
			logger.Warn("checking existing application", "name", application.Metadata.Name, "error", err)
			continue
		}
		if existing != nil {
			logger.Debug("application already registered", "name", application.Metadata.Name)
			continue
		}

		// Serialize manifest to JSON for storage
		manifestJSON, err := json.Marshal(application)
		if err != nil {
			logger.Warn("serializing manifest", "name", application.Metadata.Name, "error", err)
			continue
		}

		rec := &store.ApplicationRecord{
			Name:         application.Metadata.Name,
			Manifest:     string(manifestJSON),
			SyncStatus:   string(app.SyncStatusUnknown),
			HealthStatus: string(app.HealthStatusUnknown),
		}
		if err := st.CreateApplication(ctx, rec); err != nil {
			logger.Warn("registering application", "name", application.Metadata.Name, "error", err)
			continue
		}

		logger.Info("registered application from manifest", "name", application.Metadata.Name, "file", entry.Name())
		loaded++
	}

	if loaded > 0 {
		logger.Info("loaded application manifests", "count", loaded, "dir", configDir)
	}
	return nil
}
