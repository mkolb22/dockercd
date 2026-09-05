#!/usr/bin/env bash
# Zen UserPromptSubmit Hook
#
# This hook runs when the user submits a prompt.
# It can classify intent and suggest workflows.
#
# Environment variables available:
# - CLAUDE_USER_PROMPT: The user's prompt text (may be truncated)

set -e

PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
source "$PROJECT_ROOT/.claude/hooks/lib/common.sh"

# Get prompt (handle potential truncation)
PROMPT="${CLAUDE_USER_PROMPT:-}"

# Skip if empty or very short
if [ ${#PROMPT} -lt 5 ]; then
  exit 0
fi

# Simple keyword-based intent classification
# (More sophisticated classification would use the /classify command)
INTENT="general"
SUGGESTED_WORKFLOW=""

# Check for feature/story keywords
if echo "$PROMPT" | grep -qiE "(add|create|implement|build|new feature|add feature)"; then
  INTENT="feature"
  SUGGESTED_WORKFLOW="/feature"
fi

# Check for bug/fix keywords
if echo "$PROMPT" | grep -qiE "(fix|bug|broken|error|issue|doesn't work|not working)"; then
  INTENT="bugfix"
  SUGGESTED_WORKFLOW="/feature (bugfix mode)"
fi

# Check for refactor keywords
if echo "$PROMPT" | grep -qiE "(refactor|clean up|improve|optimize|reorganize)"; then
  INTENT="refactor"
fi

# Check for review keywords
if echo "$PROMPT" | grep -qiE "(review|check|audit|analyze|examine)"; then
  INTENT="review"
  SUGGESTED_WORKFLOW="/pr-review"
fi

# Check for exploration keywords
if echo "$PROMPT" | grep -qiE "(explore|understand|how does|explain|what is)"; then
  INTENT="exploration"
  SUGGESTED_WORKFLOW="/explore"
fi

# Log classification to SQLite
if zen_state_available; then
  SAFE_PREVIEW=$(echo "$PROMPT" | head -c 100 | tr '"' "'" | tr '\n' ' ')
  zen_event_log "route-$(date +%s)-$$" "intent_classification" "{\"intent\":\"$INTENT\",\"suggested_workflow\":\"$SUGGESTED_WORKFLOW\",\"prompt_length\":${#PROMPT},\"prompt_preview\":\"${SAFE_PREVIEW}...\"}" || true
fi

# Only output suggestion for clear workflow matches
if [ -n "$SUGGESTED_WORKFLOW" ] && [ "$INTENT" != "general" ]; then
  echo "Intent: $INTENT | Suggested: $SUGGESTED_WORKFLOW"
fi

exit 0
