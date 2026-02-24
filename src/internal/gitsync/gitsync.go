// Package gitsync manages Git repository cloning, pulling, and change detection.
// It uses go-git for pure-Go Git operations with no external binary dependency.
package gitsync

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"sync"

	"github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/plumbing"
	"github.com/go-git/go-git/v5/plumbing/transport"
	"github.com/go-git/go-git/v5/plumbing/transport/http"
	"github.com/mkolb22/dockercd/internal/app"
)

// GitSyncer manages Git repository cloning, pulling, and change detection.
type GitSyncer interface {
	// Sync fetches the latest state of the repository and returns the HEAD commit SHA.
	// If the repository is not yet cloned, it performs an initial clone.
	Sync(ctx context.Context, source app.SourceSpec) (commitSHA string, err error)

	// RepoPath returns the local filesystem path to the cloned repository
	// for the given repo URL. Returns empty string if not yet cloned.
	RepoPath(repoURL string) string

	// Commit stages the given files and creates a commit in the local clone.
	Commit(ctx context.Context, repoURL string, message string, files []string) error

	// Push pushes the current branch to origin.
	Push(ctx context.Context, repoURL string) error

	// Close releases resources.
	Close() error
}

// GoGitSyncer implements GitSyncer using the go-git library.
type GoGitSyncer struct {
	cache  *RepoCache
	logger *slog.Logger
	auth   transport.AuthMethod

	// mu protects concurrent access to the same repo URL.
	mu sync.Map // map[string]*sync.Mutex

	// repos caches opened git.Repository objects to avoid repeated
	// git.PlainOpen calls which re-read the .git object database.
	repos   map[string]*git.Repository
	reposMu sync.Mutex
}

// New creates a new GoGitSyncer with the given cache directory for cloned repos.
// If gitToken is non-empty, it is used as HTTP basic auth for HTTPS repo URLs.
func New(cacheDir string, logger *slog.Logger, gitToken string) (*GoGitSyncer, error) {
	cache, err := NewRepoCache(cacheDir)
	if err != nil {
		return nil, fmt.Errorf("creating repo cache: %w", err)
	}

	var auth transport.AuthMethod
	if gitToken != "" {
		auth = &http.BasicAuth{
			Username: "x-access-token",
			Password: gitToken,
		}
		logger.Info("git authentication configured")
	}

	return &GoGitSyncer{
		cache:  cache,
		logger: logger,
		auth:   auth,
		repos:  make(map[string]*git.Repository),
	}, nil
}

// Sync clones or pulls the repository and returns the HEAD SHA.
func (g *GoGitSyncer) Sync(ctx context.Context, source app.SourceSpec) (string, error) {
	// Serialize access per repo URL
	mu := g.repoMutex(source.RepoURL)
	mu.Lock()
	defer mu.Unlock()

	repoPath := g.cache.PathFor(source.RepoURL)
	branch := source.TargetRevision
	if branch == "" {
		branch = "main"
	}
	refName := plumbing.NewBranchReferenceName(branch)

	var repo *git.Repository
	var err error

	if g.cache.Exists(source.RepoURL) {
		repo, err = g.pull(ctx, repoPath, refName)
		if err != nil {
			// If pull fails (corrupted repo, etc.), wipe and re-clone
			g.logger.Warn("pull failed, re-cloning",
				"repo", source.RepoURL,
				"error", err,
			)
			g.evictRepo(repoPath)
			if removeErr := os.RemoveAll(repoPath); removeErr != nil {
				return "", fmt.Errorf("removing corrupted repo %q: %w", repoPath, removeErr)
			}
			repo, err = g.clone(ctx, source.RepoURL, repoPath, refName)
			if err != nil {
				return "", fmt.Errorf("re-clone after pull failure: %w", err)
			}
			g.cacheRepo(repoPath, repo)
		}
	} else {
		repo, err = g.clone(ctx, source.RepoURL, repoPath, refName)
		if err != nil {
			return "", err
		}
		g.cacheRepo(repoPath, repo)
	}

	head, err := repo.Head()
	if err != nil {
		return "", fmt.Errorf("getting HEAD: %w", err)
	}

	sha := head.Hash().String()
	g.logger.Debug("git sync complete",
		"repo", source.RepoURL,
		"branch", branch,
		"sha", sha,
	)

	return sha, nil
}

// RepoPath returns the local filesystem path to the cached clone for the given repo URL.
func (g *GoGitSyncer) RepoPath(repoURL string) string {
	path := g.cache.PathFor(repoURL)
	if _, err := os.Stat(path); err != nil {
		return ""
	}
	return path
}

