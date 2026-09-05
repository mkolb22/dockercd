---
name: health
description: "Display context health status and safety warnings"
---

# /health Command

Display current context health status to help Claude and users understand the state of the conversation context.

## Purpose

This command helps:
1. Claude understand if context has been compressed
2. Users see token usage and warnings
3. Identify when extra verification is needed before operations

## What to Do

1. Read `koan/health/status.yaml`
2. Read `koan/anchors/rules.anchor.yaml`
3. Read `koan/anchors/directory.anchor.yaml`
4. Display a formatted summary

## Output Format

```
Context Health Status
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Tokens: {used} / {total} ({percent}%) [{zone}]
Session: {interactions} interactions, {checkpoints} checkpoints
Compression: {compression_status}

Grounding Status:
{✓|✗} Directory verified: {working_directory}
{✓|✗} Rules loaded: {rule_count} rules
{✓|✗} Safety constraints active

Confidence: {confidence_level}

{warnings_section}

{recommendations_section}
```

## Example Output (Healthy)

```
Context Health Status
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Tokens: 45,000 / 200,000 (22.5%) [GREEN]
Session: 12 interactions, 1 checkpoint
Compression: None this session

Grounding Status:
✓ Directory verified: /Users/kolb/project
✓ Rules loaded: 7 rules (4 safety, 3 workflow)
✓ Safety constraints active

Confidence: HIGH

Recommendations:
• Continue normally - context is healthy
• Consider checkpoint at next workflow milestone
```

## Example Output (After Compression)

```
Context Health Status
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Tokens: 165,000 / 200,000 (82.5%) [RED]
Session: 87 interactions, 2 checkpoints
Compression: 1 compression 5 turns ago

Grounding Status:
✓ Directory verified: /Users/kolb/project
✓ Rules loaded: 7 rules
✓ Safety constraints active

Confidence: MEDIUM

⚠️  WARNINGS:
• Context was compressed. Some details from early conversation may be summarized.
• High token usage - consider /checkpoint before major operations.

Recommendations:
• Re-read koan/anchors/rules.anchor.yaml before destructive operations
• Verify assumptions about file paths and previous decisions
• Create checkpoint before next major change
```

## When to Use

- Before destructive operations (rm, git reset, etc.)
- When Claude seems confused about prior context
- At the start of a new work session
- After long conversations (50+ interactions)
- When /compact or auto-compact has run

## Related Commands

- `/checkpoint` - Create state checkpoint
- `/trace` - View action provenance
- `/costs` - View token/cost usage
