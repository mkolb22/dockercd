#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# dockercd Installation Script
# Bootstraps dockercd with optional GitOps and monitoring infrastructure
# =============================================================================

# --- Constants ----------------------------------------------------------------
DOCKERCD_PORT=8080
GITEA_PORT=3003
REGISTRY_PORT=5050
GRAFANA_PORT=3001
PROMETHEUS_PORT=9090
CADVISOR_PORT=8081
POSTGRES_PORT=5432
GITEA_USER=dockercd
GITEA_PASS=dockercd123
GITEA_EMAIL=dockercd@local
NETWORK=dockercd-net
REPO_URL="https://github.com/mkolb22/dockercd.git"
DOCKERCD_API="http://localhost:${DOCKERCD_PORT}/api/v1"

# --- Colors -------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# --- Helper Functions ---------------------------------------------------------

log_info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
log_ok()      { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $*"; }
log_step()    { echo -e "\n${BOLD}${CYAN}=> $*${NC}"; }

# Wait for an HTTP endpoint to return 200
# Usage: wait_healthy URL [timeout_seconds]
wait_healthy() {
  local url="$1"
  local timeout="${2:-60}"
  local elapsed=0

  while [ $elapsed -lt $timeout ]; do
    if curl -sf --max-time 3 "$url" > /dev/null 2>&1; then
      return 0
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done

  log_error "Timed out waiting for $url (${timeout}s)"
  return 1
}

# Register an application via the dockercd API
# Usage: register_app NAME REPO_URL REVISION PATH PROJECT [AUTOMATED]
register_app() {
  local name="$1"
  local repo_url="$2"
  local revision="$3"
  local path="$4"
  local project="$5"
  local automated="${6:-true}"

  # Check if app already exists
  local status_code
  status_code=$(curl -s -o /dev/null -w "%{http_code}" "${DOCKERCD_API}/applications/${name}")
  if [ "$status_code" = "200" ]; then
    log_ok "Application '${name}' already registered"
    return 0
  fi

  local prune="true"
  local selfheal="true"
  if [ "$automated" = "false" ]; then
    prune="false"
    selfheal="false"
  fi

  local payload
  payload=$(cat <<EOF
{
  "apiVersion": "dockercd/v1",
  "kind": "Application",
  "metadata": { "name": "${name}" },
  "spec": {
    "source": {
      "repoURL": "${repo_url}",
      "targetRevision": "${revision}",
      "path": "${path}",
      "composeFiles": ["docker-compose.yml"]
    },
    "destination": {
      "dockerHost": "unix:///var/run/docker.sock",
      "projectName": "${project}"
    },
    "syncPolicy": {
      "automated": ${automated},
      "prune": ${prune},
      "selfHeal": ${selfheal},
      "pollInterval": "180s"
    }
  }
}
EOF
)

  local resp
  resp=$(curl -s -w "\n%{http_code}" -X POST "${DOCKERCD_API}/applications" \
    -H "Content-Type: application/json" \
    -d "$payload")

  local body
  body=$(echo "$resp" | head -n -1)
  local code
  code=$(echo "$resp" | tail -n 1)

  if [ "$code" = "201" ]; then
    log_ok "Registered application '${name}'"
  elif [ "$code" = "409" ]; then
    log_ok "Application '${name}' already exists"
  else
    log_error "Failed to register '${name}' (HTTP ${code}): ${body}"
    return 1
  fi
}

# Trigger a sync for an application
# Usage: sync_app NAME
sync_app() {
  local name="$1"
  local resp
  resp=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${DOCKERCD_API}/applications/${name}/sync")
  if [ "$resp" = "200" ] || [ "$resp" = "202" ]; then
    log_ok "Triggered sync for '${name}'"
  else
    log_warn "Sync trigger for '${name}' returned HTTP ${resp}"
  fi
}

# Check if a port is in use
# Usage: check_port PORT SERVICE_NAME
check_port() {
  local port="$1"
  local service="$2"
  if lsof -i :"$port" > /dev/null 2>&1; then
    log_warn "Port ${port} is already in use (needed by ${service})"
    return 1
  fi
  return 0
}

# --- Pre-flight Checks --------------------------------------------------------

log_step "Pre-flight checks"

# Required commands
for cmd in docker git make curl; do
  if ! command -v "$cmd" > /dev/null 2>&1; then
    log_error "'${cmd}' is required but not found in PATH"
    exit 1
  fi
done

# Docker compose (plugin or standalone)
if docker compose version > /dev/null 2>&1; then
  log_ok "docker compose available"
elif command -v docker-compose > /dev/null 2>&1; then
  log_ok "docker-compose (standalone) available"
else
  log_error "'docker compose' plugin is required but not found"
  exit 1
fi

# Docker daemon running
if ! docker info > /dev/null 2>&1; then
  log_error "Docker daemon is not running"
  exit 1
fi
log_ok "Docker daemon is running"

# Repo root check
if [ ! -f "src/Makefile" ]; then
  log_error "Must be run from the dockercd repo root (src/Makefile not found)"
  exit 1
fi
log_ok "Running from repo root"

# --- Tier Selection -----------------------------------------------------------

echo ""
echo -e "${BOLD}DockerCD Installation${NC}"
echo ""
echo "  1) DockerCD only (minimal)"
echo "  2) DockerCD + Gitea + Registry (GitOps-ready)"
echo "  3) DockerCD + Gitea + Registry + Monitoring (full stack)"
echo ""
read -rp "Select option [1-3]: " TIER

case "$TIER" in
  1|2|3) ;;
  *)
    log_error "Invalid option: ${TIER}"
    exit 1
    ;;
