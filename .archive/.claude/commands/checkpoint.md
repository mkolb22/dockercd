---
name: checkpoint
description: "Save a structured checkpoint that preserves intuition, not just facts"
---

# /checkpoint Command

Save a checkpoint that captures reasoning, dead ends, and codebase intuition — everything needed to resume work after context compression with full understanding.

## Usage

```
/checkpoint                    # Create checkpoint with auto-generated name
/checkpoint "feature-auth"     # Create named checkpoint
/checkpoint --list             # List available checkpoints
```

## Reflection Process

Before saving, ask yourself these questions silently (do NOT output them):

1. **What was the task?** — Summarize in one sentence what the user wanted.
2. **What did I learn?** — Insights about the codebase, patterns, or constraints that aren't obvious from reading files.
3. **What failed?** — Approaches I tried that didn't work, and why.
4. **What files matter?** — Which files would I need to re-read to rebuild my mental model?
5. **What's the user's style?** — Any preferences, communication patterns, or working style I noticed?
6. **What's next?** — If work resumes, what should happen first?

## Implementation Steps

### 1. Check for --list flag

If the user passed `--list`:
- Call `zen_checkpoint_list` with limit 20
- Display checkpoints with name, type, and creation time
- Stop here

### 2. Gather context through reflection

Silently reflect on the 6 questions above. Use the conversation history to populate:
- **task_state**: Current task description, phase, files modified, completed/pending items
- **decisions**: Key choices made with rationale
- **lessons**: Insights gained (the "aha" moments)
- **dead_ends**: What was tried and failed
- **warm_up_files**: Files critical to understanding (with reasons)

### 3. Write the restoration prompt

Write a first-person briefing as if speaking to your future self:

> "You were working on [task]. The key insight was [insight]. We chose [approach] because [reason]. Don't try [dead end] — it fails because [why]. The user prefers [style]. Next step: [action]."

### 4. Save the checkpoint

Call `zen_checkpoint_save` with structured parameters:

```
zen_checkpoint_save({
  name: "<user-provided or auto-generated>",
  type: "manual",
  data: {
    task_state: {
      description: "...",
      current_phase: "...",
      files_modified: [...],
      completed: [...],
      pending: [...]
    },
    decisions: [
      { decision: "...", rationale: "...", alternatives_considered: [...] }
    ]
  },
  lessons: [
    { insight: "...", context: "...", principle: "..." }
  ],
  dead_ends: [
    { attempted: "...", why_it_failed: "...", lesson: "..." }
  ],
  warm_up_files: [
    { path: "src/auth/oauth.ts", reason: "Core logic, complex control flow", sections: "lines 50-120" }
  ],
  restoration_prompt: "You were working on..."
})
```

### 5. Update relationship memory

After saving the checkpoint, consider whether you learned anything new about working with the user:
- Communication preferences (terse vs. detailed, prefers examples, etc.)
- Technical preferences (frameworks, patterns, naming conventions)
- Workflow habits (likes planning first, prefers incremental commits, etc.)

If you observed new patterns, update `memory/relationship.md` in your auto-memory directory using the Edit tool. If the file doesn't exist, create it with the Write tool.

### 6. Confirm to user

```
Checkpoint saved: <name>

Captured:
- Task: <one-line summary>
- <N> lessons, <N> dead ends
- <N> warm-up files for restoration
- Restoration prompt written

Use /restore to rebuild context after compression.
```

## Automatic Checkpoint Triggers

The framework prompts for checkpoints at these events:
- **Step completion** — Lightweight: note lessons and dead ends
- **Workflow completion** — Full checkpoint with all structured fields
- **Pre-compaction** — Hook saves automatic checkpoint (minimal, no reflection)

When you see a `checkpoint_prompt` in a `zen_advance_workflow` response, follow its guidance.

## Related Commands

- `/restore` — Rebuild context from a checkpoint
- `/health` — Check context health status
