#!/usr/bin/env bash
# Dragonfly Post-Commit Hook
#
# Called after version.commit completes successfully.
# Logs commit data to SQLite events.
#
# Usage: post-commit.sh <story-id> <commit-hash> <flow-id>
#
# Arguments:
#   $1 - Story ID associated with this commit
#   $2 - Git commit hash
#   $3 - Flow ID for provenance tracking

set -e

STORY_ID="${1:-unknown}"
COMMIT_HASH="${2:-unknown}"
FLOW_ID="${3:-unknown}"
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
source "$PROJECT_ROOT/.claude/hooks/lib/common.sh"

# Get commit message
COMMIT_MSG=""
if [ "$COMMIT_HASH" != "unknown" ]; then
  COMMIT_MSG=$(git log -1 --format="%s" "$COMMIT_HASH" 2>/dev/null || echo "")
fi

# Log commit to SQLite
if dragonfly_state_available; then
  # Escape commit message for JSON (replace quotes and newlines)
  SAFE_MSG=$(echo "$COMMIT_MSG" | tr '"' "'" | tr '\n' ' ')
  dragonfly_event_log "commit-$(date +%s)" "git_commit" "{\"story_id\":\"$STORY_ID\",\"commit_hash\":\"$COMMIT_HASH\",\"flow_id\":\"$FLOW_ID\",\"message\":\"$SAFE_MSG\"}" || true
fi

# Output for hook runner
echo "post-commit: $STORY_ID -> $COMMIT_HASH"
exit 0
