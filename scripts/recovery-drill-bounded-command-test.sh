#!/usr/bin/env bash
# Focused regression checks for recovery-drill-lib.sh. No Docker daemon is used.
set -euo pipefail

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
source "$root/scripts/recovery-drill-lib.sh"

received="$(printf 'fixture-payload' | bounded_command 5 cat)"
[[ "$received" == fixture-payload ]] || {
  echo "bounded command did not preserve stdin" >&2
  exit 1
}

child_pid_file="$(mktemp "${TMPDIR:-/tmp}/dockercd-recovery-drill-bounded-child.XXXXXX")"
trap 'rm -f -- "$child_pid_file"' EXIT
if bounded_command 1 sh -ceu '
  trap "" TERM
  sleep 60 &
  printf "%s" "$!" >"$1"
  wait
' sh "$child_pid_file" >/dev/null 2>&1; then
  echo "expected bounded command timeout" >&2
  exit 1
fi
[[ -s "$child_pid_file" ]] || {
  echo "timed command did not create child evidence" >&2
  exit 1
}
child_pid="$(<"$child_pid_file")"
if kill -0 "$child_pid" 2>/dev/null; then
  echo "bounded command left an orphaned child" >&2
  exit 1
fi

interrupt_child_pid_file="$(mktemp "${TMPDIR:-/tmp}/dockercd-recovery-drill-interrupt-child.XXXXXX")"
trap 'rm -f -- "$child_pid_file" "$interrupt_child_pid_file"' EXIT
(
  trap 'terminate_active_bounded_command; exit 143' TERM
  bounded_command 30 sh -ceu '
    trap "" TERM
    sleep 60 &
    printf "%s" "$!" >"$1"
    wait
  ' sh "$interrupt_child_pid_file" >/dev/null 2>&1
) &
interrupt_parent_pid=$!
for _ in $(seq 1 50); do
  [[ -s "$interrupt_child_pid_file" ]] && break
  sleep 0.1
done
[[ -s "$interrupt_child_pid_file" ]] || {
  echo "interruption fixture did not create child evidence" >&2
  kill -KILL "$interrupt_parent_pid" 2>/dev/null || true
  exit 1
}
kill -TERM "$interrupt_parent_pid"
wait "$interrupt_parent_pid" 2>/dev/null || true
interrupt_child_pid="$(<"$interrupt_child_pid_file")"
if kill -0 "$interrupt_child_pid" 2>/dev/null; then
  echo "interruption left an orphaned child" >&2
  exit 1
fi
