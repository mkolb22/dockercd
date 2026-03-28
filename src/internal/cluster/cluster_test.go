package cluster

import (
	"bufio"
	"context"
	"fmt"
	"log/slog"
	"net"
	"os"
	"sync/atomic"
	"testing"
	"time"
)

func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelDebug}))
}

func testConfig(nodeID, peerAddr, listenAddr, preferred string) ClusterConfig {
	return ClusterConfig{
		Enabled:           true,
		NodeID:            nodeID,
		PeerAddr:          peerAddr,
		ListenAddr:        listenAddr,
		HeartbeatInterval: 100 * time.Millisecond, // fast for tests
		MaxMissedBeats:    3,
		PreferredLeader:   preferred,
		DataDir:           os.TempDir(),
	}
}

func TestNewClusterNode_Defaults(t *testing.T) {
	// Preferred leader should start as active
	n := NewClusterNode(testConfig("node0", "localhost:19090", ":19090", "node0"), nil, nil, testLogger())
	if n.Role() != "active" {
		t.Errorf("preferred leader should start as active, got %q", n.Role())
	}
	if !n.IsActive() {
		t.Error("IsActive should be true for preferred leader")
	}

	// Non-preferred should start as passive
	n2 := NewClusterNode(testConfig("node1", "localhost:19091", ":19091", "node0"), nil, nil, testLogger())
	if n2.Role() != "passive" {
		t.Errorf("non-preferred node should start as passive, got %q", n2.Role())
	}
	if n2.IsActive() {
		t.Error("IsActive should be false for non-preferred node")
	}
}

func TestHeartbeat_PeerAlive(t *testing.T) {
	// Start a fake peer that responds to heartbeats
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	peerAddr := listener.Addr().String()

	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				defer c.Close()
				scanner := bufio.NewScanner(c)
				if scanner.Scan() {
					fmt.Fprintf(c, "ACK fakepeer active\n")
				}
			}(conn)
		}
	}()

	cfg := testConfig("node0", peerAddr, ":0", "node0")
	n := NewClusterNode(cfg, nil, nil, testLogger())

	// Send a heartbeat
	resp, err := sendMessage(peerAddr, MsgHeartbeat, "node0")
	if err != nil {
		t.Fatalf("sendMessage failed: %v", err)
	}
	if resp.Type != MsgAck {
		t.Errorf("expected ACK, got %q", resp.Type)
	}
	if resp.NodeID != "fakepeer" {
		t.Errorf("expected nodeID 'fakepeer', got %q", resp.NodeID)
	}

	_ = n // used only to verify config construction
}

func TestHeartbeat_PeerDown(t *testing.T) {
	// Use an address that won't respond
	cfg := testConfig("node1", "127.0.0.1:19999", ":0", "node0")
	n := NewClusterNode(cfg, nil, nil, testLogger())

	// Simulate missed beats
	for i := 0; i < 3; i++ {
		_, err := sendMessage(n.config.PeerAddr, MsgHeartbeat, n.config.NodeID)
		if err == nil {
			t.Fatal("expected error connecting to non-existent peer")
		}
	}
}

func TestPromotion_OnPeerFailure(t *testing.T) {
	var promoted atomic.Bool

	cfg := testConfig("node1", "127.0.0.1:19998", ":0", "node0")
	n := NewClusterNode(cfg, func() { promoted.Store(true) }, nil, testLogger())

	// Verify starts as passive
	if n.IsActive() {
		t.Fatal("should start passive")
	}

	// Simulate enough missed beats to trigger failover
	n.mu.Lock()
	n.missedBeats = n.config.MaxMissedBeats
	n.mu.Unlock()
	n.peerAlive.Store(false)

	// This should promote since peer is down and we've missed enough beats
	n.promote()

	if !n.IsActive() {
		t.Error("should be active after promotion")
	}
	if !promoted.Load() {
		t.Error("onPromote callback should have been called")
	}
}

func TestDemotion_PreferredLeaderReturns(t *testing.T) {
	var demoted atomic.Bool

	// node1 is active but not the preferred leader
	cfg := testConfig("node1", "127.0.0.1:19997", ":0", "node0")
	n := NewClusterNode(cfg, nil, func() { demoted.Store(true) }, testLogger())

	// Force to active (simulating failover)
	n.role.Store("active")
	if !n.IsActive() {
		t.Fatal("should be active")
	}

	// Simulate preferred leader coming back alive
	n.peerAlive.Store(true)

	// Demote since preferred leader is back
	n.demote()

	if n.IsActive() {
		t.Error("should be passive after demotion")
	}
	if !demoted.Load() {
		t.Error("onDemote callback should have been called")
	}
}

