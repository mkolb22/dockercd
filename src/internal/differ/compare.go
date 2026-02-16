package differ

import (
	"fmt"
	"sort"
	"strings"

	"github.com/mkolb22/dockercd/internal/app"
)

// compareService compares a desired ServiceSpec against a live ServiceState
// and returns a list of field-level differences.
func compareService(desired app.ServiceSpec, live app.ServiceState) []app.FieldDiff {
	var diffs []app.FieldDiff

	// Image comparison
	if normalizeImage(desired.Image) != normalizeImage(live.Image) {
		diffs = append(diffs, app.FieldDiff{
			Field:   "image",
			Desired: desired.Image,
			Live:    live.Image,
		})
	}

	// Environment comparison (key-by-key)
	diffs = append(diffs, compareEnvironment(desired.Environment, live.Environment)...)

	// Port comparison (order-independent)
	if !portsEqual(desired.Ports, live.Ports) {
		diffs = append(diffs, app.FieldDiff{
			Field:   "ports",
			Desired: formatPorts(desired.Ports),
			Live:    formatPorts(live.Ports),
		})
	}

	// Volume comparison (order-independent)
	if !volumesEqual(desired.Volumes, live.Volumes) {
		diffs = append(diffs, app.FieldDiff{
			Field:   "volumes",
			Desired: formatVolumes(desired.Volumes),
			Live:    formatVolumes(live.Volumes),
		})
	}

	// Network comparison (order-independent)
	// When desired has no explicit networks, Docker Compose auto-creates a
	// {project}_default network. Filter those out to avoid false drift.
	liveNets := filterDefaultNetworks(live.Networks)
	if !stringSetsEqual(desired.Networks, liveNets) {
		diffs = append(diffs, app.FieldDiff{
			Field:   "networks",
			Desired: joinSorted(desired.Networks),
			Live:    joinSorted(liveNets),
		})
	}

	// Label comparison (key-by-key)
	diffs = append(diffs, compareLabels(desired.Labels, live.Labels)...)

	// Restart policy comparison
	if desired.RestartPolicy != "" && desired.RestartPolicy != live.RestartPolicy {
		diffs = append(diffs, app.FieldDiff{
			Field:   "restartPolicy",
			Desired: desired.RestartPolicy,
			Live:    live.RestartPolicy,
		})
	}

	// Command comparison — skip when desired is empty (inherits from image)
	if len(desired.Command) > 0 && !stringSlicesEqual(desired.Command, live.Command) {
		diffs = append(diffs, app.FieldDiff{
			Field:   "command",
			Desired: strings.Join(desired.Command, " "),
			Live:    strings.Join(live.Command, " "),
		})
	}

	// Entrypoint comparison — skip when desired is empty (inherits from image)
	if len(desired.Entrypoint) > 0 && !stringSlicesEqual(desired.Entrypoint, live.Entrypoint) {
		diffs = append(diffs, app.FieldDiff{
			Field:   "entrypoint",
			Desired: strings.Join(desired.Entrypoint, " "),
			Live:    strings.Join(live.Entrypoint, " "),
		})
	}

	return diffs
}

// normalizeImage normalizes a Docker image reference for comparison.
// "nginx" → "docker.io/library/nginx:latest"
// "nginx:1.25" → "docker.io/library/nginx:1.25"
// "myregistry.com/app:v1" → "myregistry.com/app:v1"
func normalizeImage(image string) string {
	if image == "" {
		return ""
	}

	// Add default tag if missing
	if !strings.Contains(image, ":") {
		image += ":latest"
	}

	// Add default registry/namespace for short names
	// A short name has no "/" or only one segment before "/"
	parts := strings.SplitN(image, "/", 2)
	if len(parts) == 1 {
		// No "/" — bare image name like "nginx:1.25"
		image = "docker.io/library/" + image
	} else if !strings.Contains(parts[0], ".") && !strings.Contains(parts[0], ":") {
		// No domain in first segment (e.g., "library/nginx") — Docker Hub namespace
		image = "docker.io/" + image
	}

	return image
}

