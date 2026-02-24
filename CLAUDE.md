# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project: dockercd

A Docker Compose-native continuous deployment tool inspired by ArgoCD's GitOps model. Instead of targeting Kubernetes, dockercd targets Docker Compose environments and runs as a single container that orchestrates deployments via the Docker socket.

### The Gap It Fills

No existing tool combines all of: ArgoCD-quality reconciliation (diff detection, health rollup, sync waves), Docker Compose as the deployment primitive, single-container simplicity, a web UI, webhook + polling, and self-healing with pruning. Watchtower only watches images. Portainer is a full platform. Kamal is push-based. Doco-CD lacks deep health assessment.

## Architecture

dockercd collapses ArgoCD's multi-component Kubernetes architecture into internal modules within one process:

| Module | ArgoCD Equivalent | dockercd Implementation |
|--------|-------------------|------------------------|
| **Git Sync** | Repo Server | Clones/pulls repos on interval (default 3min) or webhook. Caches locally. Detects changes via commit SHA. |
| **Reconciler** | Application Controller | Core loop: compares desired state (parsed compose file) with live state (Docker API). Computes diffs. Triggers sync per policy. |
| **Deployer** | Sync Engine | Executes `docker compose up -d`, `down --remove-orphans`, `pull`. Supports sync waves via labels. Runs pre/post-sync hooks. |
| **Health Monitor** | Resource Health | Watches container health via Docker healthchecks + state (running/restarting/exited). Computes per-service and per-app health. |
| **API Server** | API Server | REST API: list apps, get status, trigger sync, get diff, get logs. |
| **Web UI** | Web UI | Dashboard showing sync status, health, events, diffs per application. |
| **State Store** | etcd/CRDs | Embedded database (SQLite) for app definitions, sync history, events, cached state. |
| **Notifications** | Notification Controller | Alerts on state changes via webhooks, Slack, email. |

### Reconciliation Loop

```
every pollInterval (or on webhook):
  1. git fetch origin targetRevision
  2. if commitSHA == lastSyncedSHA and not selfHealCheck: skip
  3. desiredState = parseComposeFile(repo/path/composeFile)
  4. liveState = docker compose ps + docker inspect
  5. diff = computeDiff(desiredState, liveState)
  6. if diff.isEmpty(): markSynced(); return
  7. if automated:
       runPreSyncHooks() → docker compose pull → docker compose up -d → waitForHealthy() → runPostSyncHooks()
     else:
       markOutOfSync(diff) → notifyUser()
```

### Self-Healing

Subscribe to Docker event stream (`docker events --filter type=container`). When containers die/stop/are removed outside dockercd's control, trigger reconciliation.

### Health Statuses

`Healthy > Progressing > Degraded > Unknown` — worst child status becomes the app status. Maps to Docker container states: running+healthy=Healthy, starting=Progressing, restarting/unhealthy=Degraded, exited=Unknown.

### Application Config Format

```yaml
apiVersion: dockercd/v1
kind: Application
metadata:
  name: my-app
spec:
  source:
    repoURL: https://github.com/org/app.git
    targetRevision: main
    path: deploy/
    composeFiles: [docker-compose.yml, docker-compose.prod.yml]
  destination:
    dockerHost: unix:///var/run/docker.sock
    projectName: my-app
  syncPolicy:
    automated: true
    prune: true          # docker compose down --remove-orphans for removed services
    selfHeal: true       # re-deploy if containers manually stopped
    pollInterval: 180s
  hooks:
    preSync: [{name: db-migrate, service: migrate, command: ["python", "manage.py", "migrate"]}]
```

### Docker Socket Mounting

dockercd mounts `/var/run/docker.sock` to control sibling containers — same pattern as Watchtower, Portainer, and Traefik.

## Key ArgoCD Concepts Mapped to Docker Compose

| ArgoCD Concept | dockercd Equivalent |
|----------------|---------------------|
| Kubernetes manifests | docker-compose.yml files |
| `kubectl apply` | `docker compose up -d` |
| Resource pruning | `docker compose down --remove-orphans` |
| Cluster cache (watch API) | `docker inspect` + `docker events` stream |
| Sync waves (annotations) | Container labels or dedicated ordering config |
| Resource hooks (PreSync/PostSync) | Hook containers run before/after deploy |
| Health checks (Lua scripts) | Docker native `healthcheck` directive |
| CRDs in etcd | SQLite application records |
| Multi-cluster | Multi-host via remote Docker sockets (`tcp://host:2376`) |

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Language | Go 1.22+ | Docker ecosystem standard, static compilation, goroutine concurrency |
| Docker SDK | `github.com/docker/docker/client` | Official SDK, first-class Go types |
| Git | `github.com/go-git/go-git/v5` | Pure Go, no git binary dependency |
| Database | `modernc.org/sqlite` | Pure Go SQLite, no CGO required |
| HTTP Router | `github.com/go-chi/chi/v5` | Lightweight, stdlib-compatible |
| Logging | `log/slog` (stdlib) | Structured JSON logging |
| Config | `github.com/spf13/viper` | Environment + file config |
| CLI | `github.com/spf13/cobra` | Subcommand CLI framework |
| YAML | `gopkg.in/yaml.v3` | Compose file and manifest parsing |

