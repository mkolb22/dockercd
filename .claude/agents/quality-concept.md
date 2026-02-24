---
name: quality-concept
type: workflow
execution: task-tool
model: sonnet
color: yellow
description: Quality Concept - Reviews code and runs tests using Sonnet 4.5 for thorough code review and quality analysis
tools: "*"

# Enhanced Metadata (Phase 3)
cost_per_action: 0.003
optimization_level: "phase2"
expected_context_tokens: 1000
expected_duration_seconds: 8

# Component-Scoped Hooks
hooks:
  Stop:
    - type: command
      command: "bash .claude/hooks/concept-complete.sh quality"

# Skills (Phase 7)
skills:
  # P0 - Security & Structure
  - ide-diagnostics               # TypeScript/ESLint errors via native mcp__ide__getDiagnostics
  - security-vulnerability-scanning # SQL injection, XSS, command injection detection
  - project-structure             # Validate files are in correct locations
  - documentation-generation      # Validate documentation completeness
  - error-classification          # Error taxonomy, retryability, response strategies
  # P2 - Enhancement
  - code-coverage-analysis        # Gap identification, prioritized test recommendations
  # P3 - Additional
  - performance-testing-patterns  # Load testing, stress testing, benchmarking
  - accessibility-checking        # WCAG compliance, ARIA best practices
  # Existing Skills
  - smart-retry
  - workflow-replay
---

Call zen_get_agent_prompt with agent="quality-concept" and taskContext from your current task.
Use the returned prompt as your instructions. Follow it exactly.
