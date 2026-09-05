#!/usr/bin/env bash
# Dragonfly Status Line
#
# Displays real-time context usage alongside Dragonfly-specific state.
# Called by Claude Code with JSON input on stdin.
#
# Output format: [Model] ctx% | checkpoints | health | workflows

set -e

# Read JSON input from Claude Code
INPUT=$(cat)

# Project root for Dragonfly state files
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# =============================================================================
# Parse Claude Code JSON
# =============================================================================

# Model name (short form)
MODEL=$(echo "$INPUT" | jq -r '.model.display_name // "Unknown"' 2>/dev/null | sed 's/Claude //' | sed 's/ /-/')

# Context window metrics
#
# Token types from Claude Code:
#   input_tokens: Fresh tokens (not from cache) in this request
#   cache_creation_input_tokens: Tokens being cached this request
#   cache_read_input_tokens: Tokens read from cache (still occupy context)
#
# Total context usage = all tokens in the window, regardless of caching
# Caching affects cost, not context window occupancy
#
CONTEXT_SIZE=$(echo "$INPUT" | jq -r '.context_window.context_window_size // 200000' 2>/dev/null)
CURRENT_USAGE=$(echo "$INPUT" | jq -r '.context_window.current_usage // empty' 2>/dev/null)

if [ -n "$CURRENT_USAGE" ]; then
    INPUT_TOKENS=$(echo "$CURRENT_USAGE" | jq -r '.input_tokens // 0')
    CACHE_CREATE=$(echo "$CURRENT_USAGE" | jq -r '.cache_creation_input_tokens // 0')
    CACHE_READ=$(echo "$CURRENT_USAGE" | jq -r '.cache_read_input_tokens // 0')

    # Total context = all token types (caching is for cost, not context size)
    TOTAL_TOKENS=$((INPUT_TOKENS + CACHE_CREATE + CACHE_READ))
    CONTEXT_PCT=$((TOTAL_TOKENS * 100 / CONTEXT_SIZE))
else
    CONTEXT_PCT="?"
    TOTAL_TOKENS=0
fi

# =============================================================================
# Read Dragonfly State (SQLite preferred, YAML fallback)
# =============================================================================

STATE_DB="$PROJECT_ROOT/data/state.db"

# Checkpoint count (SQLite only)
CHECKPOINT_COUNT=0
if command -v sqlite3 &>/dev/null && [ -f "$STATE_DB" ]; then
    CHECKPOINT_COUNT=$(sqlite3 "$STATE_DB" "SELECT COUNT(*) FROM checkpoints;" 2>/dev/null || echo "0")
fi

# Health status (simplified) — use real context data computed below
HEALTH_STATUS="--"

# =============================================================================
# Context Threshold Checkpoint
# =============================================================================
# Trigger safety checkpoint at 70% context usage

THRESHOLD_FILE="$PROJECT_ROOT/data/.context-threshold"
CONTEXT_THRESHOLD=70

# Only trigger if we have valid context percentage
if [ "$CONTEXT_PCT" != "?" ] && [ "$CONTEXT_PCT" -ge "$CONTEXT_THRESHOLD" ] 2>/dev/null; then
    # Check if we already triggered at this threshold
    LAST_TRIGGER_PCT=0
    if [ -f "$THRESHOLD_FILE" ]; then
        LAST_TRIGGER_PCT=$(cat "$THRESHOLD_FILE" 2>/dev/null || echo "0")
    fi

    # Only trigger once per threshold crossing (70-75% range)
    if [ "$LAST_TRIGGER_PCT" -lt "$CONTEXT_THRESHOLD" ] && [ "$CONTEXT_PCT" -lt 75 ]; then
        # Record that we triggered
        mkdir -p "$(dirname "$THRESHOLD_FILE")"
        echo "$CONTEXT_PCT" > "$THRESHOLD_FILE"

        # Save checkpoint directly via SQLite
        if command -v sqlite3 &>/dev/null && [ -f "$STATE_DB" ]; then
            CHECKPOINT_ID="ctx-threshold-$(date +%s)"
            CHECKPOINT_DATA="{\"context_pct\":${CONTEXT_PCT},\"threshold\":${CONTEXT_THRESHOLD},\"tokens_used\":${TOTAL_TOKENS},\"model\":\"${MODEL}\"}"
            sqlite3 "$STATE_DB" "INSERT OR IGNORE INTO checkpoints (id, name, type, data, created_at) VALUES ('$CHECKPOINT_ID', 'context-threshold-${CONTEXT_PCT}pct', 'context_threshold', '$CHECKPOINT_DATA', datetime('now'));" 2>/dev/null || true
        fi
    fi
elif [ "$CONTEXT_PCT" != "?" ] && [ "$CONTEXT_PCT" -lt 50 ] 2>/dev/null; then
    # Reset threshold tracking when context drops below 50%
    rm -f "$THRESHOLD_FILE" 2>/dev/null || true
fi

# =============================================================================
# Update Health Status with Real Context Data (SQLite preferred)
# =============================================================================

if [ "$CONTEXT_PCT" != "?" ]; then
    # Determine zone based on actual usage
    if [ "$CONTEXT_PCT" -lt 50 ]; then
        ZONE="green"
    elif [ "$CONTEXT_PCT" -lt 80 ]; then
        ZONE="yellow"
    else
        ZONE="red"
    fi

    HEALTH_STATUS="$ZONE"

    if command -v sqlite3 &>/dev/null && [ -f "$STATE_DB" ]; then
        sqlite3 "$STATE_DB" "INSERT OR REPLACE INTO health (id, context_usage_percent, zone, updated_at) VALUES (1, ${CONTEXT_PCT}.0, '$ZONE', datetime('now'));" 2>/dev/null || true
    fi
fi

# =============================================================================
# Build Status Line
# =============================================================================

# Context indicator with visual cue
if [ "$CONTEXT_PCT" = "?" ]; then
    CTX_DISPLAY="ctx:?"
elif [ "$CONTEXT_PCT" -lt 50 ]; then
    CTX_DISPLAY="ctx:${CONTEXT_PCT}%"
elif [ "$CONTEXT_PCT" -lt 80 ]; then
    CTX_DISPLAY="ctx:${CONTEXT_PCT}%~"
else
    CTX_DISPLAY="ctx:${CONTEXT_PCT}%!"
fi

# Build output segments
OUTPUT="[$MODEL] $CTX_DISPLAY"

# Add checkpoint info if any exist
if [ "$CHECKPOINT_COUNT" -gt 0 ]; then
    OUTPUT="$OUTPUT | cp:$CHECKPOINT_COUNT"
fi

# Add health if available
if [ "$HEALTH_STATUS" != "--" ]; then
    OUTPUT="$OUTPUT | $HEALTH_STATUS"
fi

echo "$OUTPUT"