esac

# --- Port Checks --------------------------------------------------------------

log_step "Checking ports"

port_warnings=0
check_port "$DOCKERCD_PORT" "dockercd"     || port_warnings=$((port_warnings + 1))

if [ "$TIER" -ge 2 ]; then
  check_port "$GITEA_PORT"    "Gitea"      || port_warnings=$((port_warnings + 1))
  check_port "$REGISTRY_PORT" "Registry"   || port_warnings=$((port_warnings + 1))
  check_port "$POSTGRES_PORT" "PostgreSQL" || port_warnings=$((port_warnings + 1))
fi

if [ "$TIER" -ge 3 ]; then
  check_port "$GRAFANA_PORT"    "Grafana"    || port_warnings=$((port_warnings + 1))
  check_port "$PROMETHEUS_PORT" "Prometheus" || port_warnings=$((port_warnings + 1))
  check_port "$CADVISOR_PORT"   "cAdvisor"   || port_warnings=$((port_warnings + 1))
fi

if [ "$port_warnings" -eq 0 ]; then
  log_ok "All required ports are free"
else
  log_warn "${port_warnings} port(s) already in use — deployment may fail"
  read -rp "Continue anyway? [y/N]: " confirm
  if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
    exit 1
  fi
fi

# --- Step 1: Docker Network ---------------------------------------------------

log_step "Creating Docker network"

docker network create "$NETWORK" 2>/dev/null && log_ok "Created network '${NETWORK}'" || log_ok "Network '${NETWORK}' already exists"

# --- Step 2: Build dockercd ---------------------------------------------------

log_step "Building dockercd"

(cd src && make docker)
docker tag dockercd:dev dockercd:latest
log_ok "Built and tagged dockercd:latest"

# --- Step 3: Deploy dockercd --------------------------------------------------

log_step "Deploying dockercd"

docker compose -p dockercd -f deploy/docker-compose.yml up -d
log_info "Waiting for dockercd to become healthy..."
wait_healthy "http://localhost:${DOCKERCD_PORT}/healthz" 90
log_ok "dockercd is healthy at http://localhost:${DOCKERCD_PORT}"

# Register dockercd self-monitoring app (manual sync — it manages itself)
register_app "dockercd" "$REPO_URL" "main" "deploy/" "dockercd" "false"

# --- Step 4: Infrastructure (Tier 2+) ----------------------------------------

if [ "$TIER" -ge 2 ]; then
  log_step "Deploying infrastructure (PostgreSQL, Gitea, Registry)"

  # Register and sync infra (PostgreSQL)
  register_app "infra" "$REPO_URL" "main" "applications/infra/" "infra"
  sync_app "infra"
  log_info "Waiting for PostgreSQL..."
  sleep 10
  # Wait for postgres container health
  local_timeout=60
  local_elapsed=0
  while [ $local_elapsed -lt $local_timeout ]; do
    pg_status=$(docker inspect --format='{{.State.Health.Status}}' postgres 2>/dev/null || echo "missing")
    if [ "$pg_status" = "healthy" ]; then
      break
    fi
    sleep 3
    local_elapsed=$((local_elapsed + 3))
  done
  if [ "$pg_status" = "healthy" ]; then
    log_ok "PostgreSQL is healthy"
  else
    log_warn "PostgreSQL health check timed out (status: ${pg_status})"
  fi

  # Register and sync Gitea
  register_app "gitea" "$REPO_URL" "main" "applications/gitea/" "gitea"
  sync_app "gitea"
  log_info "Waiting for Gitea..."
  wait_healthy "http://localhost:${GITEA_PORT}/api/v1/version" 120 && \
    log_ok "Gitea is ready at http://localhost:${GITEA_PORT}" || \
    log_warn "Gitea may still be starting up"

  # Register and sync Registry
  register_app "registry" "$REPO_URL" "main" "applications/registry/" "registry"
  sync_app "registry"
  log_info "Waiting for Registry..."
  wait_healthy "http://localhost:${REGISTRY_PORT}/v2/" 60 && \
    log_ok "Registry is ready at http://localhost:${REGISTRY_PORT}" || \
    log_warn "Registry may still be starting up"

  # --- Step 5: Gitea Bootstrap ------------------------------------------------

  log_step "Bootstrapping Gitea"

  # Create admin user (idempotent — ignores error if user exists)
  log_info "Creating Gitea admin user '${GITEA_USER}'..."
  docker exec gitea gitea admin user create \
    --admin \
    --username "$GITEA_USER" \
    --password "$GITEA_PASS" \
    --email "$GITEA_EMAIL" \
    --must-change-password=false \
    --config /data/gitea/conf/app.ini 2>/dev/null && \
    log_ok "Created Gitea admin user '${GITEA_USER}'" || \
    log_ok "Gitea admin user '${GITEA_USER}' already exists"

  # Create dockercd repo via API
  log_info "Creating repository 'dockercd/dockercd'..."
  repo_resp=$(curl -s -o /dev/null -w "%{http_code}" \
    -u "${GITEA_USER}:${GITEA_PASS}" \
    -X POST "http://localhost:${GITEA_PORT}/api/v1/user/repos" \
    -H "Content-Type: application/json" \
    -d '{"name":"dockercd","auto_init":false,"private":false}')
  if [ "$repo_resp" = "201" ]; then
    log_ok "Created Gitea repo 'dockercd/dockercd'"
  elif [ "$repo_resp" = "409" ]; then
    log_ok "Gitea repo 'dockercd/dockercd' already exists"
  else
    log_warn "Gitea repo creation returned HTTP ${repo_resp}"
  fi

  # Add gitea remote and push
  gitea_remote_url="http://${GITEA_USER}:${GITEA_PASS}@localhost:${GITEA_PORT}/${GITEA_USER}/dockercd.git"
  if git remote get-url gitea > /dev/null 2>&1; then
    log_ok "Git remote 'gitea' already exists"
  else
    git remote add gitea "$gitea_remote_url"
    log_ok "Added git remote 'gitea'"
  fi

  log_info "Pushing to Gitea..."
  git push gitea main 2>/dev/null && \
    log_ok "Pushed to Gitea" || \
    log_warn "Push to Gitea failed (may need manual intervention)"
