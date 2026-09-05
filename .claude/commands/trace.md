Trace provenance chain for an action, story, or flow.

When the user runs this command, you should:

1. Read the provenance files from data/provenance/
2. Build the complete chain of actions
3. Show the workflow visually with costs and timing

Usage:
- `/trace story-001` - Trace all actions for a story
- `/trace flow-abc123` - Trace all actions in a flow
- `/trace act-042` - Trace from a specific action

Process:
1. Identify what the user wants to trace (story ID, flow ID, or action ID)
2. Read relevant provenance files from data/provenance/
3. Build the dependency chain (triggered_by relationships)
4. Present in chronological order with:
   - Action ID and timestamp
   - Concept and model used
   - Status and cost
   - Triggered by relationship
   - Synchronization rule used

Example output:
```
Tracing flow: flow-2025-11-09-20h00m00s
Story: story-001 "Add dark mode support"
Total cost: $0.0165
Duration: 15m 30s

Timeline:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[20:00:00] act-001 | story.create | sonnet | $0.000175
  Status: completed
  Output: story-001 (status: ready)
  Triggered by: user
  ↓

[20:05:00] act-002 | architecture.design | sonnet | $0.015000 ⭐
  Status: completed
  Output: arch-001 (approach: Context + CSS-in-JS)
  Triggered by: act-001 via story-to-arch
  ↓

[20:10:00] act-003 | implementation.generate | sonnet | $0.000175
  Status: completed
  Output: impl-001 (5 files, 198 lines)
  Triggered by: act-002 via arch-to-impl
  ↓

[20:15:00] act-004 | quality.review | sonnet | $0.000175
  Status: completed (approved)
  Output: review-001 (1 low-severity issue)
  Triggered by: act-003 via impl-to-quality-review
  │
[20:16:00] act-005 | quality.test | sonnet | $0.000175
  Status: completed (18/18 passed)
  Output: test-001 (94% coverage)
  Triggered by: act-003 via impl-to-quality-test
  ↓

[20:20:00] act-006 | version.commit | sonnet | $0.000175
  Status: completed
  Output: commit abc123def
  Triggered by: act-004 via quality-to-version

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Summary:
- Total actions: 6
- Model usage: 1 sonnet, 5 sonnet
- Total cost: $0.0165
- Opus cost: $0.015 (91% of total)
- Cost efficiency: 83% savings vs all-opus

Synchronizations triggered:
- story-to-arch
- arch-to-impl
- impl-to-quality-review (parallel)
- impl-to-quality-test (parallel)
- quality-to-version
```

This command demonstrates the power of provenance tracking - you can see exactly how the system arrived at the current state and understand the cost/benefit of each decision.
