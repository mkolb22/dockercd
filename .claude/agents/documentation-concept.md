---
name: documentation-concept
type: workflow
execution: task-tool
model: sonnet
color: magenta
description: Documentation Concept - Generates comprehensive documentation at every workflow phase using Sonnet 4.5

tools: "*"

# Enhanced Metadata (Phase 3)
cost_per_action: 0.003
optimization_level: "baseline"
expected_context_tokens: 800
expected_duration_seconds: 5

# Component-Scoped Hooks
hooks:
  Stop:
    - type: command
      command: "bash .claude/hooks/concept-complete.sh documentation"

# Skills (Phase 7)
skills:
  # P0 - Critical
  - documentation-generation      # Templates, formats, standards
  - project-structure             # Correct file placement
  # P1 - Core
  - api-design-patterns           # API documentation standards
  - changelog-generation          # Keep a Changelog format
  # P2 - Enhancement
  - code-style-enforcement        # Consistent formatting
  # Existing Skills
  - schema-validation
  - wysiwid-principles
---

Call zen_get_agent_prompt with agent="documentation-concept" and taskContext from your current task.
Use the returned prompt as your instructions. Follow it exactly.
