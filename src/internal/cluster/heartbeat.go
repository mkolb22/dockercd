package cluster

import (
	"bufio"
	"context"
	"crypto/tls"
	"fmt"
	"net"
	"strings"
	"time"
)

// Message types for the cluster heartbeat protocol.
const (
	MsgHeartbeat = "HEARTBEAT" // periodic liveness check
	MsgPromote   = "PROMOTE"   // "take over, I'm stepping down"
	MsgDemote    = "DEMOTE"    // "I'm back, step down"
	MsgStatus    = "STATUS"    // request peer's current role
	MsgAck       = "ACK"       // acknowledgment
)

const (
	dialTimeout    = 2 * time.Second
	readTimeout    = 3 * time.Second
	maxMessageSize = 4 << 10
)

// Message represents a parsed cluster protocol message.
type Message struct {
	Type   string
	NodeID string
	Extra  string // role info in ACK messages
}

// ParseMessage parses a newline-delimited message.
// Format: "TYPE nodeID [extra]\n"
func ParseMessage(raw string) (Message, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return Message{}, fmt.Errorf("empty message")
	}

	parts := strings.SplitN(raw, " ", 3)
	msg := Message{Type: parts[0]}
	if len(parts) >= 2 {
		msg.NodeID = parts[1]
	}
	if len(parts) >= 3 {
		msg.Extra = parts[2]
	}

	switch msg.Type {
	case MsgHeartbeat, MsgPromote, MsgDemote, MsgStatus, MsgAck:
		if msg.NodeID == "" {
			return Message{}, fmt.Errorf("cluster message %q is missing node ID", msg.Type)
		}
		return msg, nil
	default:
		return Message{}, fmt.Errorf("unknown message type: %q", msg.Type)
	}
}

// FormatMessage formats a message for transmission.
func FormatMessage(msgType, nodeID, extra string) string {
	if extra != "" {
		return fmt.Sprintf("%s %s %s\n", msgType, nodeID, extra)
	}
	return fmt.Sprintf("%s %s\n", msgType, nodeID)
}

// sendMessage opens a mutually authenticated TLS connection to the configured
// peer, sends a message, and validates the response identity. Each message is
// a fresh connection, keeping the small control protocol bounded and simple.
func (n *ClusterNode) sendMessage(msgType string) (Message, error) {
	if n.clientTLS == nil {
		return Message{}, fmt.Errorf("cluster TLS is not configured")
	}
	ctx, cancel := context.WithTimeout(context.Background(), dialTimeout+readTimeout)
	defer cancel()
	conn, err := tls.DialWithDialer(&net.Dialer{Timeout: dialTimeout}, "tcp", n.config.PeerAddr, n.clientTLS)
	if err != nil {
		return Message{}, fmt.Errorf("dial cluster peer: %w", err)
	}
	defer conn.Close()

	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(deadline)
	}

	_, err = fmt.Fprint(conn, FormatMessage(msgType, n.config.NodeID, ""))
	if err != nil {
		return Message{}, fmt.Errorf("write to cluster peer: %w", err)
	}

	scanner := bufio.NewScanner(conn)
	scanner.Buffer(make([]byte, 512), maxMessageSize)
	if scanner.Scan() {
		response, err := ParseMessage(scanner.Text())
		if err != nil {
			return Message{}, err
		}
		if response.NodeID != n.config.PeerID {
			return Message{}, fmt.Errorf("cluster response node ID %q does not match configured peer %q", response.NodeID, n.config.PeerID)
		}
		return response, nil
	}
	if err := scanner.Err(); err != nil {
		return Message{}, fmt.Errorf("read from cluster peer: %w", err)
	}
	return Message{}, fmt.Errorf("no response from cluster peer")
}

// handleHeartbeat runs the TCP listener that accepts heartbeat and control messages.
func (n *ClusterNode) handleHeartbeat(ctx context.Context) {
	listener, err := n.startHeartbeatListener()
	if err != nil {
		n.logger.Error("failed to start heartbeat listener", "addr", n.config.ListenAddr, "error", err)
		return
	}
	n.serveHeartbeat(ctx, listener)
}

func (n *ClusterNode) startHeartbeatListener() (net.Listener, error) {
	if n.serverTLS == nil {
		return nil, fmt.Errorf("cluster TLS is not configured")
	}
	listener, err := tls.Listen("tcp", n.config.ListenAddr, n.serverTLS)
	if err != nil {
		return nil, fmt.Errorf("listen on %s: %w", n.config.ListenAddr, err)
	}
	return listener, nil
}

