#!/usr/bin/env bash
# Zen SessionStart Hook
#
# This hook runs when a Claude Code session starts.
# It checks for available checkpoints and displays session context.
#
# Output goes to stdout and is shown to Claude in the transcript.
# Use $CLAUDE_ENV_FILE to persist environment variables.

set -e

PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
source "$PROJECT_ROOT/.claude/hooks/lib/common.sh"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🧘 Zen Session Started"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check for available checkpoints (SQLite)
CHECKPOINT_COUNT=0
LATEST_NAME=""
LATEST_DESC=""

if zen_state_available; then
  CHECKPOINT_COUNT=$(zen_checkpoint_count)
  if [ "$CHECKPOINT_COUNT" -gt 0 ] 2>/dev/null; then
    # Output: id|name|type|created_at
    LATEST_ROW=$(zen_checkpoint_latest)
    LATEST_NAME=$(echo "$LATEST_ROW" | cut -d'|' -f2)
    LATEST_DESC=$(zen_checkpoint_latest_description)
    LATEST_DESC="${LATEST_DESC:-Auto-saved checkpoint}"
  fi
fi

if [ "$CHECKPOINT_COUNT" -gt 0 ] 2>/dev/null; then
  echo ""
  echo "📍 Available Checkpoints: $CHECKPOINT_COUNT"
  echo "   Latest: $LATEST_NAME"
  echo "   Description: $LATEST_DESC"
  echo ""
  echo "   💡 Use /restore to load checkpoint context"
fi

# Check health status (SQLite)
CONTEXT_USAGE=""
if zen_state_available; then
  # Output: pct|zone
  HEALTH_ROW=$(zen_health_get)
  if [ -n "$HEALTH_ROW" ]; then
    CONTEXT_USAGE=$(echo "$HEALTH_ROW" | cut -d'|' -f1)
  fi
fi

if [ -n "$CONTEXT_USAGE" ] && [ "$CONTEXT_USAGE" != "0" ]; then
  echo "📊 Context Usage: ${CONTEXT_USAGE}%"
fi

# Set environment variables for the session
if [ -n "$CLAUDE_ENV_FILE" ]; then
  echo "ZEN_PROJECT_ROOT=$PROJECT_ROOT" >> "$CLAUDE_ENV_FILE"
  echo "ZEN_SESSION_START=$(date -u +"%Y-%m-%dT%H:%M:%SZ")" >> "$CLAUDE_ENV_FILE"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

exit 0
