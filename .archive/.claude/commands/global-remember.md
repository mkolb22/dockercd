# Global Remember Command

Store knowledge in global memory that persists across all projects.

## Usage

```
/global-remember "<knowledge>" [options]
```

## Options

| Option | Description | Example |
|--------|-------------|---------|
| `--category` | Memory category | `preferences`, `patterns`, `technologies`, `learnings`, `workflows` |
| `--tech` | Technology tag | `postgresql`, `typescript`, `react` |
| `--tag` | Additional tags | `error-handling`, `performance` |
| `--source` | Source project | Current project by default |

## Process

When you run this command:

1. **Parse Knowledge**
   - Extract the key insight
   - Identify category and tags

2. **Check for Duplicates**
   - Search existing global memory
   - If similar exists, offer to update or create new

3. **Store in Global Memory**
   - Create/update file in `~/.zen/global-memory/`
   - Add metadata (timestamp, source project)

4. **Confirm Storage**
   - Display what was stored
   - Show how to recall it

## Examples

### Store a Preference

```
/global-remember "Always use single quotes in TypeScript" --category=preferences
```

Creates/updates `~/.zen/global-memory/preferences.yaml`:
```yaml
coding_style:
  quotes: single
  quotes_note: "Always use single quotes in TypeScript"
  added: 2025-01-15
```

### Store a Pattern

```
/global-remember "Use Result type for error handling in TypeScript" --category=patterns --tag=error-handling
```

Creates `~/.zen/global-memory/patterns/result-type.yaml`:
```yaml
name: Result Type Pattern
category: error-handling
language: typescript
description: Use Result type for error handling in TypeScript
added: 2025-01-15
source_project: current-project

pattern: |
  type Result<T, E = Error> =
    | { success: true; value: T }
    | { success: false; error: E };

  function createUser(data: UserData): Result<User, ValidationError> {
    if (!data.email) {
      return { success: false, error: new ValidationError('Email required') };
    }
    return { success: true, value: new User(data) };
  }

usage: |
  Always check success before accessing value:
  const result = createUser(data);
  if (result.success) {
    console.log(result.value);
  } else {
    console.error(result.error);
  }
```

### Store a Technology Gotcha

```
/global-remember "PostgreSQL JSONB is faster than JSON for queries" --category=technologies --tech=postgresql
```

Updates `~/.zen/global-memory/technologies/postgresql.yaml`:
```yaml
technology: PostgreSQL
gotchas:
  - title: JSON vs JSONB Performance
    issue: JSON stores as text, JSONB as binary
    solution: Always use JSONB unless preserving whitespace
    added: 2025-01-15
```

### Store a Cross-Project Learning

```
/global-remember "API rate limiting should be per-user AND per-endpoint" --category=learnings
```

Updates `~/.zen/global-memory/learnings/api-design.yaml`:
```yaml
category: API Design
learnings:
  - id: GL004
    insight: API rate limiting should be per-user AND per-endpoint
    context: Learned from current project
    recommendation: Implement both layers in middleware
    added: 2025-01-15
    source: current-project
```

### Store a Workflow Optimization

```
/global-remember "Write failing test before fixing bugs" --category=workflows
```

Updates `~/.zen/global-memory/workflows/debugging.yaml`:
```yaml
workflow: Debugging
optimizations:
  - name: Test-first bug fixing
    steps:
      - Reproduce the bug
      - Write a failing test that captures the bug
      - Fix the code
      - Verify test passes
    rationale: Prevents regression and documents expected behavior
    added: 2025-01-15
```

## Automatic Suggestions

The system may suggest promoting project learnings to global memory:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Potential Global Learning Detected
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

This learning from the current project may be useful globally:

"Always validate webhook signatures before processing"

This applies to: webhooks, security, API integration

Would you like to add this to global memory?
[Y] Yes, add to global  [N] Keep project-only  [E] Edit first
```

## Storage Location

All global memory is stored in:
```
~/.zen/global-memory/
├── preferences.yaml
├── patterns/
│   └── *.yaml
├── technologies/
│   └── *.yaml
├── learnings/
│   └── *.yaml
└── workflows/
    └── *.yaml
```

## Privacy

- Global memory is stored locally only
- No data is sent to external services
- You control what gets stored
- Can be backed up or synced manually
