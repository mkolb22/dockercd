#!/usr/bin/env bash
# Test-only fake for release-docker-engine-security-check-test.sh.
set -euo pipefail

scenario="${RELEASE_SECURITY_FAKE_SCENARIO:?scenario required}"
[[ "$1" == --context ]] || exit 64
context="$2"
shift 2

case "$scenario:$1" in
  pass:version) printf '29.8.0\n' ;;
  pass:info) printf '0\n' ;;
  pass:plugin) ;;
  old:version) printf '29.3.0\n' ;;
  old:info) printf '0\n' ;;
  old:plugin) ;;
  plugins:version) printf '29.8.0\n' ;;
  plugins:info) printf '2\n' ;;
  plugins:plugin) printf 'private-plugin-id\n' ;;
  malformed:version) printf 'not-a-version\n' ;;
  stdout-diagnostic:version) printf 'https://operator:credential@example.invalid\n' ;;
  timeout:version) sleep 5 ;;
  parent-exits:version)
    (
      trap '' TERM
      sleep 5
    ) &
    printf '%s\n' "$!" >"${RELEASE_SECURITY_FAKE_CHILD_PID_FILE:?child pid file required}"
    exit 0
    ;;
  interrupt:version)
    (
      trap '' TERM
      sleep 5
    ) &
    printf '%s\n' "$!" >"${RELEASE_SECURITY_FAKE_CHILD_PID_FILE:?child pid file required}"
    trap 'exit 0' TERM
    wait
    ;;
  diagnostic:version)
    printf 'cannot contact https://operator:credential@example.invalid\n' >&2
    exit 1
    ;;
  *) exit 64 ;;
esac
