Display context-aware help for Dragonfly WYSIWID workflows and commands.

When the user runs this command, you should:

1. **Determine Help Context**
   - If no argument: Show overview of all commands
   - If topic provided: Show detailed help for that topic
   - If in workflow: Show current state and available actions

2. **Available Topics**
   - `commands` - List all slash commands
   - `concepts` - Explain the 10 concepts
   - `workflow` - How workflows work
   - `sync` - Synchronization rules
   - `state` - Current workflow state
   - `troubleshooting` - Common issues and fixes

## Usage

```
/help              # Overview and quick start
/help commands     # List all commands
/help concepts     # Explain concepts
/help workflow     # How workflows work
/help state        # Current workflow state
/help troubleshooting  # Common issues
```

## Overview Response (no arguments)

When user runs `/help` with no arguments:

```
Dragonfly WYSIWID Architecture - Quick Reference

WHAT YOU SEE IS WHAT IT DOES

Core Workflow:
  Story -> Architecture -> Implementation -> Quality -> Version

Getting Started:
  /feature "description"   Create a new feature
  /workflow "description"  Run complete workflow automatically
  /sync                    Check current sync state

Key Commands:
  /costs                   Show session costs
  /trace <id>              Trace workflow history
  /health                  Check session health
  /checkpoint              Save current state

Need More Help?
  /help commands           All available commands
  /help concepts           How concepts work
  /help workflow           Workflow details
  /help troubleshooting    Common issues
```

## Commands List Response

When user runs `/help commands`:

```
Dragonfly Commands Reference

WORKFLOW COMMANDS
  /feature <description>   Create feature story, evaluate syncs
  /workflow <description>  Run complete workflow automatically
  /sync                    Evaluate synchronization rules

STATE & CONTEXT
  /checkpoint              Save session state
  /restore                 Restore from checkpoint
  /health                  Check context usage
  /trace <id>              Trace provenance chain

COST & PERFORMANCE
  /costs                   Show session costs
  /predict-cost <desc>     Estimate feature cost
  /slo                     View SLO metrics

MEMORY
  /remember <fact>         Store in semantic memory
  /recall <query>          Retrieve from memory
  /global-remember         Store across projects
  /global-recall           Recall cross-project

ANALYSIS
  /replay <id>             Replay failed workflow
  /explore <question>      Explore codebase
  /profile                 Profile project
  /retrospective           Review workflow quality

UTILITIES
  /cache                   Manage concept cache
  /classify <desc>         Classify task type
  /estimate <desc>         Estimate effort
  /pr-review               Review pull request
```

## Concepts Help Response

When user runs `/help concepts`:

```
Dragonfly Concepts (10 Total)

CORE WORKFLOW CONCEPTS
  story          Captures user requirements (Opus)
                 Actions: create, update, clarify, cancel

  architecture   Designs technical approach (Opus)
                 Actions: design, revise, validate

  implementation Generates code from specs (Opus)
                 Actions: generate, refactor, fix

  quality        Reviews code and runs tests (Opus)
                 Actions: review, test, benchmark

  version        Manages git operations (Opus)
                 Actions: commit, tag, release

  context        Manages context window (Opus)
                 Actions: compress, snapshot, restore

INTEGRATION CONCEPTS
  code-analysis  Gathers codebase context via MCP (Opus)
                 Actions: context, impact, profile

  security       Validates security at each phase (Opus)
                 Actions: threat_model, validate, scan

  verification   Multi-pass independent review (Opus)
                 Actions: verify_architecture, verify_implementation

  documentation  Generates docs at each phase (Opus)
                 Actions: generate, update, validate

KEY PRINCIPLE:
  Concepts NEVER call other concepts directly.
  Synchronization rules orchestrate the workflow.
```

## State Help Response

When user runs `/help state`:

First, check current state by reading data/ files:

```
Current Workflow State

ACTIVE FLOWS
  flow-001: "Add user authentication"
    Status: in_progress
    Phase: implementation
    Story: story-001 (ready)
    Architecture: arch-001 (completed)
    Implementation: impl-001 (in_progress)

RECENT ACTIONS
  1. story.create -> completed (2 min ago)
  2. architecture.design -> completed (1 min ago)
  3. implementation.generate -> in_progress

NEXT STEPS
  - Implementation completes
  - Sync triggers: impl-to-quality-review
  - Parallel: impl-to-quality-test

CONTEXT USAGE
  Current: 35%
  Status: healthy
  Checkpoints: 1

ACTIONS YOU CAN TAKE
  /sync --execute          Continue workflow
  /trace flow-001          See full history
  /checkpoint              Save current state
```

## Troubleshooting Response

When user runs `/help troubleshooting`:

```
Dragonfly Troubleshooting Guide

COMMON ISSUES

1. "Sync rule not firing"
   Cause: Prerequisites not met
   Fix: Check data/ state files
   - /trace <id> to see what's missing
   - Ensure previous concept completed successfully

2. "Context too high (>90%)"
   Cause: Long workflow without compression
   Fix: Create checkpoint and restore
   - /checkpoint "before continuing"
   - /restore if needed

3. "MCP server unavailable"
   Cause: MCP servers not running
   Fix: Workflow continues without code analysis
   - Check: mcp-servers/ for server status
   - MCP is optional - workflow gracefully degrades

4. "Architecture has high risk"
   Cause: Design detected risky patterns
   Fix: Review and approve or revise
   - Read data/architecture/arch-{id}.yaml
   - User decision required

5. "Quality review failed"
   Cause: Code issues found
   Fix: Check review findings
   - Read data/reviews/review-{id}.yaml
   - Fix issues and re-run quality

6. "Missing state file"
   Cause: Concept didn't complete
   Fix: Re-run previous step
   - Check data/ for existing state
   - /replay <id> to restart from failure

DIAGNOSTIC COMMANDS
  /health                  Check overall health
  /trace <id>              Trace specific flow
  /costs                   Check spending
  /sync --dry-run          Preview sync evaluation

GETTING HELP
  - Read .claude/synchronizations/*.yaml for workflow logic
  - Check data/provenance/ for action history
  - Review CLAUDE.md for project context
```

## Context-Aware Behavior

When providing help, check:

1. **Active Workflow**: If there's an in-progress flow, offer relevant next steps
2. **Recent Errors**: If data/ shows issues, suggest fixes
3. **Context Usage**: If high (>75%), suggest checkpoint
4. **MCP Status**: If unavailable, note graceful degradation

## Related Commands

- `/health` - More detailed health status
- `/trace` - Detailed provenance tracking
- `/sync` - Manual sync evaluation
