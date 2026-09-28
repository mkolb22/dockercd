#!/usr/bin/env bash
# Regression checks for macOS Bash empty-array behavior used by recovery cleanup.
# No Docker daemon is used.
set -euo pipefail

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
bash -n "$root/scripts/recovery-drill.sh"

# Context inspection happens before any drill resource can be created. Keep it
# under the shared bounded-command guard even though it reads local Docker
# client configuration rather than the selected daemon.
context_inspection_source="$(sed -n '/^context_endpoint=/,/^\[\[ \"\$context_endpoint\"/p' "$root/scripts/recovery-drill.sh")"
case "$context_inspection_source" in
  *'bounded_command 30 docker context inspect'*) ;;
  *) echo "recovery context inspection is not bounded" >&2; exit 1 ;;
esac

# The runner captures authenticated controller responses before validating
# their JSON. Keep both GET and mutation response paths within the existing
# 1 MiB successful-controller-response budget.
controller_response_source="$(sed -n '/^controller_get()/,/^controller_cli()/p' "$root/scripts/recovery-drill.sh")"
case "$controller_response_source" in
  *'controller_get()'*'--max-filesize 1048576'*'controller_post_json()'*'--max-filesize 1048576'*) ;;
  *) echo "recovery controller responses are not size-bounded" >&2; exit 1 ;;
esac

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
