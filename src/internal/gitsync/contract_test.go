// contract_test.go — Contract tests for the gitsync package.
// Generated from ZenSpec "git-sync".
//
// Tests the pure properties of RepoPath and the RepoCache helper functions.
package gitsync

import (
	"os"
	"path/filepath"
	"testing"

	"pgregory.net/rapid"
)

// --- Contract: urlHash ---

// TestContract_URLHashDeterministic verifies same URL produces same hash.
func TestContract_URLHashDeterministic(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		url := rapid.StringMatching(`https://[a-z]{3,10}\.[a-z]{2,5}/[a-z]{2,8}/[a-z]{2,8}\.git`).Draw(t, "url")
		h1 := urlHash(url)
		h2 := urlHash(url)
		if h1 != h2 {
			t.Fatalf("urlHash not deterministic: %q → %q vs %q", url, h1, h2)
		}
	})
}

// TestContract_URLHashUniqueForDifferentURLs verifies different URLs get different hashes.
func TestContract_URLHashUniqueForDifferentURLs(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		url1 := rapid.StringMatching(`https://github\.com/[a-z]{3,10}/[a-z]{3,10}\.git`).Draw(t, "url1")
		url2 := rapid.StringMatching(`https://gitlab\.com/[a-z]{3,10}/[a-z]{3,10}\.git`).Draw(t, "url2")
		if url1 == url2 {
			return // skip identical
		}
		h1 := urlHash(url1)
		h2 := urlHash(url2)
		if h1 == h2 {
			t.Fatalf("hash collision: %q and %q both → %q", url1, url2, h1)
		}
	})
}

// TestContract_URLHashLength verifies hash is always 16 hex chars.
func TestContract_URLHashLength(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		url := rapid.String().Draw(t, "url")
		h := urlHash(url)
		if len(h) != 16 {
			t.Fatalf("urlHash(%q) length = %d, want 16", url, len(h))
		}
	})
}

// --- Contract: RepoCache.PathFor ---

// TestContract_PathForDeterministic verifies same URL returns same path.
func TestContract_PathForDeterministic(t *testing.T) {
	cache := &RepoCache{root: "/tmp/test-cache"}
	rapid.Check(t, func(t *rapid.T) {
		url := rapid.StringMatching(`https://[a-z]{3,10}\.com/[a-z]{2,8}/[a-z]{2,8}\.git`).Draw(t, "url")
		p1 := cache.PathFor(url)
		p2 := cache.PathFor(url)
		if p1 != p2 {
			t.Fatalf("PathFor not deterministic: %q → %q vs %q", url, p1, p2)
		}
	})
}

// TestContract_PathForUnderRoot verifies path is always under cache root.
func TestContract_PathForUnderRoot(t *testing.T) {
	root := "/tmp/test-cache"
	cache := &RepoCache{root: root}
	rapid.Check(t, func(t *rapid.T) {
		url := rapid.String().Draw(t, "url")
		p := cache.PathFor(url)
		dir := filepath.Dir(p)
		if dir != root {
			t.Fatalf("PathFor parent should be %q, got %q", root, dir)
		}
	})
}

// --- Contract: RepoPath ---

// TestContract_RepoPathUnknownReturnsEmpty verifies unknown repos return "".
func TestContract_RepoPathUnknownReturnsEmpty(t *testing.T) {
	cacheDir := t.TempDir()
	cache, err := NewRepoCache(cacheDir)
	if err != nil {
		t.Fatalf("NewRepoCache: %v", err)
	}
	syncer := &GoGitSyncer{cache: cache}
	result := syncer.RepoPath("https://github.com/unknown/repo.git")
	if result != "" {
		t.Fatalf("unknown repo should return empty, got %q", result)
	}
}

// TestContract_RepoPathExistingDirReturnsPath verifies existing cached dir returns path.
func TestContract_RepoPathExistingDirReturnsPath(t *testing.T) {
	cacheDir := t.TempDir()
	cache, err := NewRepoCache(cacheDir)
	if err != nil {
		t.Fatalf("NewRepoCache: %v", err)
	}

	repoURL := "https://github.com/org/repo.git"
	// Create the hashed directory to simulate a cached clone
	repoDir := cache.PathFor(repoURL)
	if err := os.MkdirAll(repoDir, 0750); err != nil {
		t.Fatalf("mkdir: %v", err)
	}

	syncer := &GoGitSyncer{cache: cache}
	result := syncer.RepoPath(repoURL)
	if result != repoDir {
		t.Fatalf("cached repo should return path %q, got %q", repoDir, result)
	}
}

// TestContract_RepoPathDifferentURLsIndependent verifies each URL maps independently.
func TestContract_RepoPathDifferentURLsIndependent(t *testing.T) {
	cacheDir := t.TempDir()
	cache, err := NewRepoCache(cacheDir)
	if err != nil {
		t.Fatalf("NewRepoCache: %v", err)
	}

	urlA := "https://github.com/org/repo-a.git"
	urlB := "https://github.com/org/repo-b.git"
	urlC := "https://github.com/org/repo-c.git"

	// Only create dir for A
	dirA := cache.PathFor(urlA)
	if err := os.MkdirAll(dirA, 0750); err != nil {
		t.Fatalf("mkdir: %v", err)
	}

	syncer := &GoGitSyncer{cache: cache}

	if syncer.RepoPath(urlA) == "" {
		t.Fatal("repo-a should be found")
	}
	if syncer.RepoPath(urlB) != "" {
		t.Fatal("repo-b should not be found")
	}
	if syncer.RepoPath(urlC) != "" {
		t.Fatal("repo-c should not be found")
	}
}

// --- Contract: RepoCache.Exists ---

// TestContract_CacheExistsMatchesRepoPath verifies Exists and RepoPath agree.
func TestContract_CacheExistsMatchesRepoPath(t *testing.T) {
	cacheDir := t.TempDir()
	cache, err := NewRepoCache(cacheDir)
	if err != nil {
		t.Fatalf("NewRepoCache: %v", err)
	}
	syncer := &GoGitSyncer{cache: cache}

	url := "https://github.com/test/exists.git"

	// Before creating: both should agree (not found)
	if cache.Exists(url) {
		t.Fatal("should not exist before creation")
	}
	if syncer.RepoPath(url) != "" {
		t.Fatal("should return empty before creation")
	}

	// Create the directory
	if err := os.MkdirAll(cache.PathFor(url), 0750); err != nil {
		t.Fatalf("mkdir: %v", err)
	}

	// After creating: both should agree (found)
	if !cache.Exists(url) {
		t.Fatal("should exist after creation")
	}
	if syncer.RepoPath(url) == "" {
		t.Fatal("should return path after creation")
	}
}
