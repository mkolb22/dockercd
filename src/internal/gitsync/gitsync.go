// Package gitsync manages Git repository cloning, pulling, and change detection.
// It uses go-git for pure-Go Git operations with no external binary dependency.
package gitsync

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
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

	// CheckoutSHA checks out a specific commit in the local clone. It fetches
	// full history if necessary (the clone may be shallow). Used by rollback.
	CheckoutSHA(ctx context.Context, repoURL string, sha string) error

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

	// urlMu serializes git operations per repo URL to prevent concurrent
	// clone/pull races. Distinct from reposMu which guards the repos cache.
	urlMu sync.Map // map[string]*sync.Mutex

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

// authFor returns the auth method to use for the given URL. Credentials
// embedded in the URL (http://user:pass@host/path) take precedence over
// the global token, allowing per-repo auth (e.g. Gitea vs GitHub).
func (g *GoGitSyncer) authFor(repoURL string) transport.AuthMethod {
	parsed, err := url.Parse(repoURL)
	if err == nil && parsed.User != nil {
		password, _ := parsed.User.Password()
		if parsed.User.Username() != "" || password != "" {
			return &http.BasicAuth{
				Username: parsed.User.Username(),
				Password: password,
			}
		}
	}
	return g.auth
}

// cleanURL strips embedded credentials from a URL for logging/cache purposes.
func cleanURL(repoURL string) string {
	parsed, err := url.Parse(repoURL)
	if err != nil || parsed.User == nil {
		return repoURL
	}
	parsed.User = nil
	return parsed.String()
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
		repo, err = g.pull(ctx, repoPath, refName, source.RepoURL)
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

// CheckoutSHA checks out a specific commit SHA in the local clone.
// Because normal syncs use Depth: 1, the target SHA may not exist locally.
// If so, we fetch full history first (unshallow), then checkout.
func (g *GoGitSyncer) CheckoutSHA(ctx context.Context, repoURL string, sha string) error {
	mu := g.repoMutex(repoURL)
	mu.Lock()
	defer mu.Unlock()

	repoPath := g.cache.PathFor(repoURL)
	repo, err := g.getOrOpenRepo(repoPath)
	if err != nil {
		return fmt.Errorf("opening repo at %q: %w", repoPath, err)
	}

	hash := plumbing.NewHash(sha)

	// Try to resolve the commit first — it may already be available.
	_, err = repo.CommitObject(hash)
	if err != nil {
		// Commit not available locally — fetch full history.
		g.logger.Info("fetching full history for rollback", "repo", cleanURL(repoURL), "sha", sha)
		err = repo.FetchContext(ctx, &git.FetchOptions{
			RemoteName: "origin",
			Depth:      0, // unshallow
			Auth:       g.authFor(repoURL),
		})
		if err != nil && !errors.Is(err, git.NoErrAlreadyUpToDate) {
			return fmt.Errorf("fetching full history: %w", err)
		}

		// Verify the commit is now available.
		if _, err := repo.CommitObject(hash); err != nil {
			return fmt.Errorf("commit %s not found after fetch: %w", sha, err)
		}
	}

	wt, err := repo.Worktree()
	if err != nil {
		return fmt.Errorf("getting worktree: %w", err)
	}

	if err := wt.Checkout(&git.CheckoutOptions{Hash: hash, Force: true}); err != nil {
		return fmt.Errorf("checking out %s: %w", sha, err)
	}

	g.logger.Info("checked out commit", "repo", repoURL, "sha", sha)
	return nil
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

func (g *GoGitSyncer) clone(ctx context.Context, repoURL, path string, ref plumbing.ReferenceName) (*git.Repository, error) {
	g.logger.Info("cloning repository",
		"repo", cleanURL(repoURL),
		"branch", ref.Short(),
		"path", path,
	)

	repo, err := git.PlainCloneContext(ctx, path, false, &git.CloneOptions{
		URL:           repoURL,
		ReferenceName: ref,
		Depth:         1,
		SingleBranch:  true,
		Auth:          g.authFor(repoURL),
	})
	if err != nil {
		return nil, fmt.Errorf("cloning %q: %w", cleanURL(repoURL), err)
	}
	return repo, nil
}

func (g *GoGitSyncer) pull(ctx context.Context, path string, ref plumbing.ReferenceName, repoURL string) (*git.Repository, error) {
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
		Auth:          g.authFor(repoURL),
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
		Auth:       g.authFor(repoURL),
	})
	if err != nil && !errors.Is(err, git.NoErrAlreadyUpToDate) {
		return fmt.Errorf("pushing to origin: %w", err)
	}

	g.logger.Info("pushed to origin", "repo", repoURL)
	return nil
}

// repoMutex returns a per-URL mutex to serialize git operations on the same repo.
func (g *GoGitSyncer) repoMutex(url string) *sync.Mutex {
	val, _ := g.urlMu.LoadOrStore(url, &sync.Mutex{})
	return val.(*sync.Mutex)
}
