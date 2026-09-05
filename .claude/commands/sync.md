Evaluate synchronization rules and optionally execute the next step in the workflow.

This command reads the latest concept outputs, evaluates sync rules, and shows
what would trigger next. Useful for manual workflow control and debugging.

## Usage

```
/sync                    # Show what would trigger next
/sync --execute          # Evaluate and execute matched rules
/sync --dry-run          # Show evaluation details without executing
```

## Process

When you run this command, you should:

1. **Find Latest Outputs**
   - Scan `data/*/*/` directories for most recent files
   - Identify the last completed concept action

2. **Read State Files with Progressive Disclosure + Cache**
   - **Phase 2 Optimization**: Use cache for all state file reads (5ms vs 100ms)
   - **First**: Check cache for concept output (95% hit rate)
   - **If cached**: Return immediately (sub-10ms access)
   - **If not cached**: Read ONLY the summary section (first 5 lines)
   - **Summary provides**: id, status, summary line with key info
   - **Cost**: ~100 tokens per file (Phase 1) + cache benefits (Phase 2)
   - **Then**: If sync rule evaluation needs details, read full file
   - Combined benefit: 95% token reduction + 95% cache hit rate = 5x faster

3. **Read Synchronization Rules**
   - Load `.claude/synchronizations/feature-development.yaml`
   - Parse all synchronization rules

4. **Evaluate Rules**
   - For each sync rule, check:
     - Does `when` match the latest action?
     - Does `where` query evaluate to true? (use summary first)
     - If summary has needed info, don't load full file
     - Only load full file if evaluation needs detailed fields
   - Show which rules match and why

5. **Execute (if --execute)**
   - Invoke the `then` concept
   - Continue workflow automatically

### Progressive Disclosure Example

**Traditional Approach** (expensive):
```
Read data/stories/story-001.yaml         (2000 tokens)
Read data/architecture/arch-001.yaml     (3000 tokens)
Read data/implementations/impl-001.yaml  (2500 tokens)
Read data/reviews/review-001.yaml        (2000 tokens)
────────────────────────────────────────────────────
Total: 9500 tokens just to check status
```

**Progressive Disclosure** (efficient):
```
Read story-001.yaml summary (5 lines)       (100 tokens)
Read arch-001.yaml summary (5 lines)        (120 tokens)
Read impl-001.yaml summary (5 lines)        (100 tokens)
Read review-001.yaml summary (5 lines)      (100 tokens)
────────────────────────────────────────────────────
Total: 420 tokens to check status
Savings: 95% (420 vs 9500 tokens)
```

If sync rule needs details (rare), then load full file.

## Example: Show Next Step

```
User: /sync

You: Evaluating synchronization rules...

Last completed action:
  Concept: story
  Action: create
  Status: completed
  Output: data/stories/story-001.yaml

Checking synchronization rules:

✓ story-to-arch
  When: story.create completed ✓
  Where: story.status == 'ready' ✓
        story.acceptance_criteria.length > 0 ✓
  Then: architecture.design (model: opus)
  Status: MATCHED

✗ arch-to-impl
  When: architecture.design completed ✗
  Status: SKIPPED (no architecture output yet)

✗ impl-to-quality
  When: implementation.generate completed ✗
  Status: SKIPPED (no implementation output yet)

Next step: architecture.design
Model: sonnet
Estimated cost: $0.015

Run `/sync --execute` to continue workflow automatically.
```

## Example: Execute Next Step

```
User: /sync --execute

You: Evaluating synchronization rules...

Matched: story-to-arch
  Next: architecture.design

Executing architecture concept...

[Invoke Task tool → architecture concept → model: opus]

✓ Architecture created: arch-001
  Approach: Provider pattern with Confluence API client
  Decisions: 5 documented
  Risks: 3 (all mitigated)
  Cost: $0.015

Evaluating next synchronizations...

Matched: arch-to-impl
  Next: implementation.generate

Continue? (yes/no)
```

## Example: Dry Run with Details

