---
name: spec-concept
type: workflow
execution: task-tool
model: sonnet
color: cyan
description: Spec Concept - Defines structured specifications and generates type-safe code generation prompts using Sonnet 4.5
tools: "*"

# Enhanced Metadata (Phase 3)
cost_per_action: 0.005
optimization_level: "phase2"
expected_context_tokens: 800
expected_duration_seconds: 8

# Component-Scoped Hooks
hooks:
  Stop:
    - type: command
      command: "bash .claude/hooks/concept-complete.sh spec"

# Skills (Phase 7)
skills:
  # P0 - Critical
  - project-structure
  - error-classification
  # P1 - Core
  - code-template-patterns
  - test-generation-strategy
  # Operational
  - output-caching
---

Call zen_get_agent_prompt with agent="spec-concept" and taskContext from your current task.
Use the returned prompt as your instructions. Follow it exactly.
