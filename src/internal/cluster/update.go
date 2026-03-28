package cluster

import (
	"context"
	"fmt"
	"io"
	"time"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/image"
	"github.com/docker/docker/client"
)

const (
	healthCheckTimeout  = 2 * time.Minute
	healthCheckInterval = 5 * time.Second
)

// UpdatePeer updates the peer node's container to a new image.
// This is the core of the self-update mechanism: the active node updates the
// passive node's container, and vice versa.
func (n *ClusterNode) UpdatePeer(ctx context.Context, cli *client.Client, containerName, newImage string) error {
	n.logger.Info("updating peer container",
		"container", containerName,
		"new_image", newImage,
	)

	// 1. Pull the new image
	n.logger.Info("pulling new image", "image", newImage)
	pullResp, err := cli.ImagePull(ctx, newImage, image.PullOptions{})
	if err != nil {
		return fmt.Errorf("pulling image %s: %w", newImage, err)
	}
	_, _ = io.Copy(io.Discard, pullResp)
	pullResp.Close()

	// 2. Inspect current container to preserve its config
	inspect, err := cli.ContainerInspect(ctx, containerName)
	if err != nil {
		return fmt.Errorf("inspecting container %s: %w", containerName, err)
	}

	// 3. Stop the peer container
	n.logger.Info("stopping peer container", "container", containerName)
	stopTimeout := 30
	if err := cli.ContainerStop(ctx, containerName, container.StopOptions{Timeout: &stopTimeout}); err != nil {
		return fmt.Errorf("stopping container %s: %w", containerName, err)
	}

	// 4. Remove the old container
	if err := cli.ContainerRemove(ctx, containerName, container.RemoveOptions{}); err != nil {
		return fmt.Errorf("removing container %s: %w", containerName, err)
	}

	// 5. Create new container with same config but new image
	config := inspect.Config
	config.Image = newImage

	n.logger.Info("creating new peer container", "container", containerName, "image", newImage)
	createResp, err := cli.ContainerCreate(ctx, config, inspect.HostConfig, nil, nil, containerName)
	if err != nil {
		return fmt.Errorf("creating container %s: %w", containerName, err)
	}

	// 6. Start the new container
	if err := cli.ContainerStart(ctx, createResp.ID, container.StartOptions{}); err != nil {
		return fmt.Errorf("starting container %s: %w", containerName, err)
	}

	// 7. Wait for the peer to come back online (poll heartbeat)
	n.logger.Info("waiting for peer to become healthy")
	if err := n.waitForPeerHealth(ctx); err != nil {
		return fmt.Errorf("peer health check failed after update: %w", err)
	}

	n.logger.Info("peer update complete", "container", containerName, "image", newImage)
	return nil
}

// RollingUpdate performs a zero-downtime update of both nodes.
//
// Flow:
//  1. Active node tells passive to promote (become active temporarily)
//  2. The now-active peer updates the original active node's container
//  3. Original node comes back and reclaims leadership
//  4. Original (now active again) updates the peer's container
//
// This method should be called on the active node. The peer performs the
// actual container update via the Docker SDK since a container cannot
// reliably update itself.
func (n *ClusterNode) RollingUpdate(ctx context.Context, cli *client.Client, myContainerName, peerContainerName, newImage string) error {
	if !n.IsActive() {
		return fmt.Errorf("rolling update must be initiated from the active node")
	}

	n.logger.Info("starting rolling update",
		"my_container", myContainerName,
		"peer_container", peerContainerName,
		"new_image", newImage,
	)

	// Step 1: Update the passive peer first
	n.logger.Info("step 1: updating passive peer")
	if err := n.UpdatePeer(ctx, cli, peerContainerName, newImage); err != nil {
		return fmt.Errorf("updating passive peer: %w", err)
	}

	// Step 2: Tell the peer to promote (become active)
	n.logger.Info("step 2: promoting peer to active")
	resp, err := sendMessage(n.config.PeerAddr, MsgPromote, n.config.NodeID)
	if err != nil {
		return fmt.Errorf("requesting peer promotion: %w", err)
	}
	if resp.Extra != "active" {
		return fmt.Errorf("peer did not promote, role=%s", resp.Extra)
	}

	// Step 3: Demote ourselves — the peer will update our container
	n.logger.Info("step 3: demoting self, peer will update our container")
	n.demote()

	// At this point, the now-active peer is responsible for updating our container.
	// When we come back from the container restart, the monitorPeer loop will
	// reclaim leadership (since we're the preferred leader) automatically.

	n.logger.Info("rolling update phase 1 complete — peer is now active and will update us")
	return nil
}

// waitForPeerHealth polls the peer's heartbeat endpoint until it responds
// or the timeout is reached.
func (n *ClusterNode) waitForPeerHealth(ctx context.Context) error {
	deadline := time.After(healthCheckTimeout)
	ticker := time.NewTicker(healthCheckInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-deadline:
			return fmt.Errorf("peer did not become healthy within %s", healthCheckTimeout)
		case <-ticker.C:
			_, err := sendMessage(n.config.PeerAddr, MsgStatus, n.config.NodeID)
			if err == nil {
				return nil
			}
			n.logger.Debug("waiting for peer health", "error", err)
		}
	}
}
