// Package config handles configuration loading from files, environment
// variables, and CLI flags using viper.
package config

import (
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/mkolb22/dockercd/internal/cluster"
	"github.com/spf13/viper"
)

// InsecureTLSDevelopmentAcknowledgement is the exact value required before a
// loopback-only Docker TLS connection may skip server verification. It exists
// solely for local development against disposable daemons; production remote
// Docker connections must verify the server certificate.
const InsecureTLSDevelopmentAcknowledgement = "I_UNDERSTAND_INSECURE_TLS_IS_FOR_LOCAL_DEVELOPMENT_ONLY"

// TLSHostConfig holds TLS client certificate paths for a remote Docker host.
type TLSHostConfig struct {
	Host                       string `mapstructure:"host"`                        // Docker host URL (e.g., "tcp://remote:2376")
	CertPath                   string `mapstructure:"cert_path"`                   // Path to directory containing cert.pem, key.pem, ca.pem
	InsecureSkipVerify         bool   `mapstructure:"insecure_skip_verify"`        // Local-development escape hatch; verification remains enabled by default.
	DevelopmentAcknowledgement string `mapstructure:"development_acknowledgement"` // Must equal InsecureTLSDevelopmentAcknowledgement when insecure_skip_verify is true.
}

// Config holds all configuration for the dockercd daemon.
type Config struct {
	DataDir   string `mapstructure:"data_dir"`
	ConfigDir string `mapstructure:"config_dir"`
	LogLevel  string `mapstructure:"log_level"`
	// APIHost is the interface on which the HTTP API listens. It defaults to
	// loopback so a bare daemon is not remotely reachable.
	APIHost             string        `mapstructure:"api_host"`
	APIPort             int           `mapstructure:"api_port"`
	DockerHost          string        `mapstructure:"docker_host"`
	WorkerCount         int           `mapstructure:"worker_count"`
	DefaultPollInterval time.Duration `mapstructure:"default_poll_interval"`
	GitToken            string        `mapstructure:"git_token"`
	// GitAllowedHosts is the explicit network allowlist for Git remotes. It
	// prevents a manifest from turning the controller into a generic network
	// client; include internal Git hosts here only deliberately.
	GitAllowedHosts            []string          `mapstructure:"git_allowed_hosts"`
	WebhookSecret              string            `mapstructure:"webhook_secret"`
	SlackWebhookURL            string            `mapstructure:"slack_webhook_url"`
	NotificationWebhookURL     string            `mapstructure:"notification_webhook_url"`
	NotificationWebhookHeaders map[string]string `mapstructure:"notification_webhook_headers"`
	AgeKeyFile                 string            `mapstructure:"age_key_file"`
	// TLS holds per-host TLS client certificate configuration for remote Docker daemons.
	TLS []TLSHostConfig `mapstructure:"tls"`
	// VaultAddr is the Vault server address (e.g., "http://vault:8200").
	VaultAddr string `mapstructure:"vault_addr"`
	// VaultToken is the Vault authentication token.
	VaultToken string `mapstructure:"vault_token"`
	// AWSRegion is the AWS region for Secrets Manager.
	AWSRegion string `mapstructure:"aws_region"`
	// AWSEndpoint is an optional custom AWS endpoint (e.g., for LocalStack).
	AWSEndpoint string `mapstructure:"aws_endpoint"`
	// APIToken is the bearer token for API authentication. It is required for
	// non-loopback API listeners.
	APIToken string `mapstructure:"api_token"`
	// ImagePollInterval is how often to check registries for new image tags.
	// Set to 0 to disable image update automation.
	ImagePollInterval time.Duration `mapstructure:"image_poll_interval"`
	// DefaultRegistryURL is the Docker registry URL for private registries.
	// Leave empty to use Docker Hub.
	DefaultRegistryURL string `mapstructure:"default_registry_url"`
	// ManifestRepoURL is the git repository URL containing Application manifests.
	// When set, dockercd syncs this repo on every poll cycle and treats
	// ManifestRepoPath as the authoritative source of Application definitions.
	// Adding, changing, or removing a YAML in that directory automatically
	// creates, updates, or tears down the corresponding application.
	ManifestRepoURL string `mapstructure:"manifest_repo_url"`
	// ManifestRepoPath is the subdirectory within ManifestRepoURL to scan for
	// Application YAML manifests. Defaults to "applications".
	ManifestRepoPath string `mapstructure:"manifest_repo_path"`
	// ManifestRevision is the git branch/tag/SHA to track in ManifestRepoURL.
	// Defaults to "main".
	ManifestRevision string `mapstructure:"manifest_revision"`

	// Cluster holds the active-passive cluster configuration.
	Cluster cluster.ClusterConfig `mapstructure:"cluster"`
}

