package cluster

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

const (
	replicationInterval = 5 * time.Minute
	dbFileName          = "dockercd.db"
	dbSyncPath          = "/cluster/db-sync"
)

// replicateDB periodically copies the SQLite database from the active node
// to the passive node using the SQLite backup mechanism.
// The active node POSTs the DB file to the passive node's HTTP endpoint.
func (n *ClusterNode) replicateDB(ctx context.Context) {
	ticker := time.NewTicker(replicationInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if !n.IsActive() {
				continue
			}

			if err := n.sendDBBackup(ctx); err != nil {
				n.logger.Warn("db replication failed", "error", err)
			} else {
				n.logger.Debug("db replication successful")
			}
		}
	}
}

// sendDBBackup reads the SQLite database file and POSTs it to the peer.
func (n *ClusterNode) sendDBBackup(ctx context.Context) error {
	dbPath := filepath.Join(n.config.DataDir, dbFileName)

	f, err := os.Open(dbPath)
	if err != nil {
		return fmt.Errorf("opening db file: %w", err)
	}
	defer f.Close()

	url := fmt.Sprintf("http://%s%s", n.config.PeerAddr, dbSyncPath)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, f)
	if err != nil {
		return fmt.Errorf("creating request: %w", err)
	}
	req.Header.Set("Content-Type", "application/octet-stream")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("sending db backup: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("peer returned %d: %s", resp.StatusCode, string(body))
	}

	return nil
}

// HandleDBSync is an HTTP handler for receiving a database backup from the active node.
// Mount this at POST /cluster/db-sync on the passive node.
func (n *ClusterNode) HandleDBSync(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Only passive nodes should accept DB syncs
	if n.IsActive() {
		http.Error(w, "active node cannot accept db sync", http.StatusConflict)
		return
	}

	dbPath := filepath.Join(n.config.DataDir, dbFileName)
	tmpPath := dbPath + ".tmp"

	f, err := os.Create(tmpPath)
	if err != nil {
		n.logger.Error("failed to create temp db file", "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	if _, err := io.Copy(f, r.Body); err != nil {
		f.Close()
		os.Remove(tmpPath)
		n.logger.Error("failed to write db backup", "error", err)
		http.Error(w, "write error", http.StatusInternalServerError)
		return
	}
	f.Close()

	// Atomically replace the database file
	if err := os.Rename(tmpPath, dbPath); err != nil {
		os.Remove(tmpPath)
		n.logger.Error("failed to rename db backup", "error", err)
		http.Error(w, "rename error", http.StatusInternalServerError)
		return
	}

	n.logger.Info("received db backup from active node")
	w.WriteHeader(http.StatusOK)
}