fi

# --- Step 6: Monitoring (Tier 3) ---------------------------------------------

if [ "$TIER" -ge 3 ]; then
  log_step "Deploying monitoring stack (Prometheus, Grafana, cAdvisor)"

  register_app "monitoring" "$REPO_URL" "main" "applications/monitoring/" "monitoring"
  sync_app "monitoring"

  log_info "Waiting for Grafana..."
  wait_healthy "http://localhost:${GRAFANA_PORT}/api/health" 90 && \
    log_ok "Grafana is ready at http://localhost:${GRAFANA_PORT}" || \
    log_warn "Grafana may still be starting up"

  # Import Grafana dashboards
  log_info "Importing Grafana dashboards..."

  for dashboard_id in 14282 893; do
    # Fetch dashboard JSON from Grafana.com (revision 1)
    dash_json=$(curl -sf "https://grafana.com/api/dashboards/${dashboard_id}/revisions/1/download" 2>/dev/null || echo "")
    if [ -n "$dash_json" ]; then
      import_payload=$(cat <<DASH
{
  "dashboard": ${dash_json},
  "overwrite": true,
  "inputs": [{"name": "DS_PROMETHEUS", "type": "datasource", "pluginId": "prometheus", "value": "Prometheus"}]
}
DASH
)
      import_resp=$(curl -s -o /dev/null -w "%{http_code}" \
        -u "admin:admin" \
        -X POST "http://localhost:${GRAFANA_PORT}/api/dashboards/import" \
        -H "Content-Type: application/json" \
        -d "$import_payload")
      if [ "$import_resp" = "200" ]; then
        log_ok "Imported Grafana dashboard ${dashboard_id}"
      else
        log_warn "Dashboard ${dashboard_id} import returned HTTP ${import_resp}"
      fi
    else
      log_warn "Could not fetch dashboard ${dashboard_id} from grafana.com"
    fi
  done
fi

# --- Summary ------------------------------------------------------------------

log_step "Installation complete!"

echo ""
echo -e "${BOLD}Services:${NC}"
echo ""
printf "  %-20s %-40s %s\n" "Service" "URL" "Credentials"
printf "  %-20s %-40s %s\n" "-------" "---" "-----------"
printf "  %-20s %-40s %s\n" "dockercd" "http://localhost:${DOCKERCD_PORT}/ui/" ""
printf "  %-20s %-40s %s\n" "dockercd API" "http://localhost:${DOCKERCD_PORT}/api/v1/" ""

if [ "$TIER" -ge 2 ]; then
  printf "  %-20s %-40s %s\n" "Gitea" "http://localhost:${GITEA_PORT}" "${GITEA_USER} / ${GITEA_PASS}"
  printf "  %-20s %-40s %s\n" "Registry" "http://localhost:${REGISTRY_PORT}" ""
  printf "  %-20s %-40s %s\n" "PostgreSQL" "localhost:${POSTGRES_PORT}" "gitea / gitea"
fi

if [ "$TIER" -ge 3 ]; then
  printf "  %-20s %-40s %s\n" "Grafana" "http://localhost:${GRAFANA_PORT}" "admin / admin"
  printf "  %-20s %-40s %s\n" "Prometheus" "http://localhost:${PROMETHEUS_PORT}" ""
  printf "  %-20s %-40s %s\n" "cAdvisor" "http://localhost:${CADVISOR_PORT}" ""
fi

echo ""
log_ok "Done! Open http://localhost:${DOCKERCD_PORT}/ui/ to get started."
