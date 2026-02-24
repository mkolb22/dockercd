# Koan - State Storage

This directory contains all state for your Zen WYSIWID architecture.

## Structure

- `stories/` - Story concept state (requirements, acceptance criteria)
- `architecture/` - Architecture decisions and technical designs
- `implementations/` - Code artifacts and implementation records
- `reviews/` - Quality reviews and test results
- `provenance/` - Action tracking and flow analysis
- `session-state/` - Session snapshots and checkpoints
- `anchors/` - Immutable context that survives compression
- `health/` - Context health monitoring
- `memory/` - Semantic memory storage
- `slo/` - SLO metrics and violations
- `routing/` - Task classification history
- `estimates/` - Prediction history
- `notifications/` - Team alerts
- `explorations/` - Tree-of-Thoughts exploration branches
- `repairs/` - Self-repair history and strategies
- `learnings/` - Continuous learning patterns
- `test-coverage/` - Test generation coverage data
- `tasks/` - GitOps task tracking for Kanban visualization

## Commands

- `/remember "fact"` - Store a memory
- `/recall query` - Retrieve memories
- `/explore "problem"` - Start Tree-of-Thoughts exploration
- `/checkpoint` - Save session state
- `/restore` - Restore from checkpoint
- `/trace <id>` - Explore provenance chains
- `/task create|list|update|show` - Manage GitOps tasks
