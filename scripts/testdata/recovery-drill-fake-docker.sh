#!/usr/bin/env bash
# Test-only fake for recovery-drill-preflight-test.sh. It never invokes Docker.
set -euo pipefail

scenario="${RECOVERY_DRILL_FAKE_SCENARIO:?scenario required}"

if [[ "$1" == "context" && "$2" == "ls" ]]; then
  case "$scenario" in
    unrelated-active) printf 'unrelated\n' ;;
    *) printf 'protected\n' ;;
  esac
  exit 0
fi

if [[ "$1" == "--context" && "$3" == "info" ]]; then
  context="$2"
  case "$scenario:$context" in
    pass:drill) printf 'drill-daemon\n' ;;
    pass:protected) printf 'protected-daemon\n' ;;
    alias:drill|alias:protected) printf 'same-daemon\n' ;;
    unrelated-active:drill|unrelated-active:protected) printf 'same-daemon\n' ;;
    unrelated-active:unrelated) printf 'unrelated-daemon\n' ;;
    diagnostic:drill)
      printf 'cannot contact https://operator:credential@example.invalid\n' >&2
      exit 1
      ;;
    hang:drill) sleep 5 ;;
    term-ignore:drill)
      trap '' TERM
      sleep 5 &
      wait
      ;;
    term-parent-exits:drill)
      (
        trap '' TERM
        sleep 5
      ) &
      printf '%s\n' "$!" >"${RECOVERY_DRILL_FAKE_CHILD_PID_FILE:?child pid file required}"
      trap 'exit 0' TERM
      wait
      ;;
  esac
  exit 0
fi

exit 64
