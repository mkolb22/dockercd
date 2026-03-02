# Observe Command

Analyze prompt observability data to understand Claude Code usage patterns.

## Usage

```
/observe [subcommand] [options]
```

## Subcommands

### `stats` (default)
Show usage statistics.

```
/observe stats
/observe stats --period=week
```

### `prompts`
List recent prompts.

```
/observe prompts --limit=10
/observe prompts --concept=architecture
```

### `costs`
Estimate costs based on token usage.

```
/observe costs
/observe costs --period=month
```

### `patterns`
Analyze usage patterns.

```
/observe patterns
```

## Process

When you run this command:

1. **Load Observability Data**
   - Read `koan/observability/prompts.jsonl`
   - Load `koan/observability/daily-stats.json`

2. **Analyze Based on Subcommand**
   - Aggregate data by concept, model, or time period
   - Calculate token usage and estimated costs
   - Identify patterns and anomalies

3. **Display Results**
   - Formatted tables and summaries
   - Cost breakdowns by model
   - Usage trends

## Example Output

### Stats Output

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Prompt Observability - Last 7 Days
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Total Calls:     247
Total Tokens:    ~89,420
Estimated Cost:  $2.68

By Model:
┌──────────┬───────┬──────────┬──────────┐
│ Model    │ Calls │ Tokens   │ Cost     │
├──────────┼───────┼──────────┼──────────┤
│ sonnet    │ 189   │ 45,230   │ $0.11    │
│ sonnet   │ 48    │ 32,190   │ $0.96    │
│ opus     │ 10    │ 12,000   │ $1.61    │
└──────────┴───────┴──────────┴──────────┘

By Concept:
┌─────────────────┬───────┬──────────┐
│ Concept         │ Calls │ Tokens   │
├─────────────────┼───────┼──────────┤
│ implementation  │ 78    │ 28,420   │
│ quality         │ 62    │ 18,600   │
│ story           │ 45    │ 12,150   │
│ architecture    │ 32    │ 19,200   │
│ verification    │ 20    │ 8,050    │
│ version         │ 10    │ 3,000    │
└─────────────────┴───────┴──────────┘

Daily Trend:
Mon: ████████████░░░░░░░░ 42 calls
Tue: ██████████████░░░░░░ 51 calls
Wed: ████████████████░░░░ 58 calls
Thu: ██████████░░░░░░░░░░ 38 calls
Fri: ████████████████████ 58 calls
```

### Prompts Output

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Recent Prompts
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. [2025-01-15 10:45:32] architecture.design (opus)
   Tokens: ~1,200 | Session: abc123

2. [2025-01-15 10:42:18] implementation.generate (sonnet)
   Tokens: ~450 | Session: abc123

3. [2025-01-15 10:38:05] story.create (sonnet)
   Tokens: ~280 | Session: abc123

4. [2025-01-15 10:35:22] quality.review (sonnet)
   Tokens: ~320 | Session: abc122

5. [2025-01-15 10:30:11] verification.verify_architecture (sonnet)
   Tokens: ~680 | Session: abc122
```

### Costs Output

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Cost Analysis - January 2025
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Estimated Total: $12.45

Model Breakdown:
┌──────────┬──────────────┬────────────┬───────────┐
│ Model    │ Input Tokens │ Est. Cost  │ % of Total│
├──────────┼──────────────┼────────────┼───────────┤
│ opus     │ 45,000       │ $6.75      │ 54.2%     │
│ sonnet   │ 125,000      │ $3.75      │ 30.1%     │
│ sonnet    │ 780,000      │ $1.95      │ 15.7%     │
└──────────┴──────────────┴────────────┴───────────┘

Pricing Reference:
- Opus:   $15.00 / 1M input tokens
- Sonnet: $3.00  / 1M input tokens
- Sonnet:  $0.25  / 1M input tokens

Cost Optimization Tips:
1. Architecture uses 54% of budget (Opus) - consider Sonnet for lower-risk designs
2. Quality checks are efficient (Sonnet) - good usage pattern
3. Consider caching repeated prompts
```

### Patterns Output

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Usage Patterns Analysis
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Peak Hours:
- Most active: 10:00-12:00, 14:00-16:00
- Lowest: 07:00-09:00, 18:00-20:00

Workflow Patterns:
- Average concepts per session: 4.2
- Most common flow: story → architecture → implementation
- Verification rate: 68% of architectures verified

Retry Patterns:
- Average retries per concept: 1.3
- Highest retry rate: implementation (1.8)
- Lowest retry rate: version (1.0)

Recommendations:
1. Implementation has high retry rate - consider adding examples
2. Quality reviews rarely need retries - prompt is effective
3. Architecture could benefit from planning phase more often
```

## Data Storage

Observability data is stored in:

```
koan/observability/
├── prompts.jsonl        # Raw prompt logs (JSONL format)
├── daily-stats.json     # Aggregated daily statistics
└── prompts-*.jsonl.gz   # Archived logs (rotated)
```

## Privacy

- Only metadata is logged (concept, action, model, token estimates)
- Actual prompt content is NOT stored
- Logs can be disabled by setting `PROMPT_OBSERVABILITY_ENABLED=false`

## Integration

Enable observability by adding the hook to your project:

```bash
# In .claude/settings.json
{
  "hooks": {
    "PostToolUse": [".claude/hooks/post-prompt-observe.sh"]
  }
}
```
