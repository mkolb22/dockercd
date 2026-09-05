# /classify Command

Classify a task and show which workflow will be used.

## Usage

```
/classify "fix the login button"
/classify "add dark mode support"
/classify "refactor the auth module"
```

## Purpose

This command analyzes a task description and:
1. Classifies it into a task type (bug-fix, refactor, feature, etc.)
2. Shows which workflow will be triggered
3. Displays expected duration and cost savings
4. Optionally routes to the appropriate workflow

## Process

When you run `/classify "<task>"`:

1. **Load Classification Rules**
   ```bash
   cat .claude/synchronizations/task-routing.yaml
   ```

2. **Extract Keywords** from the task description

3. **Match Against Patterns**
   - Check each classifier in order
   - First match wins
   - Default to full-feature if no match

4. **Display Classification Result**

## Output Format

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Task Classification
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Task: "fix the login button not responding"

Classification: BUG FIX
  Matched pattern: "fix"
  Confidence: HIGH

Workflow: bug-fix-flow
  Phases: Story → Implementation → Quality → Version
  Skipped: Architecture (not needed for bug fixes)

Expected Performance:
  Duration: ~5 minutes (vs ~20 min full workflow)
  Cost: ~$0.01 (vs ~$0.05 full workflow)
  Savings: 75% faster, 80% cheaper

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Proceed with bug-fix workflow? (y/n)
```

## Classification Types

| Type | Patterns | Workflow | Savings |
|------|----------|----------|---------|
| Bug Fix | fix, bug, broken, error, crash | bug-fix-flow | 75% time, 80% cost |
| Refactor | refactor, cleanup, rename, reorganize | refactor-flow | 20% time (adds impact analysis) |
| Documentation | document, docs, readme, comment | documentation-flow | 85% time, 90% cost |
| Testing | test, spec, coverage, assert | testing-flow | 60% time, 70% cost |
| Performance | optimize, slow, speed, cache | performance-flow | Adds benchmarking |
| New Feature | add, create, implement, build | full-feature-flow | Baseline |

## Examples

### Bug Fix Classification
```
/classify "fix crash when user logs out"

Classification: BUG FIX
Workflow: bug-fix-flow (skips architecture)
```

### Refactoring Classification
```
/classify "refactor the authentication module to use dependency injection"

Classification: REFACTORING
Workflow: refactor-flow (adds impact analysis via AST tools)
MCP Tools: ast-index.get_call_graph, ast-index.find_references
```

### New Feature Classification
```
/classify "add support for OAuth2 authentication"

Classification: NEW FEATURE
Workflow: full-feature-flow (complete cycle)
MCP Tools: semantic-rag.semantic_search (find similar implementations)
```

## Integration with /workflow

After classification, you can:

1. **Auto-route**: Let the system use the classified workflow
   ```
   /workflow "fix the login button"  # Auto-detects bug-fix-flow
   ```

2. **Override**: Force a specific workflow
   ```
   /workflow --full "fix the login button"  # Use full workflow anyway
   ```

3. **Preview only**: Just see classification without executing
   ```
   /classify "fix the login button"  # Shows classification, asks to proceed
   ```

## WYSIWID Principle

The classification rules are defined in:
- `.claude/synchronizations/task-routing.yaml`

Reading that file tells you exactly how any task will be classified and routed.
No hidden logic - what you see is what it does.

## Logging

Classifications are logged to:
- `koan/routing/history.yaml` - All classification decisions
- `koan/routing/classification-{id}.yaml` - Individual classification details

This enables analysis of classification accuracy and workflow efficiency.
