package parser

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"testing"

	"github.com/mkolb22/dockercd/internal/app"
)

// writeFixture writes a file to the given directory and returns its name.
func writeFixture(t *testing.T, dir, name, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0644); err != nil {
		t.Fatalf("write fixture %s: %v", name, err)
	}
}

func TestParse_SingleFile(t *testing.T) {
	dir := t.TempDir()
	writeFixture(t, dir, "docker-compose.yml", `
services:
  web:
    image: nginx:1.25
    ports:
      - "8080:80"
    environment:
      FOO: bar
    restart: always
`)
	p := New()
	spec, err := p.Parse(context.Background(), dir, []string{"docker-compose.yml"})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}

	if len(spec.Services) != 1 {
		t.Fatalf("expected 1 service, got %d", len(spec.Services))
	}

	svc := spec.Services[0]
	if svc.Name != "web" {
		t.Errorf("expected service name 'web', got %q", svc.Name)
	}
	if svc.Image != "nginx:1.25" {
		t.Errorf("expected image 'nginx:1.25', got %q", svc.Image)
	}
	if svc.RestartPolicy != "always" {
		t.Errorf("expected restart 'always', got %q", svc.RestartPolicy)
	}
	if svc.Environment["FOO"] != "bar" {
		t.Errorf("expected env FOO=bar, got %q", svc.Environment["FOO"])
	}
	if len(svc.Ports) != 1 || svc.Ports[0].HostPort != "8080" || svc.Ports[0].ContainerPort != "80" {
		t.Errorf("unexpected ports: %+v", svc.Ports)
	}
}

func TestParse_MultipleServices(t *testing.T) {
	dir := t.TempDir()
	writeFixture(t, dir, "docker-compose.yml", `
services:
  web:
    image: nginx:1.25
  db:
    image: postgres:16
  redis:
    image: redis:7
`)
	p := New()
	spec, err := p.Parse(context.Background(), dir, []string{"docker-compose.yml"})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}

	if len(spec.Services) != 3 {
		t.Fatalf("expected 3 services, got %d", len(spec.Services))
	}

	// Services should be sorted by name (normalize)
	names := make([]string, len(spec.Services))
	for i, s := range spec.Services {
		names[i] = s.Name
	}
	expected := []string{"db", "redis", "web"}
	if !reflect.DeepEqual(names, expected) {
		t.Errorf("expected sorted names %v, got %v", expected, names)
	}
}

func TestParse_MultiFileOverride(t *testing.T) {
	dir := t.TempDir()
	writeFixture(t, dir, "docker-compose.yml", `
services:
  web:
    image: nginx:1.25
    ports:
      - "80:80"
    environment:
      ENV: dev
      DEBUG: "true"
`)
	writeFixture(t, dir, "docker-compose.prod.yml", `
services:
  web:
    image: nginx:1.26
    ports:
      - "443:443"
    environment:
      ENV: prod
`)
	p := New()
	spec, err := p.Parse(context.Background(), dir, []string{"docker-compose.yml", "docker-compose.prod.yml"})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}

	svc := spec.Services[0]
	// Scalar: image should be overridden
	if svc.Image != "nginx:1.26" {
		t.Errorf("expected image override to nginx:1.26, got %q", svc.Image)
	}
	// List: ports should be appended
	if len(svc.Ports) != 2 {
		t.Errorf("expected 2 ports (appended), got %d", len(svc.Ports))
	}
	// Map: environment should be merged, ENV overridden, DEBUG retained
	if svc.Environment["ENV"] != "prod" {
		t.Errorf("expected ENV=prod, got %q", svc.Environment["ENV"])
	}
	if svc.Environment["DEBUG"] != "true" {
		t.Errorf("expected DEBUG=true retained from base, got %q", svc.Environment["DEBUG"])
	}
}

func TestParse_OverrideAddsNewService(t *testing.T) {
	dir := t.TempDir()
	writeFixture(t, dir, "docker-compose.yml", `
services:
  web:
    image: nginx:1.25
`)
	writeFixture(t, dir, "docker-compose.override.yml", `
services:
  redis:
    image: redis:7
`)
	p := New()
	spec, err := p.Parse(context.Background(), dir, []string{"docker-compose.yml", "docker-compose.override.yml"})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}

	if len(spec.Services) != 2 {
		t.Fatalf("expected 2 services, got %d", len(spec.Services))
	}
}

func TestParse_EnvironmentListForm(t *testing.T) {
	dir := t.TempDir()
	writeFixture(t, dir, "docker-compose.yml", `
services:
  web:
    image: nginx:1.25
    environment:
      - FOO=bar
      - BAZ=qux
`)
	p := New()
	spec, err := p.Parse(context.Background(), dir, []string{"docker-compose.yml"})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}

	svc := spec.Services[0]
	if svc.Environment["FOO"] != "bar" {
		t.Errorf("expected FOO=bar, got %q", svc.Environment["FOO"])
	}
	if svc.Environment["BAZ"] != "qux" {
		t.Errorf("expected BAZ=qux, got %q", svc.Environment["BAZ"])
	}
}

