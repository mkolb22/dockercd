#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# dockercd Installation Script
#
# Install modes:
#   standalone  — dockercd only; GitOps source is GitHub
#   bundle      — dockercd + Docker Registry; GitOps source is GitHub
#   full        — bundle + Prometheus / Grafana monitoring
#
# Usage:
#   ./install.sh                     # interactive mode selector
#   ./install.sh --mode standalone
#   ./install.sh --mode bundle
#   ./install.sh --mode full
# =============================================================================

# --- Defaults -----------------------------------------------------------------
DOCKERCD_PORT=8080
REGISTRY_PORT=5050
GRAFANA_PORT=3001
PROMETHEUS_PORT=9090
CADVISOR_PORT=8081

NETWORK=dockercd-net
GITHUB_REPO_URL="https://github.com/mkolb22/dockercd.git"
DOCKERCD_API="http://localhost:${DOCKERCD_PORT}/api/v1"

INSTALL_MODE=""

# --- Colors -------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# --- Argument parsing ---------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case $1 in
    --mode)
      INSTALL_MODE="$2"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 [--mode standalone|bundle|full]"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1"
      exit 1
      ;;
  esac
done

# --- Helper Functions ---------------------------------------------------------

log_info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
log_ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }
log_step()  { echo -e "\n${BOLD}${CYAN}=> $*${NC}"; }

# Register an application via the dockercd API
# Usage: register_app NAME REPO_URL REVISION PATH PROJECT [AUTOMATED]
register_app() {
  local name="$1"
  local repo_url="$2"
  local revision="$3"
  local path="$4"
  local project="$5"
  local automated="${6:-true}"

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

  local body code
  body=$(echo "$resp" | sed '$d')
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

# Check if a port is in use
check_port() {
  local port="$1"
  local service="$2"
  if lsof -i :"$port" > /dev/null 2>&1; then
    log_warn "Port ${port} is already in use (needed by ${service})"
    return 1
  fi
  return 0
}

# Trigger a sync for an application
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

# --- Pre-flight Checks --------------------------------------------------------

log_step "Pre-flight checks"

for cmd in docker git make curl; do
  if ! command -v "$cmd" > /dev/null 2>&1; then
    log_error "'${cmd}' is required but not found in PATH"
    exit 1
  fi
done

if docker compose version > /dev/null 2>&1; then
  log_ok "docker compose available"
elif command -v docker-compose > /dev/null 2>&1; then
  log_ok "docker-compose (standalone) available"
else
  log_error "'docker compose' plugin is required but not found"
  exit 1
fi

if ! docker info > /dev/null 2>&1; then
  log_error "Docker daemon is not running"
  exit 1
fi
log_ok "Docker daemon is running"

if [ ! -f "src/Makefile" ]; then
  log_error "Must be run from the dockercd repo root (src/Makefile not found)"
  exit 1
fi
log_ok "Running from repo root"

# --- Mode Selection -----------------------------------------------------------

if [ -z "$INSTALL_MODE" ]; then
  echo ""
  echo -e "${BOLD}DockerCD Installation${NC}"
  echo ""
  echo "  standalone  — dockercd only (GitHub GitOps)"
  echo "  bundle      — dockercd + Docker Registry (GitHub GitOps)"
  echo "  full        — bundle + Prometheus / Grafana monitoring"
  echo ""
  read -rp "Select mode [standalone/bundle/full]: " INSTALL_MODE
fi

case "$INSTALL_MODE" in
  standalone|bundle|full) ;;
  *)
    log_error "Invalid mode: ${INSTALL_MODE} (choose standalone, bundle, or full)"
    exit 1
    ;;
esac

log_ok "Install mode: ${INSTALL_MODE}"

# --- Port Checks --------------------------------------------------------------

log_step "Checking ports"

port_warnings=0
check_port "$DOCKERCD_PORT" "dockercd" || port_warnings=$((port_warnings + 1))

if [ "$INSTALL_MODE" != "standalone" ]; then
  check_port "$REGISTRY_PORT" "Registry" || port_warnings=$((port_warnings + 1))
fi

if [ "$INSTALL_MODE" = "full" ]; then
  check_port "$GRAFANA_PORT"    "Grafana"    || port_warnings=$((port_warnings + 1))
  check_port "$PROMETHEUS_PORT" "Prometheus" || port_warnings=$((port_warnings + 1))
  check_port "$CADVISOR_PORT"   "cAdvisor"   || port_warnings=$((port_warnings + 1))
fi

if [ "$port_warnings" -gt 0 ]; then
  log_warn "${port_warnings} port(s) already in use — deployment may fail"
  read -rp "Continue anyway? [y/N]: " confirm
  if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
    exit 1
  fi
else
  log_ok "All required ports are free"
fi

# --- Create Docker Network ----------------------------------------------------

log_step "Creating Docker network"
docker network create "$NETWORK" 2>/dev/null && \
  log_ok "Created network '${NETWORK}'" || \
  log_ok "Network '${NETWORK}' already exists"

# --- Build dockercd -----------------------------------------------------------

