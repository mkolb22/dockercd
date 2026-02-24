// Package config handles configuration loading from files, environment
// variables, and CLI flags using viper.
package config

import (
	"fmt"
	"log/slog"
	"time"

	"github.com/spf13/viper"
)

// TLSHostConfig holds TLS client certificate paths for a remote Docker host.
type TLSHostConfig struct {
	Host     string `mapstructure:"host"`      // Docker host URL (e.g., "tcp://remote:2376")
	CertPath string `mapstructure:"cert_path"` // Path to directory containing cert.pem, key.pem, ca.pem
	Verify   bool   `mapstructure:"verify"`    // Whether to verify the server certificate
}

// Config holds all configuration for the dockercd daemon.
type Config struct {
	DataDir             string            `mapstructure:"data_dir"`
	ConfigDir           string            `mapstructure:"config_dir"`
	LogLevel            string            `mapstructure:"log_level"`
	APIPort             int               `mapstructure:"api_port"`
	DockerHost          string            `mapstructure:"docker_host"`
	WorkerCount         int               `mapstructure:"worker_count"`
	DefaultPollInterval time.Duration     `mapstructure:"default_poll_interval"`
	GitToken            string            `mapstructure:"git_token"`
	WebhookSecret       string            `mapstructure:"webhook_secret"`
	SlackWebhookURL     string            `mapstructure:"slack_webhook_url"`
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
	// APIToken is the bearer token for API authentication.
	// If empty, the API is unauthenticated (for backward compatibility).
	APIToken string `mapstructure:"api_token"`
	// ImagePollInterval is how often to check registries for new image tags.
	// Set to 0 to disable image update automation.
	ImagePollInterval time.Duration `mapstructure:"image_poll_interval"`
	// DefaultRegistryURL is the Docker registry URL for private registries.
	// Leave empty to use Docker Hub.
	DefaultRegistryURL string `mapstructure:"default_registry_url"`
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
	if c.WorkerCount < 1 || c.WorkerCount > 32 {
		return fmt.Errorf("worker_count must be 1-32, got %d", c.WorkerCount)
	}
	if c.DefaultPollInterval < 30*time.Second {
		return fmt.Errorf("default_poll_interval must be >= 30s, got %s", c.DefaultPollInterval)
	}
	validLevels := map[string]bool{"debug": true, "info": true, "warn": true, "error": true}
	if !validLevels[c.LogLevel] {
		return fmt.Errorf("log_level must be one of debug/info/warn/error, got %q", c.LogLevel)
	}
	return nil
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
	v.AutomaticEnv()

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
