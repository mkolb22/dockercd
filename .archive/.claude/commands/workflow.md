Execute a complete feature workflow automatically from story to deployment.

This command runs the full WYSIWID workflow by evaluating synchronization rules
after each concept completes and automatically invoking the next concept.

## Usage

```
/workflow "Add OAuth authentication"
/workflow deep "Feature requiring careful analysis"
```

## Reasoning Modes

### Standard Mode (default)
- Architecture: Opus (deep reasoning)
- All other concepts: Sonnet

### Deep Mode (`deep` prefix)
When the description starts with "deep":
- **Architecture**: Opus with tree-of-thought exploration
- **Verification**: Multi-pass with Opus for consensus
- **Story**: Enhanced requirements analysis
- **Implementation**: More thorough code review before generation

**Detection:**
```python
if description.lower().startswith("deep"):
    mode = "deep"
    description = description.split(" ", 1)[1]  # Remove prefix
elif description.lower().startswith("quick"):
    mode = "quick"
    description = description.split(" ", 1)[1]
else:
    mode = "standard"
```

**Deep Mode Differences:**
| Concept | Standard | Deep |
|---------|----------|------|
| Story | Sonnet | Sonnet + deeper analysis |
| Architecture | Opus (5 steps) | Opus + tree-of-thought (10 steps) |
| Verification | Sonnet (if triggered) | Opus + 3-pass consensus |
| Implementation | Sonnet | Sonnet + pre-review |
| Quality | Sonnet | Sonnet + extended coverage |

## Process

When you run this command, you should:

1. **Recall Relevant Memories** (automatic, fast)
   - Extract keywords from the feature description
   - Search `koan/memory/semantic/*.yaml` for relevant memories:
     - Architecture patterns that match keywords
     - Conventions related to the feature area
     - Past patterns from similar features
   - Display relevant memories (if any):
     ```
     📚 Relevant memories found:
     - [architecture] "Authentication uses JWT with RS256" (high)
     - [patterns] "API endpoints follow /api/v1/{resource} convention"
     ```
   - Pass memories as context to subsequent concepts

2. **Create Story** (Sonnet)
   - Invoke Story concept to capture requirements
   - Include relevant memories as context
   - Wait for story creation
   - Read `koan/stories/story-{id}.yaml`

3. **Evaluate Synchronizations**
   - Read `.claude/synchronizations/feature-development.yaml`
   - Check `story-to-arch` rule:
     - `when`: story.create completed
     - `where`: story.status == 'ready' AND criteria.length > 0
     - `then`: architecture.design

4. **Continue Workflow Automatically**
   - After each concept completes, evaluate sync rules
   - Invoke next concept if rules match
   - **Auto-remember architecture decisions** after architecture phase
   - Track flow with flow_id
   - Log provenance for each step

5. **Complete Workflow Phases**:
   - Story (Sonnet) → Architecture (Opus) → Implementation (Sonnet) → Quality (Sonnet 2x parallel) → Version (Sonnet)
   - **Auto-remember workflow summary** after version.commit

6. **Invoke Subagents Using Task Tool**:
   Each concept MUST be invoked via the Task tool with appropriate subagent_type:
   ```
   Task tool invocation:
     subagent_type: "story-concept"
     model: "sonnet"
     prompt: "Create story for: {description}"

   Task tool invocation:
     subagent_type: "architecture-concept"
     model: "opus"  # Always Opus for architecture
     prompt: "Design architecture for story: {story_id}"

   # ... continue for each concept
   ```

7. **Handle Parallel Execution**:
   - If multiple rules match with `parallel: true`, invoke all in single message
   - Wait for all parallel actions to complete
   - Evaluate next sync rules with all results

## Synchronization Evaluation Logic

For each completed concept action:

```python
# Pseudocode for sync evaluation
def evaluate_syncs(completed_concept, completed_action):
    syncs = read_yaml(".claude/synchronizations/*.yaml")

    for sync in syncs:
        # Check when condition
        if sync.when.concept == completed_concept and \
           sync.when.action == completed_action and \
           sync.when.status == "completed":

            # Read the output state
            state = read_latest_output(completed_concept)

            # Evaluate where query
            if evaluate_query(sync.where.query, state):
                # Execute then action
                invoke_concept(
                    concept=sync.then.concept,
                    action=sync.then.action,
                    model=sync.then.model,
                    inputs=resolve_variables(sync.then.inputs, state)
                )

                return sync.id  # Return which sync triggered

    return None  # No sync matched
```

## Query Evaluation

Parse simple expressions from YAML:

- `story.status == 'ready'` → Read story YAML, check status field
- `architecture.risk != 'high'` → Read architecture YAML, check risk
- `criteria.length > 0` → Count array items in acceptance_criteria

## Example Execution

