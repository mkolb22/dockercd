// Package parser handles Docker Compose file parsing, multi-file merging,
// variable substitution, and normalization into the app.ComposeSpec model.
package parser

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"

	"github.com/mkolb22/dockercd/internal/app"
	"github.com/mkolb22/dockercd/internal/secrets"
	"gopkg.in/yaml.v3"
)

// ComposeParser parses Docker Compose files into a normalized desired state.
type ComposeParser interface {
	Parse(ctx context.Context, repoPath string, composeFiles []string) (*app.ComposeSpec, error)
}

// Parser is the default ComposeParser implementation.
type Parser struct {
	secrets secrets.Provider
}

// New creates a new Parser.
func New() *Parser {
	return &Parser{}
}

// NewWithSecrets creates a Parser with a secrets provider for decrypting encrypted env files.
func NewWithSecrets(sp secrets.Provider) *Parser {
	return &Parser{secrets: sp}
}

// Parse reads compose files from the given directory, merges them in order,
// substitutes variables from .env, and returns the normalized ComposeSpec.
func (p *Parser) Parse(ctx context.Context, repoPath string, composeFiles []string) (*app.ComposeSpec, error) {
	if len(composeFiles) == 0 {
		return nil, fmt.Errorf("no compose files specified")
	}

	// Load .env file for variable substitution (optional — not an error if missing)
	envVars := loadDotEnv(filepath.Join(repoPath, ".env"))

	// Check for encrypted env files and merge decrypted values
	if p.secrets != nil {
		for _, encExt := range []string{".env.age", ".env.enc"} {
			encPath := filepath.Join(repoPath, encExt)
			if _, err := os.Stat(encPath); err == nil && p.secrets.CanHandle(encPath) {
				decrypted, err := p.secrets.Decrypt(ctx, encPath)
				if err != nil {
					return nil, fmt.Errorf("decrypting %s: %w", encExt, err)
				}
				// Merge decrypted values (encrypted values take precedence)
				for k, v := range decrypted {
					envVars[k] = v
				}
			}
		}
	}

	// Parse base compose file
	basePath := filepath.Join(repoPath, composeFiles[0])
	base, err := parseComposeFile(basePath)
	if err != nil {
		return nil, fmt.Errorf("parsing %s: %w", composeFiles[0], err)
	}

	// Merge override files in order
	for i := 1; i < len(composeFiles); i++ {
		overridePath := filepath.Join(repoPath, composeFiles[i])
		override, err := parseComposeFile(overridePath)
		if err != nil {
			return nil, fmt.Errorf("parsing %s: %w", composeFiles[i], err)
		}
		base = mergeCompose(base, override)
	}

	// Convert raw compose to domain types
	spec, err := toComposeSpec(base, envVars)
	if err != nil {
		return nil, fmt.Errorf("converting compose: %w", err)
	}

	// Normalize: sort services by name for deterministic comparison
	normalize(spec)

	// Resolve inline secret references in environment values (e.g., vault:secret/data/app#key)
	if p.secrets != nil {
		for i := range spec.Services {
			for key, val := range spec.Services[i].Environment {
				if p.secrets.CanHandle(val) {
					resolved, err := p.secrets.Decrypt(ctx, val)
					if err != nil {
						return nil, fmt.Errorf("resolving secret ref %q for %s.%s: %w", val, spec.Services[i].Name, key, err)
					}
					// Use the single returned value, or the value matching the key
					if len(resolved) == 1 {
						for _, v := range resolved {
							spec.Services[i].Environment[key] = v
						}
					}
				}
			}
		}
	}

	return spec, nil
}

// rawCompose is the raw YAML structure of a docker-compose file.
type rawCompose struct {
	Services map[string]rawService `yaml:"services"`
	Networks map[string]rawNetwork `yaml:"networks,omitempty"`
	Volumes  map[string]rawVolume  `yaml:"volumes,omitempty"`
}

type rawService struct {
	Image         string            `yaml:"image"`
	Environment   interface{}       `yaml:"environment,omitempty"` // map or list
	Ports         []string          `yaml:"ports,omitempty"`
	Volumes       []string          `yaml:"volumes,omitempty"`
	Networks      interface{}       `yaml:"networks,omitempty"` // list or map
	Labels        interface{}       `yaml:"labels,omitempty"`   // map or list
	Restart       string            `yaml:"restart,omitempty"`
	Healthcheck   *rawHealthcheck   `yaml:"healthcheck,omitempty"`
	Command       interface{}       `yaml:"command,omitempty"` // string or list
	Entrypoint    interface{}       `yaml:"entrypoint,omitempty"`
	DependsOn     interface{}       `yaml:"depends_on,omitempty"` // list or map
	ContainerName string            `yaml:"container_name,omitempty"`
	Extra         map[string]interface{} `yaml:",inline"`
}

type rawHealthcheck struct {
	Test        interface{} `yaml:"test"`
	Interval    string      `yaml:"interval,omitempty"`
	Timeout     string      `yaml:"timeout,omitempty"`
	Retries     int         `yaml:"retries,omitempty"`
	StartPeriod string      `yaml:"start_period,omitempty"`
}

