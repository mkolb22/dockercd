package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	gohttp "net/http"
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
	"github.com/mkolb22/dockercd/internal/eventbus"
	"github.com/mkolb22/dockercd/internal/events"
	"github.com/mkolb22/dockercd/internal/gitsync"
	"github.com/mkolb22/dockercd/internal/health"
	"github.com/mkolb22/dockercd/internal/hostmon"
	"github.com/mkolb22/dockercd/internal/inspector"
	"github.com/mkolb22/dockercd/internal/notifier"
	"github.com/mkolb22/dockercd/internal/parser"
	"github.com/mkolb22/dockercd/internal/reconciler"
	"github.com/mkolb22/dockercd/internal/registry"
	"github.com/mkolb22/dockercd/internal/secrets"
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

	// Build TLS configs for remote Docker hosts
	var inspConcrete *inspector.DockerInspector
	if len(cfg.TLS) > 0 {
		tlsMap := make(map[string]inspector.TLSConfig, len(cfg.TLS))
		for _, tc := range cfg.TLS {
			tlsMap[tc.Host] = inspector.TLSConfig{
				CertPath: tc.CertPath,
				Verify:   tc.Verify,
			}
		}
		inspConcrete = inspector.NewWithTLS(tlsMap)
		logger.Info("TLS enabled for remote Docker hosts", "hosts", len(cfg.TLS))
	} else {
		inspConcrete = inspector.New()
	}
	var insp inspector.StateInspector = inspConcrete

	// Load TLS configs from DB-registered Docker hosts into the inspector
	dbHosts, err := st.ListDockerHosts(context.Background())
	if err != nil {
		logger.Warn("loading docker hosts from DB", "error", err)
	} else {
		for _, h := range dbHosts {
			if h.TLSCertPath != "" {
				insp.RegisterTLS(h.URL, inspector.TLSConfig{
					CertPath: h.TLSCertPath,
					Verify:   h.TLSVerify,
				})
			}
		}
		if len(dbHosts) > 0 {
			logger.Info("loaded Docker hosts from database", "count", len(dbHosts))
		}
	}

	// Initialize secrets providers (optional — any combination may be active)
	var secretProviders []secrets.Provider
	if cfg.AgeKeyFile != "" {
		sp, err := secrets.NewAge(cfg.AgeKeyFile)
		if err != nil {
			return fmt.Errorf("initializing age secrets provider: %w", err)
		}
		secretProviders = append(secretProviders, sp)
		logger.Info("age secrets provider enabled", "keyFile", cfg.AgeKeyFile)
	}
	if cfg.VaultAddr != "" && cfg.VaultToken != "" {
		secretProviders = append(secretProviders, secrets.NewVault(cfg.VaultAddr, cfg.VaultToken))
		logger.Info("vault secrets provider enabled", "addr", cfg.VaultAddr)
	}
	if cfg.AWSRegion != "" {
		secretProviders = append(secretProviders, secrets.NewAWSSecretsManager(cfg.AWSRegion, cfg.AWSEndpoint))
		logger.Info("aws secrets manager provider enabled", "region", cfg.AWSRegion)
	}

	p := parser.New()
	if len(secretProviders) > 0 {
		var sp secrets.Provider
		if len(secretProviders) == 1 {
			sp = secretProviders[0]
		} else {
			sp = secrets.NewMulti(secretProviders...)
		}
		p = parser.NewWithSecrets(sp)
	}

	d := differ.New()
	dep := deployer.New(logger)
	healthMon := health.New(insp, st, logger, health.DefaultConfig())

	// Create SSE event hub for real-time browser updates
	sseHub := eventbus.NewHub()

	// Wire broadcaster to health monitor
	healthMon.SetBroadcaster(sseHub)

	// Initialize host health monitor for remote Docker hosts
	hostMon := hostmon.New(insp, st, logger, hostmon.DefaultConfig())
	hostMon.SetBroadcaster(sseHub)

	// Build notifiers from config
	var notifiers []notifier.Notifier
	if cfg.SlackWebhookURL != "" {
		notifiers = append(notifiers, notifier.NewSlack(cfg.SlackWebhookURL))
		logger.Info("slack notifications enabled")
	}
	if cfg.NotificationWebhookURL != "" {
		notifiers = append(notifiers, notifier.NewWebhook(cfg.NotificationWebhookURL, cfg.NotificationWebhookHeaders))
		logger.Info("webhook notifications enabled")
	}

	var appNotifier notifier.Notifier
	if len(notifiers) > 0 {
		appNotifier = notifier.NewMulti(logger, notifiers...)
	}

	// Wire notifier to health monitor
	if appNotifier != nil {
		healthMon.SetNotifier(appNotifier)
	}

	// TLS lookup: resolves Docker host URL to TLS cert path.
	// Checks static config first, then DB-registered hosts.
	tlsLookup := func(host string) string {
		if host == "" {
			return ""
		}
		for _, tc := range cfg.TLS {
			if tc.Host == host {
				return tc.CertPath
			}
		}
		h, _ := st.GetDockerHostByURL(context.Background(), host)
		if h != nil {
			return h.TLSCertPath
		}
		return ""
	}

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
		Broadcaster:   sseHub,
		Notifier:      appNotifier,
		TLSLookup:     tlsLookup,
		ConfigDir:     cfg.ConfigDir,
	})

	// Initialize event watcher for self-healing
	eventClientFactory := func(host string) (events.EventClient, error) {
		opts := []client.Opt{client.WithAPIVersionNegotiation()}
		if host != "" {
			opts = append(opts, client.WithHost(host))
		}
		// Add TLS if configured for this host
		for _, tc := range cfg.TLS {
			if tc.Host == host {
				tlsCfg := inspector.TLSConfig{CertPath: tc.CertPath, Verify: tc.Verify}
				tlsConfig, err := tlsCfg.LoadTLSConfig()
				if err != nil {
					return nil, fmt.Errorf("loading TLS for event client: %w", err)
				}
				httpClient := &gohttp.Client{
					Transport: &gohttp.Transport{TLSClientConfig: tlsConfig},
				}
				opts = append(opts, client.WithHTTPClient(httpClient))
				break
			}
		}
		return client.NewClientWithOpts(opts...)
	}
	eventWatcher := events.NewWatcher(eventClientFactory, rec, st, logger, events.DefaultWatcherConfig())

	// Wire broadcaster to event watcher
	eventWatcher.SetBroadcaster(sseHub)

	// Initialize image update poller (optional)
	var imagePoller *registry.Poller
	if cfg.ImagePollInterval > 0 {
		var checker registry.TagChecker
		if cfg.DefaultRegistryURL != "" {
			checker = registry.NewGenericRegistryChecker(cfg.DefaultRegistryURL)
		} else {
			checker = registry.NewDockerHubChecker()
		}
		imagePoller = registry.NewPoller(checker, gitSyncer, st, rec, logger, registry.PollerConfig{
			PollInterval:    cfg.ImagePollInterval,
			DefaultRegistry: cfg.DefaultRegistryURL,
		})
		logger.Info("image update poller enabled", "interval", cfg.ImagePollInterval)
	}

	// Set up context with signal handling
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	// Start API server
	addr := fmt.Sprintf(":%d", cfg.APIPort)
	apiServer := api.NewServer(addr, api.ServerDeps{
		Store:         st,
		Reconciler:    rec,
		Inspector:     insp,
		Logger:        logger,
		WebhookSecret: cfg.WebhookSecret,
		SSEHub:        sseHub,
		EventWatcher:  eventWatcher,
		APIToken:      cfg.APIToken,
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

	// Start host health monitor in background
	go func() {
		if err := hostMon.Start(ctx); err != nil {
			logger.Error("host health monitor error", "error", err)
		}
	}()

	// Start event watcher in background (Docker event stream for self-healing)
	go func() {
		if err := eventWatcher.Start(ctx); err != nil {
			logger.Error("event watcher error", "error", err)
		}
	}()

	// Start watching events on all registered remote Docker hosts
	for _, h := range dbHosts {
		eventWatcher.WatchHost(h.URL)
	}

	// Start image update poller in background (optional)
	if imagePoller != nil {
		go func() {
			if err := imagePoller.Start(ctx); err != nil {
				logger.Error("image poller error", "error", err)
			}
		}()
	}

	// Start reconciler (blocks until ctx is canceled)
	logger.Info("dockercd ready", "api_addr", addr)
	err = rec.Start(ctx)

	// Graceful shutdown
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer shutdownCancel()

	if imagePoller != nil {
		imagePoller.Stop()
	}
	eventWatcher.Stop()
	hostMon.Stop()
	healthMon.Stop()
	_ = apiServer.Stop(shutdownCtx)
	inspConcrete.CloseAllClients()
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
			// Ensure existing apps with manifest files are tagged as manifest-sourced
			if existing.Source != "manifest" {
				if err := st.SetApplicationSource(ctx, application.Metadata.Name, "manifest"); err != nil {
					logger.Warn("updating application source", "name", application.Metadata.Name, "error", err)
				}
			}
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
			Source:       "manifest",
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
