# Getting Started with dockercd

## The Two-Repository Pattern

dockercd is a tool, not a config store. The most important architectural decision you will make before your first deployment is this:

**Your application manifests and compose files should live in a repository you own — not in the dockercd repository.**

This is the same principle ArgoCD, Flux, and every mature GitOps system enforces. The dockercd repo contains the engine. Your config repo contains the desired state of your infrastructure. Keeping them separate gives you:

- **Independence** — upgrade dockercd without touching your app configuration, and modify your apps without needing to clone or fork dockercd
- **Privacy** — your config repo can be private and contain environment-specific details; the dockercd repo is a public tool
- **Clean history** — your config repo's Git log is a pure audit trail of infrastructure changes, not interleaved with tool commits
- **Multi-instance** — two dockercd instances (dev and prod) can each point at their own config repo, or different branches of the same one
- **Collaboration** — teammates submit pull requests against your config repo to propose infrastructure changes; dockercd reconciles them on merge

---

## Repository Architecture

```
┌──────────────────────────────────┐     ┌──────────────────────────────────┐
│       dockercd repo              │     │       your config repo           │
│  github.com/mkolb22/dockercd     │     │  github.com/you/my-infra         │
│                                  │     │  (or private Gitea repo)         │
│  src/          ← Go source       │     │                                  │
│  docs/         ← documentation   │     │  apps/                           │
│  install.sh    ← installer       │     │    web-app/                      │
│  deploy/       ← dockercd itself │     │      manifest.yaml               │
│                                  │     │      docker-compose.yml          │
│  You deploy this once.           │     │    api-service/                  │
│  You do not put your apps here.  │     │      manifest.yaml               │
└──────────────────────────────────┘     │      docker-compose.yml          │
                                         │      docker-compose.prod.yml     │
              dockercd watches ─────────>│    infra/                        │
              your config repo           │      manifest.yaml               │
              and reconciles it          │      docker-compose.yml          │
              against your live          │                                  │
              Docker environment         │  You own this. You push to it.   │
                                         │  dockercd reconciles from it.    │
                                         └──────────────────────────────────┘
```

dockercd pulls from your config repo on a configurable poll interval (default 3 minutes) and/or immediately on a Git push webhook. Every change you commit is automatically reflected in your running containers.

---

## Config Repo Layouts

### Option A: Monorepo (Recommended for Most Users)

All application manifests and compose files in a single repository. Simple to manage, easy to see the full picture.

```
my-infra/
├── apps/
│   ├── web-app/
│   │   ├── manifest.yaml           # dockercd Application manifest
│   │   ├── docker-compose.yml      # service definition
│   │   └── docker-compose.prod.yml # production overrides (optional)
│   ├── api-service/
│   │   ├── manifest.yaml
│   │   └── docker-compose.yml
│   └── postgres/
│       ├── manifest.yaml
│       └── docker-compose.yml
└── README.md
```

Each `manifest.yaml` points back into the same repository:

```yaml
# apps/web-app/manifest.yaml
apiVersion: dockercd/v1
kind: Application
metadata:
  name: web-app
spec:
  source:
    repoURL: https://github.com/you/my-infra.git
    targetRevision: main
    path: apps/web-app/
    composeFiles:
      - docker-compose.yml
      - docker-compose.prod.yml
  destination:
    dockerHost: unix:///var/run/docker.sock
    projectName: web-app
  syncPolicy:
    automated: true
    prune: true
    selfHeal: true
    pollInterval: 180s
```

### Option B: Per-App Repositories

Each application lives in its own repository. Useful when different teams own different services and need fully independent access controls and deployment pipelines.

```
github.com/you/web-app/
├── docker-compose.yml
├── docker-compose.prod.yml
└── deploy/
    └── manifest.yaml          # manifest.yaml can live here or be registered separately

github.com/you/api-service/
├── docker-compose.yml
└── manifest.yaml

github.com/you/infra-config/
├── postgres/
│   └── manifest.yaml          # points to github.com/you/postgres-config
└── monitoring/
    └── manifest.yaml
```

### Option C: Branch-per-Environment

Use the `targetRevision` field to deploy different branches to different environments from the same repository:

```yaml
# Production — tracks main
spec:
  source:
    repoURL: https://github.com/you/my-infra.git
    targetRevision: main

# Staging — tracks staging branch
spec:
  source:
    repoURL: https://github.com/you/my-infra.git
    targetRevision: staging
```

---

## Step-by-Step: Standalone Mode (GitHub)

Use this when you want a minimal footprint with GitHub as your Git host.

### 1. Create your config repository

Create a new **private** repository on GitHub — for example `github.com/you/my-infra`.

### 2. Lay out your first application

```bash
mkdir -p my-infra/apps/my-app
cd my-infra
```

Create `apps/my-app/docker-compose.yml`:

```yaml
services:
  web:
    image: nginx:1.25-alpine
    ports:
      - "80:80"
    restart: unless-stopped
```

Create `apps/my-app/manifest.yaml`:

