# Progressive Disclosure Pattern

## Purpose

The Progressive Disclosure Pattern optimizes context window usage by structuring output files with a summary section that can be parsed independently of detailed content.

## Pattern Structure

All state files in Dragonfly use this pattern:

```yaml
# === SUMMARY (first 5 lines - quick scanning) ===
id: "entity-001"
status: "completed"
summary: "One-line description of current state"

# === FULL DETAILS (load only if needed) ===
details:
  # Complete information
  # Only loaded when full context required
```

## Benefits

| Scenario | Without Pattern | With Pattern | Savings |
|----------|-----------------|--------------|---------|
| Sync rule evaluation | ~2000 tokens | ~100 tokens | 95% |
| Status checking | ~2000 tokens | ~50 tokens | 97.5% |
| Full context needed | ~2000 tokens | ~2000 tokens | 0% |

## Implementation Guidelines

### 1. Summary Section (Lines 1-5)

Must contain:
- `id`: Unique identifier
- `status`: Current state enum
- `summary`: One-line human-readable description

Optional but recommended:
- `created_at`: ISO-8601 timestamp
- Key metrics (count, percentage, etc.)

### 2. Details Section

Everything else goes under `details:`:
- Full descriptions
- Arrays and nested objects
- Metadata
- History/provenance

### 3. Query Optimization

Sync rules should query summary fields:

```yaml
# Good - only reads summary
where:
  query: "status == 'completed'"

# Avoid - requires loading details
where:
  query: "details.acceptance_criteria.length > 0"
```

## Examples

### Story State
```yaml
story_id: "story-001"
status: "ready"
summary: "OAuth authentication - ready, 4 criteria"

details:
  title: "Add OAuth authentication"
  description: |
    Users should be able to log in using OAuth providers.
  acceptance_criteria:
    - "User sees OAuth button"
    - "Redirect to provider works"
    - "Callback handles token"
    - "Session is created"
```

### Architecture State
```yaml
arch_id: "arch-001"
status: "completed"
summary: "JWT + Redis sessions, 3 decisions, low risk"

details:
  approach: "JWT for stateless auth, Redis for session storage"
  decisions:
    - decision: "Use JWT"
      rationale: "Stateless, scalable"
    - decision: "Redis sessions"
      rationale: "Fast revocation"
    - decision: "OAuth2 flow"
      rationale: "Industry standard"
  risks:
    - risk: "Token theft"
      mitigation: "Short expiry, refresh tokens"
      severity: "medium"
```

### Implementation State
```yaml
impl_id: "impl-001"
status: "completed"
summary: "5 files, 198 lines, 2 tests created"

details:
  files_created:
    - path: "src/auth/oauth.ts"
      lines: 45
    - path: "src/auth/jwt.ts"
      lines: 78
  files_modified:
    - path: "src/routes/auth.ts"
      lines_added: 25
      lines_removed: 3
  tests_created:
    - "tests/auth/oauth.test.ts"
    - "tests/auth/jwt.test.ts"
```

## Integration with Concepts

### Story Concept
Uses pattern for story state files:
- Summary: id, status, title summary
- Details: full description, criteria, context

### Architecture Concept
Uses pattern for architecture decisions:
- Summary: id, status, approach summary, risk level
- Details: full decisions, components, risks

### Implementation Concept
Uses pattern for implementation tracking:
- Summary: id, status, file/line counts
- Details: full file lists, modifications, tests

### Quality Concept
Uses pattern for review results:
- Summary: id, status, issue counts
- Details: full issues, test results, recommendations

## Anti-Patterns

### Don't: Duplicate Summary in Details
```yaml
# Wrong - duplicates data
summary: "5 files created"
details:
  summary: "5 files created"  # Redundant!
  files: [...]
```

### Don't: Put Critical Data Only in Details
```yaml
# Wrong - status buried in details
id: "impl-001"
details:
  status: "completed"  # Should be in summary!
```

### Don't: Use Complex Summary
```yaml
# Wrong - summary too complex
summary:
  files: 5
  lines: 198
  status: "completed"
# Should be a simple string
```

## Cost Impact

For a typical feature workflow:
- ~50 sync rule evaluations
- Without pattern: 50 × 2000 = 100,000 tokens
- With pattern: 50 × 100 = 5,000 tokens
- **Savings: 95,000 tokens (~$0.285 at Opus rates)**

---

**Pattern Type**: Output Optimization
**Applies To**: All concept state files
**Context Savings**: 95% for status checks