// Validate checks the configuration for correctness.
func (c *Config) Validate() error {
	if c.DataDir == "" {
		return fmt.Errorf("data_dir must not be empty")
	}
	if c.ConfigDir == "" {
		return fmt.Errorf("config_dir must not be empty")
	}
	if c.APIPort < 1 || c.APIPort > 65535 {
		return fmt.Errorf("api_port must be 1-65535, got %d", c.APIPort)
	}
	if strings.TrimSpace(c.APIHost) == "" {
		return fmt.Errorf("api_host must not be empty")
	}
	if !isLoopbackAPIHost(c.APIHost) && len(c.APIToken) < 32 {
		return fmt.Errorf("api_token must be at least 32 characters when api_host %q is not loopback", c.APIHost)
	}
	if c.WorkerCount < 1 || c.WorkerCount > 32 {
		return fmt.Errorf("worker_count must be 1-32, got %d", c.WorkerCount)
	}
	if c.DefaultPollInterval < 30*time.Second {
		return fmt.Errorf("default_poll_interval must be >= 30s, got %s", c.DefaultPollInterval)
	}
	if len(c.GitAllowedHosts) == 0 {
		return fmt.Errorf("git_allowed_hosts must include at least one host")
	}
	for _, host := range c.GitAllowedHosts {
		host = strings.TrimSpace(host)
		if host == "" || strings.ContainsAny(host, "/:@") {
			return fmt.Errorf("git_allowed_hosts contains invalid host %q", host)
		}
	}
	validLevels := map[string]bool{"debug": true, "info": true, "warn": true, "error": true}
	if !validLevels[c.LogLevel] {
		return fmt.Errorf("log_level must be one of debug/info/warn/error, got %q", c.LogLevel)
	}
	for i, tlsHost := range c.TLS {
		if err := tlsHost.Validate(); err != nil {
			return fmt.Errorf("invalid tls[%d]: %w", i, err)
		}
	}
	if err := c.Cluster.Validate(); err != nil {
		return fmt.Errorf("invalid cluster configuration: %w", err)
	}
	return nil
}

// Validate ensures a remote Docker TLS host has the client material needed for
// certificate verification. Skipping verification is constrained to explicit,
// acknowledged loopback development endpoints so a configuration omission can
// never silently weaken a production connection.
func (c TLSHostConfig) Validate() error {
	if strings.TrimSpace(c.Host) == "" {
		return fmt.Errorf("host must not be empty")
	}
	if strings.TrimSpace(c.CertPath) == "" {
		return fmt.Errorf("cert_path must not be empty")
	}
	if !c.InsecureSkipVerify {
		return nil
	}
	if c.DevelopmentAcknowledgement != InsecureTLSDevelopmentAcknowledgement {
		return fmt.Errorf("insecure_skip_verify requires development_acknowledgement %q", InsecureTLSDevelopmentAcknowledgement)
	}
	if !isLoopbackDockerHost(c.Host) {
		return fmt.Errorf("insecure_skip_verify is only allowed for a loopback Docker host")
	}
	return nil
}

func isLoopbackDockerHost(host string) bool {
	parsed, err := url.Parse(host)
	if err != nil || parsed.Scheme != "tcp" {
		return false
	}
	hostname := parsed.Hostname()
	if strings.EqualFold(hostname, "localhost") {
		return true
	}
	ip := net.ParseIP(hostname)
	return ip != nil && ip.IsLoopback()
}

// APIAddr returns the address used by the HTTP API listener.
func (c *Config) APIAddr() string {
	return net.JoinHostPort(c.APIHost, fmt.Sprintf("%d", c.APIPort))
}

func isLoopbackAPIHost(host string) bool {
	host = strings.TrimSpace(host)
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// SlogLevel returns the slog.Level corresponding to the configured log level.
func (c *Config) SlogLevel() slog.Level {
	switch c.LogLevel {
	case "debug":
		return slog.LevelDebug
	case "warn":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

// Load reads configuration from files, environment variables, and applies defaults.
// Loading order (later overrides earlier):
//  1. Compiled-in defaults
//  2. Config file (/etc/dockercd/config.yaml or $HOME/.dockercd/config.yaml)
//  3. Environment variables (prefix DOCKERCD_)
func Load() (*Config, error) {
	v := viper.New()
	setDefaults(v)

	v.SetConfigName("config")
	v.SetConfigType("yaml")
	v.AddConfigPath("/etc/dockercd")
	v.AddConfigPath("$HOME/.dockercd")
	v.AddConfigPath(".")

	v.SetEnvPrefix("DOCKERCD")
	v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	v.AutomaticEnv()
	// Viper does not reliably decode comma-delimited environment variables into
	// a string slice during Unmarshal, so normalize the operator-facing form.
	if hosts, ok := os.LookupEnv("DOCKERCD_GIT_ALLOWED_HOSTS"); ok {
		v.Set("git_allowed_hosts", strings.Split(hosts, ","))
	}

	// DOCKER_HOST is a standard env var without prefix
	_ = v.BindEnv("docker_host", "DOCKER_HOST")

	// Read config file if it exists (not an error if missing)
	if err := v.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
			return nil, fmt.Errorf("reading config: %w", err)
		}
	}

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("unmarshaling config: %w", err)
	}

	if err := cfg.Validate(); err != nil {
		return nil, fmt.Errorf("invalid config: %w", err)
	}

	return &cfg, nil
}
