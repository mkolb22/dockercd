#!/usr/bin/env bash
# Zen Session Exit Checkpoint Hook
#
# Creates a checkpoint when the Claude Code session ends or is about to exit.
# Called by stop.sh when conditions warrant checkpoint creation.
#
# This hook captures:
# - Current git state (branch, uncommitted files)
# - Last commit information
# - Restoration prompt for next session

set -e

PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
source "$PROJECT_ROOT/.claude/hooks/lib/common.sh"

TIMESTAMP=$(date -u +"%Y%m%d-%H%M%S")
CREATED_AT=$(zen_timestamp_iso)
CHECKPOINT_ID="chk-session-exit-${TIMESTAMP}"

# Get git info
GIT_BRANCH=$(zen_git_branch)
LAST_COMMIT=$(zen_git_last_commit)
UNCOMMITTED_FILES=$(zen_git_uncommitted_count)

# Build JSON data for SQLite
JSON_DATA="{\"automatic\":true,\"git_state\":{\"branch\":\"${GIT_BRANCH}\",\"last_commit\":\"${LAST_COMMIT}\",\"uncommitted_files\":${UNCOMMITTED_FILES}},\"restoration_prompt\":\"Session ended on branch ${GIT_BRANCH}. Last commit: ${LAST_COMMIT}. Uncommitted files: ${UNCOMMITTED_FILES}.\"}"

# Write to SQLite
if zen_state_available; then
    zen_checkpoint_save "$CHECKPOINT_ID" "session-exit-${TIMESTAMP}" "session_exit" "$JSON_DATA"
fi

echo "Session checkpoint saved: $CHECKPOINT_ID"
exit 0
