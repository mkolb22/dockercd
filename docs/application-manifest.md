# Application Manifest Reference

An **Application** is the core resource in dockercd. Each manifest tells dockercd where to find your compose files, where to deploy them, and how to reconcile drift.

---

## Table of Contents

1. [Quick Reference](#1-quick-reference)
2. [Full Schema](#2-full-schema)
3. [Field Reference](#3-field-reference)
   - [metadata](#metadata)
   - [spec.source](#specsource)
   - [spec.destination](#specdestination)
   - [spec.syncPolicy](#specsyncpolicy)
4. [Duration Format](#4-duration-format)
5. [Docker Compose Labels](#5-docker-compose-labels)
6. [Env Files and Secrets](#6-env-files-and-secrets)
7. [Registering Applications](#7-registering-applications)
8. [Examples](#8-examples)

---

## 1. Quick Reference

```yaml
apiVersion: dockercd/v1
kind: Application
metadata:
  name: my-app                    # required — DNS label, unique

spec:
  source:
    repoURL: https://github.com/org/repo.git   # required
    targetRevision: main                         # default: main
    path: deploy/                               # default: .
    composeFiles:
      - docker-compose.yml                      # default: [docker-compose.yml]

  destination:
    dockerHost: unix:///var/run/docker.sock     # default: unix:///var/run/docker.sock
    projectName: my-app                         # default: metadata.name

  syncPolicy:
    automated: true       # default: false
    prune: true           # default: false
    selfHeal: true        # default: false
    pollInterval: 180s    # default: 180s, min: 30s
    syncTimeout: 300s     # default: 300s
    healthTimeout: 120s   # default: 120s
```

---

## 2. Full Schema

```
Application
├── apiVersion: dockercd/v1        (required, constant)
├── kind: Application              (required, constant)
├── metadata
│   └── name: <string>             (required)
└── spec
    ├── source
    │   ├── repoURL: <url>         (required)
    │   ├── targetRevision: <ref>  (default: "main")
    │   ├── path: <string>         (default: ".")
    │   └── composeFiles: [string] (default: ["docker-compose.yml"])
    ├── destination
    │   ├── dockerHost: <socket>   (default: "unix:///var/run/docker.sock")
    │   └── projectName: <string>  (default: metadata.name)
    └── syncPolicy
        ├── automated: <bool>      (default: false)
        ├── prune: <bool>          (default: false)
        ├── selfHeal: <bool>       (default: false)
        ├── pollInterval: <dur>    (default: 180s)
        ├── syncTimeout: <dur>     (default: 300s)
        └── healthTimeout: <dur>   (default: 120s)
```

---

## 3. Field Reference

### metadata

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | **yes** | Unique identifier for this application. Must be a valid DNS label: lowercase alphanumeric and hyphens, 1–63 characters, starting and ending with alphanumeric. Used as the Docker Compose project name when `destination.projectName` is omitted. |

---

### spec.source

Defines where dockercd fetches the compose files from.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `repoURL` | string | **required** | Git remote URL. Accepts `https://`, `http://`, `ssh://`, or `git@` SSH shorthand. Credentials can be embedded in the URL for Gitea/GitHub (e.g. `http://user:pass@gitea:3000/org/repo.git`) or supplied via `DOCKERCD_GIT_TOKEN`. Private/loopback IPs are rejected unless using internal service names (e.g. `gitea:3000`). |
| `targetRevision` | string | `main` | Branch name, tag, or full commit SHA to track. dockercd fetches HEAD of this ref on each poll. Using a commit SHA pins the version. |
| `path` | string | `.` | Relative path within the repository to the directory containing your compose files. Must not be absolute or contain `..`. |
| `composeFiles` | []string | `["docker-compose.yml"]` | One or more compose file names relative to `path`. Files are merged in order — the first file is the base, each subsequent file overlays/overrides it. This follows the same merge semantics as `docker compose -f base.yml -f override.yml`. |

**repoURL formats:**

```yaml
# GitHub HTTPS
repoURL: https://github.com/org/repo.git

# GitHub with token (embed in URL or use DOCKERCD_GIT_TOKEN env var)
repoURL: https://github.com/org/private-repo.git

# Gitea internal (bundle install — embedded credentials)
repoURL: http://dockercd:dockercd123@gitea:3000/dockercd/repo.git

# SSH
repoURL: git@github.com:org/repo.git

# SSH explicit scheme
repoURL: ssh://git@github.com/org/repo.git
```

---

### spec.destination

Defines where the compose services are deployed.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `dockerHost` | string | `unix:///var/run/docker.sock` | Docker daemon socket. Use the Unix socket path for local deployments (standard when dockercd runs as a container with the socket mounted). Use `tcp://host:2376` for remote Docker hosts; set `DOCKERCD_TLS_CERT_PATH` to a directory containing `ca.pem`, `cert.pem`, `key.pem` for mutual TLS. |
| `projectName` | string | `metadata.name` | Docker Compose project name. This is the `-p` argument passed to `docker compose`. Containers are named `{projectName}-{service}-{index}` (or `container_name` if set in the compose file). Each application must use a unique project name. |

---

### spec.syncPolicy

Controls when and how dockercd reconciles drift.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `automated` | bool | `false` | When `true`, dockercd automatically deploys whenever it detects drift (compose file changed in Git, or running containers diverge from desired state). When `false`, drift is reported but not acted on — a manual sync is required via the UI, API, or CLI. |
| `prune` | bool | `false` | When `true`, services that exist in the running project but are no longer defined in the compose files are removed via `docker compose down --remove-orphans`. Requires `automated: true` to take effect automatically. |
| `selfHeal` | bool | `false` | When `true`, dockercd subscribes to the Docker event stream and triggers a reconciliation whenever containers for this application are stopped, killed, or removed outside of dockercd's control. A 2-second debounce prevents reconciliation storms; syncs are suppressed for 5 seconds after a successful deploy to avoid self-triggering. |
| `pollInterval` | Duration | `180s` | How frequently to check the Git remote for new commits. Minimum value is `30s`. Can also be set globally with `DOCKERCD_DEFAULT_POLL_INTERVAL`. A Git push webhook can trigger immediate reconciliation between polls. |
| `syncTimeout` | Duration | `300s` | Maximum time allowed for a single sync operation (image pull + `docker compose up -d` + health wait). If exceeded, the sync is marked failed. |
| `healthTimeout` | Duration | `120s` | Maximum time to wait for all services to reach Healthy status after deployment. If services are still Progressing after this window, the sync succeeds but health is reported as Degraded. |

---

## 4. Duration Format

Duration fields accept Go duration strings or bare integers (interpreted as seconds):

| Format | Meaning |
|--------|---------|
| `30s` | 30 seconds |
| `3m` | 3 minutes |
| `1h` | 1 hour |
| `1m30s` | 1 minute 30 seconds |
| `300` | 300 seconds (bare integer) |

---

## 5. Docker Compose Labels

Labels are applied to **services** in your `docker-compose.yml` files to opt into advanced features.

### `com.dockercd.sync-wave`

Assigns a service to a numbered deployment wave. Services are deployed in ascending wave order, with dockercd waiting for each wave to complete before starting the next.

- **Type:** string (numeric)
- **Default:** `"0"` (services without this label are in wave 0)
- **Example:**

```yaml
services:
  db:
    image: postgres:16
    labels:
      com.dockercd.sync-wave: "0"   # deployed first

  migrate:
    image: myapp:latest
    labels:
      com.dockercd.sync-wave: "1"   # runs after db is healthy

  web:
    image: myapp:latest
    labels:
      com.dockercd.sync-wave: "2"   # runs after migrate completes
```

---

### `com.dockercd.hook`

Marks a service as a one-shot hook container. Hook services are run via `docker compose run --rm` — they execute once, then exit. They are excluded from the diff engine (so their absence from running containers does not trigger a sync).

- **Type:** string — `"pre-sync"` or `"post-sync"`
- `"pre-sync"` — runs before the main `docker compose up -d`. Failure aborts the deployment.
- `"post-sync"` — runs after a successful deployment. Failure is logged but does not fail the sync.
- **Example:**

```yaml
services:
  migrate:
    image: myapp:latest
    command: ["python", "manage.py", "migrate"]
    labels:
      com.dockercd.hook: "pre-sync"

  notify:
    image: curlimages/curl:latest
    command: ["curl", "-X", "POST", "https://hooks.example.com/deployed"]
    labels:
      com.dockercd.hook: "post-sync"

  web:
    image: myapp:latest
    ports:
      - "8000:8000"
```

---

### `com.dockercd.strategy`

Sets the deployment strategy. When any service in the application has this label, the strategy applies to the entire deployment.

- **Type:** string — currently only `"blue-green"` is supported
- **`"blue-green"`** — deploys the new version as a parallel project with an alternate color suffix, waits for it to become healthy, then stops the old color project. Provides zero-downtime deployments.
- **Example:**

```yaml
services:
  web:
    image: myapp:latest
    labels:
      com.dockercd.strategy: "blue-green"
```

---

### `com.dockercd.ignore-drift`

Excludes a service from drift detection and self-heal. dockercd will not include this service in the diff computation and will not trigger a sync if it is stopped externally.

- **Type:** string — `"true"` to enable
- **Use case:** Sidecar containers or tools managed outside dockercd that share the same compose file.
- **Example:**

```yaml
services:
  web:
    image: myapp:latest

  debug-proxy:
    image: mitmproxy:latest
    labels:
      com.dockercd.ignore-drift: "true"   # managed manually, won't trigger syncs
```

---

### `com.dockercd.image-policy`

Enables automatic image tag updates for a service. dockercd's image poller checks the registry every 5 minutes and commits an updated compose file to Git when a newer tag is found, which then triggers a sync.

- **Type:** string — `"semver"`, `"major"`, or `"minor"`
- `"semver"` — update to any newer semver tag
- `"major"` — only update within the current major version
- `"minor"` — only update within the current minor version
- **Example:**

```yaml
services:
  web:
    image: myapp:1.4.2
    labels:
      com.dockercd.image-policy: "minor"   # auto-update to 1.4.x, not 1.5.x
```

---

## 6. Env Files and Secrets

### `.env` variable substitution

If a `.env` file exists in the same directory as the compose files (`spec.source.path`), it is automatically loaded and its values are available for `${VAR}` substitution in compose file values.

```
# .env
IMAGE_TAG=v1.4.2
DB_NAME=production
```

```yaml
# docker-compose.yml
services:
  web:
    image: myapp:${IMAGE_TAG}
    environment:
      DB_NAME: ${DB_NAME}
```

### Encrypted secrets

dockercd supports age-encrypted env files. Set `DOCKERCD_AGE_KEY_FILE` to a path containing your age private key. If a `.env.age` or `.env.enc` file exists alongside the compose files, it is decrypted and merged over the plain `.env` values.

```bash
# Encrypt your secrets
age -r <public-key> -o .env.age .env.production

# Configure dockercd
DOCKERCD_AGE_KEY_FILE=/run/secrets/age-key
```

Inline secret references in compose environment values are also resolved:

```yaml
services:
  web:
    environment:
      DB_PASSWORD: vault:secret/data/myapp#db_password
```

---

## 7. Registering Applications

Applications can be registered three ways:

### Via manifest file (bundle install)

Place YAML files in `/config/applications/` inside the dockercd container. All files matching `*.yaml` or `*.yml` in that directory are loaded at startup and re-applied on change. The bundle install mounts the `applications/` directory from the host into the container automatically.

```bash
# In docker-compose.yml for dockercd:
volumes:
  - ./applications:/config/applications:ro
```

### Via REST API

```bash
curl -X POST http://localhost:8080/api/v1/applications \
  -H "Content-Type: application/json" \
  -d '{
    "apiVersion": "dockercd/v1",
    "kind": "Application",
    "metadata": {"name": "my-app"},
    "spec": {
      "source": {
        "repoURL": "https://github.com/org/repo.git",
        "targetRevision": "main",
        "path": "deploy/",
        "composeFiles": ["docker-compose.yml"]
      },
      "destination": {
        "dockerHost": "unix:///var/run/docker.sock",
        "projectName": "my-app"
      },
      "syncPolicy": {
        "automated": true,
        "prune": true,
        "selfHeal": true,
        "pollInterval": "180s"
      }
    }
  }'
```

### Via CLI

```bash
dockercd app create --file my-app.yaml
```

---

## 8. Examples

### Minimal

The smallest valid manifest. All optional fields take their defaults.

```yaml
apiVersion: dockercd/v1
kind: Application
metadata:
  name: my-app
spec:
  source:
    repoURL: https://github.com/org/my-app.git
```

Defaults applied:
- `targetRevision: main`
- `path: .`
- `composeFiles: [docker-compose.yml]`
- `dockerHost: unix:///var/run/docker.sock`
- `projectName: my-app`
- `automated: false`
- `pollInterval: 180s`

---

### GitHub (standalone install, manual sync)

Track a private GitHub repository. A personal access token is set via `DOCKERCD_GIT_TOKEN` environment variable — no credentials in the manifest.

```yaml
apiVersion: dockercd/v1
kind: Application
metadata:
  name: website
spec:
  source:
    repoURL: https://github.com/myorg/website.git
    targetRevision: main
    path: deploy/
    composeFiles:
      - docker-compose.yml
      - docker-compose.prod.yml
  destination:
    dockerHost: unix:///var/run/docker.sock
    projectName: website
  syncPolicy:
    automated: false    # review before deploying — UI/API sync required
    prune: true
    selfHeal: false
    pollInterval: 5m
```

---

### Gitea (bundle install, fully automated)

Self-hosted GitOps via a local Gitea instance. Credentials embedded in the URL so no env var is needed. Both automated sync and self-heal are enabled for fully hands-off operation.

```yaml
apiVersion: dockercd/v1
kind: Application
metadata:
  name: api-server
spec:
  source:
    repoURL: http://dockercd:dockercd123@gitea:3000/dockercd/api-server.git
    targetRevision: main
    path: applications/api-server/
    composeFiles:
      - docker-compose.yml
  destination:
    dockerHost: unix:///var/run/docker.sock
    projectName: api-server
  syncPolicy:
    automated: true
    prune: true
    selfHeal: true
    pollInterval: 180s
```

---

### Multi-file compose (base + environment overlay)

Use multiple compose files to separate base configuration from environment-specific overrides. Files are merged left-to-right: later files override earlier ones.

```yaml
apiVersion: dockercd/v1
kind: Application
metadata:
  name: backend
spec:
  source:
    repoURL: https://github.com/org/backend.git
    targetRevision: main
    path: deploy/
    composeFiles:
      - docker-compose.yml          # base: all services, default config
      - docker-compose.prod.yml     # overrides: resource limits, replicas, image tags
  destination:
    projectName: backend
  syncPolicy:
    automated: true
    prune: true
    selfHeal: true
    pollInterval: 3m
```

---

### Sync waves (ordered deployment)

Database before migrations before application. dockercd deploys each wave sequentially, waiting for containers to reach Healthy before proceeding.

```yaml
# docker-compose.yml
services:
  db:
    image: postgres:16-alpine
    container_name: db
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app"]
      interval: 5s
      retries: 10
    labels:
      com.dockercd.sync-wave: "0"

  migrate:
    image: myapp:latest
    command: ["./migrate", "--up"]
    labels:
      com.dockercd.hook: "pre-sync"   # runs before wave 1

  api:
    image: myapp:latest
    ports:
      - "8000:8000"
    labels:
      com.dockercd.sync-wave: "1"     # deployed after db is healthy

  worker:
    image: myapp:latest
    command: ["./worker"]
    labels:
      com.dockercd.sync-wave: "2"     # deployed after api is healthy
```

---

### Pre/post-sync hooks

Run a database migration before deploy and a notification after.

```yaml
# docker-compose.yml
services:
  migrate:
    image: myapp:latest
    command: ["python", "manage.py", "migrate", "--noinput"]
    environment:
      DATABASE_URL: postgres://app:secret@db:5432/app
    labels:
      com.dockercd.hook: "pre-sync"     # blocks deploy on failure

  notify:
    image: curlimages/curl:latest
    command:
      - curl
      - -s
      - -X POST
      - -H "Content-Type: application/json"
      - -d '{"text":"Deployed myapp to production"}'
      - https://hooks.slack.com/...
    labels:
      com.dockercd.hook: "post-sync"    # failure logged, does not fail sync

  web:
    image: myapp:latest
    ports:
      - "8000:8000"
```

---

### Blue-green deployment

Zero-downtime deployments. dockercd spins up the new version alongside the old, waits for health, then cuts over.

```yaml
# docker-compose.yml
services:
  web:
    image: myapp:${IMAGE_TAG}
    ports:
      - "8000:8000"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/healthz"]
      interval: 5s
      timeout: 3s
      retries: 5
    labels:
      com.dockercd.strategy: "blue-green"
```

---

### Remote Docker host

Deploy to a remote machine via the Docker TCP socket with mutual TLS.

```yaml
apiVersion: dockercd/v1
kind: Application
metadata:
  name: edge-service
spec:
  source:
    repoURL: https://github.com/org/edge.git
    targetRevision: main
    path: deploy/
  destination:
    dockerHost: tcp://edge-host.example.com:2376
    projectName: edge-service
  syncPolicy:
    automated: true
    prune: true
    selfHeal: true
    pollInterval: 5m
    syncTimeout: 10m    # longer timeout for slower remote connection
```

Configure TLS via `DOCKERCD_TLS_CERT_PATH` pointing to a directory with `ca.pem`, `cert.pem`, `key.pem`.

---

### Pinned revision (immutable deploy)

Pin to a specific commit SHA to prevent automatic updates. No sync will occur unless the manifest is updated to a new SHA.

```yaml
apiVersion: dockercd/v1
kind: Application
metadata:
  name: payments
spec:
  source:
    repoURL: https://github.com/org/payments.git
    targetRevision: a3f8c21d9b4e7f012345678901234567890abcde
    path: deploy/
  destination:
    projectName: payments
  syncPolicy:
    automated: false    # require explicit sync after updating targetRevision
    prune: true
    selfHeal: true
    pollInterval: 5m
    syncTimeout: 10m
    healthTimeout: 5m
```

---

### Infrastructure group (postgres + gitea + registry)

Group multiple infrastructure services under one application for coordinated deployment. Use `depends_on` in the compose file to control startup ordering within the group.

```yaml
# applications/infra.yaml
apiVersion: dockercd/v1
kind: Application
metadata:
  name: infra
spec:
  source:
    repoURL: http://dockercd:dockercd123@gitea:3000/dockercd/dockercd.git
    targetRevision: main
    path: applications/infra/
    composeFiles:
      - docker-compose.yml
  destination:
    dockerHost: unix:///var/run/docker.sock
    projectName: infra
  syncPolicy:
    automated: true
    prune: true
    selfHeal: true
    pollInterval: 180s
```

```yaml
# applications/infra/docker-compose.yml
services:
  postgres:
    image: postgres:16-alpine
    container_name: postgres
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U gitea"]
      interval: 10s
      retries: 5
    environment:
      POSTGRES_USER: gitea
      POSTGRES_PASSWORD: gitea
      POSTGRES_DB: gitea
    volumes:
      - postgres-data:/var/lib/postgresql/data
    networks:
      - dockercd-net

  gitea:
    image: gitea/gitea:latest
    container_name: gitea
    restart: unless-stopped
    ports:
      - "3003:3000"
    depends_on:
      postgres:
        condition: service_healthy    # waits for pg_isready before starting
    environment:
      GITEA__database__DB_TYPE: postgres
      GITEA__database__HOST: postgres:5432
    networks:
      - dockercd-net

  registry:
    image: registry:2
    container_name: registry
    restart: unless-stopped
    ports:
      - "5050:5000"
    environment:
      REGISTRY_STORAGE_DELETE_ENABLED: "true"
    networks:
      - dockercd-net

volumes:
  postgres-data:

networks:
  dockercd-net:
    external: true
```

---

## Validation Rules

dockercd validates every manifest before persisting it. The following checks are enforced:

| Rule | Detail |
|------|--------|
| `apiVersion` must be `dockercd/v1` | Any other value is rejected |
| `kind` must be `Application` | Any other value is rejected |
| `metadata.name` is required | Must match `^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$` |
| `spec.source.repoURL` is required | Must be `https://`, `http://`, `ssh://`, or `git@` |
| `spec.source.path` must be relative | Rejects absolute paths and `..` traversal sequences |
| `spec.syncPolicy.pollInterval` minimum | Must be `>= 30s` if set |
| `spec.source.repoURL` no private IPs | Rejects `127.x`, `10.x`, `192.168.x`, `172.16-31.x` via IP address (internal service names like `gitea` are allowed) |
