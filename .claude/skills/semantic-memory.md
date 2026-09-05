# Semantic Memory Skill

Expert knowledge for managing long-term semantic memory across sessions.

## Overview

Semantic memory provides persistent, searchable storage for:
- Project knowledge and patterns
- Code explanations and rationale
- User preferences and conventions
- Cross-session learnings

## Memory Architecture

### Memory Types

```yaml
memory_types:
  episodic:
    description: "Specific events and interactions"
    retention: "session + checkpoint"
    examples:
      - "User explained auth requirements on Jan 5"
      - "Bug fix discussion for issue #42"

  semantic:
    description: "General knowledge and facts"
    retention: "permanent"
    examples:
      - "This project uses TypeScript strict mode"
      - "API responses are paginated with cursor"

  procedural:
    description: "How to do things in this project"
    retention: "permanent"
    examples:
      - "To deploy: run npm run deploy:prod"
      - "Tests require DATABASE_URL env var"
```

### Storage Structure

```
data/*/
├── memory/
│   ├── index.yaml           # Memory index and metadata
│   ├── semantic/            # Long-term knowledge
│   │   ├── project.yaml     # Project-level facts
│   │   ├── patterns.yaml    # Code patterns used
│   │   ├── decisions.yaml   # Architectural decisions
│   │   └── conventions.yaml # Style and conventions
│   ├── procedural/          # How-to knowledge
│   │   ├── workflows.yaml   # Common workflows
│   │   ├── commands.yaml    # Project commands
│   │   └── debugging.yaml   # Debugging approaches
│   └── episodes/            # Session summaries
│       └── 2025-01-06.yaml  # Daily episode logs
```

## Memory Operations

### 1. Remember (Store)

Store a new memory:

```yaml
# data/memory/semantic/project.yaml
memories:
  - id: "mem-001"
    type: semantic
    category: architecture
    content: "Authentication uses JWT with RS256 signing"
    confidence: high
    source: "User stated in session 2025-01-05"
    tags: [auth, jwt, security]
    created_at: "2025-01-05T10:30:00Z"

  - id: "mem-002"
    type: semantic
    category: conventions
    content: "All API endpoints return { data, error, meta } shape"
    confidence: high
    source: "Observed in codebase analysis"
    tags: [api, conventions]
    created_at: "2025-01-05T11:00:00Z"
```

### 2. Recall (Retrieve)

Query memories by:
- **Tags**: Find memories with specific tags
- **Category**: Filter by memory category
- **Recency**: Most recent first
- **Relevance**: Text similarity (if available)

```yaml
# Query example
recall:
  tags: [auth]
  category: architecture
  limit: 5

# Returns matching memories
```

### 3. Forget (Remove)

Remove outdated or incorrect memories:

```yaml
forget:
  id: "mem-001"
  reason: "Superseded by mem-015 - auth changed to OAuth"
```

### 4. Consolidate (Merge)

Periodically consolidate related memories:

```yaml
# Before consolidation
- "Uses React 18"
- "Uses React with hooks"
- "Functional components preferred"

# After consolidation
- id: "mem-consolidated-001"
  content: "React 18 with hooks, functional components preferred"
  consolidated_from: [mem-003, mem-007, mem-012]
```

## Memory Index

The index provides fast lookup:

```yaml
# data/memory/index.yaml
version: 1
last_updated: "2025-01-06T14:00:00Z"

stats:
  total_memories: 47
  by_type:
    semantic: 32
    procedural: 12
    episodic: 3
  by_category:
    architecture: 15
    conventions: 10
    patterns: 8
    workflows: 7
    debugging: 4
    other: 3

recent_additions:
  - id: "mem-047"
    summary: "Rate limiting uses token bucket"
    added: "2025-01-06T13:45:00Z"

tags:
  auth: [mem-001, mem-015, mem-023]
  api: [mem-002, mem-008, mem-019]
  testing: [mem-005, mem-011, mem-030]
  # ... more tags
```

## Integration with Checkpoints

When creating a checkpoint:
1. Save relevant memories in checkpoint
2. Mark episodic memories for that session
3. Consolidate if memory count is high

When restoring:
1. Load memories from checkpoint
2. Merge with any newer permanent memories
3. Present relevant memories in restoration summary

## Memory Confidence Levels

```yaml
confidence_levels:
  high:
    description: "User explicitly stated or verified"
    decay: none

  medium:
    description: "Inferred from code or context"
    decay: "Review after 30 days"

  low:
    description: "Assumption or guess"
    decay: "Review after 7 days"

  deprecated:
    description: "Known to be outdated"
    action: "Remove or update"
```

## Usage in Commands

### /remember

```
/remember "API uses cursor-based pagination"
/remember --category patterns "Error handling uses Result type"
/remember --tags api,conventions "All endpoints require auth header"
```

### /recall

```
/recall auth                    # Find memories about auth
/recall --category architecture # All architecture memories
/recall --recent 10             # Last 10 memories
```

### /forget

```
/forget mem-001                 # Remove specific memory
/forget --tag deprecated        # Remove all deprecated
```

## Best Practices

1. **Be Specific**: Store concrete facts, not vague impressions
2. **Include Source**: Note where the information came from
3. **Use Tags**: Enable efficient retrieval
4. **Review Regularly**: Consolidate and prune memories
5. **Confidence Levels**: Be honest about certainty
6. **Link to Code**: Reference files/lines when relevant

## Example Session

```
User: /remember "The user prefers explicit error handling over try-catch"

Claude:
✅ Memory stored:

ID: mem-048
Type: semantic
Category: conventions
Content: "The user prefers explicit error handling over try-catch"
Confidence: high (user stated)
Tags: [conventions, error-handling, preferences]

This will be recalled in future sessions when discussing error handling.
```

```
User: /recall error

Claude:
Found 3 memories matching "error":

1. [mem-048] conventions | high
   "The user prefers explicit error handling over try-catch"

2. [mem-023] patterns | medium
   "Errors are logged to Sentry in production"

3. [mem-031] procedural | high
   "To debug API errors: check logs at /var/log/api.log"
```
