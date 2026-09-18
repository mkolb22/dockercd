package inspector

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	gohttp "net/http"
	"net/url"
	"path"
	"strconv"
	"strings"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/filters"
	"github.com/docker/docker/api/types/system"
	"github.com/docker/docker/client"
)

var errCapacityResponseTooLarge = errors.New("capacity metadata response exceeds limit")

// capacityMetadataClient is deliberately separate from DockerClient. The
// ordinary SDK metadata methods decode an unbounded response; capacity samples
// must not use them.
type capacityMetadataClient interface {
	CapacityInfo(context.Context) (system.Info, error)
	CapacityContainerList(context.Context, container.ListOptions) ([]container.Summary, error)
}

// boundedCapacityClient preserves the normal Docker SDK for established
// inspector paths while using a bounded raw decoder for capacity metadata.
// It is created only by the production client factory.
type boundedCapacityClient struct {
	*client.Client
	tls bool
}

func (c *boundedCapacityClient) CapacityInfo(ctx context.Context) (system.Info, error) {
	var info system.Info
	if err := c.decodeMetadata(ctx, "/info", nil, &info); err != nil {
		return system.Info{}, err
	}
	return info, nil
}

func (c *boundedCapacityClient) CapacityContainerList(ctx context.Context, options container.ListOptions) ([]container.Summary, error) {
	query := url.Values{}
	if options.All {
		query.Set("all", "1")
	}
	if options.Limit > 0 {
		query.Set("limit", strconv.Itoa(options.Limit))
	}
	if options.Filters.Len() > 0 {
		filterJSON, err := filters.ToParamWithVersion(c.ClientVersion(), options.Filters) //nolint:staticcheck // Docker API compatibility helper
		if err != nil {
			return nil, err
		}
		query.Set("filters", filterJSON)
	}
	var containers []container.Summary
	if err := c.decodeMetadata(ctx, "/containers/json", query, &containers); err != nil {
		return nil, err
	}
	return containers, nil
}

func (c *boundedCapacityClient) decodeMetadata(ctx context.Context, endpoint string, query url.Values, destination any) error {
	// Keep the API version aligned with the primary SDK client. Ping responses
	// are tiny protocol negotiation, while the two metadata responses below are
	// read with the explicit capacity ceiling.
	c.NegotiateAPIVersion(ctx)
	host, err := client.ParseHostURL(c.DaemonHost())
	if err != nil {
		return fmt.Errorf("parsing docker host: %w", err)
	}
	scheme := "http"
	if c.tls {
		scheme = "https"
	}
	requestHost := host.Host
	if host.Scheme == "unix" || host.Scheme == "npipe" {
		// The SDK-configured transport routes this synthetic HTTP host to the
		// local socket. Do not expose the socket path in a request host header.
		requestHost = "docker"
	}
	requestPath := path.Join(host.Path, "v"+strings.TrimPrefix(c.ClientVersion(), "v"), endpoint)
	if c.ClientVersion() == "" {
		requestPath = path.Join(host.Path, endpoint)
	}
	requestURL := (&url.URL{Scheme: scheme, Host: requestHost, Path: requestPath, RawQuery: query.Encode()}).String()
	req, err := gohttp.NewRequestWithContext(ctx, gohttp.MethodGet, requestURL, nil)
	if err != nil {
		return fmt.Errorf("creating docker metadata request: %w", err)
	}
	response, err := c.HTTPClient().Do(req)
	if err != nil {
		return fmt.Errorf("requesting docker metadata: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < gohttp.StatusOK || response.StatusCode >= gohttp.StatusMultipleChoices {
		return fmt.Errorf("docker metadata returned HTTP %d", response.StatusCode)
	}
	return decodeCapacityJSON(response.Body, response.ContentLength, destination)
}

func decodeCapacityJSON(body io.Reader, contentLength int64, destination any) error {
	if contentLength > capacityMaxBody {
		return errCapacityResponseTooLarge
	}
	data, err := io.ReadAll(io.LimitReader(body, capacityMaxBody+1))
	if err != nil {
		return fmt.Errorf("reading capacity metadata: %w", err)
	}
	if len(data) > capacityMaxBody {
		return errCapacityResponseTooLarge
	}
	if err := json.Unmarshal(data, destination); err != nil {
		return fmt.Errorf("decoding capacity metadata: %w", err)
	}
	return nil
}
