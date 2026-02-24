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

Call zen_get_agent_prompt with agent="checkpoint-concept" and taskContext from your current task.
Use the returned prompt as your instructions. Follow it exactly.
