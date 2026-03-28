package cluster

// Priority-based leader election for a two-node cluster.
//
// Two nodes cannot do majority quorum (Raft needs 3+), so we use a simpler
// priority-based approach:
//
// 1. One node is the "preferred leader" (typically node0).
// 2. When both nodes are alive, the preferred leader is always active.
// 3. When the preferred leader goes down (MaxMissedBeats heartbeats missed),
//    the other node promotes itself.
// 4. When the preferred leader comes back, the non-preferred node demotes.
//
// This avoids split-brain because:
//   - The non-preferred node always yields when the preferred node is alive.
//   - There's a clear, deterministic winner for any given state.
//
// Trade-off: if the preferred node is flapping (up/down rapidly), leadership
// will oscillate. The heartbeat interval (60s) and miss threshold (3 = 3 min)
// provide enough dampening for real-world scenarios.

// IsPreferredLeader returns true if this node is the configured preferred leader.
func (n *ClusterNode) IsPreferredLeader() bool {
	return n.config.PreferredLeader == n.config.NodeID
}

// PeerIsAlive returns true if the peer's last heartbeat was successful.
func (n *ClusterNode) PeerIsAlive() bool {
	return n.peerAlive.Load()
}

// MissedBeats returns the current number of consecutive missed heartbeats.
func (n *ClusterNode) MissedBeats() int {
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.missedBeats
}
