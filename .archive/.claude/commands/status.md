---
name: status
description: "Show unified project dashboard: git, tests, sync rules, workflow, health"
---

# /status Command

Show a unified project dashboard in a single call.

## What to Do

Gather data from these sources in parallel, then display a formatted summary:

1. **Git status** — Run `git branch --show-current` and `git log --oneline -1` via Bash
2. **Framework status** — Call `zen_framework_status` MCP tool
3. **Health status** — Call `zen_health_get` MCP tool
4. **Workflow state** — Call `zen_get_workflow_state` MCP tool (may return no active session)

## Output Format

```
Project Status
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Git:       {branch} @ {short_sha} — {commit_message}
Health:    {zone} ({usage}% context used)
Framework: {concept_count} concepts, {command_count} commands, {sync_rules} sync rules
Workflow:  {active_session_info or "No active workflow"}
Tests:     Run `npm test` in zen-server for count

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Example

```
Project Status
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Git:       main @ 5958925 — feat: Wire sync rules into zen_advance_workflow
Health:    green (45% context used)
Framework: 22 concepts, 28 commands, 200 sync rules
Workflow:  wf-abc123 — story (completed) → implementation (in_progress)
Tests:     240 passing (zen-server)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Notes

- All data gathering should happen in parallel for speed
- If any source fails, show "unavailable" for that line
- Keep output concise — this is a quick glance, not a deep report
