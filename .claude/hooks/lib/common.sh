#!/usr/bin/env bash
# Dragonfly Hook Common Library
#
# Shared functions and variables for all Dragonfly hooks.
# Source this at the top of any hook script:
#
#   source "$(dirname "$0")/lib/common.sh"
#
# Or from deployed location:
#   HOOKS_DIR="${HOOKS_DIR:-$(dirname "$0")}"
#   source "$HOOKS_DIR/lib/common.sh"
#
# Provides:
#   Variables: PROJECT_ROOT, DATA_DIR, STATE_DB, etc.
#   Functions: dragonfly_timestamp, dragonfly_git_*, dragonfly_ensure_dir, dragonfly_state_available, dragonfly_event_log, etc.

# =============================================================================
# Project Paths
# =============================================================================

PROJECT_ROOT="${PROJECT_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"

DATA_DIR="$PROJECT_ROOT/data"
HOOKS_DIR="$PROJECT_ROOT/.claude/hooks"

# =============================================================================
# Timestamps
# =============================================================================

# ISO 8601 UTC timestamp (e.g., 2026-01-15T08:30:00Z)
dragonfly_timestamp_iso() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

# Compact timestamp for IDs (e.g., 20260115-083000)
dragonfly_timestamp_compact() {
  date -u +"%Y%m%d-%H%M%S"
}

# Epoch seconds (for unique IDs)
dragonfly_timestamp_epoch() {
  date +%s
}

# Convenience: set TIMESTAMP to ISO format (most common usage)
TIMESTAMP="${TIMESTAMP:-$(dragonfly_timestamp_iso)}"

# =============================================================================
# Git Context
# =============================================================================

# Current branch name
dragonfly_git_branch() {
  git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown"
}

# Short hash of HEAD
dragonfly_git_short_hash() {
  git rev-parse --short HEAD 2>/dev/null || echo "unknown"
}

# Last commit as "hash subject"
dragonfly_git_last_commit() {
  git log -1 --format="%h %s" 2>/dev/null || echo "no commits"
}

# Count of uncommitted files (staged + unstaged + untracked)
dragonfly_git_uncommitted_count() {
  git status --porcelain 2>/dev/null | wc -l | tr -d ' '
}

# =============================================================================
# Directory Helpers
# =============================================================================

# Ensure one or more directories exist.
# Usage: dragonfly_ensure_dir "/path/to/dir1" "/path/to/dir2"
dragonfly_ensure_dir() {
  for dir in "$@"; do
    mkdir -p "$dir"
  done
}

# =============================================================================
# SQLite State Helpers (state.db — single source of truth)
# =============================================================================

STATE_DB="$DATA_DIR/state.db"

# Check if sqlite3 is available and state.db exists
dragonfly_state_available() {
  command -v sqlite3 &>/dev/null && [ -f "$STATE_DB" ]
}

# ─── Health ────────────────────────────────────────────────

# Read health from SQLite. Output: "pct|zone"
dragonfly_health_get() {
  sqlite3 "$STATE_DB" "SELECT context_usage_percent, zone FROM health ORDER BY rowid DESC LIMIT 1;" 2>/dev/null
}

# Write health to SQLite (upsert)
dragonfly_health_update() {
  local pct="$1" zone="$2"
  sqlite3 "$STATE_DB" "INSERT OR REPLACE INTO health (id, context_usage_percent, zone, updated_at) VALUES (1, $pct, '$zone', datetime('now'));" 2>/dev/null
}

# ─── Events ───────────────────────────────────────────────

# Log an event to SQLite
dragonfly_event_log() {
  local id="$1" type="$2" data="$3"
  sqlite3 "$STATE_DB" "INSERT OR IGNORE INTO events (id, type, data, created_at) VALUES ('$id', '$type', '${data//\'/\'\'}', datetime('now'));" 2>/dev/null
}

# ─── Checkpoints ──────────────────────────────────────────

# Save a checkpoint to SQLite
dragonfly_checkpoint_save() {
  local id="$1" name="$2" type="$3" data="$4"
  sqlite3 "$STATE_DB" "INSERT OR IGNORE INTO checkpoints (id, name, type, data, created_at) VALUES ('$id', '$name', '$type', '${data//\'/\'\'}', datetime('now'));" 2>/dev/null
}

# Count checkpoints in SQLite
dragonfly_checkpoint_count() {
  sqlite3 "$STATE_DB" "SELECT COUNT(*) FROM checkpoints;" 2>/dev/null || echo "0"
}

# Get latest checkpoint. Output: "id|name|type|created_at"
dragonfly_checkpoint_latest() {
  sqlite3 "$STATE_DB" "SELECT id, name, type, created_at FROM checkpoints ORDER BY created_at DESC LIMIT 1;" 2>/dev/null
}

# Get minutes since last checkpoint (returns 9999 if no checkpoints)
dragonfly_checkpoint_age_minutes() {
  sqlite3 "$STATE_DB" "SELECT CAST((julianday('now') - julianday(created_at)) * 1440 AS INTEGER) FROM checkpoints ORDER BY created_at DESC LIMIT 1;" 2>/dev/null || echo "9999"
}

# Count checkpoints by type
dragonfly_checkpoint_count_by_type() {
  local type="$1"
  sqlite3 "$STATE_DB" "SELECT COUNT(*) FROM checkpoints WHERE type='$type';" 2>/dev/null || echo "0"
}

# Get description from latest checkpoint JSON data
dragonfly_checkpoint_latest_description() {
  sqlite3 "$STATE_DB" "SELECT json_extract(data, '$.description') FROM checkpoints ORDER BY created_at DESC LIMIT 1;" 2>/dev/null || echo ""
}

# =============================================================================
# Logging
# =============================================================================

# Append a timestamped log entry.
# Usage: dragonfly_log <file> <level> <message>
dragonfly_log() {
  local file="$1" level="$2" message="$3"
  echo "[$(dragonfly_timestamp_iso)] [$level] $message" >> "$file"
}