```yaml
apiVersion: dockercd/v1
kind: Application
metadata:
  name: my-app
spec:
  source:
    repoURL: https://github.com/you/my-infra.git
    targetRevision: main
    path: apps/my-app/
    composeFiles:
      - docker-compose.yml
  destination:
    dockerHost: unix:///var/run/docker.sock
    projectName: my-app
  syncPolicy:
    automated: true
    prune: true
    selfHeal: true
```

Push to GitHub:

```bash
git init && git add . && git commit -m "Add my-app"
git remote add origin https://github.com/you/my-infra.git
git push -u origin main
```

### 3. Deploy dockercd

Clone the dockercd repo and build the image:

```bash
git clone https://github.com/mkolb22/dockercd.git
cd dockercd
cd src && make docker && docker tag dockercd:dev dockercd:latest && cd ..
```

Run the installer:

```bash
./install.sh --mode standalone
```

When prompted for your Git token, provide a GitHub PAT with `repo` read access to your config repo.

### 4. Register your application

After dockercd starts, register your app by pointing it at your config repo manifest:

```bash
curl -X POST http://localhost:8080/api/v1/applications \
  -H "Content-Type: application/json" \
  -d '{
    "apiVersion": "dockercd/v1",
    "kind": "Application",
    "metadata": {"name": "my-app"},
    "spec": {
      "source": {
        "repoURL": "https://github.com/you/my-infra.git",
        "targetRevision": "main",
        "path": "apps/my-app/",
        "composeFiles": ["docker-compose.yml"]
      },
      "destination": {
        "dockerHost": "unix:///var/run/docker.sock",
        "projectName": "my-app"
      },
      "syncPolicy": {
        "automated": true,
        "prune": true,
        "selfHeal": true
      }
    }
  }'
```

Or drop `apps/my-app/manifest.yaml` into the `DOCKERCD_CONFIG_DIR` directory (mounted into the container) — dockercd will pick it up automatically.

### 5. Verify

Open `http://localhost:8080/ui/` — your app appears, syncs, and turns green within one poll cycle (default 3 minutes, or trigger manually via **Sync**).

From this point forward: **any commit you push to `my-infra` is automatically deployed.**

---

## Step-by-Step: Bundle Mode (Self-Hosted Gitea)

Use this when you want a fully self-contained GitOps stack with no internet dependency after initial setup.

### 1. Deploy the full stack

```bash
./install.sh --mode bundle
```

This brings up dockercd + Gitea + Docker Registry + PostgreSQL. Open Gitea at `http://localhost:3003` and complete the setup wizard.

### 2. Create your config repository in Gitea

Log into Gitea and create a new repository — for example `my-infra`.

### 3. Push your config

```bash
git remote add gitea http://your-user:your-pass@localhost:3003/your-user/my-infra.git
git push gitea main
```

### 4. Register your application using Gitea as the source

The key difference from standalone mode is the `repoURL` — use the internal Gitea hostname (`gitea:3000`) so that dockercd can reach it from inside Docker:

```yaml
apiVersion: dockercd/v1
kind: Application
metadata:
  name: my-app
spec:
  source:
    repoURL: http://your-user:your-pass@gitea:3000/your-user/my-infra.git
    targetRevision: main
    path: apps/my-app/
    composeFiles:
      - docker-compose.yml
  destination:
    dockerHost: unix:///var/run/docker.sock
    projectName: my-app
  syncPolicy:
    automated: true
    prune: true
    selfHeal: true
```

### 5. (Optional) Configure a push webhook for instant deploys

In Gitea → your repo → Settings → Webhooks, add:

- **URL**: `http://dockercd:8080/api/v1/webhook/git`
- **Secret**: the value of `DOCKERCD_WEBHOOK_SECRET`
- **Events**: Push events

With a webhook configured, deploys trigger in seconds instead of waiting for the poll interval.

---

## What Belongs in Your Config Repo

| Belongs here | Does not belong here |
|---|---|
| `docker-compose.yml` files | Application source code |
| `docker-compose.prod.yml` overrides | Dockerfiles |
| dockercd `manifest.yaml` files | Built artifacts or images |
| `.env` template files (no secrets) | Secrets or credentials in plaintext |
| Environment-specific config | The dockercd tool itself |

For secrets, use [age-encrypted `.env.age` files](application-manifest.md#env-files-and-secrets) or a Vault/AWS Secrets Manager reference. Never commit plaintext credentials.

---

## Recommended File Naming

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Base service definition |
| `docker-compose.prod.yml` | Production overrides (image tags, resource limits, restart policies) |
| `docker-compose.dev.yml` | Development overrides (bind mounts, debug ports) |
| `manifest.yaml` | dockercd Application manifest |
| `.env.example` | Template showing required variables (no values) |
| `.env.age` | Age-encrypted secrets file |

---

## Further Reading

- [Application Manifest Reference](application-manifest.md) — all manifest fields, Docker Compose labels, secrets
- [Engineering Architecture](design.md) — how the reconciliation engine works internally
