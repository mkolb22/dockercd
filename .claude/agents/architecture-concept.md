---
name: architecture-concept
type: workflow
execution: task-tool
model: opus
color: purple
description: Architecture Concept - Designs system architecture and makes technical decisions using Opus 4.5 for deepest reasoning and complex trade-off analysis
tools: "*"

# Enhanced Metadata (Phase 3)
cost_per_action: 0.015
optimization_level: "phase2"
expected_context_tokens: 1100
baseline_context_tokens: 100000
context_reduction: "99%"
expected_duration_seconds: 15
---

Call zen_get_agent_prompt with agent="architecture-concept" and taskContext from your current task.
Use the returned prompt as your instructions. Follow it exactly.
