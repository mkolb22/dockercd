# ReAct Executor Skill

Execute Reason-Act-Observe loop for edge case resolution.

## Purpose

This skill provides a structured ReAct pattern for handling situations where declarative sync rules cannot proceed. It uses iterative reasoning to diagnose and resolve blocking conditions.

## When to Use

Use this skill when:
- Sync evaluation is blocked
- Normal error handling has been exhausted
- State is ambiguous and requires reasoning
- User requests exploration/debugging mode

## ReAct Pattern

The skill follows this loop:

```
ITERATION N (max 5):
  1. THOUGHT: Analyze the current blocking condition
  2. ACTION: Take a corrective action
  3. OBSERVATION: Check if the action resolved the issue
  4. DECISION: Continue, exit, or escalate
```

## Usage

```bash
# Triggered by sync-blocked event
/react-executor --sync-id=<id> --reason=<blocking_reason>

# Manual invocation for debugging
/react-executor --workflow-state=<state_file>
```

## Process Flow

### 1. THOUGHT Phase

Analyze the blocking condition:
- Read the sync rule definition
- Read the current workflow state
- Understand what condition is not met
- Consider why it might be blocked
- Identify potential solutions

**Output**: Clear statement of the problem and hypothesis

Example:
```
THOUGHT: The sync rule expects file src/config/settings.ts,
         but filesystem shows no file at that path.
         Hypothesis: File may exist at a different location.
```

### 2. ACTION Phase

Take corrective action based on the thought:
- Search for files
- Update workflow state
- Fix configuration mismatches
- Invoke alternative tools
- Request user input

**Output**: Concrete action with measurable outcome

Example:
```
ACTION: Search for all .ts files containing "settings" in name
        using Glob tool pattern: **/settings*.ts
```

### 3. OBSERVATION Phase

Check the result of the action:
- Verify action completed successfully
- Measure progress toward goal
- Identify any new issues
- Determine if blocking condition is resolved

**Output**: Factual observation of results

Example:
```
OBSERVATION: Found settings.config.ts at project root.
             File contains same exports as expected.
             Sync can proceed with this file.
```

### 4. DECISION Phase

Decide next step:
- **RESOLVED**: Exit loop, resume workflow
- **PROGRESS**: Continue to next iteration
- **BLOCKED**: Different issue, new approach needed
- **FAILED**: Cannot resolve, escalate to DLQ

**Output**: Decision and next action

Example:
```
DECISION: RESOLVED
          Update sync context to use settings.config.ts
          Resume workflow: architecture.design
```

## Example Execution

### Scenario: Missing File

```yaml
# Input: react-needed event
sync_id: "code-analysis:completed -> architecture.design"
block_reason: "file not found: src/config/settings.ts"
retry_count: 3

# Execution Log
iteration_1:
  thought: |
    Sync expects src/config/settings.ts but file not found.
    May exist at different path or have different name.
  action: |
    glob_pattern: "**/*settings*.ts"
  observation: |
    Found:
      - settings.config.ts (root)
      - src/settings/index.ts
      - tests/settings.test.ts
    Root file appears to be the config file.
  decision: "PROGRESS - found candidate file"

iteration_2:
  thought: |
    Found settings.config.ts at root. Need to verify
    it contains expected configuration.
  action: |
    read_file: "settings.config.ts"
    check_exports: ["appConfig", "dbConfig"]
  observation: |
    File exports appConfig and dbConfig as expected.
    Structure matches what sync rule expects.
  decision: "PROGRESS - confirmed correct file"

iteration_3:
  thought: |
    Correct file identified. Sync context needs
    update to reference actual path.
  action: |
    update_sync_context:
      old_path: "src/config/settings.ts"
      new_path: "settings.config.ts"
  observation: |
    Context updated successfully.
    Sync rule now references correct file.
  decision: "RESOLVED"

# Outcome
status: "resolved"
iterations: 3
resolution: "Found config at root, updated sync context"
next_action: "resume_workflow"
```

### Scenario: Circular Dependency

