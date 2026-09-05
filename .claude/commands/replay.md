Replay a failed workflow from provenance to debug issues and understand what went wrong.

This command loads the provenance trail for a failed workflow and allows you to:
- See exactly what happened at each step
- Replay specific concept invocations
- Modify inputs and retry
- Identify where failures occurred
- Compare expected vs actual outputs

## Usage

```
/replay <flow-id>              # Show full workflow replay
/replay <flow-id> --action <id> # Replay specific action
/replay <flow-id> --from <id>   # Replay from specific action onwards
/replay <flow-id> --fix         # Interactive fix mode
```

## Process

When you run this command, you should:

1. **Load Provenance**
   - Read `data/provenance/flows/flow-{id}.yaml`
   - Parse all actions in chronological order
   - Identify failed/blocked actions

2. **Display Workflow Timeline**
   ```
   Flow: flow-2025-11-10-19h00m00s
   Status: FAILED at action act-003
   Duration: 12 minutes
   Cost: $0.0165
   
   Timeline:
   ✓ act-001: story.create (Opus) - 2min - $0.000175
   ✓ act-002: architecture.design (Opus) - 8min - $0.015
   ✗ act-003: implementation.generate (Opus) - FAILED
     Error: Missing required field 'technical_spec' in architecture output
     
   Not executed (due to failure):
   ⊘ act-004: quality.review (Opus)
   ⊘ act-005: quality.test (Opus)
   ⊘ act-006: version.commit (Opus)
   ```

3. **Show Failure Details**
   ```
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Action: act-003 (implementation.generate)
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   
   Concept: implementation
   Action: generate
   Model: sonnet
   Status: FAILED
   
   Inputs:
     architecture_id: arch-042
     story_id: story-042
     technical_spec: ${architecture.technical_spec}  ← UNRESOLVED
   
   Error:
     Variable '${architecture.technical_spec}' could not be resolved
     Field 'technical_spec' not found in arch-042.yaml
   
   Root Cause:
     Architecture output (act-002) is missing required field 'technical_spec'
     This prevented implementation from receiving necessary specifications
   
   Suggested Fix:
     1. Review architecture output: arch-042.yaml
     2. Add missing 'technical_spec' field
     3. Or: Replay act-002 (architecture.design) with corrected output
   ```

4. **Offer Replay Options**
   ```
   What would you like to do?
   
   1. Replay failed action (act-003) with fixed inputs
   2. Replay from previous action (act-002) to regenerate architecture
   3. Skip failed action and continue workflow
   4. Examine action details in depth
   5. Exit replay mode
   
   Choose option (1-5):
   ```

## Example: Replay Failed Workflow

```
User: /replay flow-2025-11-10-19h00m00s

You: Loading workflow provenance...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Workflow Replay: flow-2025-11-10-19h00m00s
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Status: FAILED
Started: 2025-11-10 19:00:00
Failed: 2025-11-10 19:12:34
Duration: 12m 34s
Cost: $0.0165

Timeline:
┌─────────────────────────────────────────────────┐
│ ✓ act-001: story.create                  2m 15s │
│   Model: sonnet                           $0.0002 │
│   Output: story-042.yaml                        │
│                                                  │
│ ✓ act-002: architecture.design           8m 20s │
│   Model: sonnet                          $0.015  │
│   Output: arch-042.yaml                         │
│   ⚠️  Warning: Schema validation skipped         │
│                                                  │
│ ✗ act-003: implementation.generate      FAILED  │
│   Model: sonnet                                   │
│   Error: Variable resolution failed             │
│   → architecture.technical_spec not found       │
│                                                  │
│ ⊘ act-004: quality.review           NOT EXECUTED│
│ ⊘ act-005: quality.test             NOT EXECUTED│
│ ⊘ act-006: version.commit           NOT EXECUTED│
└─────────────────────────────────────────────────┘

Root Cause Analysis:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

The architecture concept (act-002) completed successfully but
produced invalid output missing the 'technical_spec' field.

This cascaded to implementation (act-003) which failed because
it couldn't resolve the required ${architecture.technical_spec}
variable.

Key Issue: Schema validation was not run after act-002.
If validation had been enabled, the missing field would have
been caught immediately, saving 2 minutes of wasted execution.

Suggested Actions:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Option 1: Fix architecture output manually
  1. Edit arch-042.yaml
  2. Add missing technical_spec field
  3. Run: /replay flow-2025-11-10-19h00m00s --from act-003

Option 2: Replay architecture with better prompt
  1. Replay act-002 with explicit technical_spec requirement
  2. Enable schema validation
  3. Continue workflow from there

Option 3: Examine architecture output in detail
  1. Run: /replay flow-2025-11-10-19h00m00s --action act-002
  2. Review what was generated
  3. Identify why technical_spec was omitted

Which option would you like? (1-3 or 'exit')
```

