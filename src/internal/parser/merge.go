package parser

import "fmt"

// mergeCompose merges an override compose file into a base compose file.
// Follows Docker Compose override semantics:
//   - Scalars: override replaces base
//   - Maps (environment, labels): override values merge; override keys win on conflict
//   - Lists (ports, volumes): override values are appended to base
//   - Services in override but not base are added
//   - Services in base but not override remain unchanged
func mergeCompose(base, override *rawCompose) *rawCompose {
	if base == nil {
		return override
	}
	if override == nil {
		return base
	}

	result := &rawCompose{
		Services: make(map[string]rawService),
		Networks: make(map[string]rawNetwork),
		Volumes:  make(map[string]rawVolume),
	}

	// Copy base services
	for name, svc := range base.Services {
		result.Services[name] = svc
	}

	// Merge override services
	for name, overrideSvc := range override.Services {
		if baseSvc, exists := result.Services[name]; exists {
			result.Services[name] = mergeService(baseSvc, overrideSvc)
		} else {
			result.Services[name] = overrideSvc
		}
	}

	// Merge networks
	for name, net := range base.Networks {
		result.Networks[name] = net
	}
	for name, net := range override.Networks {
		result.Networks[name] = net
	}

	// Merge volumes
	for name, vol := range base.Volumes {
		result.Volumes[name] = vol
	}
	for name, vol := range override.Volumes {
		result.Volumes[name] = vol
	}

	return result
}

// mergeService merges an override service into a base service.
func mergeService(base, override rawService) rawService {
	result := base

	// Scalar fields: override replaces base
	if override.Image != "" {
		result.Image = override.Image
	}
	if override.Restart != "" {
		result.Restart = override.Restart
	}
	if override.ContainerName != "" {
		result.ContainerName = override.ContainerName
	}
	if override.Command != nil {
		result.Command = override.Command
	}
	if override.Entrypoint != nil {
		result.Entrypoint = override.Entrypoint
	}
	if override.Healthcheck != nil {
		result.Healthcheck = override.Healthcheck
	}

	// Map fields: merge with override keys winning
	result.Environment = mergeMaps(base.Environment, override.Environment)
	result.Labels = mergeMaps(base.Labels, override.Labels)

	// List fields: override appends to base
	if override.Ports != nil {
		result.Ports = appendStringSlices(base.Ports, override.Ports)
	}
	if override.Volumes != nil {
		result.Volumes = appendStringSlices(base.Volumes, override.Volumes)
	}

	// Networks and depends_on: merge
	if override.Networks != nil {
		result.Networks = mergeListOrMap(base.Networks, override.Networks)
	}
	if override.DependsOn != nil {
		result.DependsOn = mergeListOrMap(base.DependsOn, override.DependsOn)
	}

	return result
}

// mergeMaps merges two interface{} values that can be either map or list form
// of environment/labels. Override keys win on conflict.
func mergeMaps(base, override interface{}) interface{} {
	if override == nil {
		return base
	}
	if base == nil {
		return override
	}

	baseMap := toStringMap(base)
	overrideMap := toStringMap(override)

	for k, v := range overrideMap {
		baseMap[k] = v
	}

	// Convert back to map[string]interface{} for YAML compatibility
	result := make(map[string]interface{})
	for k, v := range baseMap {
		result[k] = v
	}
	return result
}

// toStringMap converts environment/labels from either map or list form to map.
func toStringMap(v interface{}) map[string]string {
	result := make(map[string]string)

	switch val := v.(type) {
	case map[string]interface{}:
		for k, v := range val {
			if v == nil {
				result[k] = ""
			} else {
				result[k] = fmt.Sprintf("%v", v)
			}
		}
	case []interface{}:
		for _, item := range val {
			s := fmt.Sprintf("%v", item)
			key, value := splitEnvVar(s)
			result[key] = value
		}
	}

	return result
}

// mergeListOrMap merges networks or depends_on (can be list or map).
func mergeListOrMap(base, override interface{}) interface{} {
	if override == nil {
		return base
	}
	if base == nil {
		return override
	}

	// Convert both to string sets and merge
	baseSet := toStringSet(base)
	overrideSet := toStringSet(override)

	for k := range overrideSet {
		baseSet[k] = true
	}

	// Convert back to list
	result := make([]interface{}, 0, len(baseSet))
	for k := range baseSet {
		result = append(result, k)
	}
	return result
}

func toStringSet(v interface{}) map[string]bool {
	result := make(map[string]bool)
	switch val := v.(type) {
	case []interface{}:
		for _, item := range val {
			result[fmt.Sprintf("%v", item)] = true
		}
	case map[string]interface{}:
		for k := range val {
			result[k] = true
		}
	}
	return result
}

func appendStringSlices(base, override []string) []string {
	result := make([]string, 0, len(base)+len(override))
	result = append(result, base...)
	result = append(result, override...)
	return result
}
