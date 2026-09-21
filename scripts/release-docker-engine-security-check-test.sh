#!/usr/bin/env bash
# Regression check for the read-only Docker Engine security evidence script.
set -euo pipefail

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
check="$root/scripts/release-docker-engine-security-check.sh"
fake="$root/scripts/testdata/release-security-fake-docker.sh"
bash -n "$check" "$fake"

run_check() {
  local scenario="$1"
  env -u DOCKER_HOST -u DOCKER_CONTEXT \
    DOCKER_BIN="$fake" \
    DOCKERCD_RELEASE_SECURITY_TEST_ONLY=1 \
    DOCKERCD_RELEASE_SECURITY_TIMEOUT_SECONDS=1 \
    RELEASE_SECURITY_FAKE_SCENARIO="$scenario" \
    "$check" --context fixture
}

pass_output="$(run_check pass)"
case "$pass_output" in
  *"context=fixture"*"engine_version=29.8.0"*"authz_plugin_count=0"*"installed_plugin_count=0"*"result=pass"*) ;;
  *) echo "expected redacted passing release evidence" >&2; exit 1 ;;
esac

for scenario in old malformed stdout-diagnostic timeout diagnostic; do
  output=""
  if output="$(run_check "$scenario" 2>&1)"; then
    echo "expected $scenario scenario to fail" >&2
    exit 1
  fi
  case "$output" in
    *"https://operator:credential@example.invalid"*)
      echo "Docker diagnostic credential leaked" >&2
      exit 1
      ;;
  esac
done

assert_no_live_child() {
  local child_pid="$1"
  if kill -0 "$child_pid" 2>/dev/null; then
    echo "release security check left an orphaned helper" >&2
    exit 1
  fi
}

child_pid_file="$(mktemp "${TMPDIR:-/tmp}/dockercd-release-engine-child.XXXXXX")"
trap 'rm -f -- "$child_pid_file"' EXIT
if env -u DOCKER_HOST -u DOCKER_CONTEXT \
  DOCKER_BIN="$fake" \
  DOCKERCD_RELEASE_SECURITY_TEST_ONLY=1 \
  DOCKERCD_RELEASE_SECURITY_TIMEOUT_SECONDS=1 \
  RELEASE_SECURITY_FAKE_SCENARIO=parent-exits \
  RELEASE_SECURITY_FAKE_CHILD_PID_FILE="$child_pid_file" \
  "$check" --context fixture >/dev/null 2>&1; then
  echo "expected parent-exits scenario to fail" >&2
  exit 1
fi
[[ -s "$child_pid_file" ]] || { echo "parent-exits fixture did not record child" >&2; exit 1; }
assert_no_live_child "$(<"$child_pid_file")"

: >"$child_pid_file"
env -u DOCKER_HOST -u DOCKER_CONTEXT \
  DOCKER_BIN="$fake" \
  DOCKERCD_RELEASE_SECURITY_TEST_ONLY=1 \
  DOCKERCD_RELEASE_SECURITY_TIMEOUT_SECONDS=10 \
  RELEASE_SECURITY_FAKE_SCENARIO=interrupt \
  RELEASE_SECURITY_FAKE_CHILD_PID_FILE="$child_pid_file" \
  "$check" --context fixture >/dev/null 2>&1 &
check_pid=$!
for _ in $(seq 1 50); do
  [[ -s "$child_pid_file" ]] && break
  sleep 0.1
done
[[ -s "$child_pid_file" ]] || {
  echo "interruption fixture did not record child" >&2
  kill -KILL "$check_pid" 2>/dev/null || true
  exit 1
}
kill -TERM "$check_pid"
wait "$check_pid" 2>/dev/null || true
assert_no_live_child "$(<"$child_pid_file")"

plugin_output="$(run_check plugins)"
case "$plugin_output" in
  *"authz_plugin_count=2"*"installed_plugin_count=1"*) ;;
  *) echo "expected plugin posture counts" >&2; exit 1 ;;
esac
case "$plugin_output" in
  *private-plugin-id*)
    echo "plugin identifier leaked into release evidence" >&2
    exit 1
    ;;
esac
