# Deploying dockercd

dockercd can deploy and manage itself via GitOps. This directory contains the deployment artifacts.

## Quick Start

### 1. Build the Docker image

```bash
cd src
make docker
docker tag dockercd:dev dockercd:latest
```

### 2. Set your GitHub token

For private repositories, create a fine-grained personal access token with **Contents: Read-only** permission.

```bash
export DOCKERCD_GIT_TOKEN=ghp_your_token_here
```

### 3. Bootstrap dockercd

The first deploy uses a bootstrap overlay to mount the application manifest:

```bash
cd deploy
docker compose -p dockercd -f docker-compose.yml -f docker-compose.bootstrap.yml up -d
```

This registers the `dockercd` application in the SQLite database. The `-p dockercd` flag sets the project name to match the reconciler's expected project name.

### 4. Verify

```bash
# Check health
curl http://localhost:8080/healthz

# Open the web UI
open http://localhost:8080/ui/
```

## How Self-Deployment Works

dockercd uses a two-phase bootstrap:

**Phase 1 (manual):** You run the bootstrap command above to start dockercd with the application manifest mounted. On startup, it reads `dockercd-app.yaml`, registers itself as a managed application, and stores the registration in SQLite.

**Phase 2 (automatic):** The reconciler clones the git repository, detects drift between the compose file and the live container, and runs `docker compose up -d` to reconcile. Since the app registration is persisted in the named volume, subsequent container restarts no longer need the bind-mounted manifest. From this point forward, changes pushed to the `main` branch are automatically detected and deployed within the 3-minute poll interval.

## Files

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Production deployment descriptor (used by reconciler) |
| `docker-compose.bootstrap.yml` | Bootstrap overlay that mounts the app manifest |
| `dockercd-app.yaml` | Application manifest for self-monitoring |

## Configuration

All configuration is via environment variables with the `DOCKERCD_` prefix:

| Variable | Default | Purpose |
|----------|---------|---------|
| `DOCKERCD_DATA_DIR` | `/data` | SQLite database and git cache |
| `DOCKERCD_CONFIG_DIR` | `/config/applications` | Application manifest directory |
| `DOCKERCD_API_PORT` | `8080` | HTTP listen port |
| `DOCKERCD_LOG_LEVEL` | `info` | Log verbosity (debug/info/warn/error) |
| `DOCKERCD_GIT_TOKEN` | *(empty)* | GitHub PAT for private repo access |

## Persistent State

The `dockercd-state` named volume stores the SQLite database at `/data/dockercd.db`. This volume persists across container restarts, preserving application registrations, sync history, and events.

To back up:

```bash
docker run --rm -v dockercd-state:/data -v $(pwd):/backup alpine \
  cp /data/dockercd.db /backup/dockercd-backup.db
```

## Updating

Once self-deployment is active, push changes to the `main` branch and dockercd will automatically update itself. For manual updates:

```bash
cd src && make docker && docker tag dockercd:dev dockercd:latest
cd ../deploy && docker compose -p dockercd up -d
```