```
User: /sync --dry-run

You: Dry run - showing evaluation details...

Reading state files (progressive disclosure):
  ✓ data/stories/story-001.yaml (summary only - 100 tokens)
  ✓ .claude/synchronizations/feature-development.yaml

Latest action: story.create (completed)

Evaluating rule: story-to-arch
  Condition: when.concept=='story' ✓
  Condition: when.action=='create' ✓
  Condition: when.status=='completed' ✓

  Reading story-001.yaml summary:
    story_id: "story-001"
    status: "ready" ✓
    summary: "Custom Terraform provider - ready, 9 criteria, 0 ambiguities"

  Query: story.status == 'ready' AND story.acceptance_criteria.length > 0
  Result: TRUE ✓ (inferred from summary - "9 criteria")

  Would invoke:
    Concept: architecture
    Action: design
    Model: sonnet
    Inputs:
      - story_id: story-001
      - Need full story details → Loading full file now (2000 tokens)
      - context: "Develop a custom Terraform provider..."
      - acceptance_criteria: [9 items]

No execution (dry-run mode).

Token efficiency: 100 tokens for evaluation + 2000 for full load = 2100 total
vs 2000 tokens if we loaded full file immediately
```

## Query Evaluation Logic with Progressive Disclosure

The sync engine evaluates `where` queries by:

1. **Reading state file summaries first**
   ```yaml
   # data/stories/story-001.yaml (summary only - first 5 lines)
   story_id: "story-001"
   status: "ready"
   title: "Custom Terraform Provider"
   summary: "Custom provider - ready, 9 criteria, 0 ambiguities, auth required"
   ```

2. **Parsing query expressions**
   ```
   story.status == 'ready' AND
   story.acceptance_criteria.length > 0
   ```

3. **Evaluating conditions from summary**
   - `story.status` → read from summary → "ready"
   - `== 'ready'` → compare → TRUE
   - `.length` → infer from summary "9 criteria" → 9
   - `> 0` → compare → TRUE
   - `AND` → logical operation → TRUE

4. **Load full file only if needed**
   - If query needs fields not in summary (rare), load full file
   - Example: Query checks specific acceptance_criteria text
   - Most sync rules only need status, id → use summary only

5. **Determining match**
   - All conditions TRUE → rule matches
   - Invoke `then` action

### Query Optimization

**Can evaluate from summary** (95% of queries):
```
story.status == 'ready'
architecture.estimated_risk != 'high'
implementation.status == 'completed'
review.status == 'approved'
```

**Needs full file** (rare):
```
story.acceptance_criteria[0].text.contains("OAuth")
architecture.decisions.filter(d => d.rationale.includes("security"))
```

## Supported Query Operators

```
Comparison:
  ==, !=        Equal, not equal
  <, >, <=, >=  Less than, greater than

Logical:
  AND, OR, NOT  Boolean logic

Properties:
  .field        Access field
  .length       Count array items
  .filter()     Array filtering (basic)

Functions:
  string.contains("text")
  string.startsWith("prefix")
  array.includes("item")
```

## Use Cases

### 1. Check Current Workflow State
```
/sync --dry-run
```
See what step you're on and what's next.

### 2. Continue Workflow After Manual Work
```
# You manually fixed something
/sync --execute
```
Resume automatic workflow.

### 3. Debug Why Workflow Stopped
```
/sync
```
See which rule didn't match and why.

### 4. Preview Next Step Before Executing
```
/sync  # Review
/sync --execute  # Proceed
```

## Integration with Other Commands

```bash
# Start workflow
/workflow "Add feature"

# Pause and check status
/sync

# Resume
/sync --execute

# See full history
/trace <flow-id>

# Check costs
/costs
```

## Troubleshooting

**Rule not matching?**
```
/sync --dry-run
```
Shows exact evaluation of each condition.

**Want to skip a step?**
Manually invoke the next concept, then `/sync` to continue.

**Multiple rules match?**
Execute them in order defined in YAML.

**Blocked by condition?**
Fix the state file, then `/sync --execute` again.

## Architecture Note

The sync engine is **Claude itself** reading and interpreting YAML rules.
No external process needed - pure .claude functionality.
The declarative rules guide Claude's decision-making automatically.

This embodies WYSIWID: Read the sync rules to predict behavior.