```
User: /workflow "Add dark mode support"

You: I'll execute the complete feature workflow.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Recalling Relevant Memories
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📚 Found 2 relevant memories:
- [patterns] "Theme switching uses React Context" (high)
- [conventions] "CSS variables for color tokens" (medium)

These will be included as context throughout the workflow.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Phase 1: Story Capture (Sonnet)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[Invoke Task tool → story concept → model: sonnet]

✓ Story created: story-042
  Status: ready
  Acceptance criteria: 4 defined
  Memory context: 2 items applied
  Cost: $0.003

Evaluating synchronizations...
✓ Matched: story-to-arch
  Condition: status=='ready' AND criteria.length>0
  Next: architecture.design (Opus)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Phase 2: Architecture Design (Opus)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[Invoke Task tool → architecture-concept → model: opus]

✓ Architecture created: arch-042
  Approach: Context + CSS-in-JS
  Decisions: 3 documented
  Risks: 2 (both mitigated)
  Risk level: low
  Cost: $0.015

💾 Auto-remembered 2 architecture decisions:
- "Dark mode uses React Context for theme state"
- "CSS-in-JS with CSS variables for color tokens"

Evaluating synchronizations...
✓ Matched: arch-to-impl
  Condition: decisions.length>0 AND risk!='high'
  Next: implementation.generate (Sonnet)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Phase 3: Implementation (Sonnet)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[Invoke Task tool → implementation concept → model: sonnet]

✓ Implementation created: impl-042
  Files changed: 5 (198 lines)
  Tests created: 2
  Status: completed
  Cost: $0.003

Evaluating synchronizations...
✓ Matched: impl-to-quality-review
  Next: quality.review (Sonnet)
✓ Matched: impl-to-quality-test
  Next: quality.test (Sonnet)

Both rules have parallel:true → executing simultaneously...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Phase 4: Quality Assurance (Sonnet) - PARALLEL EXECUTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[Invoke 2x Task tools in single message → both quality actions]

✓ Review completed: review-042
  Status: approved
  Issues: 1 low-severity
  Cost: $0.003

✓ Tests completed: test-042
  Passed: 18/18
  Coverage: 94%
  Cost: $0.003

Evaluating synchronizations...
✓ Matched: quality-to-version
  Condition: review.status=='approved' AND tests.passed
  Next: version.commit (Sonnet)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Phase 5: Version Control (Sonnet)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[Invoke Task tool → version concept → model: sonnet]

✓ Commit created: abc123def
  Branch: feature/story-042-dark-mode
  Files: 5
  Message: "feat(theme): add dark mode support"
  Cost: $0.003

Evaluating synchronizations...
No further syncs matched. Workflow complete!

💾 Auto-remembered workflow summary:
- Feature: "Add dark mode support"
- Approach: "React Context + CSS-in-JS"
- Key files: 5 changed (ThemeContext.tsx, useTheme.ts, etc.)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Workflow Complete ✅
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Flow: flow-2025-11-09-22h00m00s
Total actions: 7
Total cost: ~$0.030
Time: 18 minutes
Memories created: 3

Breakdown:
- Story (Sonnet):          $0.003   (10%)
- Architecture (Opus):     $0.015   (50%)
- Implementation (Sonnet): $0.003   (10%)
- Quality 2x (Sonnet):     $0.006   (20%)
- Version (Sonnet):        $0.003   (10%)

Next steps:
- Review code: See impl-042
- View trace: /trace flow-2025-11-09-22h00m00s
- Push changes: git push origin feature/story-042-dark-mode
```

## Error Handling

If a concept fails or returns blocked status:

```
✗ Architecture blocked: arch-042
  Blocker: Unclear requirements for authentication flow

Evaluating synchronizations...
✓ Matched: arch-blocked-to-story-clarify
  Next: story.clarify

Pausing workflow for clarification...
```

## Manual Intervention

At any point, you can:
- `/trace <flow-id>` - See progress
- `/sync` - Manually evaluate and trigger next step
- Continue the workflow manually if needed

## Parallel Execution

**When multiple sync rules match with `parallel: true`**:

1. **Detection**: Check if multiple rules match same completion
   ```yaml
   impl-to-quality-review: parallel: true
   impl-to-quality-test:   parallel: true
   ```

2. **Execution**: Invoke all concepts in **single message**
   ```
   Send ONE message with multiple Task tool calls:
   - Task(quality.review, model=sonnet)
   - Task(quality.test, model=sonnet)
   ```

3. **Wait**: Collect all results before proceeding

4. **Benefits**:
   - 50% faster (review+test run simultaneously, not sequentially)
   - Same cost (both actions run anyway)
   - Better resource utilization

**Requirements for Safe Parallelization**:
- ✅ Actions read from same completed concept
- ✅ Neither action modifies what the other reads
- ✅ Neither depends on the other's output
- ✅ Both can execute independently

**Example**: Quality review and test are perfect candidates:
- Both read from completed implementation
- Neither modifies implementation state
- Neither needs the other's results
- Both produce independent quality reports

## Performance

Expected duration by feature complexity:
- Simple feature: 5-10 minutes (3-4 min with parallel quality)
- Medium feature: 15-20 minutes (13-16 min with parallel quality)
- Complex feature: 30-45 minutes (26-39 min with parallel quality)

Most time spent in Architecture phase (deep reasoning).

**Parallel Quality Impact**:
- Traditional: Impl (3min) → Review (2min) → Test (2min) = 7min for impl+quality
- With Parallel: Impl (3min) → Review+Test (2min) = 5min for impl+quality
- **Savings**: 2 minutes per feature (29% faster)

## Cost Tracking

Each workflow creates complete provenance:
- See `koan/provenance/flows/flow-{id}.yaml`
- Track cumulative cost
- Analyze model usage
- Use `/costs` for aggregated analysis

## WYSIWID in Action

The synchronization rules ARE the workflow logic.
Read `.claude/synchronizations/*.yaml` to see exactly what will happen.
What you see (the rules) is what it does (the execution).
