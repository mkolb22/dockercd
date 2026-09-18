#!/usr/bin/env bash
set -euo pipefail

# Starts only the isolated development pair: dockercd and dockercd-web.
# It deliberately performs no image build, Git bootstrap, application sync,
# network sharing, or personal-environment action.

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
env_file="${repo_dir}/deploy/.env"

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "Docker Engine and the Docker Compose plugin are required." >&2
  exit 1
fi

if [ ! -f "$env_file" ]; then
  echo "Create deploy/.env from deploy/.env.example and provision its two local secret files first." >&2
  exit 1
fi

docker compose --env-file "$env_file" -f "${repo_dir}/deploy/docker-compose.yml" config --quiet
docker compose --env-file "$env_file" -f "${repo_dir}/deploy/docker-compose.yml" up -d

echo "Development controller API: http://127.0.0.1:${DOCKERCD_DEV_API_PORT:-18080}"
echo "Development Web service:   http://127.0.0.1:${DOCKERCD_DEV_WEB_PORT:-18092} (serve through configured HTTPS proxy)"
