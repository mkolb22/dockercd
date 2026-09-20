#!/usr/bin/env bash
# Shared, bounded process execution for the disposable recovery drill. This
# file is sourced by the runner and its focused shell regression test.

bounded_active_pid=""
bounded_active_stdout=""
bounded_active_stderr=""
# The runner assigns a private state file after creating its work directory.
# A command substitution runs in a Bash subshell, so this file lets the parent
# EXIT trap still find and terminate the active isolated group on interruption.
bounded_active_state_file=""
bounded_temp_dir=""

terminate_bounded_process_group() {
  local pid="$1"
  [[ -n "$pid" ]] || return 0
  kill -TERM -- "-$pid" 2>/dev/null || true
  local grace=0
  while kill -0 -- "-$pid" 2>/dev/null && (( grace < 10 )); do
    sleep 0.1
    ((grace += 1))
  done
  if kill -0 -- "-$pid" 2>/dev/null; then
    kill -KILL -- "-$pid" 2>/dev/null || true
  fi
  wait "$pid" 2>/dev/null || true
}

terminate_active_bounded_command() {
  local pid="$bounded_active_pid"
  if [[ -z "$pid" && -n "$bounded_active_state_file" && -f "$bounded_active_state_file" ]]; then
    read -r pid <"$bounded_active_state_file" || true
  fi
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || pid=""
  terminate_bounded_process_group "$pid"
  [[ -z "$bounded_active_stdout" ]] || rm -f -- "$bounded_active_stdout"
  [[ -z "$bounded_active_stderr" ]] || rm -f -- "$bounded_active_stderr"
  [[ -z "$bounded_active_state_file" ]] || rm -f -- "$bounded_active_state_file"
  bounded_active_pid=""
  bounded_active_stdout=""
  bounded_active_stderr=""
}

bounded_command() {
  local timeout_seconds="$1"
  shift
  local stdout_file stderr_file pid elapsed status temp_dir
  temp_dir="${bounded_temp_dir:-${TMPDIR:-/tmp}}"
  stdout_file="$(mktemp "$temp_dir/dockercd-recovery-drill-output.XXXXXX")" || return 1
  stderr_file="$(mktemp "$temp_dir/dockercd-recovery-drill-diagnostic.XXXXXX")" || {
    rm -f -- "$stdout_file"
    return 1
  }
  # A process group is required: Docker can leave an SSH/TCP helper behind
  # after the direct client exits, and a timed-out Git child must not outlive
  # the drill's cleanup trap. Explicitly preserve stdin: a backgrounded Bash
  # job otherwise receives /dev/null in a noninteractive shell.
  perl -MPOSIX=setsid -e 'setsid() or die "setsid failed"; exec @ARGV' \
    "$@" <&0 >"$stdout_file" 2>"$stderr_file" &
  pid=$!
  bounded_active_pid="$pid"
  bounded_active_stdout="$stdout_file"
  bounded_active_stderr="$stderr_file"
  if [[ -n "$bounded_active_state_file" ]]; then
    printf '%s\n' "$pid" >"$bounded_active_state_file"
  fi
  elapsed=0
  while kill -0 "$pid" 2>/dev/null; do
    if (( elapsed >= timeout_seconds * 10 )); then
      terminate_active_bounded_command
      return 124
    fi
    sleep 0.1
    ((elapsed += 1))
  done
  status=0
  wait "$pid" 2>/dev/null || status=$?
  if [[ "$status" -eq 0 ]]; then
    cat "$stdout_file"
  fi
  terminate_active_bounded_command
  return "$status"
}
