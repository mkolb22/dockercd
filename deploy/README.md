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

### Two-node cluster

The optional `docker-compose.cluster.yml` example runs an active/passive pair.
It is intended for operators who can manage a private cluster CA and two
node-specific certificates; it is not a substitute for storage fencing or a
multi-host orchestration platform.

Before starting it, create a directory outside this repository with restrictive
permissions and set `DOCKERCD_CLUSTER_TLS_DIR` to it. The directory must contain
`ca.pem`, `node0.pem`, `node0-key.pem`, `node1.pem`, and `node1-key.pem`. Each
leaf certificate must be signed by `ca.pem`, be valid for both client and server
authentication, and contain its node ID (`node0` or `node1`) as a DNS Subject
Alternative Name. Do not commit these files or put their private keys in a
Compose file.

```bash
export DOCKERCD_API_TOKEN="$(openssl rand -base64 48)"
export DOCKERCD_CLUSTER_TLS_DIR=/secure/path/dockercd-cluster-tls
docker compose -f deploy/docker-compose.cluster.yml up -d
```

The cluster listener is deliberately not host-published. It is reachable only
over the Compose network and accepts TLS 1.3 connections that present the
expected peer certificate identity. The node APIs remain bound to loopback on
the host (`127.0.0.1:8080` and `127.0.0.1:8081`); place an authenticated TLS
reverse proxy in front of either API if remote access is required.

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

### Optional local Web presentation login

[`docker-compose.web-local-auth.example.yml`](docker-compose.web-local-auth.example.yml)
is a reference composition for the separate `dockercd-web` container. It is
not enabled by the primary controller Compose file and does not publish the
controller API. A TLS reverse proxy is the only browser-facing endpoint; the
Web service and controller communicate over the private `dockercd-net`.

Docker Compose secrets are service-specific file mounts at
`/run/secrets/<name>`. For this first local login phase, supply a Web-only,
host-managed JSON registry through `DOCKERCD_WEB_USERS_SECRET_FILE`. Each
entry has a subject, Argon2id password verifier, and that user's dedicated,
controller-scoped bearer. The separate controller registry contains the
SHA-256 digest and authorization metadata for each bearer, never the bearer
itself. The two registries must be provisioned together but never mounted into
the other service.

This is local secret distribution, not Kubernetes encrypted secret storage:
restrict the host file and deployment account, exclude it from backups shared
outside the trust boundary, and never commit it. See
[ADR 0003](../docs/adr/0003-local-password-bootstrap-for-web-presentation.md)
for the exact schema, lifecycle, and limits.

### Local secret file

The tracked [`deploy/.env.example`](.env.example) contains placeholders only.
If this installation needs a Git credential or non-loopback API token, copy it
to the ignored local `deploy/.env` on the deployment host, set the file mode
to owner-readable only, and populate freshly created values there. Do not put
credentials in any Compose file, application manifest, documentation example,
commit, image layer, or browser configuration. Rotate a value immediately if
it was pasted into a terminal transcript, chat, log, or screenshot.

`DOCKERCD_GIT_TOKEN` is optional and should have the smallest repository scope
necessary for dockercd's source reads. `DOCKERCD_API_TOKEN` is a distinct
random controller credential; do not reuse a Git token for it.

All configuration uses the `DOCKERCD_` prefix:

| Variable | Default | Purpose |
|----------|---------|---------|
| `DOCKERCD_DATA_DIR` | `/data` | SQLite database and git cache |
| `DOCKERCD_CONFIG_DIR` | `/config/applications` | Application manifest directory |
| `DOCKERCD_API_HOST` | `127.0.0.1` | HTTP listen interface; a non-loopback value requires an API token |
| `DOCKERCD_API_PORT` | `8080` | HTTP listen port |
| `DOCKERCD_API_TOKEN` | *(empty)* | Required (32+ characters) when `DOCKERCD_API_HOST` is non-loopback |
| `DOCKERCD_LOG_LEVEL` | `info` | Log verbosity (debug/info/warn/error) |
| `DOCKERCD_GIT_TOKEN` | *(empty)* | GitHub PAT for private repos (standalone only) |
| `DOCKERCD_GIT_ALLOWED_HOSTS` | `github.com` | Comma-delimited allowlist for Git remote hosts; include an internal host such as `gitea` only when intended |
| `DOCKERCD_CLUSTER_PEER_ID` | *(empty)* | Required peer node identity when cluster mode is enabled |
| `DOCKERCD_CLUSTER_TLS_CERT_FILE` | *(empty)* | Required node certificate PEM for cluster mTLS |
| `DOCKERCD_CLUSTER_TLS_KEY_FILE` | *(empty)* | Required node private-key PEM for cluster mTLS |
| `DOCKERCD_CLUSTER_TLS_CA_FILE` | *(empty)* | Required CA PEM that signs the peer node certificate |

---

## Persistent State

The `dockercd-state` named volume holds the SQLite database at `/data/dockercd.db`. It survives container restarts and preserves all application registrations, sync history, and events.

Sync history no longer stores resolved Compose environment values. On first start
after this release, the database migration removes legacy stored Compose
snapshots. If an older deployment may have contained credentials in its
manifests or secret substitutions, rotate those credentials and replace any
database/WAL backups made before the upgrade; the migration cannot revoke a
secret that has already been copied elsewhere.

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
