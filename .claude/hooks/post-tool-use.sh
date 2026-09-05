#!/usr/bin/env bash
# Dragonfly PostToolUse Hook
#
# This hook runs after tool execution completes.
# It tracks provenance for concept actions (Task tool) via SQLite events.
#
# Environment variables available:
# - CLAUDE_TOOL_NAME: Name of the tool that was executed
# - CLAUDE_TOOL_INPUT: JSON input to the tool
# - CLAUDE_TOOL_OUTPUT: JSON output from the tool (may be truncated)

set -e

# Only track Task tool calls (concept actions)
if [ "$CLAUDE_TOOL_NAME" != "Task" ]; then
  exit 0
fi

PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
source "$PROJECT_ROOT/.claude/hooks/lib/common.sh"

# Extract subagent type from input (simplified parsing)
SUBAGENT_TYPE=""
if [ -n "$CLAUDE_TOOL_INPUT" ]; then
  SUBAGENT_TYPE=$(echo "$CLAUDE_TOOL_INPUT" | grep -o '"subagent_type"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*: *"//' | tr -d '"' || echo "")
fi

# Only track concept actions
case "$SUBAGENT_TYPE" in
  story-concept|architecture-concept|implementation-concept|quality-concept|version-concept|context-concept)
    ;;
  *)
    # Not a concept action, skip
    exit 0
    ;;
esac

# Determine concept name from subagent type
CONCEPT_NAME=$(echo "$SUBAGENT_TYPE" | sed 's/-concept//')
GIT_BRANCH="$(dragonfly_git_branch)"
GIT_COMMIT="$(dragonfly_git_short_hash)"

# Log task invocation to SQLite
if dragonfly_state_available; then
  dragonfly_event_log "task-$(date +%s%N)" "task_invocation" "{\"concept\":\"$CONCEPT_NAME\",\"subagent_type\":\"$SUBAGENT_TYPE\",\"git_branch\":\"$GIT_BRANCH\",\"git_commit\":\"$GIT_COMMIT\"}" || true
fi

# Output confirmation (visible in transcript)
echo "Provenance recorded: $CONCEPT_NAME"

exit 0
