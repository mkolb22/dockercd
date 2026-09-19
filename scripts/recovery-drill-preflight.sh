#!/usr/bin/env bash
# Fail closed before a recovery drill can receive Docker-daemon authority.
# The runner intentionally requires a separately provisioned disposable daemon.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: DOCKERCD_RECOVERY_DRILL_CONTEXT=<dedicated-context> \
  DOCKERCD_RECOVERY_PROTECTED_CONTEXTS=<context[,context...]> \
  scripts/recovery-drill-preflight.sh

Validates that the named Docker context is reachable, is not a protected
deployment context, and does not resolve to the same daemon identity as the
active or explicitly protected deployment contexts. It creates no Docker
objects and never reads or prints controller, Web, Git, or application secrets.

The recovery drill must use a disposable daemon: Docker network separation does
not constrain the authority of a mounted Docker socket. Do not point this at
the context hosting the development/personal DockerCD pairs or Signal.
EOF
}

fail() {
  printf 'recovery-drill preflight: %s\n' "$*" >&2
  exit 1
}

docker_bin="${DOCKER_BIN:-docker}"
probe_timeout_seconds="${DOCKERCD_RECOVERY_DRILL_TIMEOUT_SECONDS:-10}"
[[ "$probe_timeout_seconds" =~ ^([1-9]|[1-5][0-9]|60)$ ]] || fail "timeout must be a whole number from 1 to 60"
command -v perl >/dev/null 2>&1 || fail "Perl with POSIX setsid is required for bounded process-group cleanup"

probe_output=""
probe_temp=""
cleanup_probe_temp() {
  [[ -z "$probe_temp" ]] || rm -f -- "$probe_temp"
}
trap cleanup_probe_temp EXIT

# Docker contexts can be SSH/TCP endpoints. Capture diagnostics so an endpoint
# URL (which can contain credentials) never reaches terminal output, and bound
# every call so an unreachable SSH agent cannot hold a release job open.
run_docker() {
  probe_temp="$(mktemp "${TMPDIR:-/tmp}/dockercd-recovery-drill.XXXXXX")" || return 1
  # setsid gives the probe and every helper its own process group. A negative
  # PID signal below can then terminate SSH/TCP descendants even after the
  # Docker client itself exits; inherited shell process groups are unsafe.
  perl -MPOSIX=setsid -e 'setsid() or die "setsid failed"; exec @ARGV' \
    "$docker_bin" "$@" >"$probe_temp" 2>/dev/null &
  local pid=$!
  local elapsed=0
  while kill -0 "$pid" 2>/dev/null; do
    if (( elapsed >= probe_timeout_seconds * 10 )); then
      # Signal the dedicated group, not merely the direct child. A Docker
      # client can exit after forwarding TERM while an SSH helper remains.
      kill -TERM -- "-$pid" 2>/dev/null || true
      local grace=0
      while kill -0 -- "-$pid" 2>/dev/null && (( grace < 10 )); do
        sleep 0.1
        ((grace += 1))
      done
      if kill -0 -- "-$pid" 2>/dev/null; then
        kill -KILL -- "-$pid" 2>/dev/null || true
      fi
      # SIGKILL is not catchable. This wait reaps the direct child and cannot
      # block after group termination; its output remains suppressed.
      wait "$pid" 2>/dev/null || true
      cleanup_probe_temp
      probe_temp=""
      return 124
    fi
    sleep 0.1
    ((elapsed += 1))
  done
  local status=0
  wait "$pid" || status=$?
  probe_output="$(<"$probe_temp")"
  cleanup_probe_temp
  probe_temp=""
  return "$status"
}

daemon_identity() {
  local context_name="$1"
  if ! run_docker --context "$context_name" info --format '{{.ID}}'; then
    return 1
  fi
  [[ "$probe_output" =~ ^[[:alnum:]][[:alnum:].-]*$ ]] || return 1
  printf '%s\n' "$probe_output"
}

valid_context_name() {
  [[ "$1" =~ ^[[:alnum:]_.-]+$ ]]
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

[[ $# -eq 0 ]] || {
  usage >&2
  exit 2
}

drill_context="${DOCKERCD_RECOVERY_DRILL_CONTEXT:-}"
[[ -n "$drill_context" ]] || fail "DOCKERCD_RECOVERY_DRILL_CONTEXT is required"
valid_context_name "$drill_context" || fail "drill context name has unsupported characters"
protected_contexts_raw="${DOCKERCD_RECOVERY_PROTECTED_CONTEXTS:-}"
[[ -n "$protected_contexts_raw" ]] || fail "DOCKERCD_RECOVERY_PROTECTED_CONTEXTS is required"
[[ "$protected_contexts_raw" != *$'\n'* && "$protected_contexts_raw" != *$'\r'* ]] || fail "protected context list must be one line"
[[ ",$protected_contexts_raw," != *',,'* ]] || fail "protected context list contains an empty name"

# The runner owns its daemon selection through --context. An ambient endpoint
# or context would make an operator's shell configuration part of the trust
# boundary, so fail rather than attempting to sanitize a partial invocation.
[[ -z "${DOCKER_HOST:-}" ]] || fail "unset ambient DOCKER_HOST before running the drill"
[[ -z "${DOCKER_CONTEXT:-}" ]] || fail "unset ambient DOCKER_CONTEXT before running the drill"

run_docker context ls --format '{{if .Current}}{{.Name}}{{end}}' || fail "could not determine the active Docker context"
active_context="$(printf '%s\n' "$probe_output" | awk 'NF { print; exit }')"
[[ -n "$active_context" ]] || fail "could not determine the active Docker context"
valid_context_name "$active_context" || fail "active context name has unsupported characters"

drill_identity="$(daemon_identity "$drill_context")" || fail "cannot establish a bounded identity for the dedicated drill daemon"

# Protect the active context too: it can be unrelated to a deployment, but it
# must never be silently accepted as the drill target. The caller additionally
# supplies every context known to host a deployed pair; contexts are names only,
# never endpoints or credentials.
protected_contexts=("$active_context")
IFS=',' read -r -a configured_contexts <<< "$protected_contexts_raw"
for protected_context in "${configured_contexts[@]}"; do
  [[ -n "$protected_context" ]] || fail "protected context list contains an empty name"
  valid_context_name "$protected_context" || fail "protected context name has unsupported characters"
  for existing_context in "${protected_contexts[@]}"; do
    [[ "$existing_context" != "$protected_context" ]] || continue 2
  done
  protected_contexts+=("$protected_context")
done

for protected_context in "${protected_contexts[@]}"; do
  [[ "$drill_context" != "$protected_context" ]] || fail "drill context is protected ($protected_context)"
  protected_identity="$(daemon_identity "$protected_context")" || fail "cannot establish a bounded identity for protected context $protected_context"
  [[ "$drill_identity" != "$protected_identity" ]] || fail "drill daemon identity matches protected context $protected_context"
done

# This is machine-readable, non-secret evidence. The runner must accept these
# values and repeat the identity comparison immediately before it creates its
# first Docker object; this preflight alone grants no Docker authority.
printf 'drill_context=%s\ndrill_daemon_id=%s\n' "$drill_context" "$drill_identity"