// compareEnvironment compares desired and live environment variables key-by-key.
// Variables injected by Docker (PATH, HOME, HOSTNAME, etc.) are excluded from
// comparison when they appear only in live state.
func compareEnvironment(desired, live map[string]string) []app.FieldDiff {
	if len(desired) == 0 && len(live) == 0 {
		return nil
	}

	var diffs []app.FieldDiff

	// All keys from both maps
	allKeys := make(map[string]bool)
	for k := range desired {
		allKeys[k] = true
	}
	for k := range live {
		if !isDockerInjectedVar(k) {
			allKeys[k] = true
		}
	}

	// Compare each key, sorted for deterministic output
	keys := make([]string, 0, len(allKeys))
	for k := range allKeys {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	for _, key := range keys {
		dv := desired[key]
		lv := live[key]
		_, inDesired := desired[key]
		_, inLive := live[key]

		if inDesired && inLive {
			if dv != lv {
				diffs = append(diffs, app.FieldDiff{
					Field:   "environment." + key,
					Desired: dv,
					Live:    lv,
				})
			}
		} else if inDesired && !inLive {
			diffs = append(diffs, app.FieldDiff{
				Field:   "environment." + key,
				Desired: dv,
				Live:    "",
			})
		} else if !inDesired && inLive && !isDockerInjectedVar(key) {
			diffs = append(diffs, app.FieldDiff{
				Field:   "environment." + key,
				Desired: "",
				Live:    lv,
			})
		}
	}

	return diffs
}

// isDockerInjectedVar returns true for environment variables injected by Docker
// that should not be compared against desired state.
var dockerInjectedVars = map[string]bool{
	"PATH":     true,
	"HOME":     true,
	"HOSTNAME": true,
	"TERM":     true,
}

func isDockerInjectedVar(key string) bool {
	return dockerInjectedVars[key]
}

// isDockerManagedLabel returns true for labels injected by Docker Desktop
// or Docker Compose that should not be compared against desired state.
func isDockerManagedLabel(key string) bool {
	return strings.HasPrefix(key, "desktop.docker.io/") ||
		strings.HasPrefix(key, "com.docker.compose.")
}

// compareLabels compares desired and live labels key-by-key.
// Labels injected by Docker Desktop or Docker Compose are excluded when
// they appear only in live state.
func compareLabels(desired, live map[string]string) []app.FieldDiff {
	if len(desired) == 0 && len(live) == 0 {
		return nil
	}

	var diffs []app.FieldDiff

	allKeys := make(map[string]bool)
	for k := range desired {
		allKeys[k] = true
	}
	for k := range live {
		if !isDockerManagedLabel(k) {
			allKeys[k] = true
		}
	}

	keys := make([]string, 0, len(allKeys))
	for k := range allKeys {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	for _, key := range keys {
		dv := desired[key]
		lv := live[key]
		_, inDesired := desired[key]
		_, inLive := live[key]

		if inDesired && inLive && dv != lv {
			diffs = append(diffs, app.FieldDiff{
				Field:   "labels." + key,
				Desired: dv,
				Live:    lv,
			})
		} else if inDesired && !inLive {
			diffs = append(diffs, app.FieldDiff{
				Field:   "labels." + key,
				Desired: dv,
				Live:    "",
			})
		} else if !inDesired && inLive && !isDockerManagedLabel(key) {
			diffs = append(diffs, app.FieldDiff{
				Field:   "labels." + key,
				Desired: "",
				Live:    lv,
			})
		}
	}

	return diffs
}

// portsEqual compares two port lists order-independently.
// Duplicate entries (e.g. Docker Desktop IPv4+IPv6 bindings) are deduplicated.
func portsEqual(a, b []app.PortMapping) bool {
	sa := dedupStrings(normalizedPorts(a))
	sb := dedupStrings(normalizedPorts(b))

	if len(sa) != len(sb) {
		return false
	}
	if len(sa) == 0 {
		return true
	}

	sort.Strings(sa)
	sort.Strings(sb)

	for i := range sa {
		if sa[i] != sb[i] {
			return false
		}
	}
	return true
}

// dedupStrings removes duplicate strings from a slice.
func dedupStrings(s []string) []string {
	seen := make(map[string]bool, len(s))
	result := make([]string, 0, len(s))
	for _, v := range s {
		if !seen[v] {
			seen[v] = true
			result = append(result, v)
		}
	}
	return result
}

func normalizedPorts(ports []app.PortMapping) []string {
	result := make([]string, len(ports))
	for i, p := range ports {
		proto := p.Protocol
		if proto == "" {
			proto = "tcp"
		}
		if p.HostPort != "" {
			result[i] = fmt.Sprintf("%s:%s/%s", p.HostPort, p.ContainerPort, proto)
		} else {
			result[i] = fmt.Sprintf("%s/%s", p.ContainerPort, proto)
		}
	}
	return result
}

// formatPorts formats a port list as a human-readable string.
func formatPorts(ports []app.PortMapping) string {
	strs := normalizedPorts(ports)
	sort.Strings(strs)
	return strings.Join(strs, ", ")
}

// volumesEqual compares two volume lists order-independently.
// For each desired volume, finds a matching live volume by target path.
// Named volumes (no "/" in source) are compared by target+readOnly only,
// since Docker resolves the source to the full host path at runtime.
func volumesEqual(desired, live []app.VolumeMount) bool {
	if len(desired) != len(live) {
		return false
	}
	if len(desired) == 0 {
		return true
	}

	// Index live volumes by target path
	liveByTarget := make(map[string]app.VolumeMount, len(live))
	for _, v := range live {
		liveByTarget[v.Target] = v
	}

	for _, dv := range desired {
		lv, exists := liveByTarget[dv.Target]
		if !exists {
			return false
		}
		if dv.ReadOnly != lv.ReadOnly {
			return false
		}
		// For bind mounts (absolute or relative path), compare source too
		if !isNamedVolume(dv.Source) && dv.Source != lv.Source {
			return false
		}
	}
	return true
}

// isNamedVolume returns true if the source looks like a named volume (no "/" or "." prefix).
func isNamedVolume(source string) bool {
	return source != "" && !strings.HasPrefix(source, "/") && !strings.HasPrefix(source, ".")
}

func normalizedVolumes(vols []app.VolumeMount) []string {
	result := make([]string, len(vols))
	for i, v := range vols {
		s := v.Target
		if v.Source != "" {
			s = v.Source + ":" + s
		}
		if v.ReadOnly {
			s += ":ro"
		}
		result[i] = s
	}
	return result
}

// formatVolumes formats a volume list as a human-readable string.
func formatVolumes(vols []app.VolumeMount) string {
	strs := normalizedVolumes(vols)
	sort.Strings(strs)
	return strings.Join(strs, ", ")
}

// stringSetsEqual compares two string slices as unordered sets.
func stringSetsEqual(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	if len(a) == 0 {
		return true
	}

	sa := make([]string, len(a))
	copy(sa, a)
	sort.Strings(sa)

	sb := make([]string, len(b))
	copy(sb, b)
	sort.Strings(sb)

	for i := range sa {
		if sa[i] != sb[i] {
			return false
		}
	}
	return true
}

// stringSlicesEqual compares two string slices (order matters).
func stringSlicesEqual(a, b []string) bool {
	if len(a) == 0 && len(b) == 0 {
		return true
	}
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// filterDefaultNetworks removes Docker Compose default networks (ending in
// "_default") from the list when desired networks is empty. These are
// auto-created by Compose and are not explicit configuration drift.
func filterDefaultNetworks(networks []string) []string {
	var result []string
	for _, n := range networks {
		if !strings.HasSuffix(n, "_default") {
			result = append(result, n)
		}
	}
	return result
}

// joinSorted sorts and joins strings with comma separator.
func joinSorted(strs []string) string {
	s := make([]string, len(strs))
	copy(s, strs)
	sort.Strings(s)
	return strings.Join(s, ", ")
}