func TestParse_LabelsMapAndList(t *testing.T) {
	dir := t.TempDir()
	writeFixture(t, dir, "docker-compose.yml", `
services:
  web:
    image: nginx
    labels:
      app: web
      tier: frontend
`)
	p := New()
	spec, err := p.Parse(context.Background(), dir, []string{"docker-compose.yml"})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}

	svc := spec.Services[0]
	if svc.Labels["app"] != "web" || svc.Labels["tier"] != "frontend" {
		t.Errorf("unexpected labels: %v", svc.Labels)
	}
}

func TestParse_Healthcheck(t *testing.T) {
	dir := t.TempDir()
	writeFixture(t, dir, "docker-compose.yml", `
services:
  web:
    image: nginx
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 5s
`)
	p := New()
	spec, err := p.Parse(context.Background(), dir, []string{"docker-compose.yml"})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}

	hc := spec.Services[0].Healthcheck
	if hc == nil {
		t.Fatal("expected healthcheck to be set")
	}
	expected := []string{"CMD", "curl", "-f", "http://localhost"}
	if !reflect.DeepEqual(hc.Test, expected) {
		t.Errorf("expected test %v, got %v", expected, hc.Test)
	}
	if hc.Interval != "30s" {
		t.Errorf("expected interval '30s', got %q", hc.Interval)
	}
	if hc.Retries != 3 {
		t.Errorf("expected retries 3, got %d", hc.Retries)
	}
}

func TestParse_CommandStringForm(t *testing.T) {
	dir := t.TempDir()
	writeFixture(t, dir, "docker-compose.yml", `
services:
  web:
    image: nginx
    command: "nginx -g 'daemon off;'"
`)
	p := New()
	spec, err := p.Parse(context.Background(), dir, []string{"docker-compose.yml"})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}

	cmd := spec.Services[0].Command
	if len(cmd) != 1 || cmd[0] != "nginx -g 'daemon off;'" {
		t.Errorf("expected single string command, got %v", cmd)
	}
}

func TestParse_CommandListForm(t *testing.T) {
	dir := t.TempDir()
	writeFixture(t, dir, "docker-compose.yml", `
services:
  web:
    image: nginx
    command: ["nginx", "-g", "daemon off;"]
`)
	p := New()
	spec, err := p.Parse(context.Background(), dir, []string{"docker-compose.yml"})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}

	cmd := spec.Services[0].Command
	expected := []string{"nginx", "-g", "daemon off;"}
	if !reflect.DeepEqual(cmd, expected) {
		t.Errorf("expected %v, got %v", expected, cmd)
	}
}

func TestParse_Volumes(t *testing.T) {
	dir := t.TempDir()
	writeFixture(t, dir, "docker-compose.yml", `
services:
  web:
    image: nginx
    volumes:
      - ./data:/app/data
      - config:/etc/config:ro
      - /tmp
`)
	p := New()
	spec, err := p.Parse(context.Background(), dir, []string{"docker-compose.yml"})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}

	vols := spec.Services[0].Volumes
	if len(vols) != 3 {
		t.Fatalf("expected 3 volumes, got %d", len(vols))
	}

	// Find each volume by target
	volMap := make(map[string]app.VolumeMount)
	for _, v := range vols {
		volMap[v.Target] = v
	}

	if v := volMap["/app/data"]; v.Source != "./data" {
		t.Errorf("expected source './data', got %q", v.Source)
	}
	if v := volMap["/etc/config"]; !v.ReadOnly {
		t.Error("expected /etc/config to be readonly")
	}
	if v := volMap["/tmp"]; v.Source != "" {
		t.Errorf("expected empty source for anonymous volume, got %q", v.Source)
	}
}

func TestParse_PortProtocol(t *testing.T) {
	dir := t.TempDir()
	writeFixture(t, dir, "docker-compose.yml", `
services:
  web:
    image: nginx
    ports:
      - "8080:80/tcp"
      - "53:53/udp"
`)
	p := New()
	spec, err := p.Parse(context.Background(), dir, []string{"docker-compose.yml"})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}

	ports := spec.Services[0].Ports
	sort.Slice(ports, func(i, j int) bool {
		return ports[i].ContainerPort < ports[j].ContainerPort
	})

	if len(ports) != 2 {
		t.Fatalf("expected 2 ports, got %d", len(ports))
	}
	if ports[0].Protocol != "udp" || ports[0].ContainerPort != "53" {
		t.Errorf("unexpected port[0]: %+v", ports[0])
	}
	if ports[1].Protocol != "tcp" || ports[1].ContainerPort != "80" {
		t.Errorf("unexpected port[1]: %+v", ports[1])
	}
}