type rawNetwork struct {
	Driver   string `yaml:"driver,omitempty"`
	External interface{} `yaml:"external,omitempty"` // bool or map
}

type rawVolume struct {
	Driver   string `yaml:"driver,omitempty"`
	External interface{} `yaml:"external,omitempty"`
}

func parseComposeFile(path string) (*rawCompose, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("reading file: %w", err)
	}

	var raw rawCompose
	if err := yaml.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("unmarshaling YAML: %w", err)
	}

	if raw.Services == nil {
		raw.Services = make(map[string]rawService)
	}

	return &raw, nil
}

// toComposeSpec converts a rawCompose into an app.ComposeSpec,
// performing variable substitution on string values.
func toComposeSpec(raw *rawCompose, envVars map[string]string) (*app.ComposeSpec, error) {
	spec := &app.ComposeSpec{}

	for name, svc := range raw.Services {
		s := app.ServiceSpec{
			Name:          name,
			Image:         substituteVars(svc.Image, envVars),
			Environment:   parseEnvironment(svc.Environment, envVars),
			Ports:         parsePorts(svc.Ports),
			Volumes:       parseVolumes(svc.Volumes),
			Networks:      parseNetworksList(svc.Networks),
			Labels:        parseLabels(svc.Labels),
			RestartPolicy: svc.Restart,
			Command:       parseCommand(svc.Command),
			Entrypoint:    parseCommand(svc.Entrypoint),
			DependsOn:     parseDependsOn(svc.DependsOn),
		}

		if svc.Healthcheck != nil {
			s.Healthcheck = &app.HealthcheckSpec{
				Test:        parseCommand(svc.Healthcheck.Test),
				Interval:    svc.Healthcheck.Interval,
				Timeout:     svc.Healthcheck.Timeout,
				Retries:     svc.Healthcheck.Retries,
				StartPeriod: svc.Healthcheck.StartPeriod,
			}
		}

		spec.Services = append(spec.Services, s)
	}

	// Networks
	if raw.Networks != nil {
		spec.Networks = make(map[string]app.NetworkSpec)
		for name, net := range raw.Networks {
			spec.Networks[name] = app.NetworkSpec{
				Driver:   net.Driver,
				External: parseBoolOrMap(net.External),
			}
		}
	}

	// Volumes
	if raw.Volumes != nil {
		spec.Volumes = make(map[string]app.VolumeSpec)
		for name, vol := range raw.Volumes {
			spec.Volumes[name] = app.VolumeSpec{
				Driver:   vol.Driver,
				External: parseBoolOrMap(vol.External),
			}
		}
	}

	return spec, nil
}

// normalize sorts services by name for deterministic comparison.
func normalize(spec *app.ComposeSpec) {
	sort.Slice(spec.Services, func(i, j int) bool {
		return spec.Services[i].Name < spec.Services[j].Name
	})

	// Sort ports and networks within each service
	for i := range spec.Services {
		sort.Slice(spec.Services[i].Ports, func(a, b int) bool {
			pa := spec.Services[i].Ports[a]
			pb := spec.Services[i].Ports[b]
			if pa.ContainerPort != pb.ContainerPort {
				return pa.ContainerPort < pb.ContainerPort
			}
			return pa.HostPort < pb.HostPort
		})
		sort.Strings(spec.Services[i].Networks)
		sort.Strings(spec.Services[i].DependsOn)
	}
}

// parseEnvironment handles the two forms of environment in compose:
// map form: {KEY: value, KEY2: value2}
// list form: ["KEY=value", "KEY2=value2"]
func parseEnvironment(env interface{}, vars map[string]string) map[string]string {
	if env == nil {
		return nil
	}

	result := make(map[string]string)

	switch v := env.(type) {
	case map[string]interface{}:
		for key, val := range v {
			if val == nil {
				result[key] = ""
			} else {
				result[key] = substituteVars(fmt.Sprintf("%v", val), vars)
			}
		}
	case []interface{}:
		for _, item := range v {
			s := fmt.Sprintf("%v", item)
			key, val := splitEnvVar(s)
			result[key] = substituteVars(val, vars)
		}
	}

	return result
}

// parseLabels handles map and list forms of labels.
func parseLabels(labels interface{}) map[string]string {
	if labels == nil {
		return nil
	}

	result := make(map[string]string)

	switch v := labels.(type) {
	case map[string]interface{}:
		for key, val := range v {
			if val == nil {
				result[key] = ""
			} else {
				result[key] = fmt.Sprintf("%v", val)
			}
		}
	case []interface{}:
		for _, item := range v {
			s := fmt.Sprintf("%v", item)
			key, val := splitEnvVar(s)
			result[key] = val
		}
	}

	return result
}

// parseCommand handles string and list forms of command/entrypoint.
func parseCommand(cmd interface{}) []string {
	if cmd == nil {
		return nil
	}

	switch v := cmd.(type) {
	case string:
		if v == "" {
			return nil
		}
		return []string{v}
	case []interface{}:
		result := make([]string, 0, len(v))
		for _, item := range v {
			result = append(result, fmt.Sprintf("%v", item))
		}
		return result
	}
	return nil
}

