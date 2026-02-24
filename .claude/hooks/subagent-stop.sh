#!/usr/bin/env bash
# Zen SubagentStop Hook
#
# This hook runs when a subagent (concept) completes execution.
# It tracks costs via SQLite events.
#
# Environment variables available:
# - CLAUDE_AGENT_NAME: Name of the subagent that stopped
# - CLAUDE_AGENT_DURATION_MS: How long the agent ran (milliseconds)
# - CLAUDE_AGENT_INPUT_TOKENS: Input tokens used
# - CLAUDE_AGENT_OUTPUT_TOKENS: Output tokens used

set -e

PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
source "$PROJECT_ROOT/.claude/hooks/lib/common.sh"

# Only track concept agents
case "$CLAUDE_AGENT_NAME" in
  story-concept|architecture-concept|implementation-concept|quality-concept|version-concept|context-concept)
    ;;
  *)
    # Not a concept agent, skip
    exit 0
    ;;
esac

# Extract concept name
CONCEPT_NAME=$(echo "$CLAUDE_AGENT_NAME" | sed 's/-concept//')

# Log concept completion to SQLite
if zen_state_available; then
  zen_event_log "concept-$(date +%s%N)" "concept_complete" "{\"concept\":\"$CONCEPT_NAME\",\"duration_ms\":${CLAUDE_AGENT_DURATION_MS:-0},\"input_tokens\":${CLAUDE_AGENT_INPUT_TOKENS:-0},\"output_tokens\":${CLAUDE_AGENT_OUTPUT_TOKENS:-0}}" || true
fi

# Output confirmation (visible in transcript)
DURATION_SEC=$((${CLAUDE_AGENT_DURATION_MS:-0} / 1000))
echo "Concept completed: $CONCEPT_NAME (${DURATION_SEC}s, ${CLAUDE_AGENT_INPUT_TOKENS:-0}+${CLAUDE_AGENT_OUTPUT_TOKENS:-0} tokens)"

exit 0