## Example: Replay Specific Action

```
User: /replay flow-2025-11-10-19h00m00s --action act-002

You: Replaying action act-002...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Action Replay: act-002
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Concept: architecture
Action: design
Model: sonnet
Status: completed (but with issues)

Inputs:
  story_id: story-042
  requirements: "Add OAuth authentication with Google and GitHub"
  acceptance_criteria: [5 items]

Context Loaded:
  Input tokens: 25,432
  Output tokens: 3,847
  Cost: $0.015

Generated Output:
  architecture_id: arch-042
  selected_approach: "Passport.js with OAuth2 strategies"
  decisions: [3 documented]
  components: [4 defined]
  risks: [2 identified]

Issues Found:
  ✗ Missing required field: technical_spec
  ✗ Schema validation was not run
  ⚠️  Implementation guidance is vague

Output File: arch-042.yaml
Schema: architecture.schema.json

Would you like to:
1. View full architecture output
2. Regenerate with corrected prompt
3. Manually fix arch-042.yaml
4. Run schema validation now
5. Compare against similar successful architectures

Choose (1-5):
```

## Example: Interactive Fix Mode

```
User: /replay flow-2025-11-10-19h00m00s --fix

You: Entering interactive fix mode...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Interactive Fix: flow-2025-11-10-19h00m00s
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

I'll guide you through fixing this workflow step by step.

Step 1: Understanding the Failure
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

The workflow failed at implementation.generate (act-003) because
the architecture output was missing the 'technical_spec' field.

This is a common issue when:
- Architecture prompt didn't explicitly request technical_spec
- Opus summarized instead of providing detailed specs
- Schema validation was disabled

Step 2: Fixing Architecture Output
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

I can regenerate the architecture with an improved prompt that
explicitly requires technical_spec, OR we can manually add it.

Recommended: Regenerate (ensures consistency and quality)

Regenerate architecture? (yes/no): yes

Regenerating act-002 with improved prompt...

[Invoke architecture concept with enhanced prompt]

✓ Architecture regenerated: arch-042.yaml
✓ Schema validation passed
✓ Technical spec included (127 lines)

Step 3: Resume Workflow
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Architecture is now fixed. Resume workflow from implementation?

Resume from act-003? (yes/no): yes

Resuming workflow...

✓ act-003: implementation.generate - COMPLETED
  Files changed: 5
  Tests created: 2
  
✓ act-004: quality.review - COMPLETED
  Status: approved
  Issues: 0

✓ act-005: quality.test - COMPLETED
  Passed: 18/18
  Coverage: 94%

✓ act-006: version.commit - COMPLETED
  Commit: abc123def

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Workflow Fixed and Completed! ✅
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Original failure: 12m 34s, $0.0165, FAILED
After fix: 18m 45s total, $0.0171 total, SUCCESS

Time saved vs full restart: 8 minutes (started from act-003)
Additional cost: $0.0006 (only regenerated architecture)

Flow updated: flow-2025-11-10-19h00m00s-fixed
Original preserved: flow-2025-11-10-19h00m00s
```

## Provenance Format

The replay command reads from:

