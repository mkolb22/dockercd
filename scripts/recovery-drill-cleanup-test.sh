#!/usr/bin/env bash
# Regression checks for macOS Bash empty-array behavior used by recovery cleanup.
# No Docker daemon is used.
set -euo pipefail

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
bash -n "$root/scripts/recovery-drill.sh"

# Keep this assertion tied to the production cleanup function: an empty array
# is unbound on Bash 3.2 with nounset, so cleanup must deliberately disable it.
cleanup_source="$(sed -n '/^cleanup() {/,/^}/p' "$root/scripts/recovery-drill.sh")"
case "$cleanup_source" in
  *$'set +u'*) ;;
  *) echo "recovery cleanup does not disable nounset" >&2; exit 1 ;;
esac

exercise_cleanup_arrays() {
  set -u
  local -a containers=("$@")
  local -a networks=()
  local -a volumes=()
  local -a images=()
  local item seen=""
  # This matches the cleanup preamble before it expands every inventory array.
  set +e
  set +u
  for item in "${containers[@]}"; do seen+="container:$item " ; done
  for item in "${networks[@]}"; do seen+="network:$item " ; done
  for item in "${volumes[@]}"; do seen+="volume:$item " ; done
  for item in "${images[@]}"; do seen+="image:$item " ; done
  printf '%s' "$seen"
}

[[ -z "$(exercise_cleanup_arrays)" ]] || {
  echo "empty cleanup inventory produced an unexpected item" >&2
  exit 1
}
[[ "$(exercise_cleanup_arrays controller fixture)" == 'container:controller container:fixture ' ]] || {
  echo "partial cleanup inventory did not complete" >&2
  exit 1
}
