---
name: remember
description: "Store a fact or knowledge in semantic memory for future sessions"
---

# /remember Command

Store persistent memories that survive across sessions and context compressions.

## Usage

```
/remember "fact or knowledge to store"
/remember --category <cat> "content"
/remember --tags tag1,tag2 "content"
/remember --confidence high|medium|low "content"
```

## Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| content | The fact/knowledge to remember | required |
| --category | Category: architecture, conventions, patterns, workflows, debugging | inferred |
| --tags | Comma-separated tags for retrieval | auto-generated |
| --confidence | Confidence level | high (if user stated) |

## What to Do

### 1. Parse the Memory Content

Extract:
- The core fact being stored
- Any implicit category
- Relevant tags

### 2. Generate Memory Entry

```yaml
# data/memory/semantic/{category}.yaml
- id: "mem-{timestamp}"
  type: semantic
  category: "{category}"
  content: "{user's content}"
  confidence: "{level}"
  source: "User stated in session {date}"
  tags: [{generated tags}]
  created_at: "{timestamp}"
  session_id: "{current session}"
```

### 3. Update Memory Index

Add entry to `data/memory/index.yaml`:
- Increment total count
- Add to tag index
- Add to recent additions

### 4. Confirm Storage

```
✅ Memory stored:

ID: mem-{id}
Type: semantic
Category: {category}
Content: "{content}"
Confidence: {level}
Tags: [{tags}]

This will be recalled in future sessions.
```

## Examples

### Basic Usage
```
/remember "API rate limit is 100 requests per minute"

✅ Memory stored:
ID: mem-20250106-143052
Category: architecture
Content: "API rate limit is 100 requests per minute"
Tags: [api, rate-limit, constraints]
```

### With Category
```
/remember --category conventions "Use kebab-case for file names"

✅ Memory stored:
ID: mem-20250106-143055
Category: conventions
Content: "Use kebab-case for file names"
Tags: [conventions, naming, files]
```

### With Tags
```
/remember --tags auth,security "OAuth tokens expire after 1 hour"

✅ Memory stored:
ID: mem-20250106-143100
Category: architecture
Content: "OAuth tokens expire after 1 hour"
Tags: [auth, security, tokens, oauth]
```

## Auto-Remember Triggers

Claude should proactively suggest remembering when:

1. **User explicitly states a rule**
   > "Always use async/await, never callbacks"

   Suggest: `/remember "Always use async/await, never callbacks"`

2. **Important decision is made**
   > "Let's go with PostgreSQL for the database"

   Suggest: `/remember --category architecture "Using PostgreSQL as primary database"`

3. **Debugging insight discovered**
   > "Ah, the issue was the missing CORS header"

   Suggest: `/remember --category debugging "CORS issues: check for missing headers"`

4. **User preference revealed**
   > "I prefer smaller, focused commits"

   Suggest: `/remember --tags preferences,git "User prefers smaller, focused commits"`

## Memory Categories

| Category | Use For |
|----------|---------|
| architecture | System design, tech choices, constraints |
| conventions | Coding style, naming, formatting |
| patterns | Common code patterns in the project |
| workflows | How to do common tasks |
| debugging | Known issues and solutions |
| preferences | User's stated preferences |

## Related Commands

- `/recall` - Retrieve stored memories
- `/forget` - Remove a memory
- `/checkpoint` - Save session state
