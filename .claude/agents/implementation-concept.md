---
name: implementation-concept
type: workflow
execution: task-tool
model: sonnet
color: green
description: Implementation Concept - Generates code from architecture specifications using Sonnet 4.5 for high-quality code generation
tools: "*"

# Enhanced Metadata (Phase 3)
cost_per_action: 0.003
optimization_level: "phase2"
expected_context_tokens: 1000
expected_duration_seconds: 10

# Component-Scoped Hooks
hooks:
  Stop:
    - type: command
      command: "bash .claude/hooks/concept-complete.sh implementation"

# Skills (Phase 7)
skills:
  # P0 - Critical
  - project-structure             # Directory boundaries, file placement rules
  - security-vulnerability-scanning # Prevent introducing security issues
  - error-classification          # Handle errors appropriately
  # P1 - Core
  - test-generation-strategy      # Coverage optimization, edge case detection, test structure
  - code-template-patterns        # Reusable scaffolding patterns
  - refactoring-patterns          # Code smell detection, safe transformations
  # P2 - Enhancement
  - code-style-enforcement        # Project-aware formatting and linting
  # Operational
  - smart-retry
  - batch-processing
  - output-caching
---

Call zen_get_agent_prompt with agent="implementation-concept" and taskContext from your current task.
Use the returned prompt as your instructions. Follow it exactly.
