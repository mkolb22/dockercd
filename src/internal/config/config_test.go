package config

import (
	"testing"
	"time"
)

func validConfig() Config {
	return Config{
		DataDir:             "/data",
		ConfigDir:           "/config/applications",
		LogLevel:            "info",
		APIPort:             8080,
		DockerHost:          "unix:///var/run/docker.sock",
		WorkerCount:         4,
		DefaultPollInterval: 180 * time.Second,
	}
}

func TestValidate_ValidConfig(t *testing.T) {
	cfg := validConfig()
	if err := cfg.Validate(); err != nil {
		t.Fatalf("expected valid, got: %v", err)
	}
}

func TestValidate_EmptyDataDir(t *testing.T) {
	cfg := validConfig()
	cfg.DataDir = ""
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected error for empty data_dir")
	}
}

func TestValidate_EmptyConfigDir(t *testing.T) {
	cfg := validConfig()
	cfg.ConfigDir = ""
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected error for empty config_dir")
	}
}

func TestValidate_InvalidPort(t *testing.T) {
	cfg := validConfig()

	cfg.APIPort = 0
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected error for port 0")
	}

	cfg.APIPort = 70000
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected error for port 70000")
	}
}

func TestValidate_InvalidWorkerCount(t *testing.T) {
	cfg := validConfig()

	cfg.WorkerCount = 0
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected error for worker_count 0")
	}

	cfg.WorkerCount = 33
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected error for worker_count 33")
	}
}

func TestValidate_PollIntervalTooShort(t *testing.T) {
	cfg := validConfig()
	cfg.DefaultPollInterval = 10 * time.Second
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected error for poll interval < 30s")
	}
}

func TestValidate_InvalidLogLevel(t *testing.T) {
	cfg := validConfig()
	cfg.LogLevel = "trace"
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected error for invalid log level")
	}
}

func TestValidate_AllLogLevels(t *testing.T) {
	for _, level := range []string{"debug", "info", "warn", "error"} {
		cfg := validConfig()
		cfg.LogLevel = level
		if err := cfg.Validate(); err != nil {
			t.Errorf("log level %q should be valid: %v", level, err)
		}
	}
}

func TestSlogLevel(t *testing.T) {
	cfg := validConfig()

	cfg.LogLevel = "debug"
	if cfg.SlogLevel().String() != "DEBUG" {
		t.Errorf("expected DEBUG, got %s", cfg.SlogLevel())
	}

	cfg.LogLevel = "warn"
	if cfg.SlogLevel().String() != "WARN" {
		t.Errorf("expected WARN, got %s", cfg.SlogLevel())
	}

	cfg.LogLevel = "error"
	if cfg.SlogLevel().String() != "ERROR" {
		t.Errorf("expected ERROR, got %s", cfg.SlogLevel())
	}

	cfg.LogLevel = "info"
	if cfg.SlogLevel().String() != "INFO" {
		t.Errorf("expected INFO, got %s", cfg.SlogLevel())
	}
}