// parseNetworksList handles list and map forms of service networks.
func parseNetworksList(networks interface{}) []string {
	if networks == nil {
		return nil
	}

	switch v := networks.(type) {
	case []interface{}:
		result := make([]string, 0, len(v))
		for _, item := range v {
			result = append(result, fmt.Sprintf("%v", item))
		}
		return result
	case map[string]interface{}:
		result := make([]string, 0, len(v))
		for name := range v {
			result = append(result, name)
		}
		return result
	}
	return nil
}

// parseDependsOn handles list and map forms of depends_on.
func parseDependsOn(dep interface{}) []string {
	if dep == nil {
		return nil
	}

	switch v := dep.(type) {
	case []interface{}:
		result := make([]string, 0, len(v))
		for _, item := range v {
			result = append(result, fmt.Sprintf("%v", item))
		}
		return result
	case map[string]interface{}:
		result := make([]string, 0, len(v))
		for name := range v {
			result = append(result, name)
		}
		return result
	}
	return nil
}

// parsePorts converts port strings like "8080:80" or "8080:80/tcp" to PortMapping.
func parsePorts(ports []string) []app.PortMapping {
	if len(ports) == 0 {
		return nil
	}

	result := make([]app.PortMapping, 0, len(ports))
	for _, p := range ports {
		pm := parsePortString(p)
		result = append(result, pm)
	}
	return result
}

func parsePortString(s string) app.PortMapping {
	protocol := "tcp"
	// Check for protocol suffix
	if idx := lastIndex(s, '/'); idx != -1 {
		protocol = s[idx+1:]
		s = s[:idx]
	}

	// Split host:container
	parts := splitPort(s)
	switch len(parts) {
	case 1:
		return app.PortMapping{ContainerPort: parts[0], Protocol: protocol}
	case 2:
		return app.PortMapping{HostPort: parts[0], ContainerPort: parts[1], Protocol: protocol}
	case 3:
		// host_ip:host_port:container_port
		return app.PortMapping{HostPort: parts[1], ContainerPort: parts[2], Protocol: protocol}
	default:
		return app.PortMapping{ContainerPort: s, Protocol: protocol}
	}
}

// splitPort splits a port string, handling IPv6 addresses in brackets.
func splitPort(s string) []string {
	// Simple case: no brackets
	if s[0] != '[' {
		return splitN(s, ':', 3)
	}
	// IPv6: [::1]:8080:80
	bracketEnd := 0
	for i, c := range s {
		if c == ']' {
			bracketEnd = i
			break
		}
	}
	if bracketEnd == 0 {
		return []string{s}
	}
	// After closing bracket, expect ':'
	rest := s[bracketEnd+1:]
	if len(rest) == 0 || rest[0] != ':' {
		return []string{s}
	}
	parts := splitN(rest[1:], ':', 2)
	result := []string{s[:bracketEnd+1]}
	result = append(result, parts...)
	return result
}

// parseVolumes converts volume strings like "./data:/app/data:ro" to VolumeMount.
func parseVolumes(volumes []string) []app.VolumeMount {
	if len(volumes) == 0 {
		return nil
	}

	result := make([]app.VolumeMount, 0, len(volumes))
	for _, v := range volumes {
		vm := parseVolumeString(v)
		result = append(result, vm)
	}
	return result
}

func parseVolumeString(s string) app.VolumeMount {
	parts := splitN(s, ':', 3)
	vm := app.VolumeMount{}

	switch len(parts) {
	case 1:
		vm.Target = parts[0]
	case 2:
		vm.Source = parts[0]
		vm.Target = parts[1]
	case 3:
		vm.Source = parts[0]
		vm.Target = parts[1]
		vm.ReadOnly = parts[2] == "ro"
	}

	return vm
}

// parseBoolOrMap handles external: true or external: {name: ...}
func parseBoolOrMap(v interface{}) bool {
	if v == nil {
		return false
	}
	switch val := v.(type) {
	case bool:
		return val
	case map[string]interface{}:
		return true // external: {name: ...} means external
	}
	return false
}

// splitEnvVar splits "KEY=value" into key and value. If no =, value is empty.
func splitEnvVar(s string) (string, string) {
	for i, c := range s {
		if c == '=' {
			return s[:i], s[i+1:]
		}
	}
	return s, ""
}

func splitN(s string, sep byte, n int) []string {
	var result []string
	for i := 0; i < n-1; i++ {
		idx := -1
		for j := 0; j < len(s); j++ {
			if s[j] == sep {
				idx = j
				break
			}
		}
		if idx == -1 {
			break
		}
		result = append(result, s[:idx])
		s = s[idx+1:]
	}
	result = append(result, s)
	return result
}

func lastIndex(s string, c byte) int {
	for i := len(s) - 1; i >= 0; i-- {
		if s[i] == c {
			return i
		}
	}
	return -1
}
