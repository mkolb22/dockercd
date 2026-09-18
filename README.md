# dockercd

**ArgoCD-quality GitOps continuous deployment for Docker Compose.**

DockerCD brings the reconciliation model of ArgoCD — drift detection, health rollup, sync waves, self-healing — to Docker Compose environments. It runs as a single container, mounts the Docker socket, and continuously reconciles your running services against the desired state in Git.

No Kubernetes. No agents. No complex setup.

---

## Why dockercd?

| Tool | What it does | What it lacks |
|------|-------------|---------------|
| Watchtower | Watches images | No Git source, no diff, no health |
| Portainer | Full platform | No GitOps reconciliation loop |
| Kamal | Push-based deploys | No continuous reconciliation |
| ArgoCD | Full GitOps | Requires Kubernetes |
| **dockercd** | **ArgoCD model on Docker Compose** | — |

---

## Features

### GitOps Engine
- **Polling + webhooks** — poll Git on a configurable interval (default 3 min) and/or receive GitHub/Gitea push webhooks for instant deploys
- **HMAC webhook validation** — SHA256 signature verification on all incoming webhooks
- **Commit SHA tracking** — skip reconciliation when HEAD matches last-synced SHA
- **Per-app locking** — prevents concurrent syncs on the same application

### Reconciliation
- **Desired vs live diff** — parse compose files from Git, compare against live Docker state, compute field-level diffs (image, env, ports, volumes, labels)
- **Automated sync** — deploy immediately on drift when `automated: true`
- **Manual sync** — trigger through the authenticated API or CLI
- **Dry-run mode** — compute and display diffs without deploying
- **Sync timeout** — configurable per-application (default 5 min)

### Deployment
- **docker compose up/down** — wraps `docker compose` CLI for full compatibility
- **Sync waves** — label services with `com.dockercd.sync-wave=<n>` to deploy in order (waves 0, 1, 2, …)
- **Pre/post-sync hooks** — one-shot containers (`com.dockercd.hook=pre-sync|post-sync`) for migrations, cache warming, notifications
- **Blue-green deployments** — zero-downtime color switching with health-gated cutover (`com.dockercd.strategy=blue-green`)
- **Pruning** — `docker compose down --remove-orphans` removes services deleted from compose files (`prune: true`)
- **Image pulling** — always pull latest image before deploy
- **Multi-file compose** — merge multiple compose files in order (overrides pattern)
- **Encrypted secrets** — age-encrypted `.env.age` files decrypted at deploy time

### Self-Healing
- **Docker event stream** — subscribe to container stop/die events via Docker SDK
- **Auto-reconcile** — re-deploy when containers are stopped externally (`selfHeal: true`)
- **Debounce** — 2s window prevents reconciliation storms; 5s post-sync suppression prevents self-triggering
- **Reconnect with backoff** — exponential backoff (1s→30s) if the Docker event stream drops

### Health Monitoring
- **Four-tier status** — `Healthy > Progressing > Degraded > Unknown`
- **Docker-native healthchecks** — uses container `HEALTHCHECK` status when configured
- **State inference** — maps `running/restarting/exited` to health tiers when no healthcheck is defined
- **Worst-child aggregation** — one degraded service degrades the whole application
- **Post-deploy watching** — block until all services are healthy (or timeout)
- **Background sweep** — continuous 30s health poll across all registered apps
- **Health conditions** — timestamped condition records for SyncError, GitError, DeployError, etc.

### Resource Metrics
- **Per-container** — CPU %, memory usage/limit, network I/O, block I/O, process count, uptime
- **Per-service** — aggregated from all containers of the service
- **Per-app** — sum across all services

### Web presentation
- **Separate, unprivileged service** — `dockercd-web` is a server-rendered,
  read-only monitoring surface using a scoped presentation API
- **Local-password bootstrap** — opaque Web sessions and dedicated scoped
  controller credentials; browsers never receive a controller bearer
- **Honest operational evidence** — controller-authored freshness, bounded
  status, and activity; no invented telemetry or browser mutations in v1.0
- **No authored JavaScript** — semantic HTML, CSS, and server rendering with
  explicit refresh behavior

