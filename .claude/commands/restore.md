---
name: restore
description: "Restore context from a checkpoint with progressive warm-up"
---

# /restore Command

Rebuild Claude's context from a checkpoint after context compression or a new session. Restores not just facts, but intuition — reasoning chains, dead ends, and codebase feel.

## Usage

```
/restore                    # Restore most recent checkpoint
/restore <name-or-id>      # Restore specific checkpoint
/restore --list             # List available checkpoints
```

## Implementation Steps

### 1. Handle --list flag

If the user passed `--list`:
- Call `zen_checkpoint_list` with limit 20
- Display checkpoints with name, type, and creation time
- Stop here

### 2. Load the checkpoint

Call `zen_checkpoint_restore` with either:
- `latest: true` (default, no argument)
- `checkpoint_id: "<id>"` (specific checkpoint)

This returns structured layers and instructions.

### 3. Follow the progressive restoration

Process the response in this order:

**Layer 1: Grounding** — Read `layers.grounding` to understand what task was in progress, what phase it was in, and what files were involved.

**Layer 2: Decisions** — Read `layers.decisions`. These are settled choices — do NOT re-derive or second-guess them unless the user asks.

**Layer 3: Lessons** — Read `layers.lessons`. These are hard-won insights. Internalize them.

**Layer 4: Dead ends** — Read `layers.dead_ends`. These are approaches that were tried and failed. Do NOT retry them.

**Layer 5: Restoration prompt** — Read `restoration_prompt`. This is a first-person briefing from your past self. Trust it.

### 4. Read warm-up files

Read each file in `layers.warm_up_files` using the Read tool:
- Use line ranges from `sections` if specified
- Do NOT ask permission — read silently
- These files rebuild your intuition about the codebase

### 5. Check relationship memory

Read `memory/relationship.md` from your auto-memory directory if it exists. This contains patterns about working with this user — communication style, preferences, habits.

### 6. Provide synthesis

After reading everything, provide a brief synthesis to the user:

```
Context restored from: <checkpoint-name> (<time ago>)

Task: <one-line summary>
Phase: <current phase>
Key insight: <most important lesson>
Next step: <what to do next>

<N> files re-read for context. Ready to continue.
```

Keep the synthesis concise — 4-6 lines. The goal is to confirm understanding, not repeat everything.

## Backward Compatibility

Old checkpoints without structured fields (lessons, dead_ends, warm_up_files) will still work:
- Missing fields default to empty arrays
- The grounding layer falls back to the full `data` object
- Restoration still works, just with less structured context

## Related Commands

- `/checkpoint` — Save a new checkpoint
- `/health` — Check context health status