// Close releases cached repository objects.
func (g *GoGitSyncer) Close() error {
	g.reposMu.Lock()
	g.repos = make(map[string]*git.Repository)
	g.reposMu.Unlock()
	return nil
}

// getOrOpenRepo returns a cached *git.Repository for the path, or opens one.
func (g *GoGitSyncer) getOrOpenRepo(path string) (*git.Repository, error) {
	g.reposMu.Lock()
	defer g.reposMu.Unlock()

	if repo, ok := g.repos[path]; ok {
		return repo, nil
	}

	repo, err := git.PlainOpen(path)
	if err != nil {
		return nil, err
	}
	g.repos[path] = repo
	return repo, nil
}

// cacheRepo stores an opened repository in the cache.
func (g *GoGitSyncer) cacheRepo(path string, repo *git.Repository) {
	g.reposMu.Lock()
	g.repos[path] = repo
	g.reposMu.Unlock()
}

// evictRepo removes a cached repository (e.g., before re-clone).
func (g *GoGitSyncer) evictRepo(path string) {
	g.reposMu.Lock()
	delete(g.repos, path)
	g.reposMu.Unlock()
}

func (g *GoGitSyncer) clone(ctx context.Context, url, path string, ref plumbing.ReferenceName) (*git.Repository, error) {
	g.logger.Info("cloning repository",
		"repo", url,
		"branch", ref.Short(),
		"path", path,
	)

	repo, err := git.PlainCloneContext(ctx, path, false, &git.CloneOptions{
		URL:           url,
		ReferenceName: ref,
		Depth:         1,
		SingleBranch:  true,
		Auth:          g.auth,
	})
	if err != nil {
		return nil, fmt.Errorf("cloning %q: %w", url, err)
	}
	return repo, nil
}

func (g *GoGitSyncer) pull(ctx context.Context, path string, ref plumbing.ReferenceName) (*git.Repository, error) {
	repo, err := g.getOrOpenRepo(path)
	if err != nil {
		return nil, fmt.Errorf("opening repo at %q: %w", path, err)
	}

	wt, err := repo.Worktree()
	if err != nil {
		return nil, fmt.Errorf("getting worktree: %w", err)
	}

	err = wt.PullContext(ctx, &git.PullOptions{
		RemoteName:    "origin",
		ReferenceName: ref,
		Depth:         1,
		Force:         true,
		Auth:          g.auth,
	})
	if err != nil && !errors.Is(err, git.NoErrAlreadyUpToDate) {
		return nil, fmt.Errorf("pulling %q: %w", ref.Short(), err)
	}

	return repo, nil
}

// Commit stages the given files and creates a commit in the local repository for repoURL.
func (g *GoGitSyncer) Commit(ctx context.Context, repoURL string, message string, files []string) error {
	mu := g.repoMutex(repoURL)
	mu.Lock()
	defer mu.Unlock()

	repoPath := g.cache.PathFor(repoURL)
	repo, err := g.getOrOpenRepo(repoPath)
	if err != nil {
		return fmt.Errorf("opening repo: %w", err)
	}

	wt, err := repo.Worktree()
	if err != nil {
		return fmt.Errorf("getting worktree: %w", err)
	}

	for _, f := range files {
		if _, err := wt.Add(f); err != nil {
			return fmt.Errorf("staging %s: %w", f, err)
		}
	}

	_, err = wt.Commit(message, &git.CommitOptions{})
	if err != nil {
		return fmt.Errorf("creating commit: %w", err)
	}

	g.logger.Info("created commit", "repo", repoURL, "message", message)
	return nil
}

// Push pushes the current branch to origin for the repository at repoURL.
func (g *GoGitSyncer) Push(ctx context.Context, repoURL string) error {
	mu := g.repoMutex(repoURL)
	mu.Lock()
	defer mu.Unlock()

	repoPath := g.cache.PathFor(repoURL)
	repo, err := g.getOrOpenRepo(repoPath)
	if err != nil {
		return fmt.Errorf("opening repo: %w", err)
	}

	err = repo.PushContext(ctx, &git.PushOptions{
		RemoteName: "origin",
		Auth:       g.auth,
	})
	if err != nil && !errors.Is(err, git.NoErrAlreadyUpToDate) {
		return fmt.Errorf("pushing to origin: %w", err)
	}

	g.logger.Info("pushed to origin", "repo", repoURL)
	return nil
}

// repoMutex returns a per-URL mutex to serialize git operations on the same repo.
func (g *GoGitSyncer) repoMutex(url string) *sync.Mutex {
	val, _ := g.mu.LoadOrStore(url, &sync.Mutex{})
	return val.(*sync.Mutex)
}