## Build Commands

```bash
cd src
make build          # Build binary
make test           # Run unit tests
make test-race      # Run tests with race detector
make lint           # Run golangci-lint
make docker         # Build Docker image
make integration    # Run integration tests (requires Docker)
```

## Repository Structure

- `.zen/` — Zen framework submodule (read-only, never modify)
- `.claude/` — Zen configuration (concepts, agents, hooks, commands)
- `koan/` — Zen state storage (YAML files only)
- `docs/` — Documentation (design.md is the engineering spec)
- `src/` — Go application source code
  - `cmd/dockercd/` — Binary entrypoint
  - `internal/app/` — Domain types (Application, SyncStatus, HealthStatus)
  - `internal/gitsync/` — Git clone/pull, SHA-based change detection
  - `internal/parser/` — Compose YAML parsing, multi-file merge
  - `internal/inspector/` — Docker container state via SDK
  - `internal/differ/` — Pure-function desired vs live diff
  - `internal/deployer/` — Docker Compose CLI orchestration
  - `internal/reconciler/` — Core reconciliation loop + worker pool
  - `internal/health/` — Health status computation, worst-child aggregation
  - `internal/events/` — Docker event stream, self-healing triggers
  - `internal/store/` — SQLite persistence, migrations
  - `internal/api/` — REST API (chi router)
  - `internal/cli/` — Cobra CLI commands

## How to Work on This Project

**These are standing orders, not suggestions. Follow them without being prompted.**

### Before Writing Code

1. **Run AST index** (`index_project`) on affected packages. Use the symbol graph to understand call chains, interfaces, and dependencies before changing anything.
2. **Check existing specs** (`zen_spec_list`, `zen_spec_get`). If a spec covers the area you're modifying, use its contracts (pre/post conditions, properties) to validate your implementation. If no spec exists for a significant module, create one.
3. **Run semantic search** (`semantic_search`) on the problem domain before implementing. Find similar patterns already in the codebase. Don't reinvent what exists.
4. **Read before writing**. Never propose changes to code you haven't read. Understand the full call graph of what you're touching.

### While Writing Code

Apply these patterns in every module, on the first pass — not as a second-pass optimization:

- **Cache clients and connections**: Any SDK client, DB handle, or repo object created in a hot path must be cached and reused. Never create-and-close per call.
- **Bound all collections**: Every map, sync.Map, or slice that grows with user data must have a cleanup/eviction path. If an entry is created on add, it must be deleted on remove.
- **Pre-allocate slices**: When the capacity is known or estimable, use `make([]T, 0, n)`.
- **Conditional writes**: Don't write to DB/store when the value hasn't changed. Compare before writing.
- **Limit input**: All external input (HTTP bodies, webhook payloads) must be size-limited.
- **Thread parsed data**: If a value is parsed/deserialized, pass it through the call chain. Never re-parse the same data in a downstream function.
- **No duplication**: If logic exists in a helper, call it. Don't inline a copy.

### After Writing Code

1. **Run `go build ./...` and `go test ./...`** before declaring anything complete.
2. **Save a checkpoint** (`zen_checkpoint_save`) after completing significant milestones — not just when asked.
3. **Update memory** if you learned something stable about the project (architecture, gotchas, patterns).

### For Features and Multi-Step Work

Use the zen workflow tools to structure work:
- `zen_start_workflow` for new features — it plans the steps and assigns models
- `zen_advance_workflow` to move through phases
- `zen_get_concept` to load phase-specific instructions (story, architecture, implementation, quality)

Don't skip phases. The story phase catches requirement gaps. The architecture phase catches design issues. The quality phase catches bugs. Each phase exists because skipping it has cost us rework.

### What This Means in Practice

If the user says "add feature X", the response is NOT to start writing code. It is:
1. Index the codebase (`index_project`)
2. Search for related patterns (`semantic_search`, `find_symbol`)
3. Check/create specs (`zen_spec_list`)
4. Plan the approach (understand the call graph, identify affected files)
5. Then implement, applying the code quality standards above on the first pass

The tools were built for you. Use them.

## Zen Framework

This repo uses the Zen WYSIWID framework via git submodule (`.zen/`, branch `mcp`). Key commands:

```
/feature "description"    # Start a feature workflow
/workflow "description"   # Full automatic workflow
/health                   # Check context health
/checkpoint               # Save session state
```

See `.zen/CLAUDE.md` for full Zen documentation.
