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
		APIHost:             "127.0.0.1",
		APIPort:             8080,
		DockerHost:          "unix:///var/run/docker.sock",
		WorkerCount:         4,
		DefaultPollInterval: 180 * time.Second,
		GitAllowedHosts:     []string{"github.com"},
	}
}

func TestValidate_GitAllowedHostsRequiredAndWellFormed(t *testing.T) {
	cfg := validConfig()
	cfg.GitAllowedHosts = nil
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected an empty Git host allowlist to be rejected")
	}
	cfg.GitAllowedHosts = []string{"github.com/path"}
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected malformed Git allowlist host to be rejected")
	}
}

func TestValidate_ExternalAPIRequiresStrongToken(t *testing.T) {
	cfg := validConfig()
	cfg.APIHost = "0.0.0.0"
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected external API listener without token to be rejected")
	}

	cfg.APIToken = "too-short"
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected short token for external API listener to be rejected")
	}

	cfg.APIToken = "0123456789abcdef0123456789abcdef"
	if err := cfg.Validate(); err != nil {
		t.Fatalf("expected external API listener with strong token to be valid: %v", err)
	}
}

func TestValidate_ExplicitInsecureNoAuthOverride(t *testing.T) {
	cfg := validConfig()
	cfg.APIHost = "0.0.0.0"
	cfg.AllowInsecureNoAuth = true
	if err := cfg.Validate(); err != nil {
		t.Fatalf("expected explicit insecure local-development override to be valid: %v", err)
	}
}

func TestValidate_LoopbackAPIAllowsEmptyToken(t *testing.T) {
	for _, host := range []string{"127.0.0.1", "::1", "localhost"} {
		cfg := validConfig()
		cfg.APIHost = host
		cfg.APIToken = ""
		if err := cfg.Validate(); err != nil {
			t.Errorf("expected loopback host %q without token to be valid: %v", host, err)
		}
	}
}

func TestValidate_PresentationAPIRequiresCompleteSecureConfiguration(t *testing.T) {
	cfg := validConfig()
	cfg.PresentationCredentialsFile = "/run/secrets/presentation-credentials.json"
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected presentation registry without audience to be rejected")
	}

	cfg.PresentationAudience = "dockercd-web"
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected presentation API without a strong legacy admin token to be rejected")
	}

	cfg.APIToken = "0123456789abcdef0123456789abcdef"
	if err := cfg.Validate(); err != nil {
		t.Fatalf("expected complete presentation API configuration to be valid: %v", err)
	}

	cfg.PresentationAudience = " not-a-valid-audience "
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected padded audience to be rejected")
	}
	cfg.PresentationAudience = "not a valid audience"
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected whitespace audience to be rejected")
	}
}

func TestAPIAddr(t *testing.T) {
	cfg := validConfig()
	if got, want := cfg.APIAddr(), "127.0.0.1:8080"; got != want {
		t.Fatalf("APIAddr() = %q, want %q", got, want)
	}

	cfg.APIHost = "::1"
	if got, want := cfg.APIAddr(), "[::1]:8080"; got != want {
		t.Fatalf("APIAddr() = %q, want %q", got, want)
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

func TestTLSHostConfig_VerifiesByDefault(t *testing.T) {
	cfg := TLSHostConfig{
		Host:     "tcp://docker.example.test:2376",
		CertPath: "/certs/docker",
	}
	if err := cfg.Validate(); err != nil {
		t.Fatalf("secure TLS configuration should be valid: %v", err)
	}
}

func TestTLSHostConfig_InsecureVerificationRequiresLocalAcknowledgement(t *testing.T) {
	tests := []struct {
		name string
		cfg  TLSHostConfig
		want bool
	}{
		{
			name: "missing acknowledgement",
			cfg: TLSHostConfig{
				Host:               "tcp://127.0.0.1:2376",
				CertPath:           "/certs/docker",
				InsecureSkipVerify: true,
			},
		},
		{
			name: "remote host",
			cfg: TLSHostConfig{
				Host:                       "tcp://docker.example.test:2376",
				CertPath:                   "/certs/docker",
				InsecureSkipVerify:         true,
				DevelopmentAcknowledgement: InsecureTLSDevelopmentAcknowledgement,
			},
		},
		{
			name: "acknowledged loopback development host",
			cfg: TLSHostConfig{
				Host:                       "tcp://localhost:2376",
				CertPath:                   "/certs/docker",
				InsecureSkipVerify:         true,
				DevelopmentAcknowledgement: InsecureTLSDevelopmentAcknowledgement,
			},
			want: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.cfg.Validate()
			if (err == nil) != tt.want {
				t.Fatalf("Validate() error = %v, want success %t", err, tt.want)
			}
		})
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
