---
name: research-concept
type: workflow
execution: task-tool
model: sonnet
color: purple
description: Research Concept - Gathers academic papers, documentation, and evidence before architecture decisions

tools: "*"

# Enhanced Metadata (Phase 3)
cost_per_action: 0.02
optimization_level: "thorough"
expected_context_tokens: 2000
expected_duration_seconds: 300

# Component-Scoped Hooks
hooks:
  Stop:
    - type: command
      command: "bash .claude/hooks/concept-complete.sh research"

# Skills (Phase 7)
skills:
  # P0 - Critical
  - project-structure             # Understand codebase layout
  # P1 - Core
  - cross-project-knowledge       # Apply patterns from other projects
  - dependency-impact-analysis    # Understand what's affected
  # Research Skills
  - smart-summarization           # Synthesize findings
---

Call zen_get_agent_prompt with agent="research-concept" and taskContext from your current task.
Use the returned prompt as your instructions. Follow it exactly.
