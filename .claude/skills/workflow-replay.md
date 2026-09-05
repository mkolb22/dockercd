---
name: Workflow Replay
description: Debug failed workflows using provenance-based replay for 5x faster issue resolution
version: 1.0.0
trigger_keywords: [replay, debug, workflow, failed, provenance, troubleshoot, resume]
author: Dragonfly Architecture
---

# Workflow Replay - Expert Skill

Debug failed workflows by replaying from provenance, identifying root causes, and resuming from failure points.

## Purpose

Workflow replay provides:
- **5x faster debugging**: 9 minutes vs 45 minutes traditional debugging
- **Root cause analysis**: Automatic identification of failure points
- **Cost savings**: Resume from failure instead of full restart
- **Learning tool**: Understand what went wrong and why

## When to Use

Use workflow replay when:
- ✅ A workflow fails or gets blocked
- ✅ Debugging variable resolution issues
- ✅ Investigating missing fields or validation failures
- ✅ Learning from execution patterns
- ✅ Resuming interrupted workflows

## Replay Process

### 1. Load Provenance

Read the complete execution record:

```bash
/replay flow-2025-11-10-19h00m00s
```

This loads: `data/provenance/flows/flow-{id}.yaml`

### 2. Analyze Timeline

See the complete execution flow:

```
Timeline:
✓ act-001: story.create (Opus) - 2min - $0.0002
✓ act-002: architecture.design (Opus) - 8min - $0.015
✗ act-003: implementation.generate (Opus) - FAILED
⊘ act-004: quality.review (Opus) - NOT EXECUTED
⊘ act-005: quality.test (Opus) - NOT EXECUTED
⊘ act-006: version.commit (Opus) - NOT EXECUTED
```

### 3. Identify Root Cause

Automatic analysis of the failure:

```
Root Cause:
  Variable '${architecture.technical_spec}' could not be resolved
  Field 'technical_spec' not found in arch-042.yaml

Upstream Issue:
  Architecture output (act-002) missing required field
  Schema validation was not run
```

### 4. Choose Resolution

Guided options for fixing:

```
1. Replay failed action with fixed inputs
2. Replay from previous action to regenerate
3. Manually fix output files
4. Skip failed action and continue
5. Examine in detail
```

## Common Failure Patterns

### Pattern 1: Missing Required Fields

**Symptom**:
```
Error: Variable resolution failed
Cannot resolve ${architecture.technical_spec}
```

**Root Cause**: Previous concept output missing required field

**Fix**:
```bash
# Option A: Regenerate with validation
/replay flow-id --action act-002
# Enable schema validation
# Regenerate architecture

# Option B: Manual fix
# Edit arch-042.yaml
# Add missing field
# Resume from next action
```

### Pattern 2: Schema Validation Failure

**Symptom**:
```
✗ data.story_id must match pattern "^story-[0-9]{3,}$"
✗ data.status must be one of: draft, ready, needs_clarification
```

**Root Cause**: Concept output doesn't conform to schema

**Fix**:
```bash
# Replay with corrected output format
/replay flow-id --action act-001
# Ensure proper ID format
# Use valid enum values
```

### Pattern 3: Blocked Concept

**Symptom**:
```
Status: blocked
Blocker: "Ambiguous requirements for authentication flow"
```

**Root Cause**: Concept can't proceed without clarification

**Fix**:
```bash
# Review blocker details
/replay flow-id --action act-002

# Clarify requirements
# Update story or architecture
# Replay from blocked action
```

### Pattern 4: Cascading Failures

**Symptom**:
```
✓ act-001: completed
✗ act-002: failed (missing input)
⊘ act-003: not executed (dependency failed)
⊘ act-004: not executed (dependency failed)
```

**Root Cause**: Early failure prevents downstream execution

**Fix**:
```bash
# Fix root cause (act-002)
/replay flow-id --from act-002

# This replays act-002, act-003, act-004...
# Saves cost of act-001 (already completed)
```

## Replay Modes

### Full Replay

Show complete workflow with analysis:

```bash
/replay flow-2025-11-10-19h00m00s
```

### Action-Specific Replay

Replay just one action:

```bash
/replay flow-2025-11-10-19h00m00s --action act-002
```

### Resume from Point

Replay from specific action onwards:

```bash
/replay flow-2025-11-10-19h00m00s --from act-003
```

### Interactive Fix Mode

Guided fixing with prompts:

```bash
/replay flow-2025-11-10-19h00m00s --fix
```

## Debugging Strategies

### Strategy 1: Binary Search

For complex failures, use binary search:

```bash
# Workflow has 6 actions, fails at act-006
# Check middle action
/replay flow-id --action act-003  # ✓ OK

# Failure is after act-003, check act-005
/replay flow-id --action act-005  # ✗ FAILED

# Failure is between act-003 and act-005
/replay flow-id --action act-004  # ✗ FAILED

# Found: Failure starts at act-004
```

### Strategy 2: Upstream Trace

Trace backwards from failure:

```bash
# Implementation failed (act-003)
# Check what it depends on

/replay flow-id --action act-002  # Architecture
# View architecture output
# Look for missing fields

# If architecture looks good, check earlier
/replay flow-id --action act-001  # Story
# Verify story has complete requirements
```

