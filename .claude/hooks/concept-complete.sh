#!/usr/bin/env bash
# Dragonfly Concept Complete Hook
#
# Called by agent frontmatter when a concept completes.
# Records concept-specific completion data via SQLite events.
#
# Usage: concept-complete.sh <concept-name>
#
# Arguments:
#   $1 - Concept name (story, architecture, implementation, quality, version, context)

set -e

CONCEPT_NAME="${1:-unknown}"
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
source "$PROJECT_ROOT/.claude/hooks/lib/common.sh"

# Log concept completion to SQLite
if dragonfly_state_available; then
  dragonfly_event_log "concept-complete-$(date +%s%N)" "concept_complete_frontmatter" "{\"concept\":\"$CONCEPT_NAME\"}" || true
fi

# Concept-specific post-processing
case "$CONCEPT_NAME" in
  story)
    # Could trigger story validation or sync evaluation
    ;;
  architecture)
    # Could trigger ADR generation or diagram updates
    ;;
  implementation)
    # Could trigger test generation or linting
    ;;
  quality)
    # Could trigger coverage report generation
    ;;
  version)
    # Could trigger changelog updates
    ;;
  context)
    # Could trigger checkpoint creation
    ;;
esac

exit 0