func TestParse_Networks(t *testing.T) {
	dir := t.TempDir()
	writeFixture(t, dir, "docker-compose.yml", `
services:
  web:
    image: nginx
    networks:
      - frontend
      - backend

networks:
  frontend:
    driver: bridge
  backend:
    external: true
`)
	p := New()
	spec, err := p.Parse(context.Background(), dir, []string{"docker-compose.yml"})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}

	svc := spec.Services[0]
	sort.Strings(svc.Networks)
	if !reflect.DeepEqual(svc.Networks, []string{"backend", "frontend"}) {
		t.Errorf("expected [backend frontend], got %v", svc.Networks)
	}

	if spec.Networks["frontend"].Driver != "bridge" {
		t.Errorf("expected frontend driver 'bridge', got %q", spec.Networks["frontend"].Driver)
	}
	if !spec.Networks["backend"].External {
		t.Error("expected backend to be external")
	}
}

func TestParse_DependsOn(t *testing.T) {
	dir := t.TempDir()
	writeFixture(t, dir, "docker-compose.yml", `
services:
  web:
    image: nginx
    depends_on:
      - db
      - redis
  db:
    image: postgres
  redis:
    image: redis
`)
	p := New()
	spec, err := p.Parse(context.Background(), dir, []string{"docker-compose.yml"})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}

	// Find web service
	var webSvc *app.ServiceSpec
	for i := range spec.Services {
		if spec.Services[i].Name == "web" {
			webSvc = &spec.Services[i]
			break
		}
	}
	if webSvc == nil {
		t.Fatal("web service not found")
	}

	sort.Strings(webSvc.DependsOn)
	if !reflect.DeepEqual(webSvc.DependsOn, []string{"db", "redis"}) {
		t.Errorf("expected depends_on [db redis], got %v", webSvc.DependsOn)
	}
}

func TestParse_EnvFile(t *testing.T) {
	dir := t.TempDir()
	writeFixture(t, dir, ".env", `
# Database config
DB_HOST=localhost
DB_PORT=5432
DB_NAME="mydb"
`)
	writeFixture(t, dir, "docker-compose.yml", `
services:
  web:
    image: nginx
    environment:
      DATABASE_HOST: ${DB_HOST}
      DATABASE_PORT: ${DB_PORT}
      DATABASE_NAME: ${DB_NAME}
`)
	p := New()
	spec, err := p.Parse(context.Background(), dir, []string{"docker-compose.yml"})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}

	env := spec.Services[0].Environment
	if env["DATABASE_HOST"] != "localhost" {
		t.Errorf("expected DATABASE_HOST=localhost, got %q", env["DATABASE_HOST"])
	}
	if env["DATABASE_PORT"] != "5432" {
		t.Errorf("expected DATABASE_PORT=5432, got %q", env["DATABASE_PORT"])
	}
	if env["DATABASE_NAME"] != "mydb" {
		t.Errorf("expected DATABASE_NAME=mydb, got %q", env["DATABASE_NAME"])
	}
}

func TestParse_NoComposeFiles(t *testing.T) {
	p := New()
	_, err := p.Parse(context.Background(), t.TempDir(), nil)
	if err == nil {
		t.Fatal("expected error for no compose files")
	}
}

func TestParse_MissingFile(t *testing.T) {
	p := New()
	_, err := p.Parse(context.Background(), t.TempDir(), []string{"nonexistent.yml"})
	if err == nil {
		t.Fatal("expected error for missing file")
	}
}

func TestParse_InvalidYAML(t *testing.T) {
	dir := t.TempDir()
	writeFixture(t, dir, "docker-compose.yml", `
services:
  web:
    image: nginx
    ports: [invalid yaml structure
`)
	p := New()
	_, err := p.Parse(context.Background(), dir, []string{"docker-compose.yml"})
	if err == nil {
		t.Fatal("expected error for invalid YAML")
	}
}

func TestParse_TopLevelVolumes(t *testing.T) {
	dir := t.TempDir()
	writeFixture(t, dir, "docker-compose.yml", `
services:
  web:
    image: nginx

volumes:
  data:
    driver: local
  cache:
    external: true
`)
	p := New()
	spec, err := p.Parse(context.Background(), dir, []string{"docker-compose.yml"})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}

	if spec.Volumes["data"].Driver != "local" {
		t.Errorf("expected data volume driver 'local', got %q", spec.Volumes["data"].Driver)
	}
	if !spec.Volumes["cache"].External {
		t.Error("expected cache volume to be external")
	}
}