### REST API
```
GET  /healthz                                       liveness probe
GET  /readyz                                        readiness probe
GET  /api/v1/system                                 version + uptime
GET  /api/v1/system/stats                           host resource metrics

GET  /api/v1/applications                           list all apps
POST /api/v1/applications                           register app (JSON)
GET  /api/v1/applications/{name}                    app detail + status
DELETE /api/v1/applications/{name}                  unregister
POST /api/v1/applications/{name}/sync               trigger sync
POST /api/v1/applications/{name}/rollback           rollback to SHA
POST /api/v1/applications/{name}/adopt              adopt unmanaged containers
GET  /api/v1/applications/{name}/diff               desired vs live (dry-run)
GET  /api/v1/applications/{name}/events             event log
GET  /api/v1/applications/{name}/history            sync history
GET  /api/v1/applications/{name}/metrics            resource metrics
GET  /api/v1/applications/{name}/services/{svc}     service detail
GET  /api/v1/applications/{name}/services/{svc}/logs  container logs

GET  /api/v1/events/stream                          SSE event stream
POST /api/v1/webhook/git                            GitHub / Gitea push webhook

GET  /api/v1/settings/poll-interval                 global poll override
PUT  /api/v1/settings/poll-interval                 set global poll override
```

### CLI
```bash
dockercd serve                          # start the daemon
dockercd app list                       # list applications
dockercd app get <name>                 # application detail
dockercd app diff <name>                # desired vs live diff
dockercd app sync <name>                # trigger sync
dockercd app rollback <name> <sha>      # rollback to commit
dockercd app adopt <name>               # adopt unmanaged containers
dockercd version                        # print version
```

### Notifications
- **Slack** — post sync events to a Slack webhook
- **Generic webhooks** — POST structured sync event data to any URL
- **Custom headers** — inject auth headers on outbound webhook calls
- **Multi-notifier** — dispatch to multiple backends simultaneously

### Persistence (SQLite)
- **Applications** — full manifest, sync status, health, last-synced SHA, conditions
- **Sync history** — every sync with operation type, result, diff, compose spec, duration
- **Events** — timestamped event log per application with severity levels
- **WAL mode** — write-ahead logging for safe concurrent access
- **Embedded migrations** — schema versioned and applied automatically at startup

### V1 deployment model

DockerCD v1 uses a deliberately small, paired deployment: one privileged
`dockercd` control plane and one unprivileged, read-only `dockercd-web`
presentation service. The checked-in Compose deployment is for the separately
configured development pair. A separately provisioned personal pair manages
the Signal application only; it must have distinct state, credentials, secret
files, network, and manifest source. Those are configuration boundaries only
when both controllers share one Docker daemon: Docker socket access is
host-admin equivalent. Use separate Docker hosts or daemons for a true
security boundary.

The bundle, registry, monitoring, bootstrap, cluster, and controller
self-management examples are intentionally not part of v1. See
[ADR 0006](docs/adr/0006-minimal-v1-deployment.md) and the
[deployment guide](deploy/README.md).

---

## Deployment Architecture

> **Before deploying, read the [Getting Started guide](docs/getting-started.md).**

The most important architectural decision in a dockercd deployment is keeping your application configuration in a **separate repository** from the dockercd tool itself. This is the same pattern ArgoCD, Flux, and every mature GitOps system enforces:

```
┌─────────────────────────┐     ┌─────────────────────────────┐
│   dockercd repo         │     │   your config repo          │
│   (the tool)            │     │   (your infra, your rules)  │
│                         │     │                             │
│  Deploy once.           │     │  apps/                      │
│  Upgrade independently. │     │    web-app/manifest.yaml    │
│  Don't put your apps    │     │    web-app/docker-compose.. │
│  here.                  │     │    api/manifest.yaml        │
└─────────────────────────┘     │    api/docker-compose.yml   │
                                └─────────────────────────────┘
                                              ▲
                                    dockercd polls and
                                    reconciles continuously
```

Keeping these repositories separate means:
- Upgrading dockercd never touches your application configuration
- Your config repo is private and contains only your infrastructure state
- Teams propose infrastructure changes via pull requests against the config repo
- Two environments (dev/prod) can each track different branches of the same config repo

The [Getting Started guide](docs/getting-started.md) covers controller
operation and application registration. Follow the
[deployment guide](deploy/README.md) for the paired development instance.

---

## Application Manifest

