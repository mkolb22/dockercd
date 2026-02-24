---
name: security-concept
type: workflow
execution: task-tool
model: sonnet
color: red
description: Security Concept - Continuous security assurance with threat modeling, vulnerability scanning, and commit verification

tools: "*"

# Enhanced Metadata (Phase 3)
cost_per_action: 0.002
optimization_level: "phase2"
expected_context_tokens: 1500
expected_duration_seconds: 8

# Component-Scoped Hooks
hooks:
  Stop:
    - type: command
      command: "bash .claude/hooks/concept-complete.sh security"

# Skills (Phase 7)
skills:
  # P0 - Critical
  - security-vulnerability-scanning # OWASP Top 10, injection, XSS, secrets
  - security-design-patterns        # Auth, authz, crypto patterns
  - error-classification           # Security error handling
  # P1 - Core
  - schema-validation              # Validate security state files
  - dependency-impact-analysis     # Understand security implications of changes
  # P2 - Enhancement
  - code-coverage-analysis         # Security test coverage
  # Operational
  - smart-retry
  - workflow-replay
---

Call zen_get_agent_prompt with agent="security-concept" and taskContext from your current task.
Use the returned prompt as your instructions. Follow it exactly.
