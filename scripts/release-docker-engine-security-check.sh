#!/usr/bin/env bash
# Verify the Docker Engine/plugin posture required for DockerCD release evidence.
# This script is read-only: it never creates, changes, or removes Docker objects.
set -euo pipefail

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
source "$root/scripts/recovery-drill-lib.sh"

usage() {
  cat <<'EOF'
Usage: scripts/release-docker-engine-security-check.sh --context NAME [--context NAME...]

Checks each explicitly named Docker context with bounded, noninteractive calls.
Each target must run Docker Engine 29.3.1 or newer. The output intentionally
records only the context, Engine version, and plugin/AuthZ counts—not endpoint
URLs, plugin names, credentials, or Docker object details.

Unset DOCKER_HOST and DOCKER_CONTEXT first. Run this once for every controller
deployment target as final release evidence; it does not deploy or reconfigure
DockerCD, Docker Engine, authorization plugins, or Docker plugins.
EOF
}

fail() {
  printf 'release Docker security check: %s\n' "$*" >&2
  exit 1
}

if [[ -n "${DOCKER_BIN:-}" && "${DOCKERCD_RELEASE_SECURITY_TEST_ONLY:-}" != "1" ]]; then
  fail "DOCKER_BIN overrides are permitted only in explicit test mode"
fi
docker_bin="${DOCKER_BIN:-docker}"
timeout_seconds="${DOCKERCD_RELEASE_SECURITY_TIMEOUT_SECONDS:-10}"
[[ "$timeout_seconds" =~ ^([1-9]|[1-5][0-9]|60)$ ]] || fail "timeout must be a whole number from 1 to 60"
command -v "$docker_bin" >/dev/null 2>&1 || fail "Docker client is unavailable"
command -v perl >/dev/null 2>&1 || fail "Perl with POSIX setsid is required"
[[ -z "${DOCKER_HOST:-}" && -z "${DOCKER_CONTEXT:-}" ]] || fail "unset ambient DOCKER_HOST and DOCKER_CONTEXT"

check_temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/dockercd-release-engine.XXXXXX")" || fail "cannot create private temporary directory"
chmod 0700 "$check_temp_dir"
bounded_temp_dir="$check_temp_dir"
bounded_active_state_file="$check_temp_dir/active-bounded-command"
release_cleanup_started=false
release_cleanup() {
  local status=$?
  [[ "$release_cleanup_started" == true ]] && exit "$status"
  release_cleanup_started=true
  trap - EXIT INT TERM
  set +e +u
  terminate_active_bounded_command
  rm -rf -- "$check_temp_dir"
  exit "$status"
}
trap release_cleanup EXIT
trap 'exit 130' INT TERM

run_docker() {
  bounded_command "$timeout_seconds" "$docker_bin" "$@"
}

valid_context_name() {
  [[ "$1" =~ ^[[:alnum:]_.-]+$ ]]
}

engine_is_fixed() {
  local version="$1"
  if [[ ! "$version" =~ ^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$ ]]; then
    return 1
  fi
  local major="${BASH_REMATCH[1]}" minor="${BASH_REMATCH[2]}" patch="${BASH_REMATCH[3]}"
  (( 10#$major > 29 )) || {
    (( 10#$major == 29 && 10#$minor > 3 )) || {
      (( 10#$major == 29 && 10#$minor == 3 && 10#$patch >= 1 ))
    }
  }
}

valid_engine_version() {
  [[ "$1" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]]
}

contexts=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --context)
      [[ $# -ge 2 ]] || fail "--context requires a name"
      valid_context_name "$2" || fail "context name has unsupported characters"
      contexts+=("$2")
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      usage >&2
      exit 2
      ;;
  esac
done
(( ${#contexts[@]} > 0 )) || {
  usage >&2
  exit 2
}

for context in "${contexts[@]}"; do
  version="$(run_docker --context "$context" version --format '{{.Server.Version}}')" || fail "cannot read Docker Engine version for context $context"
  [[ "$version" != *$'\n'* ]] || fail "Docker Engine returned an invalid version for context $context"
  valid_engine_version "$version" || fail "Docker Engine returned an invalid version for context $context"
  engine_is_fixed "$version" || fail "Docker Engine on context $context is below required 29.3.1"

  authz_count="$(run_docker --context "$context" info --format '{{len .Plugins.Authorization}}')" || fail "cannot read authorization-plugin posture for context $context"
  [[ "$authz_count" =~ ^[0-9]+$ ]] || fail "Docker Engine returned invalid authorization-plugin posture for context $context"
  plugin_count="$(run_docker --context "$context" plugin ls --format '{{.ID}}' | awk 'NF { count++ } END { print count + 0 }')" || fail "cannot read plugin posture for context $context"
  [[ "$plugin_count" =~ ^[0-9]+$ ]] || fail "Docker Engine returned invalid plugin posture for context $context"

  printf 'context=%s\nengine_version=%s\nauthz_plugin_count=%s\ninstalled_plugin_count=%s\nresult=pass\n' \
    "$context" "$version" "$authz_count" "$plugin_count"
done