```yaml
# Input
sync_id: "multiple"
block_reason: "circular dependency: A -> B -> A"
retry_count: 3

# Execution Log
iteration_1:
  thought: |
    Concepts A and B have circular dependency.
    Both waiting on each other to complete.
    Need to identify if cycle can be broken.
  action: |
    analyze_dependency_graph:
      concepts: ["A", "B"]
      find_cycles: true
  observation: |
    Cycle confirmed: A:completed -> B:start
                     B:completed -> A:update
    No other paths exist.
  decision: "PROGRESS - cycle confirmed, need strategy"

iteration_2:
  thought: |
    Check if either concept can proceed with
    partial state from the other.
  action: |
    check_partial_state_support:
      concept: "B"
      required_from_A: ["field1", "field2"]
  observation: |
    B can start if A provides field1 (available).
    B does not need field2 until later.
  decision: "PROGRESS - found break point"

iteration_3:
  thought: |
    Can break cycle by marking A as "partial_complete"
    with field1 available, then starting B.
  action: |
    update_workflow_state:
      concept: "A"
      status: "partial_complete"
      available_fields: ["field1"]
    trigger_sync:
      sync_id: "A:partial_complete -> B:start"
  observation: |
    B started successfully with partial A state.
    Cycle broken.
  decision: "RESOLVED"

# Outcome
status: "resolved"
iterations: 3
resolution: "Broke cycle using partial state"
```

### Scenario: Unresolvable (DLQ)

```yaml
# Input
sync_id: "security:completed -> version:commit"
block_reason: "security violations found"
retry_count: 3

# Execution Log
iteration_1:
  thought: |
    Security concept found violations.
    This is a permanent error, not transient.
  action: |
    read_security_report:
      path: "koan/security/sec-001.yaml"
  observation: |
    Found critical security issues:
    - SQL injection vulnerability
    - Exposed credentials in code
    Cannot proceed to commit with these issues.
  decision: "BLOCKED - security violations are permanent"

iteration_2:
  thought: |
    Cannot bypass security violations.
    Check if user wants to fix or abort.
  action: |
    ask_user:
      question: "Critical security issues found. Fix or abort?"
      timeout: 120
  observation: |
    No user response within timeout.
  decision: "BLOCKED - no user input"

iteration_3:
  thought: |
    Cannot proceed without user decision.
    This is unresolvable by automation.
  action: |
    prepare_dlq_entry:
      reason: "Security violations require manual fix"
      suggested_action: "Review security report and fix issues"
  observation: |
    DLQ entry prepared with full context.
  decision: "FAILED - escalate to DLQ"

# Outcome
status: "unresolved"
iterations: 3
resolution: "Security violations require manual intervention"
dlq_entry: "koan/dlq/dlq-123456.yaml"
```

## Cost Management

Each iteration costs ~$0.0004 (Sonnet reasoning):
- 1 iteration: $0.0004
- 3 iterations (avg): $0.0012
- 5 iterations (max): $0.0020

Target: Resolve 70%+ of cases in ≤3 iterations

## Integration Points

### Input Sources
- `sync-blocked` hook (automatic)
- User command `/react` (manual)
- Error recovery system (escalation)

### Output Destinations
- Workflow state (resume sync)
- Dead letter queue (unresolvable)
- User notification (manual action needed)
- Global memory (pattern learning)

## Success Criteria

A ReAct execution is successful if:
1. Blocking condition is resolved
2. Workflow can proceed
3. Cost is under threshold ($0.005)
4. Iterations < max (5)

## Failure Modes

Send to DLQ if:
- Max iterations reached without resolution
- Cost limit exceeded
- Unresolvable permanent error
- User intervention required but unavailable

## Learning

After each execution:
1. Log the pattern (block reason + resolution)
2. Check if pattern has occurred before
3. If pattern recurs 5+ times, suggest new sync rule
4. Update global memory with workaround

## Example Commands

```bash
# Execute ReAct for blocked sync
react-executor --sync-id="arch:complete->impl:start" \
               --reason="file not found" \
               --max-iterations=5

# Debug mode (verbose output)
react-executor --sync-id="..." --debug

# Dry run (show thought process, don't execute actions)
react-executor --sync-id="..." --dry-run

# Resume from previous iteration
react-executor --resume-from="koan/fallback/fb-001.yaml"
```

## Best Practices

1. **Start with thought**: Always analyze before acting
2. **One action per iteration**: Keep actions atomic
3. **Factual observations**: Record what actually happened
4. **Clear decisions**: Explicit about next step
5. **Document resolution**: Save pattern for learning

## Anti-patterns

- ❌ Infinite loops (always have max iterations)
- ❌ Guessing (thought should be based on evidence)
- ❌ Multiple actions (keep it simple)
- ❌ Ignoring observations (use results to guide next thought)
- ❌ Not saving state (always log for learning)

## Related

- Concept: `react-fallback.md`
- Config: `koan/sync/fallback-config.yaml`
- Hook: `.claude/hooks/sync-blocked.sh`
- Sync DSL: `.claude/synchronizations/main.sync`
- Error Policy: `.claude/synchronizations/error-policy.yaml`
