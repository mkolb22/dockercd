# Error Messages - Actionable Guidance

Standard error messages with clear, actionable steps for users.

## Error Message Format

All error messages should follow this format:

```
ERROR: [Category] - [Brief Description]

What happened:
  [1-2 sentence explanation of what went wrong]

Why this matters:
  [Impact on workflow/user]

How to fix:
  1. [First action]
  2. [Second action]
  3. [Optional: Third action]

Quick fix: [One-liner for common case]

Need help? /help troubleshooting
```

## Standard Error Messages

### Story Errors

```
ERROR: Story Creation Failed

What happened:
  Could not capture requirements from the provided description.
  The story concept couldn't extract clear acceptance criteria.

Why this matters:
  Without a clear story, architecture cannot proceed safely.

How to fix:
  1. Rephrase with specific outcomes: "Users should be able to..."
  2. Include at least one measurable success criteria
  3. Separate "what" (requirements) from "how" (implementation)

Quick fix: Add "As a user, I want..." format

Example:
  Before: "Add login"
  After: "As a user, I want to log in with my email and password
          so that I can access my account securely."
```

```
ERROR: Story Ambiguous - Clarification Needed

What happened:
  The story description could mean multiple things.
  Confidence score: ${confidence}% (threshold: 70%)

Why this matters:
  Ambiguous stories lead to incorrect architecture decisions.

How to fix:
  1. Answer the clarification questions below
  2. Provide specific examples of expected behavior
  3. Define scope boundaries (what's NOT included)

Quick fix: Answer the prompted questions
```

### Architecture Errors

```
ERROR: Architecture Design Failed

What happened:
  Could not create a technical design for the story.
  Error: ${error.message}

Why this matters:
  Implementation cannot proceed without architecture decisions.

How to fix:
  1. Check if requirements are clear: /trace ${story.id}
  2. Simplify requirements if scope is too broad
  3. Provide reference implementations: "Similar to how X works..."

Quick fix: /feature "${story.title}" --simplify

Alternative: Provide architecture manually in data/architecture/
```

```
ERROR: High Risk Architecture - Approval Required

What happened:
  Architecture analysis identified high-risk design decisions.
  Risks: ${architecture.risks}

Why this matters:
  High-risk designs may have security, scalability, or maintenance issues.

How to fix:
  1. Review risks in: data/architecture/arch-${id}.yaml
  2. Choose:
     - Approve: Accept risks and proceed
     - Revise: Request lower-risk alternative
     - Cancel: Stop and reconsider approach

Quick fix: Review and approve if acceptable risk

Note: This is a safety gate, not a blocker. Your judgment matters.
```

### Implementation Errors

```
ERROR: Implementation Generation Failed

What happened:
  Could not generate code from the architecture specification.
  Architecture may be too complex for single-pass generation.

Why this matters:
  No code changes were made. Workflow is paused.

How to fix:
  1. Break architecture into smaller pieces: /sync --decompose
  2. Simplify technical approach
  3. Implement manually following the spec

Quick fix: Ask to "break into smaller pieces"

Files expected but not created:
${architecture.expected_files}
```

```
ERROR: Implementation Fix Failed

What happened:
  Auto-fix could not resolve test failures.
  Failing tests: ${test.failures}

Why this matters:
  Code quality gate not passed. Commit blocked.

How to fix:
  1. Review test output for specific failures
  2. Provide hints about the failure type (mock, timing, data)
  3. Fix manually if auto-fix can't handle it

Quick fix: Choose "Retry with hints" and describe the issue

Common causes:
  - Mock setup incorrect
  - Async timing issues
  - Test data/fixtures wrong
```

### Quality Errors

```
ERROR: Code Review Failed

What happened:
  The quality review process encountered an error.
  This is NOT the same as finding code issues.

Why this matters:
  Cannot verify code quality before commit.

How to fix:
  1. Retry the review (often works)
  2. Skip review if you've manually reviewed
  3. Check for unusual file patterns

Quick fix: Choose "Retry review"

Note: Skipping review is not recommended for production code.
```

```
ERROR: Test Execution Failed

What happened:
  Tests could not run (execution error, not test failure).
  Error: ${error.message}

Why this matters:
  Cannot verify implementation correctness.

How to fix:
  1. Check test environment: npm test (or appropriate command)
  2. Verify test dependencies installed
  3. Check for syntax errors in test files

Quick fix: Run tests manually and report results

Possible causes:
  - Missing dependencies
  - Environment variables not set
  - Test runner configuration issue
```

### Version/Git Errors

```
ERROR: Pre-commit Hook Failed

What happened:
  Git pre-commit hook rejected the commit.
  Hook output: ${error.hook_output}

Why this matters:
  Code doesn't meet project standards. Commit blocked.

How to fix:
  1. Auto-fix: Ask to "Fix hook issues"
  2. Manual: Run linter/formatter locally
  3. Skip: Commit with --no-verify (not recommended)

Quick fix: Choose "Fix hook issues"

Common causes:
  - Linting errors
  - Formatting issues
  - Type errors (TypeScript)
```

```
ERROR: Merge Conflict Detected

What happened:
  Changes conflict with remote repository changes.

Why this matters:
  Cannot commit until conflicts are resolved.

How to fix:
  1. Pull latest changes: git pull
  2. Resolve conflicts in marked files
  3. Stage resolved files and retry

Quick fix: git pull --rebase and resolve conflicts

This requires manual resolution - automated tools can't safely merge.
```

### Context Errors

```
ERROR: Context Usage Critical (${usage}%)

What happened:
  Context window approaching limit.
  Workflow may be interrupted.

Why this matters:
  At 100%, Claude loses access to earlier conversation.

How to fix:
  1. Create checkpoint immediately: /checkpoint
  2. Continue in new session: /restore
  3. Review earlier steps for compression

Quick fix: /checkpoint "before continuing"

Warning: Context above 95% may cause data loss.
```

```
ERROR: Context Snapshot Failed

What happened:
  Could not save context state.
  This is a critical failure.

Why this matters:
  Risk of losing workflow progress if context overflows.

How to fix:
  1. Manually save important state to files
  2. Note current workflow step and state
  3. Start new session with /restore

Quick fix: Copy important state to clipboard/file NOW

Files to preserve:
  - data/flows/ (workflow state)
  - data/stories/ (requirements)
  - data/architecture/ (design decisions)
```

### MCP Errors

```
ERROR: MCP Server Unavailable

What happened:
  Code analysis MCP servers are not responding.
  Server: ${mcp.server}

Why this matters:
  Code context won't be available for architecture decisions.
  Workflow continues with graceful degradation.

How to fix:
  1. Check MCP server status: ls mcp-servers/
  2. Restart servers if needed
  3. Or continue - MCP is optional

Quick fix: Continue without MCP (workflow handles this)

Note: MCP enhances accuracy but isn't required.
```

## Using These Messages

When implementing error handling:

1. **Include all sections** - Users need context, impact, and actions
2. **Be specific** - Include file paths, IDs, exact commands
3. **Prioritize quick fix** - Most users want the fastest solution
4. **Link to help** - Always provide escape hatch to more help
5. **Don't blame** - Focus on solutions, not what went wrong

## Template Variables

Standard variables available in error messages:
- `${error.message}` - Raw error message
- `${error.classification}` - transient/permanent/degraded
- `${concept}` - Current concept name
- `${action}` - Current action name
- `${story.id}`, `${architecture.id}`, etc. - State IDs
- `${context.usage_percent}` - Current context usage
- `${flow.id}` - Current workflow ID