```yaml
# data/provenance/flows/flow-2025-11-10-19h00m00s.yaml

flow_id: "flow-2025-11-10-19h00m00s"
started_at: "2025-11-10T19:00:00Z"
status: "failed"
failed_at: "2025-11-10T19:12:34Z"
failure_action: "act-003"

actions:
  - action_id: "act-001"
    concept: "story"
    action: "create"
    model: "opus"
    status: "completed"
    started_at: "2025-11-10T19:00:00Z"
    completed_at: "2025-11-10T19:02:15Z"
    cost:
      input_tokens: 1200
      output_tokens: 450
      cost_usd: 0.000175
    inputs:
      title: "Add OAuth authentication"
      description: "..."
    outputs:
      story_id: "story-042"
      status: "ready"
      file: "data/stories/story-042.yaml"

  - action_id: "act-002"
    concept: "architecture"
    action: "design"
    model: "opus"
    status: "completed"
    triggered_by: "act-001"
    sync_id: "story-to-arch"
    started_at: "2025-11-10T19:02:20Z"
    completed_at: "2025-11-10T19:10:40Z"
    cost:
      input_tokens: 25432
      output_tokens: 3847
      cost_usd: 0.015
    inputs:
      story_id: "story-042"
      requirements: "..."
    outputs:
      architecture_id: "arch-042"
      file: "data/architecture/arch-042.yaml"
    warnings:
      - "Schema validation not run"
      - "technical_spec field missing"

  - action_id: "act-003"
    concept: "implementation"
    action: "generate"
    model: "opus"
    status: "failed"
    triggered_by: "act-002"
    sync_id: "arch-to-impl"
    started_at: "2025-11-10T19:10:45Z"
    failed_at: "2025-11-10T19:12:34Z"
    error:
      type: "VariableResolutionError"
      message: "Cannot resolve ${architecture.technical_spec}"
      details: "Field 'technical_spec' not found in arch-042.yaml"
      resolution: "Add missing field to architecture output or regenerate"
    inputs:
      architecture_id: "arch-042"
      technical_spec: "${architecture.technical_spec}"  # FAILED HERE

total_cost: 0.0165
total_duration_seconds: 754
```

## Debugging Benefits

### 5x Faster Debugging

**Without /replay** (traditional debugging):
1. Read logs manually (5 min)
2. Trace through workflow (10 min)
3. Find failing point (5 min)
4. Identify root cause (10 min)
5. Fix and restart entire workflow (15 min)
**Total: 45 minutes**

**With /replay**:
1. Run /replay command (30 sec)
2. See failure point immediately (1 min)
3. Root cause analysis provided (2 min)
4. Guided fix options (2 min)
5. Resume from failure point (10 min)
**Total: 15 minutes + 30 seconds = ~9 minutes**

**Savings: ~36 minutes (80% faster) = 5x speedup**

### Cost Savings

**Full restart**: Pay for all actions again ($0.016)
**Replay from failure**: Pay only for failed + remaining actions ($0.006)
**Savings**: $0.01 per failed workflow

## Integration with Other Commands

```bash
# Start workflow
/workflow "Add OAuth"

# If it fails...
/trace flow-2025-11-10-19h00m00s    # See what happened
/replay flow-2025-11-10-19h00m00s   # Debug and fix

# After fixing
/sync --execute                      # Continue workflow

# Check costs
/costs --flow flow-2025-11-10-19h00m00s
```

## Use Cases

### 1. Debug Variable Resolution Failures
When ${variables} can't be resolved, replay shows exactly which field is missing from which output.

### 2. Investigate Blocked Concepts
When a concept returns "blocked" status, replay shows the blocker details and suggests resolutions.

### 3. Analyze Schema Validation Failures
When validation fails, replay shows all validation errors and where in the output they occurred.

### 4. Compare Successful vs Failed Workflows
Load two flows side-by-side to see what differed.

### 5. Resume Partial Workflows
Pick up exactly where a workflow stopped without restarting from scratch.

## Architecture Note

The replay command leverages complete provenance tracking to provide:
- Full execution history
- Input/output snapshots
- Cost tracking
- Timing information
- Error details
- Resolution suggestions

This embodies WYSIWID: The provenance file IS the execution record.
Read it to understand exactly what happened.

---

**Use this command when**: Workflows fail, debugging issues, understanding execution flow, learning from errors, or resuming interrupted work.
