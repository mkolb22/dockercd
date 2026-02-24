---
name: code-analysis-concept
type: workflow
execution: task-tool
model: sonnet
color: teal
description: Code Analysis Concept - Gathers codebase context using MCP tools before architecture design

tools: "*"

# Enhanced Metadata (Phase 3)
cost_per_action: 0.0002
optimization_level: "baseline"
expected_context_tokens: 300
expected_duration_seconds: 3

# Component-Scoped Hooks
hooks:
  Stop:
    - type: command
      command: "bash .claude/hooks/concept-complete.sh code-analysis"

# Skills (Phase 7)
skills:
  # P0 - Critical
  - project-structure             # Understand codebase layout
  # P1 - Core
  - dependency-impact-analysis    # Understand code relationships
  - cross-project-knowledge       # Apply patterns from other projects
  # Existing Skills
  - incremental-loading
  - semantic-memory
---

Call zen_get_agent_prompt with agent="code-analysis-concept" and taskContext from your current task.
Use the returned prompt as your instructions. Follow it exactly.
