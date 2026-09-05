#!/usr/bin/env bash
# Dragonfly Stop Hook
#
# This hook runs when Claude Code completes a response.
# It updates health status and can trigger auto-saves.
#
# Environment variables available:
# - CLAUDE_RESPONSE_TOKENS: Tokens in the response
# - CLAUDE_TOOL_CALLS: Number of tool calls made

set -e

PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
source "$PROJECT_ROOT/.claude/hooks/lib/common.sh"

# Track session metrics in SQLite if available
if dragonfly_state_available; then
  local_id="stop-$(date +%s%N)"
  dragonfly_event_log "$local_id" "session_interaction" "{\"tool_calls\":${CLAUDE_TOOL_CALLS:-0},\"response_tokens\":${CLAUDE_RESPONSE_TOKENS:-0}}" || true
fi

# =============================================================================
# Session Exit Checkpoint Logic
# =============================================================================
# Create checkpoint if there's uncommitted work and it's been a while since last checkpoint

UNCOMMITTED="$(dragonfly_git_uncommitted_count)"
CHECKPOINT_AGE=9999

if dragonfly_state_available; then
  CHECKPOINT_AGE=$(dragonfly_checkpoint_age_minutes)
fi

# Create session checkpoint if:
# 1. There's uncommitted work AND
# 2. It's been more than 30 minutes since last checkpoint
if [ "$UNCOMMITTED" -gt 0 ] && [ "$CHECKPOINT_AGE" -gt 30 ]; then
  SESSION_CHECKPOINT_SCRIPT="$PROJECT_ROOT/.claude/hooks/session-exit-checkpoint.sh"
  if [ -x "$SESSION_CHECKPOINT_SCRIPT" ]; then
    "$SESSION_CHECKPOINT_SCRIPT" > /dev/null 2>&1 || true
  fi
fi

# Silent operation - don't pollute output on every response
exit 0