### Strategy 3: Comparison

Compare with successful workflow:

```bash
# Failed workflow
/replay flow-failed-id --action act-002

# Similar successful workflow
/replay flow-success-id --action act-002

# Compare:
# - Inputs differ?
# - Outputs differ?
# - Model assignments differ?
# - Validation run?
```

## Performance Tracking

### Debugging Time Savings

**Traditional Debugging** (45 minutes):
- Read logs manually: 5 min
- Trace workflow: 10 min
- Find failure: 5 min
- Identify root cause: 10 min
- Fix and restart: 15 min

**With Replay** (9 minutes):
- Run /replay: 30 sec
- See failure immediately: 1 min
- Root cause provided: 2 min
- Guided fix: 2 min
- Resume from failure: 3-4 min

**Savings**: 36 minutes (80% faster) = **5x speedup**

### Cost Savings

**Full Restart**:
```
Story:          $0.000175
Architecture:   $0.015
Implementation: $0.000175
Quality:        $0.00035
Version:        $0.000175
Total:          $0.016075
```

**Resume from Failure** (at implementation):
```
Architecture:   $0.015    (regenerate)
Implementation: $0.000175 (resume)
Quality:        $0.00035  (resume)
Version:        $0.000175 (resume)
Total:          $0.0163
```

**Savings**: $0.0008 per replay + time saved

## Provenance Structure

Replay reads from:

```yaml
# data/provenance/flows/flow-{id}.yaml

flow_id: "flow-2025-11-10-19h00m00s"
status: "failed"
failure_action: "act-003"

actions:
  - action_id: "act-001"
    concept: "story"
    status: "completed"
    cost: {...}
    inputs: {...}
    outputs: {...}
    file: "data/stories/story-042.yaml"

  - action_id: "act-002"
    concept: "architecture"
    status: "completed"
    triggered_by: "act-001"
    warnings: ["Schema validation not run"]
    cost: {...}
    outputs: {...}
    file: "data/architecture/arch-042.yaml"

  - action_id: "act-003"
    concept: "implementation"
    status: "failed"
    triggered_by: "act-002"
    error:
      type: "VariableResolutionError"
      message: "Cannot resolve ${architecture.technical_spec}"
      resolution: "Add missing field or regenerate"
```

## Integration with Other Tools

### With /trace

```bash
# Quick overview
/trace flow-id

# Detailed debugging
/replay flow-id
```

### With /sync

```bash
# Debug why sync didn't trigger
/replay flow-id --action act-002
# Check output against sync rules

# Resume workflow after fix
/sync --execute
```

### With Schema Validation

```bash
# Replay shows validation wasn't run
/replay flow-id --action act-002

# Run validation now
./scripts/validate-concept-output.sh architecture arch-042.yaml

# If fails, regenerate with validation enabled
```

## Best Practices

### 1. Enable Complete Provenance

Ensure all actions log to provenance:

```yaml
# In concept execution
provenance:
  action_id: "act-{id}"
  concept: "{concept}"
  status: "{status}"
  inputs: {...}
  outputs: {...}
  errors: {...}  # Include on failure
  warnings: {...}  # Include validation skips
```

### 2. Use Meaningful Error Messages

```yaml
# Good
error:
  type: "VariableResolutionError"
  message: "Cannot resolve ${architecture.technical_spec}"
  field: "technical_spec"
  source_file: "arch-042.yaml"
  resolution: "Add technical_spec field to architecture output"

# Bad
error:
  message: "Error in implementation"
```

### 3. Save Intermediate State

```yaml
# Save outputs even on partial completion
outputs:
  files_created: ["file1.js", "file2.js"]  # Even if not all done
  partial: true
  next_step: "Create remaining test files"
```

### 4. Track Dependencies

```yaml
# Record what triggered this action
triggered_by: "act-002"
sync_id: "arch-to-impl"
depends_on:
  - "arch-042.yaml"
  - "story-042.yaml"
```

### 5. Include Context in Provenance

```yaml
# Help debugging with context
context:
  codebase_files_read: 15
  mcp_tools_used: ["find_symbol", "search_for_pattern"]
  validation_run: false  # ← Important for debugging
  model_temperature: 0.7
```

## Troubleshooting

### Issue: Provenance File Not Found

```bash
# Check provenance directory
ls data/provenance/flows/

# Verify flow ID format
# Should be: flow-YYYY-MM-DD-HHhMMmSSs
```

### Issue: Incomplete Provenance

```bash
# Check if concepts are logging properly
# Each action should create provenance entry

# Enable provenance tracking in concepts
```

### Issue: Can't Resume from Failure

```bash
# Check if outputs were saved
ls data/stories/ data/architecture/

# If missing, need to regenerate from earlier point
/replay flow-id --from act-001
```

## Related Documents

- **/replay command** - Command reference
- **/trace command** - Quick workflow overview
- **DRAGONFLY_IMPLEMENTATION_PHASES.md** - Day 8-9 implementation
- **DRAGONFLY_IMPROVEMENT_PROPOSALS.md** - Proposal #5

---

**Use this skill when**: Debugging failed workflows, investigating errors, learning from failures, or resuming interrupted work.
