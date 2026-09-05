#!/usr/bin/env bash
# Dragonfly PreCompact Hook
#
# This hook runs before Claude Code compresses the conversation history.
# It saves a checkpoint to preserve critical context.
#
# Environment variables available:
# - CLAUDE_CONTEXT_TOKENS: Current token count before compaction

set -e

PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
source "$PROJECT_ROOT/.claude/hooks/lib/common.sh"

CHECKPOINT_ID="pre-compact-$(date +%s)"
GIT_BRANCH="$(dragonfly_git_branch)"
GIT_COMMIT="$(dragonfly_git_short_hash)"

# Build checkpoint data
JSON_DATA="{\"automatic\":true,\"description\":\"Auto-saved before context compaction\",\"context_tokens\":\"${CLAUDE_CONTEXT_TOKENS:-unknown}\",\"git_state\":{\"branch\":\"${GIT_BRANCH}\",\"commit\":\"${GIT_COMMIT}\"},\"session_start\":\"${DRAGONFLY_SESSION_START:-unknown}\"}"

# Write to SQLite
if dragonfly_state_available; then
    dragonfly_checkpoint_save "$CHECKPOINT_ID" "$CHECKPOINT_ID" "pre_compact" "$JSON_DATA"
fi

# Output confirmation
echo "Pre-compaction checkpoint saved: $CHECKPOINT_ID"
echo "Context tokens: ${CLAUDE_CONTEXT_TOKENS:-unknown}"

# Output critical reminders for post-compaction
echo ""
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║  AFTER COMPACTION:                                              ║"
echo "║  1. Read \$PROJECT_ROOT/CLAUDE.md                                ║"
echo "║  2. Run /restore to rebuild context from last checkpoint        ║"
echo "╚══════════════════════════════════════════════════════════════════╝"

exit 0
