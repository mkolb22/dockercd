#!/usr/bin/env bash
# Dragonfly Timeout Hook
#
# Called when a concept or sync rule times out.
# Logs timeout events and can trigger recovery actions.
#
# Usage: timeout.sh <source-type> <source-id> <timeout-ms>
#
# Arguments:
#   $1 - Source type: "concept" or "sync"
#   $2 - Source identifier (concept name or sync rule ID)
#   $3 - Timeout duration in milliseconds

set -e

SOURCE_TYPE="${1:-unknown}"
SOURCE_ID="${2:-unknown}"
TIMEOUT_MS="${3:-0}"
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
source "$PROJECT_ROOT/.claude/hooks/lib/common.sh"

# Log timeout event to SQLite
if dragonfly_state_available; then
  EVENT_ID="timeout-$(date +%s%N)"
  dragonfly_event_log "$EVENT_ID" "timeout" "{\"source_type\":\"${SOURCE_TYPE}\",\"source_id\":\"${SOURCE_ID}\",\"timeout_ms\":${TIMEOUT_MS}}"
fi

# Source-specific timeout handling
case "$SOURCE_TYPE" in
  concept)
    # Could notify user or trigger fallback
    case "$SOURCE_ID" in
      architecture)
        # Architecture timeout is serious - might need simpler approach
        ;;
      implementation)
        # Implementation timeout - could break into smaller chunks
        ;;
    esac
    ;;
  sync)
    # Sync rule timeout - log for sync evaluation skip
    ;;
esac

# Output for hook runner
echo "timeout: $SOURCE_TYPE/$SOURCE_ID after ${TIMEOUT_MS}ms"
exit 0
