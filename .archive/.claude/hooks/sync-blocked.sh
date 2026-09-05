#!/usr/bin/env bash
# Zen Sync Blocked Hook
#
# Called when a synchronization rule is blocked (prerequisites not met).
# Logs blocked events to SQLite for workflow debugging and optimization.
#
# Usage: sync-blocked.sh <rule-id> <reason> [blocking-condition]
#
# Arguments:
#   $1 - Sync rule ID (e.g., "story-to-arch", "arch-to-impl")
#   $2 - Reason for blocking (e.g., "prerequisite_failed", "condition_not_met")
#   $3 - Optional: The specific condition that caused blocking

set -e

RULE_ID="${1:-unknown}"
REASON="${2:-unknown}"
BLOCKING_CONDITION="${3:-}"
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
source "$PROJECT_ROOT/.claude/hooks/lib/common.sh"

# Log blocked event to SQLite
if zen_state_available; then
  zen_event_log "sync-blocked-$(date +%s%N)" "sync_blocked" "{\"rule_id\":\"$RULE_ID\",\"reason\":\"$REASON\",\"condition\":\"$BLOCKING_CONDITION\"}" || true
fi

# Rule-specific handling
case "$RULE_ID" in
  story-to-arch)
    # Story not ready - might need clarification
    ;;
  arch-to-impl)
    # Architecture incomplete or high risk awaiting approval
    ;;
  impl-to-quality*)
    # Implementation has blockers
    ;;
  quality-to-version)
    # Quality checks not passed
    ;;
esac

# Output for hook runner
echo "sync-blocked: $RULE_ID ($REASON)"
exit 0