log_step "Building dockercd"
(cd src && make docker)
docker tag dockercd:dev dockercd:latest
log_ok "Built and tagged dockercd:latest"

# =============================================================================
# STANDALONE MODE
# Deploy dockercd alone. GitOps source is GitHub.
# =============================================================================

if [ "$INSTALL_MODE" = "standalone" ]; then

  log_step "Deploying dockercd (standalone)"

  docker compose -p dockercd -f deploy/docker-compose.yml up -d

  log_info "Waiting for dockercd to become healthy..."
  wait_healthy "http://localhost:${DOCKERCD_PORT}/healthz" 90
  log_ok "dockercd is healthy at http://localhost:${DOCKERCD_PORT}"

  register_app "dockercd" "$GITHUB_REPO_URL" "main" "deploy/" "dockercd" "false"

fi

# =============================================================================
# BUNDLE MODE (also used by full)
# Deploys dockercd + Docker Registry. GitOps source is GitHub.
# =============================================================================

if [ "$INSTALL_MODE" = "bundle" ] || [ "$INSTALL_MODE" = "full" ]; then

  # --- Step 1: Bring up infra (registry) ------------------------------------

  log_step "Deploying infrastructure (Docker Registry)"

  docker compose -p infra -f applications/infra/docker-compose.yml up -d

  log_info "Waiting for Registry..."
  wait_healthy "http://localhost:${REGISTRY_PORT}/v2/" 60 && \
    log_ok "Registry is ready at http://localhost:${REGISTRY_PORT}" || \
    log_warn "Registry may still be starting"

  # --- Step 2: Start dockercd with bootstrap overlay ------------------------
  #
  # The bootstrap overlay mounts applications/ into /config/applications.
  # dockercd reads the YAML manifests on startup — both reference GitHub:
  #   - applications/dockercd.yaml  → repoURL: github.com/... (self-monitor)
  #   - applications/infra.yaml     → repoURL: github.com/... (registry)

  log_step "Deploying dockercd (bundle mode)"

  docker compose \
    -p dockercd \
    -f deploy/docker-compose.yml \
    -f deploy/docker-compose.bootstrap.yml \
    up -d

  log_info "Waiting for dockercd to become healthy..."
  wait_healthy "http://localhost:${DOCKERCD_PORT}/healthz" 90
  log_ok "dockercd is healthy at http://localhost:${DOCKERCD_PORT}"

  # --- Step 3: Trigger initial sync -----------------------------------------

  log_step "Triggering initial sync"

  sleep 5

  for app in dockercd infra; do
    sync_app "$app" || true
  done

fi

# =============================================================================
# FULL MODE — Monitoring stack on top of bundle
# =============================================================================

if [ "$INSTALL_MODE" = "full" ]; then

  log_step "Deploying monitoring stack (Prometheus, Grafana, cAdvisor)"

  log_info "Monitoring stack (Prometheus/Grafana/cAdvisor) is managed via"
  log_info "the dockercd-apps GitOps repository. Register via the UI or API:"
  log_info "  POST ${DOCKERCD_API}/applications"
  log_info "  path: applications/monitoring/, project: monitoring"
  log_warn "Skipping auto-setup of monitoring — register via dockercd UI after startup"

fi

# --- Summary ------------------------------------------------------------------

log_step "Installation complete!"

echo ""
echo -e "${BOLD}Services:${NC}"
echo ""
printf "  %-22s %-42s %s\n" "Service" "URL" "Credentials"
printf "  %-22s %-42s %s\n" "-------" "---" "-----------"
printf "  %-22s %-42s %s\n" "dockercd UI" \
  "http://localhost:${DOCKERCD_PORT}/ui/" ""
printf "  %-22s %-42s %s\n" "dockercd API" \
  "http://localhost:${DOCKERCD_PORT}/api/v1/" ""

if [ "$INSTALL_MODE" != "standalone" ]; then
  printf "  %-22s %-42s %s\n" "Registry" \
    "http://localhost:${REGISTRY_PORT}" ""
fi

if [ "$INSTALL_MODE" = "full" ]; then
  printf "  %-22s %-42s %s\n" "Grafana" \
    "http://localhost:${GRAFANA_PORT}" "admin / admin (after setup)"
  printf "  %-22s %-42s %s\n" "Prometheus" \
    "http://localhost:${PROMETHEUS_PORT}" ""
  printf "  %-22s %-42s %s\n" "cAdvisor" \
    "http://localhost:${CADVISOR_PORT}" ""
fi

echo ""

if [ "$INSTALL_MODE" = "standalone" ]; then
  log_ok "Standalone install complete."
  log_info "GitOps source: ${GITHUB_REPO_URL}"
  log_info "Sync is manual — use the UI or API to trigger syncs."
else
  log_ok "Bundle install complete."
  log_info "GitOps source: ${GITHUB_REPO_URL}"
  log_info "Push to GitHub → dockercd auto-syncs within 3 minutes."
fi

echo ""
log_ok "Open http://localhost:${DOCKERCD_PORT}/ui/ to get started."