```yaml
apiVersion: dockercd/v1
kind: Application
metadata:
  name: my-app
spec:
  source:
    repoURL: https://github.com/org/app.git   # credentials are never embedded in this URL
    targetRevision: main                        # branch, tag, or commit SHA
    path: deploy/                               # path within repo
    composeFiles:
      - docker-compose.yml
      - docker-compose.prod.yml                # merged in order
  destination:
    dockerHost: unix:///var/run/docker.sock
    projectName: my-app
  syncPolicy:
    automated: true
    prune: true          # remove services deleted from compose files
    selfHeal: true       # re-deploy if containers stopped externally
    pollInterval: 180s   # min: 30s
    syncTimeout: 300s
    healthTimeout: 120s
```

See the [full Application Manifest Reference](docs/application-manifest.md) for all fields, defaults, validation rules, Docker Compose labels (`sync-wave`, `hook`, `strategy`, `ignore-drift`), secrets, and annotated examples.

---

## Quick Start

### Prerequisites
- Docker Engine + Compose plugin
- Git
- `make`

### 1. Clone and build

```bash
git clone https://github.com/mkolb22/dockercd.git
cd dockercd
cd src && make docker && docker tag dockercd:dev dockercd:latest
cd ..
```

### 2. Install

```bash
cp deploy/.env.example deploy/.env
# Provision the two local secret files referenced by deploy/.env.
./install.sh
```

### 3. Verify the controller

```bash
dockercd app list --server http://127.0.0.1:18080
```

The paired Web service listens on `http://127.0.0.1:18092`; make it network
reachable only through an explicitly configured TLS reverse proxy. The
controller does not serve a browser UI.

---

## Configuration

All configuration uses the `DOCKERCD_` prefix:

| Variable | Default | Description |
|----------|---------|-------------|
| `DOCKERCD_DATA_DIR` | `/data` | SQLite database and Git cache |
| `DOCKERCD_CONFIG_DIR` | `/config/applications` | Application manifest directory |
| `DOCKERCD_API_HOST` | `127.0.0.1` | HTTP listen interface; a non-loopback value requires an API token |
| `DOCKERCD_API_PORT` | `8080` | HTTP listen port |
| `DOCKERCD_LOG_LEVEL` | `info` | debug / info / warn / error |
| `DOCKERCD_WORKER_COUNT` | `4` | Reconciliation worker pool size (1–32) |
| `DOCKERCD_DEFAULT_POLL_INTERVAL` | `180s` | Default poll interval (min 30s) |
| `DOCKERCD_GIT_TOKEN` | *(empty)* | GitHub / Gitea PAT for HTTPS auth |
| `DOCKERCD_WEBHOOK_SECRET` | *(empty)* | HMAC secret for Git webhook validation |
| `DOCKERCD_API_TOKEN` | *(empty)* | Required (32+ characters) when `DOCKERCD_API_HOST` is non-loopback; sent as a Bearer token |
| `DOCKERCD_SLACK_WEBHOOK_URL` | *(empty)* | Slack notifications |
| `DOCKERCD_NOTIFICATION_WEBHOOK_URL` | *(empty)* | Generic webhook notifications |
| `DOCKERCD_AGE_KEY_FILE` | *(empty)* | Path to age private key for secret decryption |

Deployment Compose files publish the **controller API** only on `127.0.0.1`.
Keep it loopback-bound or place a TLS-terminating, authenticated reverse proxy
in front of it; do not expose the controller API directly to an untrusted
network. Deploy `dockercd-web` separately for browser monitoring; it is the
only supported browser presentation surface.

---

## Technology Stack

| Component | Choice |
|-----------|--------|
| Language | Go 1.22+ |
| Docker SDK | `github.com/docker/docker/client` |
| Git | `github.com/go-git/go-git/v5` (pure Go) |
| Database | `modernc.org/sqlite` (pure Go, no CGO) |
| HTTP Router | `github.com/go-chi/chi/v5` |
| CLI | `github.com/spf13/cobra` |
| Config | `github.com/spf13/viper` |
| Logging | `log/slog` (stdlib) |

Single static binary. No external runtime dependencies.

---

## Build

```bash
cd src
make build          # build binary → src/bin/dockercd
make test           # unit tests
make test-race      # tests with race detector
make lint           # golangci-lint
make docker         # build Docker image
make integration    # integration tests (requires Docker)
```

---

## License

Commons Clause + MIT — see [LICENSE](LICENSE).
Free to use, modify, and distribute. Commercial resale requires a separate agreement.
