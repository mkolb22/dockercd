# Retrospective Command

Manually trigger retrospective analysis for a workflow.

## Usage

```
/retrospective [flow-id]
```

## Arguments

- `flow-id` (optional): Specific flow to analyze. If omitted, analyzes most recent failed flow.

## Process

When you run this command:

1. **Find Failed Flow**
   - If flow-id provided, load that flow's provenance
   - Otherwise, find most recent flow with failed/rejected/blocked status
   - Read from `data/provenance/flows/`

2. **Gather Context**
   - Load all concept outputs from the flow
   - Identify the failure point
   - Collect rejection/failure details

3. **Run Analysis**
   - Invoke retrospective concept with Opus
   - Apply 5 Whys root cause analysis
   - Extract actionable learnings

4. **Store Results**
   - Save to `data/retrospectives/retro-{id}.yaml`
   - Update `data/learnings/active-learnings.yaml`
   - Link retrospective to original flow

5. **Report Findings**
   - Display root causes
   - Show learnings with priorities
   - List immediate recommendations

## Example

```
User: /retrospective flow-2025-01-15-10h30m00s