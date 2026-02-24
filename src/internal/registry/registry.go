// Package registry provides Docker image tag checking and image update automation.
package registry

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// TagChecker checks a Docker registry for available tags.
type TagChecker interface {
	// ListTags returns all tags for the given image.
	ListTags(ctx context.Context, image string) ([]string, error)
}

// DockerHubChecker checks Docker Hub for image tags.
type DockerHubChecker struct {
	client *http.Client
}

// NewDockerHubChecker creates a DockerHubChecker.
func NewDockerHubChecker() *DockerHubChecker {
	return &DockerHubChecker{
		client: &http.Client{Timeout: 30 * time.Second},
	}
}

// ListTags returns all tags for a Docker Hub image.
func (c *DockerHubChecker) ListTags(ctx context.Context, image string) ([]string, error) {
	// Normalize image name: "nginx" → "library/nginx"
	parts := strings.SplitN(image, "/", 2)
	namespace := "library"
	name := image
	if len(parts) == 2 {
		namespace = parts[0]
		name = parts[1]
	}

	url := fmt.Sprintf("https://hub.docker.com/v2/repositories/%s/%s/tags?page_size=100", namespace, name)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("docker hub request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16)) // 64 KiB max error body
		return nil, fmt.Errorf("docker hub returned %d: %s", resp.StatusCode, string(body))
	}

	var result struct {
		Results []struct {
			Name string `json:"name"`
		} `json:"results"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decoding docker hub response: %w", err)
	}

	tags := make([]string, 0, len(result.Results))
	for _, r := range result.Results {
		tags = append(tags, r.Name)
	}
	return tags, nil
}

// GenericRegistryChecker checks a Docker Registry v2 API for image tags.
type GenericRegistryChecker struct {
	registryURL string
	client      *http.Client
}

// NewGenericRegistryChecker creates a checker for a private registry.
func NewGenericRegistryChecker(registryURL string) *GenericRegistryChecker {
	return &GenericRegistryChecker{
		registryURL: strings.TrimRight(registryURL, "/"),
		client:      &http.Client{Timeout: 30 * time.Second},
	}
}

// ListTags returns all tags for an image in a private registry.
func (c *GenericRegistryChecker) ListTags(ctx context.Context, image string) ([]string, error) {
	url := fmt.Sprintf("%s/v2/%s/tags/list", c.registryURL, image)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("registry request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16)) // 64 KiB max error body
		return nil, fmt.Errorf("registry returned %d: %s", resp.StatusCode, string(body))
	}

	var result struct {
		Tags []string `json:"tags"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decoding registry response: %w", err)
	}

	return result.Tags, nil
}

// ParseImageRef splits an image reference into name and tag.
// Examples:
//
//	"nginx:1.26"             → ("nginx", "1.26")
//	"myregistry.com/app:v1"  → ("myregistry.com/app", "v1")
//	"nginx"                  → ("nginx", "latest")
func ParseImageRef(image string) (name, tag string) {
	// Handle digest references
	if idx := strings.IndexByte(image, '@'); idx >= 0 {
		return image[:idx], ""
	}

	if idx := strings.LastIndexByte(image, ':'); idx >= 0 {
		// Make sure the colon is after any slash (not a port in a registry URL with no path)
		slashIdx := strings.LastIndexByte(image, '/')
		if idx > slashIdx {
			return image[:idx], image[idx+1:]
		}
	}
	return image, "latest"
}
