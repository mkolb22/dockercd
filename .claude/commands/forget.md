---
name: forget
description: Remove a memory from semantic storage
---

# Forget Command

Remove memories from semantic storage.

## Usage

```
/forget mem-001              # Remove specific memory by ID
/forget --tag deprecated     # Remove all memories with a tag
/forget --older-than 90d     # Remove memories older than 90 days
```

## Arguments

| Argument | Description |
|----------|-------------|
| `<memory-id>` | ID of the specific memory to remove |
| `--tag <tag>` | Remove all memories with this tag |
| `--older-than <duration>` | Remove memories older than duration (e.g., 30d, 6m, 1y) |
| `--dry-run` | Show what would be removed without actually removing |

## Implementation

When invoked, I:

1. Parse the arguments to determine what to forget
2. Find matching memories in `koan/memory/`
3. If `--dry-run`, show what would be removed
4. Otherwise, remove the matching memories
5. Log the removal in provenance

## Examples

### Remove a specific memory

```
/forget mem-architecture-001
```

Output:
```
Removed memory: mem-architecture-001
  Content: "Use OAuth2 for authentication"
  Category: architecture
  Created: 2026-01-05T10:30:00Z
```

### Remove by tag

```
/forget --tag temporary
```

Output:
```
Removed 3 memories with tag 'temporary':
  - mem-debug-001: "Temporary fix for..."
  - mem-debug-002: "Debug logging for..."
  - mem-experiment-001: "Testing approach..."
```

### Preview removal

```
/forget --older-than 30d --dry-run
```

Output:
```
Would remove 5 memories older than 30 days:
  - mem-001: Created 2025-12-01
  - mem-002: Created 2025-12-05
  ...

Use without --dry-run to actually remove.
```

## Memory Locations

Memories are stored in:

| Category | Location |
|----------|----------|
| Architecture | `koan/memory/semantic/architecture.yaml` |
| Patterns | `koan/memory/semantic/patterns.yaml` |
| Preferences | `koan/memory/semantic/preferences.yaml` |
| Conventions | `koan/memory/semantic/conventions.yaml` |

## Safety

- **No cascade deletion**: Forgetting a memory doesn't affect related provenance
- **Provenance preserved**: The forget action is logged in provenance
- **Recovery possible**: Memories can be restored from git history if needed

## Related Commands

- `/remember` - Store new memories
- `/recall` - Retrieve stored memories
- `/checkpoint` - Save session state
