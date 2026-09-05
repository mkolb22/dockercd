---
name: recall
description: "Retrieve memories from semantic storage"
---

# /recall Command

Search and retrieve stored memories from semantic memory.

## Usage

```
/recall <query>                 # Search by keyword
/recall --category <cat>        # Filter by category
/recall --tags tag1,tag2        # Filter by tags
/recall --recent [n]            # Show n most recent (default: 10)
/recall --all                   # Show all memories
```

## Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| query | Keyword to search in memory content | - |
| --category | Filter: architecture, conventions, patterns, workflows, debugging | all |
| --tags | Comma-separated tags to match | - |
| --recent | Show most recent n memories | 10 |
| --all | Show all memories (paginated) | false |

## What to Do

### 1. Read Memory Index

```bash
cat data/memory/index.yaml
```

### 2. Search Memories

Based on query type:
- **Keyword**: Search content fields
- **Tags**: Match tag arrays
- **Category**: Filter by category
- **Recent**: Sort by created_at

### 3. Read Matching Memory Files

```bash
# Read relevant category files
cat data/memory/semantic/architecture.yaml
cat data/memory/semantic/conventions.yaml
# etc.
```

### 4. Format Results

```
Found {n} memories matching "{query}":

1. [mem-001] {category} | {confidence}
   "{content}"
   Tags: [{tags}]
   Stored: {date}

2. [mem-002] {category} | {confidence}
   "{content}"
   Tags: [{tags}]
   Stored: {date}

... more results
```

## Examples

### Keyword Search
```
/recall auth

Found 4 memories matching "auth":

1. [mem-015] architecture | high
   "Authentication uses JWT with RS256 signing"
   Tags: [auth, jwt, security]
   Stored: 2025-01-05

2. [mem-023] architecture | high
   "OAuth tokens expire after 1 hour"
   Tags: [auth, oauth, tokens]
   Stored: 2025-01-05

3. [mem-031] workflows | medium
   "To test auth: use test user credentials in .env.test"
   Tags: [auth, testing, credentials]
   Stored: 2025-01-06

4. [mem-048] debugging | high
   "Auth failures: check token expiry first"
   Tags: [auth, debugging, tokens]
   Stored: 2025-01-06
```

### Category Filter
```
/recall --category conventions

Found 8 memories in category "conventions":

1. [mem-002] high
   "All API endpoints return { data, error, meta } shape"
   Tags: [api, conventions]

2. [mem-007] high
   "Use kebab-case for file names"
   Tags: [naming, files]

3. [mem-012] high
   "Always use async/await, never callbacks"
   Tags: [async, style]

... 5 more
```

### Tag Search
```
/recall --tags security

Found 3 memories with tag "security":

1. [mem-015] architecture | high
   "Authentication uses JWT with RS256 signing"

2. [mem-019] architecture | medium
   "API keys stored in environment variables only"

3. [mem-027] conventions | high
   "Never log sensitive data - use [REDACTED]"
```

### Recent Memories
```
/recall --recent 5

5 most recent memories:

1. [mem-048] debugging | high (today)
   "Auth failures: check token expiry first"

2. [mem-047] patterns | medium (today)
   "Rate limiting uses token bucket algorithm"

3. [mem-046] workflows | high (yesterday)
   "Deploy to staging: npm run deploy:staging"

4. [mem-045] architecture | medium (yesterday)
   "Cache TTL is 5 minutes for user data"

5. [mem-044] conventions | high (2 days ago)
   "Error messages should be user-friendly"
```

## No Results

When no memories match:
```
/recall kubernetes

No memories found matching "kubernetes".

Suggestions:
- Try broader search terms
- Check available categories: /recall --categories
- Store new knowledge: /remember "..."
```

## Memory Context for Tasks

When working on a task, proactively recall relevant memories:

```
User: Let's work on the API error handling

Claude: Before we start, let me check relevant memories...

/recall --tags api,error

Found 2 relevant memories:
1. "All API endpoints return { data, error, meta } shape"
2. "Error messages should be user-friendly"

I'll keep these conventions in mind as we work.
```

## Related Commands

- `/remember` - Store new memory
- `/forget` - Remove a memory
- `/health` - Check context health
