// Package cluster implements a two-node active-passive cluster for dockercd.
// Neither node updates itself — each updates its peer, enabling zero-downtime
// self-updates of the dockercd binary/container.
package cluster

import (
	"context"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"
)

// ClusterConfig holds all configuration for the two-node cluster.
type ClusterConfig struct {
	Enabled           bool          `mapstructure:"enabled"`
	NodeID            string        `mapstructure:"node_id"`             // "node0" or "node1"
	PeerAddr          string        `mapstructure:"peer_addr"`           // e.g., "node1:9090"
	ListenAddr        string        `mapstructure:"listen_addr"`         // e.g., ":9090"
	HeartbeatInterval time.Duration `mapstructure:"heartbeat_interval"`  // default 60s
	MaxMissedBeats    int           `mapstructure:"max_missed_beats"`    // default 3
	PreferredLeader   string        `mapstructure:"preferred_leader"`    // e.g., "node0"
	DataDir           string        `mapstructure:"data_dir"`            // for SQLite backup sync
}

// ClusterNode manages the active/passive state machine for one node.
type ClusterNode struct {
	config      ClusterConfig
	role        atomic.Value // stores string: "active" or "passive"
	peerAlive   atomic.Bool
	missedBeats int
	mu          sync.Mutex
	onPromote   func() // callback when this node becomes active
	onDemote    func() // callback when this node becomes passive
	logger      *slog.Logger
	cancel      context.CancelFunc
	done        chan struct{}
}

// NewClusterNode creates a new cluster node with the given callbacks.
// onPromote is called when this node transitions to active.
// onDemote is called when this node transitions to passive.
func NewClusterNode(cfg ClusterConfig, onPromote, onDemote func(), logger *slog.Logger) *ClusterNode {
	n := &ClusterNode{
		config:    cfg,
		onPromote: onPromote,
		onDemote:  onDemote,
		logger:    logger.With("component", "cluster", "node_id", cfg.NodeID),
		done:      make(chan struct{}),
	}

	// The preferred leader starts as active; the other starts as passive
	if cfg.PreferredLeader == cfg.NodeID {
		n.role.Store("active")
	} else {
		n.role.Store("passive")
	}

	return n
}

// Start begins the heartbeat listener and peer monitor goroutines.
// It blocks until ctx is canceled.
func (n *ClusterNode) Start(ctx context.Context) error {
	ctx, n.cancel = context.WithCancel(ctx)

	n.logger.Info("cluster node starting",
		"role", n.Role(),
		"peer_addr", n.config.PeerAddr,
		"listen_addr", n.config.ListenAddr,
		"preferred_leader", n.config.PreferredLeader,
		"heartbeat_interval", n.config.HeartbeatInterval,
		"max_missed_beats", n.config.MaxMissedBeats,
	)

	// If we start as active, fire the promote callback immediately
	if n.IsActive() {
		n.logger.Info("starting as active node, running promote callback")
		if n.onPromote != nil {
			n.onPromote()
		}
	} else {
		n.logger.Info("starting as passive node")
	}

	// Start heartbeat listener in background
	go n.handleHeartbeat(ctx)

	// Start DB replication in background
	go n.replicateDB(ctx)

	// Run peer monitor (blocks until ctx canceled)
	n.monitorPeer(ctx)

	close(n.done)
	return nil
}

// Stop cancels the cluster node and waits for goroutines to finish.
func (n *ClusterNode) Stop() {
	if n.cancel != nil {
		n.cancel()
	}
	<-n.done
}

// Role returns the current role: "active" or "passive".
func (n *ClusterNode) Role() string {
	if v := n.role.Load(); v != nil {
		return v.(string)
	}
	return "passive"
}

// IsActive returns true if this node is the active (leader) node.
func (n *ClusterNode) IsActive() bool {
	return n.Role() == "active"
}

// PeerAddr returns the cluster address of the peer node.
func (n *ClusterNode) PeerAddr() string {
	return n.config.PeerAddr
}

// promote transitions this node to active and fires the callback.
func (n *ClusterNode) promote() {
	n.mu.Lock()
	defer n.mu.Unlock()

	if n.IsActive() {
		return
	}

	n.logger.Info("promoting to active")
	n.role.Store("active")
	if n.onPromote != nil {
		n.onPromote()
	}
}

// demote transitions this node to passive and fires the callback.
func (n *ClusterNode) demote() {
	n.mu.Lock()
	defer n.mu.Unlock()

	if !n.IsActive() {
		return
	}

	n.logger.Info("demoting to passive")
	n.role.Store("passive")
	if n.onDemote != nil {
		n.onDemote()
	}
}

// RequestPromotion asks the peer to demote so this node can promote.
// Sends a PROMOTE message to the peer, then promotes locally on ACK.
func (n *ClusterNode) RequestPromotion() error {
	n.logger.Info("requesting promotion from peer")
	resp, err := sendMessage(n.config.PeerAddr, MsgPromote, n.config.NodeID)
	if err != nil {
		return err
	}
	if resp.Type == MsgAck {
		n.promote()
	}
	return nil
}