func (n *ClusterNode) serveHeartbeat(ctx context.Context, listener net.Listener) {
	defer listener.Close()

	n.logger.Info("heartbeat listener started", "addr", n.config.ListenAddr)

	// Close listener when context is canceled
	go func() {
		<-ctx.Done()
		listener.Close()
	}()

	for {
		conn, err := listener.Accept()
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			n.logger.Debug("heartbeat accept error", "error", err)
			continue
		}
		select {
		case n.connections <- struct{}{}:
			go func() {
				defer func() { <-n.connections }()
				n.handleConnection(conn)
			}()
		default:
			// Do not create unbounded goroutines for unauthenticated network input.
			_ = conn.Close()
			n.logger.Debug("cluster connection rejected: admission limit reached")
		}
	}
}

// handleConnection processes a single inbound cluster message.
func (n *ClusterNode) handleConnection(conn net.Conn) {
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(readTimeout))

	tlsConn, ok := conn.(*tls.Conn)
	if !ok {
		n.logger.Debug("rejected non-TLS cluster connection")
		return
	}
	if err := tlsConn.Handshake(); err != nil {
		n.logger.Debug("cluster TLS handshake failed", "error", err)
		return
	}
	state := tlsConn.ConnectionState()
	if len(state.PeerCertificates) == 0 {
		n.logger.Debug("cluster peer did not present a certificate")
		return
	}
	if err := state.PeerCertificates[0].VerifyHostname(n.config.PeerID); err != nil {
		n.logger.Debug("cluster peer TLS identity rejected", "error", err)
		return
	}

	scanner := bufio.NewScanner(conn)
	scanner.Buffer(make([]byte, 512), maxMessageSize)
	if !scanner.Scan() {
		return
	}

	msg, err := ParseMessage(scanner.Text())
	if err != nil {
		n.logger.Debug("invalid cluster message", "error", err)
		return
	}
	if msg.NodeID != n.config.PeerID {
		n.logger.Debug("cluster protocol identity rejected", "node_id", msg.NodeID)
		return
	}

	var response string
	switch msg.Type {
	case MsgHeartbeat:
		// Peer is alive and checking on us
		n.peerAlive.Store(true)
		response = FormatMessage(MsgAck, n.config.NodeID, n.Role())

	case MsgPromote:
		// Peer is asking us to take over (it's stepping down)
		n.logger.Info("received PROMOTE request from peer", "peer", msg.NodeID)
		n.promote()
		response = FormatMessage(MsgAck, n.config.NodeID, n.Role())

	case MsgDemote:
		// Peer is back and asking us to step down
		n.logger.Info("received DEMOTE request from peer", "peer", msg.NodeID)
		n.demote()
		response = FormatMessage(MsgAck, n.config.NodeID, n.Role())

	case MsgStatus:
		response = FormatMessage(MsgAck, n.config.NodeID, n.Role())

	default:
		response = FormatMessage(MsgAck, n.config.NodeID, "unknown")
	}

	_, _ = fmt.Fprint(conn, response)
}

// monitorPeer sends heartbeats to the peer on a regular interval and manages
// the leader election state machine.
func (n *ClusterNode) monitorPeer(ctx context.Context) {
	ticker := time.NewTicker(n.config.HeartbeatInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			resp, err := n.sendMessage(MsgHeartbeat)
			if err != nil {
				n.mu.Lock()
				n.missedBeats++
				missed := n.missedBeats
				n.mu.Unlock()

				n.logger.Warn("peer heartbeat missed",
					"peer_addr", n.config.PeerAddr,
					"missed_beats", missed,
					"max_missed", n.config.MaxMissedBeats,
				)

				if missed >= n.config.MaxMissedBeats {
					n.peerAlive.Store(false)
					if !n.IsActive() {
						n.logger.Info("peer unreachable, promoting self")
						n.promote()
					}
				}
			} else {
				n.mu.Lock()
				n.missedBeats = 0
				n.mu.Unlock()
				n.peerAlive.Store(true)

				n.logger.Debug("peer heartbeat OK",
					"peer_role", resp.Extra,
					"my_role", n.Role(),
				)

				// If I'm active but the peer is the preferred leader and it's alive, demote
				if n.IsActive() && n.config.PreferredLeader != n.config.NodeID && n.peerAlive.Load() {
					n.logger.Info("preferred leader is alive, demoting self",
						"preferred", n.config.PreferredLeader,
					)
					n.demote()
				}
			}
		}
	}
}
