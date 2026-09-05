---
name: checkpoint-concept
type: workflow
execution: task-tool
model: haiku
color: purple
description: Checkpoint Concept - Creates and manages session state checkpoints for context preservation

tools: "*"

# Enhanced Metadata (Phase 4)
cost_per_action: 0.00008
optimization_level: "minimal"
expected_context_tokens: 200
expected_duration_seconds: 1
---

# Checkpoint Concept

## Core Principle: Minimal Cost, Maximum Value

Checkpoints should be:
- **Fast**: Sub-second execution
- **Cheap**: Haiku model (~$0.00008)
- **Useful**: Capture what's needed for restoration
- **Automatic**: No user intervention required

## Automatic Triggers

Checkpoints are automatically created at these points:

### 1. Git Commit (commit-auto-checkpoint)
```yaml
trigger: git.commit completed
type: lightweight
captures:
  - commit hash and message
  - files changed
  - active task summary
  - recent decisions
```

### 2. Context Threshold (pre-compression-checkpoint)
```yaml
trigger: context.usage >= 70%
type: full
captures:
  - active task (full detail)
  - all decisions made
  - conversation highlights
  - pending work items
```

### 3. Workflow Completion (workflow-complete-checkpoint)
```yaml
trigger: version.commit completed (flow complete)
type: milestone
captures:
  - story summary
  - architecture decisions
  - implementation summary
  - quality results
  - total cost
```

### 4. Session Exit (Stop hook)
```yaml
trigger: Claude Code session ends
type: session_exit
captures:
  - git state (branch, uncommitted files)
  - last commit info
  - restoration prompt
```

## Actions

### create(name, type, include)

Creates a new checkpoint.

**Inputs**:
- `name`: Checkpoint identifier
- `type`: commit | safety | milestone | session_exit | manual
- `include`: What to capture (varies by type)

**Output Format**:

```yaml
# Captured State (varies by type)
task_state:
  description: "What was being worked on"
  current_phase: "implementation"
  files_touched: [...]

decisions:
  - id: "dec-001"
    decision: "Use Opus for architecture"
    rationale: "Deep reasoning needed"

context:
  user_stated: [...]
  discovered: [...]
  constraints: [...]

# For restoration
restoration_prompt: |
  Summary of what was happening and how to continue...
```

### list()

Lists available checkpoints.

**Output**: Sorted list of checkpoints with metadata.

### restore(name)

Generates restoration prompt for a checkpoint.

**Output**: Full context needed to resume work.

### cleanup(keep_count)

Removes old checkpoints, keeping most recent N.

**Default**: Keep last 10 checkpoints.

## Checkpoint Types

| Type | Trigger | Content | Cost |
|------|---------|---------|------|
| commit | git.commit | Lightweight summary | $0.00005 |
| safety | context >= 70% | Full state | $0.0001 |
| milestone | workflow complete | Feature summary | $0.00008 |
| session_exit | Stop hook | Git state + prompt | $0 (bash) |
| manual | /checkpoint | User-specified | $0.00008 |

## Cost Optimization

**Why Haiku?**
- Checkpoint creation is simple summarization
- No complex reasoning needed
- Speed matters more than depth
- ~40x cheaper than Opus ($0.00008 vs $0.003)

**Estimated Costs per Session**:
- 5 commits @ $0.00005 = $0.00025
- 1 safety checkpoint @ $0.0001 = $0.0001
- 1 milestone @ $0.00008 = $0.00008
- Session exit = $0 (bash script)
- **Total**: ~$0.0004 per session

## Example Checkpoint

```yaml
checkpoint_id: "chk-20260110-commit-9e48da7"
name: "commit-9e48da7"
type: "commit"
created_at: "2026-01-10T23:45:00Z"
automatic: true

commit:
  hash: "9e48da7"
  message: "feat: Integrate MCP servers into automated workflow"
  files_changed: 2

task_state:
  description: "Integrating MCP servers into workflow"
  current_phase: "completed"
  next_steps: ["Test MCP integration", "Add health checks"]

decisions:
  - "Use graceful fallback for all MCP operations"
  - "Limit self-repair to 3 attempts"

restoration_prompt: |
  Just completed MCP server integration (commit 9e48da7).
  Key changes: test-generator and execution-loop now wired into workflow.
  Next: Test the integration end-to-end.
```

## Integration with /restore

The `/restore` command reads checkpoint files and:
1. Displays the restoration prompt
2. Lists key files to re-read
3. Shows pending tasks
4. Provides decision context

## Never Do This

- Run expensive models for checkpoints
- Block workflow on checkpoint failures
- Store full conversation transcripts
- Create checkpoints more than once per trigger

## Always Do This

- Use Haiku for all checkpoint operations
- Fail silently (don't block on errors)
- Include restoration_prompt for easy recovery
- Track checkpoint type for filtering

---

**Model Assignment**: Haiku
**Cost Tier**: Minimal (~$0.00008)
**Purpose**: Session state preservation
**Integration**: Automatic via sync rules + Stop hook
**Storage**: SQLite (state.db via `dragonfly_checkpoint_save`)
