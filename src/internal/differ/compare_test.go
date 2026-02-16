package differ

import (
	"testing"

	"github.com/mkolb22/dockercd/internal/app"
)

func TestNormalizeImage(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"nginx", "docker.io/library/nginx:latest"},
		{"nginx:1.25", "docker.io/library/nginx:1.25"},
		{"library/nginx", "docker.io/library/nginx:latest"},
		{"myregistry.com/app:v1", "myregistry.com/app:v1"},
		{"ghcr.io/org/app:latest", "ghcr.io/org/app:latest"},
		{"", ""},
		{"redis:7-alpine", "docker.io/library/redis:7-alpine"},
		{"username/myapp", "docker.io/username/myapp:latest"},
		{"localhost:5000/myapp:v2", "localhost:5000/myapp:v2"},
	}

	for _, tt := range tests {
		result := normalizeImage(tt.input)
		if result != tt.expected {
			t.Errorf("normalizeImage(%q) = %q, want %q", tt.input, result, tt.expected)
		}
	}
}

func TestPortsEqual(t *testing.T) {
	tests := []struct {
		name string
		a, b []app.PortMapping
		want bool
	}{
		{
			name: "both empty",
			a:    nil,
			b:    nil,
			want: true,
		},
		{
			name: "same ports same order",
			a:    []app.PortMapping{{HostPort: "8080", ContainerPort: "80", Protocol: "tcp"}},
			b:    []app.PortMapping{{HostPort: "8080", ContainerPort: "80", Protocol: "tcp"}},
			want: true,
		},
		{
			name: "same ports different order",
			a: []app.PortMapping{
				{HostPort: "8080", ContainerPort: "80", Protocol: "tcp"},
				{HostPort: "443", ContainerPort: "443", Protocol: "tcp"},
			},
			b: []app.PortMapping{
				{HostPort: "443", ContainerPort: "443", Protocol: "tcp"},
				{HostPort: "8080", ContainerPort: "80", Protocol: "tcp"},
			},
			want: true,
		},
		{
			name: "different ports",
			a:    []app.PortMapping{{HostPort: "8080", ContainerPort: "80", Protocol: "tcp"}},
			b:    []app.PortMapping{{HostPort: "9090", ContainerPort: "80", Protocol: "tcp"}},
			want: false,
		},
		{
			name: "different lengths",
			a:    []app.PortMapping{{HostPort: "8080", ContainerPort: "80", Protocol: "tcp"}},
			b:    nil,
			want: false,
		},
		{
			name: "default protocol handling",
			a:    []app.PortMapping{{HostPort: "8080", ContainerPort: "80", Protocol: "tcp"}},
			b:    []app.PortMapping{{HostPort: "8080", ContainerPort: "80", Protocol: ""}},
			want: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := portsEqual(tt.a, tt.b); got != tt.want {
				t.Errorf("portsEqual() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestVolumesEqual(t *testing.T) {
	tests := []struct {
		name string
		a, b []app.VolumeMount
		want bool
	}{
		{
			name: "both empty",
			a:    nil,
			b:    nil,
			want: true,
		},
		{
			name: "same volumes",
			a:    []app.VolumeMount{{Source: "./data", Target: "/data"}},
			b:    []app.VolumeMount{{Source: "./data", Target: "/data"}},
			want: true,
		},
		{
			name: "different order",
			a: []app.VolumeMount{
				{Source: "./data", Target: "/data"},
				{Source: "./logs", Target: "/logs"},
			},
			b: []app.VolumeMount{
				{Source: "./logs", Target: "/logs"},
				{Source: "./data", Target: "/data"},
			},
			want: true,
		},
		{
			name: "readonly difference",
			a:    []app.VolumeMount{{Source: "./data", Target: "/data", ReadOnly: false}},
			b:    []app.VolumeMount{{Source: "./data", Target: "/data", ReadOnly: true}},
			want: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := volumesEqual(tt.a, tt.b); got != tt.want {
				t.Errorf("volumesEqual() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestStringSetsEqual(t *testing.T) {
	tests := []struct {
		name string
		a, b []string
		want bool
	}{
		{"both nil", nil, nil, true},
		{"same order", []string{"a", "b"}, []string{"a", "b"}, true},
		{"different order", []string{"b", "a"}, []string{"a", "b"}, true},
		{"different values", []string{"a"}, []string{"b"}, false},
		{"different lengths", []string{"a"}, []string{"a", "b"}, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := stringSetsEqual(tt.a, tt.b); got != tt.want {
				t.Errorf("stringSetsEqual() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestStringSlicesEqual(t *testing.T) {
	tests := []struct {
		name string
		a, b []string
		want bool
	}{
		{"both nil", nil, nil, true},
		{"both empty", []string{}, []string{}, true},
		{"nil vs empty", nil, []string{}, true},
		{"same", []string{"a", "b"}, []string{"a", "b"}, true},
		{"different order", []string{"b", "a"}, []string{"a", "b"}, false},
		{"different values", []string{"a"}, []string{"b"}, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := stringSlicesEqual(tt.a, tt.b); got != tt.want {
				t.Errorf("stringSlicesEqual() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestIsDockerInjectedVar(t *testing.T) {
	injected := []string{"PATH", "HOME", "HOSTNAME", "TERM"}
	for _, v := range injected {
		if !isDockerInjectedVar(v) {
			t.Errorf("expected %q to be Docker-injected", v)
		}
	}

	notInjected := []string{"FOO", "DATABASE_URL", "APP_PORT", "MY_PATH"}
	for _, v := range notInjected {
		if isDockerInjectedVar(v) {
			t.Errorf("expected %q to NOT be Docker-injected", v)
		}
	}
}

func TestFormatPorts(t *testing.T) {
	ports := []app.PortMapping{
		{HostPort: "443", ContainerPort: "443", Protocol: "tcp"},
		{HostPort: "8080", ContainerPort: "80", Protocol: "tcp"},
	}

	result := formatPorts(ports)
	expected := "443:443/tcp, 8080:80/tcp"
	if result != expected {
		t.Errorf("formatPorts() = %q, want %q", result, expected)
	}
}

func TestFormatVolumes(t *testing.T) {
	vols := []app.VolumeMount{
		{Source: "./logs", Target: "/logs"},
		{Source: "./data", Target: "/data", ReadOnly: true},
	}

	result := formatVolumes(vols)
	expected := "./data:/data:ro, ./logs:/logs"
	if result != expected {
		t.Errorf("formatVolumes() = %q, want %q", result, expected)
	}
}

func TestJoinSorted(t *testing.T) {
	result := joinSorted([]string{"c", "a", "b"})
	if result != "a, b, c" {
		t.Errorf("joinSorted() = %q, want %q", result, "a, b, c")
	}
}

func TestIsDockerManagedLabel(t *testing.T) {
	managed := []string{
		"desktop.docker.io/binds/0/Source",
		"desktop.docker.io/binds/0/SourceKind",
		"desktop.docker.io/binds/0/Target",
		"desktop.docker.io/ports.scheme",
		"desktop.docker.io/ports/8080/tcp",
		"com.docker.compose.project",
		"com.docker.compose.service",
		"com.docker.compose.config-hash",
	}
	for _, l := range managed {
		if !isDockerManagedLabel(l) {
			t.Errorf("expected %q to be Docker-managed", l)
		}
	}

	notManaged := []string{
		"app.version",
		"maintainer",
		"org.opencontainers.image.source",
	}
	for _, l := range notManaged {
		if isDockerManagedLabel(l) {
			t.Errorf("expected %q to NOT be Docker-managed", l)
		}
	}
}

func TestCompareLabels_IgnoresDockerManagedLabels(t *testing.T) {
	desired := map[string]string{
		"app": "myapp",
	}
	live := map[string]string{
		"app":                                "myapp",
		"desktop.docker.io/binds/0/Source":   "/some/path",
		"desktop.docker.io/ports/8080/tcp":   "",
		"com.docker.compose.project":         "myproject",
		"com.docker.compose.service":         "web",
		"com.docker.compose.config-hash":     "abc123",
	}

	diffs := compareLabels(desired, live)
	if len(diffs) != 0 {
		t.Errorf("expected no diffs when only Docker-managed labels differ, got %d: %v", len(diffs), diffs)
	}
}
