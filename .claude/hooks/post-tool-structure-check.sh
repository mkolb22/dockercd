#!/usr/bin/env bash
# Dragonfly Project Structure Validation Hook
#
# Runs after Write/Edit tool use to detect files in wrong locations.
# Warns but does not block (to avoid breaking workflows).
#
# Protected directories:
#   - data/     → ONLY state files (.db, .json, .npy) allowed
#   - .claude/  → ONLY Dragonfly config files allowed

set -e

# Get tool input from stdin (JSON)
INPUT=$(cat)

# Extract file path from tool input
# Handles both Write and Edit tools
FILE_PATH=$(echo "$INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n 1 | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')

# If no file path found, exit silently
[ -z "$FILE_PATH" ] && exit 0

# Get project root
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# Make path relative for checking
REL_PATH="${FILE_PATH#$PROJECT_ROOT/}"

# Function to output warning
warn() {
    echo ""
    echo "⚠️  PROJECT STRUCTURE WARNING"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "$1"
    echo ""
    echo "See: .claude/skills/project-structure.md"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
}

# Check 1: data/ directory (ONLY state and data files)
if [[ "$REL_PATH" == data/* ]]; then
    # Allow .db, .json, .npy, .bin, .log files
    if [[ "$REL_PATH" != *.db && "$REL_PATH" != *.json && "$REL_PATH" != *.npy && "$REL_PATH" != *.bin && "$REL_PATH" != *.log ]]; then
        EXTENSION="${REL_PATH##*.}"
        warn "Unexpected file detected in data/ directory.

File: $REL_PATH
Extension: .$EXTENSION

The data/ directory should ONLY contain:
  - .db files (SQLite state)
  - .json files (manifests, graphs)
  - .npy/.bin files (embeddings, indices)

Source code should be placed in:
  - src/     (source files)
  - tests/   (test files)
  - lib/     (libraries)

Please move this file to the appropriate project directory."
        exit 0
    fi
fi

# Check 2: .claude/ directory (ONLY Dragonfly config)
if [[ "$REL_PATH" == .claude/* ]]; then
    # Allow known Dragonfly file types
    case "$REL_PATH" in
        *.md|*.yaml|*.json|*.sh)
            # These are valid Dragonfly config files
            ;;
        *)
            EXTENSION="${REL_PATH##*.}"
            # Check for source code extensions
            case "$EXTENSION" in
                ts|js|tsx|jsx|py|go|rs|java|cpp|c|h|rb|php|swift|kt)
                    warn "Source code detected in .claude/ directory.

File: $REL_PATH
Extension: .$EXTENSION

The .claude/ directory should ONLY contain Dragonfly configuration:
  - concepts/*.md
  - agents/*.md
  - skills/*.md
  - commands/*.md
  - synchronizations/*.yaml
  - schemas/*.json
  - hooks/*.sh

Source code should be placed in:
  - src/     (source files)
  - tests/   (test files)
  - lib/     (libraries)

Please move this file to the appropriate project directory."
                    ;;
            esac
            ;;
    esac
fi

# Check 4: Source code extensions in data/ subdirectories
if [[ "$REL_PATH" == data/*/* ]]; then
    EXTENSION="${REL_PATH##*.}"
    case "$EXTENSION" in
        ts|js|tsx|jsx|py|go|rs|java|cpp|c|h|rb|php|swift|kt|css|scss|html|vue|svelte)
            warn "Source code detected in data/ subdirectory.

File: $REL_PATH
Extension: .$EXTENSION

The data/ directory should ONLY contain state and data files (.db, .json, .npy).

Please move the source code to the project's src/ directory."
            ;;
    esac
fi

exit 0
