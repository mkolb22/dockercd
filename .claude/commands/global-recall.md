# Global Recall Command

Retrieve knowledge from global memory across all categories.

## Usage

```
/global-recall "<query>" [options]
```

## Options

| Option | Description | Example |
|--------|-------------|---------|
| `--category` | Filter by category | `preferences`, `patterns`, `technologies`, `learnings`, `workflows` |
| `--tech` | Filter by technology | `postgresql`, `typescript`, `react` |
| `--tag` | Filter by tag | `error-handling`, `performance` |
| `--all` | Show all matches | Default shows top 5 |

## Process

When you run this command:

1. **Search Global Memory**
   - Search all categories (or filtered)
   - Match query against content and metadata
   - Rank by relevance

2. **Display Results**
   - Show matching memories with context
   - Include source and date added
   - Highlight relevant portions

3. **Apply to Context**
   - Relevant memories are available for current session
   - Can be referenced in subsequent prompts

## Examples

### Search by Query

```
/global-recall "error handling"
```

Output:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Global Memory: "error handling"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Found 3 matches:

1. [Pattern] Result Type Pattern
   Category: patterns/error-handling
   Added: 2025-01-15

   Use Result type for error handling in TypeScript:
   ```typescript
   type Result<T, E = Error> =
     | { success: true; value: T }
     | { success: false; error: E };
   ```

2. [Learning] GL001 - Error Types in Stories
   Category: learnings/requirements
   Added: 2025-01-10
   Source: project-a

   Always specify error types explicitly in acceptance criteria

3. [Pattern] AppError Class
   Category: patterns/error-handling
   Added: 2025-01-05

   Consistent error class with code and statusCode properties

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Filter by Category

```
/global-recall --category=technologies --tech=postgresql
```

Output:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Global Memory: PostgreSQL Knowledge
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Technology: PostgreSQL
Version: 14+

Gotchas:
• Connection pooling: Default 100 connections
  → Use PgBouncer for high-traffic

• JSON vs JSONB: JSON is text, JSONB is binary
  → Always use JSONB unless preserving whitespace

• Foreign key indexes: Not auto-created
  → Always create indexes for FK columns

Best Practices:
• Always use parameterized queries
• Use EXPLAIN ANALYZE for optimization
• Prefer BIGINT for IDs

Common Queries:
• Upsert pattern available
• Cursor pagination pattern available

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Get Preferences

```
/global-recall --category=preferences
```

Output:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Global Preferences
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Coding Style:
• Indentation: 2 spaces
• Quotes: single
• Semicolons: false
• Trailing commas: ES5

Documentation:
• Style: JSDoc
• Detail level: moderate
• Include examples: yes

Testing:
• Framework: Vitest
• Coverage target: 80%
• Style: Arrange-Act-Assert

Git:
• Commit style: Conventional
• Branch naming: feature/issue-description
• Squash preference: yes

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

These preferences will be applied to code generation.
Override in project with data/memory/preferences.yaml
```

### Search Learnings

```
/global-recall "API" --category=learnings
```

Output:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Global Learnings: API
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

GL001: Always version APIs from the start
       Source: project-a (2024-06)
       → Use /v1/ prefix even for initial release

GL002: Rate limiting should be per-user AND per-endpoint
       Source: project-b (2024-09)
       → One user was able to DOS specific endpoints

GL003: Use cursor-based pagination, not offset
       Source: project-b (2024-09)
       → Offset caused performance issues at scale

GL004: Validate webhook signatures before processing
       Source: project-c (2025-01)
       → Security best practice

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Browse Workflows

```
/global-recall --category=workflows
```

Output:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Global Workflow Optimizations
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Debugging Workflow:
1. Capture exact input that caused error
2. Check error logs for stack trace
3. Write failing test FIRST
4. Fix and verify test passes

Performance Investigation:
1. Profile in production-like environment
2. Identify top 3 bottlenecks
3. Address largest first
4. Re-profile after each change

Code Review Workflow:
1. Run automated checks first
2. Review architecture/design choices
3. Check for security issues
4. Verify test coverage
5. Style/formatting last

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Automatic Context Loading

When starting a new task, relevant global memories may be automatically suggested:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Relevant Global Memories
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Based on your task "Add API authentication", these memories may help:

• GL001: Always version APIs from the start
• Pattern: JWT Authentication Pattern
• Tech: Rate limiting best practices

Apply to current context? [Y/n]
```

## Storage Location

Global memory is read from:
```
~/.dragonfly/global-memory/
├── preferences.yaml
├── patterns/
├── technologies/
├── learnings/
└── workflows/
```
