# Deploying dockercd

dockercd ships with two install models that serve different use cases. Choose the one that fits your environment.

---

## Install Models

### Standalone

**Best for:** Individual developers, simple setups, existing GitHub repos.

```
GitHub ──(webhook/poll)──► dockercd ──► Docker socket
```

- Single container: `dockercd`
- GitOps source: GitHub (or any public git remote)
- Self-monitoring: manual sync (you control when dockercd updates itself)
- No external dependencies

### Bundle

**Best for:** Teams, home labs, air-gapped environments, full self-hosted GitOps.

```
Gitea ──(webhook/poll)──► dockercd ──► Docker socket
  ▲                          │
  └─── git push ─────────────┘
Registry ◄── docker push ──► dockercd deployments
```

- Services: `dockercd` + `postgres` + `gitea` + `registry`
- GitOps source: local Gitea (`gitea:3000` — internal DNS, no internet required)
- Self-monitoring: automated (push to Gitea → dockercd auto-deploys itself)
- Full GitOps loop: code changes propagate automatically

---

## Quick Start

### 1. Build the image

```bash
cd src && make docker && docker tag dockercd:dev dockercd:latest
```

### 2. Run the installer

```bash
./install.sh                     # interactive mode selection
./install.sh --mode standalone   # non-interactive
./install.sh --mode bundle       # non-interactive
./install.sh --mode full         # bundle + Prometheus/Grafana
```

---

## Bootstrap Sequence

### Standalone

1. Create `dockercd-net` Docker network
2. Start `dockercd` with bootstrap overlay (mounts `applications/` + `deploy/dockercd-app.standalone.yaml`)
3. dockercd reads `dockercd-app.standalone.yaml` → registers self pointing to GitHub (manual sync)
4. Reconciler clones GitHub repo; subsequent pushes detected within poll interval

### Bundle

The bundle has a **chicken-and-egg problem**: Gitea must be running before it can serve as the GitOps source. The install sequence resolves this:

```
1. Start postgres + gitea + registry   (direct docker compose, not GitOps)
   ↓
2. Bootstrap Gitea                     (create admin user, create repo)
   ↓
3. Push dockercd repo to Gitea         (git push gitea main)
   ↓
4. Start dockercd with bootstrap overlay
   └── mounts applications/*.yaml
       ├── gitea.yaml     → repoURL: gitea:3000/... ✓ (Gitea URL, already correct)
       ├── registry.yaml  → repoURL: gitea:3000/... ✓ (Gitea URL, already correct)
       └── infra.yaml     → repoURL: gitea:3000/... ✓ (Gitea URL, already correct)
       plus dockercd-app.bundle.yaml (Gitea URL, automated sync)
   ↓
5. Trigger initial sync
   └── dockercd reconciles all apps from Gitea
```

After step 5, the GitOps loop is closed. All future changes flow through Gitea.

---

## Files

| File | Purpose |
|------|---------|
| `docker-compose.yml` | dockercd service definition (used by reconciler for self-management) |
| `docker-compose.bootstrap.yml` | Overlay: mounts `applications/` for initial startup |
| `docker-compose.bundle.yml` | All bundle services in one file (cold-start / disaster recovery) |
| `dockercd-app.yaml` | Default self-monitoring manifest (standalone, GitHub, manual sync) |
| `dockercd-app.standalone.yaml` | Self-monitoring: GitHub source, manual sync |
| `dockercd-app.bundle.yaml` | Self-monitoring: Gitea source, automated sync |

---

## Application Manifests

Each app is defined by a YAML manifest under `applications/`:

| Manifest | GitOps Source | Mode |
|----------|---------------|------|
| `applications/gitea.yaml` | `gitea:3000` (internal) | bundle |
| `applications/registry.yaml` | `gitea:3000` (internal) | bundle |
| `applications/infra.yaml` | `gitea:3000` (internal) | bundle (postgres) |

On startup, dockercd reads all `.yaml` files from `/config/applications` (mounted via bootstrap overlay) and registers them. After registration is persisted in SQLite, the bootstrap overlay is no longer needed.

---

## Configuration

All configuration uses the `DOCKERCD_` prefix:

| Variable | Default | Purpose |
|----------|---------|---------|
| `DOCKERCD_DATA_DIR` | `/data` | SQLite database and git cache |
| `DOCKERCD_CONFIG_DIR` | `/config/applications` | Application manifest directory |
| `DOCKERCD_API_PORT` | `8080` | HTTP listen port |
| `DOCKERCD_LOG_LEVEL` | `info` | Log verbosity (debug/info/warn/error) |
| `DOCKERCD_GIT_TOKEN` | *(empty)* | GitHub PAT for private repos (standalone only) |

---

## Persistent State

The `dockercd-state` named volume holds the SQLite database at `/data/dockercd.db`. It survives container restarts and preserves all application registrations, sync history, and events.

**Backup:**
```bash
docker run --rm \
  -v dockercd-state:/data \
  -v "$(pwd)":/backup \
  alpine cp /data/dockercd.db /backup/dockercd-backup.db
```

---

## Manual Update (standalone)

```bash
cd src && make docker && docker tag dockercd:dev dockercd:latest
docker compose -p dockercd -f deploy/docker-compose.yml up -d
```

## GitOps Update (bundle)

```bash
git push gitea main
# dockercd detects the change within 3 minutes and auto-deploys
```
