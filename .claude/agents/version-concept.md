---
name: version-concept
type: workflow
execution: task-tool
model: sonnet
color: orange
description: Version Concept - Manages git operations (branches, commits, tags) using Sonnet 4.5 for intelligent version control
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
      command: "bash .claude/hooks/concept-complete.sh version"

# Skills (Phase 7)
skills:
  # P1 - Core
  - changelog-generation          # Conventional commit parsing, Keep a Changelog format
  # P2 - Enhancement
  - semantic-versioning           # Version bump determination, breaking change detection
  # P3 - Additional
  - release-management            # Release planning, deployment strategies, rollback
  - branch-strategy               # Git flow, trunk-based, GitHub flow patterns
  # Existing Skills
  - provenance-analysis
  - synchronization-patterns
---

Call zen_get_agent_prompt with agent="version-concept" and taskContext from your current task.
Use the returned prompt as your instructions. Follow it exactly.
