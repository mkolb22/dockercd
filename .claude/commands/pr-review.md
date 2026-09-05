# /pr-review Command

Analyze and review pull requests using MCP tools.

## Usage

```
/pr-review <pr_url>                    # Analyze PR
/pr-review submit <pr_url> [--approve] # Submit formal review
/pr-review comment <pr_url> <file:line> <message>  # Add inline comment
```

## Purpose

This command invokes the pr-review concept to:
- Analyze code changes for quality issues
- Check architectural impact
- Scan for security concerns
- Suggest improvements
- Submit reviews via GitHub MCP

## Process

When you run `/pr-review <url>`:

1. **Fetch PR Details**
   - Get changed files via GitHub MCP
   - Load existing comments

2. **Analyze Changes**
   - Code quality assessment
   - Pattern consistency check
   - Error handling completeness

3. **Check Architecture**
   - Component boundaries
   - Dependency direction
   - Impact on call graph (via AST index)

4. **Security Scan**
   - Input validation
   - Secrets handling
   - Common vulnerabilities

5. **Generate Report**
   - Categorized findings
   - Severity ratings
   - Specific suggestions

## Output Format

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PR Analysis: #123 - Add OAuth authentication
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Summary:
  Files Changed: 8
  Additions:     245
  Deletions:     32

┌─────────────────────────────────────────────────┐
│ Code Quality: 85%                               │
├─────────────────────────────────────────────────┤
│ MEDIUM  src/auth/oauth.ts:45                    │
│         Error handling could be more specific   │
│         → Catch specific OAuth errors           │
│                                                 │
│ LOW     src/auth/oauth.ts:78                    │
│         Magic string detected                   │
│         → Extract 'google' to constant          │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│ Architectural Impact: LOW RISK                  │
├─────────────────────────────────────────────────┤
│ AuthService  - New dependency added             │
│ UserController - New endpoint registered        │
│ Call Graph: +5 new calls, 2 modified            │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│ Security: 90%                                   │
├─────────────────────────────────────────────────┤
│ INFO    Ensure OAuth secrets in env variables   │
│         File: src/auth/config.ts                │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│ Testing                                         │
├─────────────────────────────────────────────────┤
│ Tests Added: 3                                  │
│ Coverage:    ~85% (estimated)                   │
│ New Code:    ✓ Covered                          │
└─────────────────────────────────────────────────┘

Recommendations:
  MUST ADDRESS:
    • Add specific error types for OAuth failures

  SHOULD ADDRESS:
    • Extract provider names to constants
    • Add integration test for token refresh

  NICE TO HAVE:
    • Add JSDoc comments for public methods

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Analysis saved to: data/reviews/pr-123-analysis.yaml

Submit review? [a] Approve  [c] Comment  [r] Request Changes  [n] Skip
```

## Submitting Reviews

With `/pr-review submit`:

```
/pr-review submit https://github.com/owner/repo/pull/123 --approve

Submitting review...

✓ Review submitted: APPROVE
  Summary posted with 3 inline comments

View at: https://github.com/owner/repo/pull/123#pullrequestreview-...
```

## Adding Comments

```
/pr-review comment #123 src/auth.ts:45 "Consider using AuthError type"

✓ Comment posted at src/auth.ts line 45
```

## Review Criteria

| Category | Checks |
|----------|--------|
| Code Quality | Clean code, error handling, duplication, naming |
| Architecture | Boundaries, dependencies, patterns |
| Security | Input validation, auth, secrets, injection |
| Performance | N+1 queries, re-renders, memory leaks |
| Testing | Coverage, edge cases, integration |

## Storage

- Analysis: `data/reviews/pr-{number}-analysis.yaml`
- Notification: `data/notifications/pr-alert-{timestamp}.yaml` (if high-risk)

## MCP Tools Used

- GitHub MCP: `get_pull_request`, `get_pull_request_files`, `create_pull_request_review`
- AST Index: `find_symbol`, `get_call_graph` (optional, enhances review)
- Semantic RAG: `find_similar_code` (optional, finds patterns)

## WYSIWID Principle

Review criteria visible in:
- `.claude/concepts/pr-review.md`
- Analysis YAML shows all factors considered
- No hidden scoring rules
