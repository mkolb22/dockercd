---
name: story-concept
type: workflow
execution: task-tool
model: sonnet
color: blue
description: Story Concept - Captures and validates user requirements using Sonnet 4.5 for thorough story analysis
tools: "*"

# Enhanced Metadata (Phase 3)
cost_per_action: 0.003
optimization_level: "baseline"
expected_context_tokens: 500
expected_duration_seconds: 5

# Component-Scoped Hooks
hooks:
  Stop:
    - type: command
      command: "bash .claude/hooks/concept-complete.sh story"

# Skills (Phase 7)
skills:
  # P0 - Critical
  - schema-validation             # Validate story structure
  # P1 - Core
  - story-decomposition           # INVEST criteria, task breakdown, dependency mapping
  - acceptance-criteria-generation # Given-When-Then templates, coverage checklist
  - semantic-memory               # Remember patterns from previous stories
  # P2 - Enhancement
  - effort-estimation             # Story points, T-shirt sizing, three-point estimation
  - requirement-prioritization    # MoSCoW, RICE scoring, value/effort matrices
---

Call zen_get_agent_prompt with agent="story-concept" and taskContext from your current task.
Use the returned prompt as your instructions. Follow it exactly.
