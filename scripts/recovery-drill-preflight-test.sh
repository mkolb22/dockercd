#!/usr/bin/env bash
# Regression check with a fake Docker binary: this intentionally makes no
# Docker calls. It exercises the identity/timeout/redaction guardrails.
set -euo pipefail

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
bash -n "$root/scripts/recovery-drill-preflight.sh"
"$root/scripts/recovery-drill-preflight.sh" --help >/dev/null

fake_docker="$root/scripts/testdata/recovery-drill-fake-docker.sh"

run_preflight() {
  local scenario="$1"
  shift
  env -u DOCKER_HOST -u DOCKER_CONTEXT \
    DOCKER_BIN="$fake_docker" \
    DOCKERCD_RECOVERY_DRILL_CONTEXT=drill \
    DOCKERCD_RECOVERY_PROTECTED_CONTEXTS=protected \
    DOCKERCD_RECOVERY_DRILL_TIMEOUT_SECONDS=1 \
    RECOVERY_DRILL_FAKE_SCENARIO="$scenario" \
    "$root/scripts/recovery-drill-preflight.sh" "$@"
}

pass_output="$(run_preflight pass)"
case "$pass_output" in
  *"drill_context=drill"*"drill_daemon_id=drill-daemon") ;;
  *) echo "expected machine-readable preflight evidence" >&2; exit 1 ;;
esac

for scenario in alias unrelated-active hang; do
  if run_preflight "$scenario" >/dev/null 2>&1; then
    echo "expected $scenario scenario to fail" >&2
    exit 1
  fi
done

start_seconds=$SECONDS
if run_preflight term-ignore >/dev/null 2>&1; then
  echo "expected TERM-ignoring scenario to fail" >&2
  exit 1
fi
(( SECONDS - start_seconds < 4 )) || {
  echo "TERM-ignoring Docker process exceeded hard timeout" >&2
  exit 1
}

child_pid_file="$(mktemp "${TMPDIR:-/tmp}/dockercd-recovery-drill-child.XXXXXX")"
trap 'rm -f -- "$child_pid_file"' EXIT
if env -u DOCKER_HOST -u DOCKER_CONTEXT \
  DOCKER_BIN="$fake_docker" \
  DOCKERCD_RECOVERY_DRILL_CONTEXT=drill \
  DOCKERCD_RECOVERY_PROTECTED_CONTEXTS=protected \
  DOCKERCD_RECOVERY_DRILL_TIMEOUT_SECONDS=1 \
  RECOVERY_DRILL_FAKE_SCENARIO=term-parent-exits \
  RECOVERY_DRILL_FAKE_CHILD_PID_FILE="$child_pid_file" \
  "$root/scripts/recovery-drill-preflight.sh" >/dev/null 2>&1; then
  echo "expected parent-exits scenario to fail" >&2
  exit 1
fi
child_pid="$(<"$child_pid_file")"
if kill -0 "$child_pid" 2>/dev/null; then
  echo "orphaned helper survived process-group cleanup" >&2
  exit 1
fi

if env -u DOCKER_HOST -u DOCKER_CONTEXT \
  DOCKER_BIN="$fake_docker" \
  DOCKERCD_RECOVERY_DRILL_CONTEXT=drill \
  DOCKERCD_RECOVERY_PROTECTED_CONTEXTS=$'protected\nunreviewed' \
  RECOVERY_DRILL_FAKE_SCENARIO=pass \
  "$root/scripts/recovery-drill-preflight.sh" >/dev/null 2>&1; then
  echo "expected multiline protected context list to fail" >&2
  exit 1
fi

if env -u DOCKER_HOST -u DOCKER_CONTEXT \
  DOCKER_BIN="$fake_docker" \
  DOCKERCD_RECOVERY_DRILL_CONTEXT=drill \
  DOCKERCD_RECOVERY_PROTECTED_CONTEXTS=protected \
  DOCKERCD_RECOVERY_DRILL_TIMEOUT_SECONDS=18446744073709551617 \
  RECOVERY_DRILL_FAKE_SCENARIO=pass \
  "$root/scripts/recovery-drill-preflight.sh" >/dev/null 2>&1; then
  echo "expected overflowing timeout to fail" >&2
  exit 1
fi

if env -u DOCKER_HOST -u DOCKER_CONTEXT \
  DOCKER_BIN="$fake_docker" \
  DOCKERCD_RECOVERY_DRILL_CONTEXT=drill \
  DOCKERCD_RECOVERY_PROTECTED_CONTEXTS='protected,' \
  RECOVERY_DRILL_FAKE_SCENARIO=pass \
  "$root/scripts/recovery-drill-preflight.sh" >/dev/null 2>&1; then
  echo "expected trailing protected context delimiter to fail" >&2
  exit 1
fi

diagnostic_output=""
if diagnostic_output="$(run_preflight diagnostic 2>&1)"; then
  echo "expected diagnostic scenario to fail" >&2
  exit 1
fi
case "$diagnostic_output" in
  *"https://operator:credential@example.invalid"*)
    echo "Docker diagnostic credential leaked" >&2
    exit 1
    ;;
esac