func TestRoleCallbacks(t *testing.T) {
	var promoteCount, demoteCount int

	cfg := testConfig("node0", "127.0.0.1:19996", ":0", "node0")
	n := NewClusterNode(cfg, func() { promoteCount++ }, func() { demoteCount++ }, testLogger())

	// Already active (preferred leader), promote should be no-op
	n.promote()
	if promoteCount != 0 {
		t.Error("promote on already-active node should be no-op")
	}

	// Demote
	n.demote()
	if demoteCount != 1 {
		t.Errorf("expected 1 demote, got %d", demoteCount)
	}

	// Demote again should be no-op
	n.demote()
	if demoteCount != 1 {
		t.Errorf("demote on already-passive should be no-op, got %d", demoteCount)
	}

	// Promote
	n.promote()
	if promoteCount != 1 {
		t.Errorf("expected 1 promote, got %d", promoteCount)
	}
}

func TestPriorityElection(t *testing.T) {
	// When both nodes are alive, the preferred leader should always be active
	cfg0 := testConfig("node0", "127.0.0.1:19995", ":0", "node0")
	n0 := NewClusterNode(cfg0, nil, nil, testLogger())

	cfg1 := testConfig("node1", "127.0.0.1:19994", ":0", "node0")
	n1 := NewClusterNode(cfg1, nil, nil, testLogger())

	// node0 is preferred and starts active
	if !n0.IsActive() {
		t.Error("node0 (preferred) should be active")
	}
	if !n0.IsPreferredLeader() {
		t.Error("node0 should report as preferred leader")
	}

	// node1 is not preferred and starts passive
	if n1.IsActive() {
		t.Error("node1 (non-preferred) should be passive")
	}
	if n1.IsPreferredLeader() {
		t.Error("node1 should not report as preferred leader")
	}
}

func TestMessageParsing(t *testing.T) {
	tests := []struct {
		input    string
		wantType string
		wantNode string
		wantExtra string
		wantErr  bool
	}{
		{"HEARTBEAT node0", MsgHeartbeat, "node0", "", false},
		{"ACK node1 active", MsgAck, "node1", "active", false},
		{"PROMOTE node0", MsgPromote, "node0", "", false},
		{"DEMOTE node1", MsgDemote, "node1", "", false},
		{"STATUS node0", MsgStatus, "node0", "", false},
		{"INVALID node0", "", "", "", true},
		{"", "", "", "", true},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			msg, err := ParseMessage(tt.input)
			if tt.wantErr {
				if err == nil {
					t.Error("expected error")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if msg.Type != tt.wantType {
				t.Errorf("type: got %q, want %q", msg.Type, tt.wantType)
			}
			if msg.NodeID != tt.wantNode {
				t.Errorf("nodeID: got %q, want %q", msg.NodeID, tt.wantNode)
			}
			if msg.Extra != tt.wantExtra {
				t.Errorf("extra: got %q, want %q", msg.Extra, tt.wantExtra)
			}
		})
	}
}

func TestFormatMessage(t *testing.T) {
	got := FormatMessage(MsgHeartbeat, "node0", "")
	want := "HEARTBEAT node0\n"
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}

	got = FormatMessage(MsgAck, "node1", "active")
	want = "ACK node1 active\n"
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestHeartbeat_Integration(t *testing.T) {
	// Spin up two cluster nodes and verify they discover each other.
	// Use ephemeral ports to avoid conflicts.
	listener0, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr0 := listener0.Addr().String()
	listener0.Close()

	listener1, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr1 := listener1.Addr().String()
	listener1.Close()

	var n0Promoted, n1Promoted atomic.Bool

	cfg0 := ClusterConfig{
		Enabled:           true,
		NodeID:            "node0",
		PeerAddr:          addr1,
		ListenAddr:        addr0,
		HeartbeatInterval: 50 * time.Millisecond,
		MaxMissedBeats:    3,
		PreferredLeader:   "node0",
		DataDir:           t.TempDir(),
	}
	cfg1 := ClusterConfig{
		Enabled:           true,
		NodeID:            "node1",
		PeerAddr:          addr0,
		ListenAddr:        addr1,
		HeartbeatInterval: 50 * time.Millisecond,
		MaxMissedBeats:    3,
		PreferredLeader:   "node0",
		DataDir:           t.TempDir(),
	}

	n0 := NewClusterNode(cfg0, func() { n0Promoted.Store(true) }, nil, testLogger())
	n1 := NewClusterNode(cfg1, func() { n1Promoted.Store(true) }, nil, testLogger())

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	go n0.Start(ctx)
	go n1.Start(ctx)

	// Wait for a few heartbeat cycles
	time.Sleep(300 * time.Millisecond)

	// node0 should be active (preferred leader)
	if !n0.IsActive() {
		t.Error("node0 should be active")
	}
	// node1 should be passive
	if n1.IsActive() {
		t.Error("node1 should be passive")
	}

	cancel()
}
