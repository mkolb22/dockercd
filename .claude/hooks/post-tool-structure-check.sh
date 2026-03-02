#!/usr/bin/env bash
# Zen Project Structure Validation Hook
#
# Runs after Write/Edit tool use to detect files in wrong locations.
# Warns but does not block (to avoid breaking workflows).
#
# Protected directories:
#   - koan/     → ONLY state files (.yaml, .db) allowed
#   - .claude/  → ONLY Zen config files allowed
#   - .zen/     → NEVER modify (submodule)

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

# Check 1: .zen/ directory (NEVER modify)
if [[ "$REL_PATH" == .zen/* ]]; then
    warn "Modifying .zen/ submodule is not allowed.

File: $REL_PATH

The .zen/ directory is a git submodule and should never be modified.
To customize Zen, edit files in .claude/ instead."
    exit 0
fi

# Check 2: koan/ directory (ONLY state files)
if [[ "$REL_PATH" == koan/* ]]; then
    # Allow .yaml, .db, .md, .log files
    if [[ "$REL_PATH" != *.yaml && "$REL_PATH" != *.db && "$REL_PATH" != *.md && "$REL_PATH" != *.log ]]; then
        EXTENSION="${REL_PATH##*.}"
        warn "Unexpected file detected in koan/ directory.

File: $REL_PATH
Extension: .$EXTENSION

The koan/ directory should ONLY contain:
  - .db files (SQLite state)
  - .yaml files (configuration/anchors)
  - README.md (documentation)

Source code should be placed in:
  - src/     (source files)
  - tests/   (test files)
  - lib/     (libraries)

Please move this file to the appropriate project directory."
        exit 0
    fi
fi

# Check 3: .claude/ directory (ONLY Zen config)
if [[ "$REL_PATH" == .claude/* ]]; then
    # Allow known Zen file types
    case "$REL_PATH" in
        *.md|*.yaml|*.json|*.sh)
            # These are valid Zen config files
            ;;
        *)
            EXTENSION="${REL_PATH##*.}"
            # Check for source code extensions
            case "$EXTENSION" in
                ts|js|tsx|jsx|py|go|rs|java|cpp|c|h|rb|php|swift|kt)
                    warn "Source code detected in .claude/ directory.

File: $REL_PATH
Extension: .$EXTENSION

The .claude/ directory should ONLY contain Zen configuration:
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

# Check 4: Source code extensions in root koan subdirectories
# This catches things like koan/implementations/auth.ts
if [[ "$REL_PATH" == koan/*/* ]]; then
    EXTENSION="${REL_PATH##*.}"
    case "$EXTENSION" in
        ts|js|tsx|jsx|py|go|rs|java|cpp|c|h|rb|php|swift|kt|css|scss|html|vue|svelte)
            warn "Source code detected in koan/ subdirectory.

File: $REL_PATH
Extension: .$EXTENSION

The koan/ directory and its subdirectories should ONLY contain state files (.db, .yaml).

Example of correct structure:
  koan/implementations/impl-001.yaml  (metadata about implementation)
  src/auth.ts                         (actual source code)

Please move the source code to the project's src/ directory."
            ;;
    esac
fi

exit 0
