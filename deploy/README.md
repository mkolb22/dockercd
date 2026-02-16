# Deploying dockercd

dockercd can deploy and manage itself via GitOps. This directory contains the deployment artifacts.

## Quick Start

### 1. Build the Docker image

```bash
cd src
make docker
```

This builds `dockercd:latest` locally.

### 2. Start dockercd

```bash
cd deploy
docker compose up -d
```

### 3. Verify

```bash
# Check health
curl http://localhost:8080/healthz

# Open the web UI
open http://localhost:8080/ui/
```

## How Self-Deployment Works

dockercd uses a two-phase bootstrap:

**Phase 1 (manual):** You run `docker compose up -d` to start dockercd for the first time. This is necessary because dockercd must exist before it can manage itself.

**Phase 2 (automatic):** Once running, dockercd reads `dockercd-app.yaml` (mounted into the container), registers itself as a managed application, and begins monitoring its own git repository. From this point forward, changes pushed to the `main` branch are automatically detected and deployed within the 3-minute poll interval.

## Files

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Production deployment descriptor |
| `dockercd-app.yaml` | Application manifest for self-monitoring |

## Configuration

All configuration is via environment variables with the `DOCKERCD_` prefix:

| Variable | Default | Purpose |
|----------|---------|---------|
| `DOCKERCD_DATA_DIR` | `/data` | SQLite database and git cache |
| `DOCKERCD_CONFIG_DIR` | `/config/applications` | Application manifest directory |
| `DOCKERCD_API_PORT` | `8080` | HTTP listen port |
| `DOCKERCD_LOG_LEVEL` | `info` | Log verbosity (debug/info/warn/error) |

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
cd src && make docker
cd ../deploy && docker compose up -d
```
