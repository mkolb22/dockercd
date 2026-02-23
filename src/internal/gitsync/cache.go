package gitsync

import (
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
)

// RepoCache manages the local filesystem cache of cloned repositories.
// Each repository is stored in a directory named by a deterministic hash
// of its URL, under the configured cache root.
type RepoCache struct {
	root string
}

// NewRepoCache creates a RepoCache rooted at the given directory.
// The directory is created if it does not exist.
func NewRepoCache(root string) (*RepoCache, error) {
	if err := os.MkdirAll(root, 0750); err != nil {
		return nil, fmt.Errorf("creating cache dir %q: %w", root, err)
	}
	return &RepoCache{root: root}, nil
}

// PathFor returns the local filesystem path where the given repo URL will be cached.
func (c *RepoCache) PathFor(repoURL string) string {
	return filepath.Join(c.root, urlHash(repoURL))
}

// Exists reports whether a cached clone exists for the given repo URL.
func (c *RepoCache) Exists(repoURL string) bool {
	path := c.PathFor(repoURL)
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

// Remove deletes the cached clone for the given repo URL.
func (c *RepoCache) Remove(repoURL string) error {
	return os.RemoveAll(c.PathFor(repoURL))
}

// urlHash returns a deterministic, filesystem-safe hash of a URL.
// Uses the first 16 chars of the SHA-256 hex digest.
func urlHash(url string) string {
	h := sha256.Sum256([]byte(url))
	return fmt.Sprintf("%x", h[:8])
}
