# /estimate Command

Get predictive estimates before executing a task.

## Usage

```
/estimate "Add OAuth authentication"
/estimate --workflow refactor "Reorganize the auth module"
/estimate --compare est-20250106  # Compare prediction to actual
```

## Purpose

This command predicts outcomes BEFORE execution:
- Expected duration
- Expected cost
- Risk factors
- Optimization suggestions
- SLO pass/fail likelihood

## Process

When you run `/estimate "<task>"`:

1. **Load Historical Data**
   ```bash
   cat data/metrics/*/*.yaml  # Monthly performance data
   ```

2. **Classify Task**
   - Use task-routing.yaml patterns
   - Determine base complexity

3. **Analyze Complexity**
   - Count acceptance criteria (from story)
   - Check code analysis results (if available)
   - Identify scope indicators

4. **Match Historical Tasks**
   - Find similar past tasks by type + complexity
   - Calculate statistical distributions

5. **Generate Predictions**
   - Expected values (mean)
   - P50 (median)
   - P95 (worst case)
   - Confidence level

6. **Assess SLO Risk**
   - Compare predictions to SLO thresholds
   - Flag potential violations

7. **Suggest Optimizations**
   - Skills to enable
   - Cached patterns to use
   - Workflow adjustments

## Output Format

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Predictive Estimate
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Task: "Add OAuth authentication"
Type: NEW FEATURE (full-feature-flow)

┌─────────────────────────────────────────────────┐
│ Predictions                                     │
├─────────────────────────────────────────────────┤
│ Duration:  15-25 min (expected: 18 min)         │
│ Cost:      $0.02-0.05 (expected: $0.03)         │
│ Quality:   85% likely to pass review            │
│ Context:   ~8,500 tokens (15% overflow risk)    │
│                                                 │
│ Confidence: 75% (based on 12 similar tasks)     │
└─────────────────────────────────────────────────┘

SLO Assessment:
  Duration: ✅ LIKELY PASS (< 20 min SLO)
  Cost:     ⚠️ AT RISK ($0.03 approaches $0.05 budget)
  Quality:  ✅ LIKELY PASS (> 80% target)

Risk Factors:
  • OAuth complexity varies by provider count
  • No cached architecture pattern found
  • First auth feature in this project

Recommendations:
  1. Enable 'incremental-loading' skill
     → Expected 40% context reduction

  2. Use oauth-authentication example
     → Path: .claude/examples/architecture/oauth-authentication.yaml
     → Expected 50% faster architecture phase

  3. Consider breaking into phases:
     → Phase 1: Google OAuth only
     → Phase 2: Add GitHub provider
     → Reduces per-task complexity

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Proceed? [y] Yes  [o] Optimize first  [n] Cancel
```

## Comparing Predictions

After a task completes, compare predictions to actuals:

```
/estimate --compare est-20250106-143052

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Prediction Accuracy Report
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Estimate: est-20250106-143052
Task: "Add OAuth authentication"

              Predicted    Actual      Accuracy
Duration:     18 min       22 min      82%
Cost:         $0.03        $0.028      107%
Quality:      85%          passed      ✓

Analysis:
  • Duration underestimated by 4 min
  • Reason: Provider-specific error handling took longer
  • Learning: Add +20% buffer for multi-provider OAuth

Updated Model:
  • oauth-related tasks: duration_factor += 0.2
  • Confidence for similar tasks: now 78%

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Historical Data Requirements

Estimates work best with historical data in:
```
data/metrics/
├── architecture/
│   └── 2025-01.yaml
├── implementation/
│   └── 2025-01.yaml
└── quality/
    └── 2025-01.yaml
```

Without historical data, estimates use:
- Task type base complexity
- Industry benchmarks
- Conservative confidence (50%)

## Complexity Indicators

| Indicator | Low | Medium | High |
|-----------|-----|--------|------|
| Acceptance criteria | 1-3 | 4-6 | 7+ |
| Affected files | 1-3 | 4-10 | 11+ |
| Call graph depth | 1-2 | 3-4 | 5+ |
| New vs existing | Existing | Mixed | All new |

## Integration with /workflow

Estimates can auto-run before workflows:

```yaml
# In config.yaml
workflow:
  pre_flight_estimate: true  # Auto-estimate before execution
  estimate_approval_threshold: "at_risk"  # Ask user if AT RISK
```

When enabled:
```
/workflow "Add OAuth"

Running pre-flight estimate...

⚠️ Cost prediction ($0.03) is AT RISK vs budget ($0.05)

Recommendations available. View estimate? [y/n]
```

## WYSIWID Principle

Estimates are fully transparent:
- All complexity factors shown
- Historical data sources cited
- Confidence levels explained
- Recommendations include reasoning

What you see in the estimate is exactly what informed the predictions.
