// Package cluster implements a two-node active-passive cluster for dockercd.
// Neither node updates itself — each updates its peer, enabling zero-downtime
// self-updates of the dockercd binary/container.
package cluster

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"log/slog"
	"net"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const maxConcurrentConnections = 32

// ClusterConfig holds all configuration for the two-node cluster.
type ClusterConfig struct {
	Enabled           bool          `mapstructure:"enabled"`
	NodeID            string        `mapstructure:"node_id"`            // "node0" or "node1"
	PeerID            string        `mapstructure:"peer_id"`            // expected TLS identity and protocol node ID of the peer
	PeerAddr          string        `mapstructure:"peer_addr"`          // e.g., "node1:9090"
	ListenAddr        string        `mapstructure:"listen_addr"`        // e.g., ":9090"
	HeartbeatInterval time.Duration `mapstructure:"heartbeat_interval"` // default 60s
	MaxMissedBeats    int           `mapstructure:"max_missed_beats"`   // default 3
	PreferredLeader   string        `mapstructure:"preferred_leader"`   // e.g., "node0"
	DataDir           string        `mapstructure:"data_dir"`           // for SQLite backup sync
	TLSCertFile       string        `mapstructure:"tls_cert_file"`      // PEM certificate whose SAN contains NodeID
	TLSKeyFile        string        `mapstructure:"tls_key_file"`       // PEM private key for TLSCertFile
	TLSCAFile         string        `mapstructure:"tls_ca_file"`        // PEM CA used to authenticate the peer certificate
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
	serverTLS   *tls.Config
	clientTLS   *tls.Config
	connections chan struct{}
}

// Validate ensures that enabled cluster control has the identity and mutual
// TLS material needed to reject untrusted nodes. Cluster mode has no plaintext
// compatibility path because promotion controls Docker-backed workloads.
func (c ClusterConfig) Validate() error {
	if !c.Enabled {
		return nil
	}
	if strings.TrimSpace(c.NodeID) == "" {
		return fmt.Errorf("cluster.node_id must not be empty when cluster is enabled")
	}
	if strings.TrimSpace(c.PeerID) == "" {
		return fmt.Errorf("cluster.peer_id must not be empty when cluster is enabled")
	}
	if c.NodeID == c.PeerID {
		return fmt.Errorf("cluster.node_id and cluster.peer_id must differ")
	}
	if _, _, err := net.SplitHostPort(c.PeerAddr); err != nil {
		return fmt.Errorf("cluster.peer_addr must be host:port: %w", err)
	}
	if _, _, err := net.SplitHostPort(c.ListenAddr); err != nil {
		return fmt.Errorf("cluster.listen_addr must be host:port: %w", err)
	}
	if c.HeartbeatInterval <= 0 {
		return fmt.Errorf("cluster.heartbeat_interval must be positive")
	}
	if c.MaxMissedBeats < 1 {
		return fmt.Errorf("cluster.max_missed_beats must be at least 1")
	}
	if strings.TrimSpace(c.TLSCertFile) == "" || strings.TrimSpace(c.TLSKeyFile) == "" || strings.TrimSpace(c.TLSCAFile) == "" {
		return fmt.Errorf("cluster TLS certificate, key, and CA files are required when cluster is enabled")
	}
	return nil
}

// NewClusterNode creates a new cluster node with the given callbacks.
// onPromote is called when this node transitions to active.
// onDemote is called when this node transitions to passive.
func NewClusterNode(cfg ClusterConfig, onPromote, onDemote func(), logger *slog.Logger) *ClusterNode {
	n := &ClusterNode{
		config:      cfg,
		onPromote:   onPromote,
		onDemote:    onDemote,
		logger:      logger.With("component", "cluster", "node_id", cfg.NodeID),
		done:        make(chan struct{}),
		connections: make(chan struct{}, maxConcurrentConnections),
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
	if err := n.config.Validate(); err != nil {
		return fmt.Errorf("invalid cluster configuration: %w", err)
	}
	if err := n.configureTLS(); err != nil {
		return err
	}
	listener, err := n.startHeartbeatListener()
	if err != nil {
		return err
	}

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

	// The listener was bound before role activation, so a node cannot enter
	// cluster service with a missing control listener.
	go n.serveHeartbeat(ctx, listener)

	// Start DB replication in background
	go n.replicateDB(ctx)

	// Run peer monitor (blocks until ctx canceled)
	n.monitorPeer(ctx)

	close(n.done)
	return nil
}

// configureTLS creates separate immutable client and server configurations.
// TLS 1.3 plus certificate verification protects the role-control plane from
// eavesdropping and from peers that do not present the configured identity.
func (n *ClusterNode) configureTLS() error {
	certificate, err := tls.LoadX509KeyPair(n.config.TLSCertFile, n.config.TLSKeyFile)
	if err != nil {
		return fmt.Errorf("loading cluster TLS certificate: %w", err)
	}
	caPEM, err := os.ReadFile(n.config.TLSCAFile)
	if err != nil {
		return fmt.Errorf("reading cluster TLS CA: %w", err)
	}
	caPool := x509.NewCertPool()
	if !caPool.AppendCertsFromPEM(caPEM) {
		return fmt.Errorf("parsing cluster TLS CA: no certificates found")
	}

	n.serverTLS = &tls.Config{
		MinVersion:   tls.VersionTLS13,
		Certificates: []tls.Certificate{certificate},
		ClientCAs:    caPool,
		ClientAuth:   tls.RequireAndVerifyClientCert,
	}
	n.clientTLS = &tls.Config{
		MinVersion:   tls.VersionTLS13,
		Certificates: []tls.Certificate{certificate},
		RootCAs:      caPool,
		ServerName:   n.config.PeerID,
	}
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
	resp, err := n.sendMessage(MsgPromote)
	if err != nil {
		return err
	}
	if resp.Type == MsgAck {
		n.promote()
	}
	return nil
}
