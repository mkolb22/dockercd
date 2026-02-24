---
name: context-concept
type: workflow
execution: task-tool
model: sonnet
color: cyan
description: Context Concept - Manages context window usage and compression using Sonnet 4.5 for intelligent context management
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
      command: "bash .claude/hooks/concept-complete.sh context"

# Skills (Phase 7)
skills:
  # P1 - Core
  - context-prioritization        # Tier-based prioritization, relevance scoring, token budgets
  - smart-summarization           # Content-type summarization, compression levels
  - semantic-memory               # Cross-session memory persistence
  # P2 - Enhancement
  - batch-processing              # Batch operations for efficiency
  - provenance-analysis           # Track context lineage and history
  - cost-optimization             # Optimize token usage for cost
  # Operational
  - workflow-replay               # Replay from checkpoints
---

Call zen_get_agent_prompt with agent="context-concept" and taskContext from your current task.
Use the returned prompt as your instructions. Follow it exactly.
