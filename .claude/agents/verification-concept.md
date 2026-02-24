---
name: verification-concept
type: workflow
execution: task-tool
model: sonnet
color: indigo
description: Verification Concept - Multi-pass verification of architecture and implementation for 39.7% accuracy improvement

tools: "*"

# Enhanced Metadata (Phase 3)
cost_per_action: 0.003
optimization_level: "phase2"
expected_context_tokens: 2500
expected_duration_seconds: 12

# Component-Scoped Hooks
hooks:
  Stop:
    - type: command
      command: "bash .claude/hooks/concept-complete.sh verification"

# Skills (Phase 7)
skills:
  # P0 - Critical
  - security-vulnerability-scanning # Deep security analysis
  - error-classification          # Error taxonomy for issues found
  # P1 - Core
  - dependency-impact-analysis    # Understand change impact
  - cross-project-knowledge       # Apply patterns from other projects
  # P2 - Enhancement
  - code-coverage-analysis        # Validate test coverage
  # Existing Skills
  - smart-retry
  - workflow-replay
---

Call zen_get_agent_prompt with agent="verification-concept" and taskContext from your current task.
Use the returned prompt as your instructions. Follow it exactly.
