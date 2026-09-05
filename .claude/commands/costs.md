Show cost analysis for AI model usage across flows and concepts.

When the user runs this command, you should:

1. Aggregate provenance data from data/provenance/
2. Calculate costs by concept, model, and time period
3. Show cost efficiency metrics and trends

Usage:
- `/costs` - Show all-time costs
- `/costs --last-week` - Show last 7 days
- `/costs --by-concept` - Break down by concept
- `/costs --by-flow` - Break down by flow

Process:
1. Read all provenance files from data/provenance/actions/
2. Aggregate cost data
3. Calculate metrics
4. Present insights

Example output:
```
Dragonfly Cost Analysis
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Period: All time
Total flows: 15
Total actions: 87
Total cost: $0.2475

By Concept:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

story           (sonnet)   15 actions   $0.045   (5%)
code-analysis   (sonnet)   15 actions   $0.045   (5%)
architecture    (opus)     15 actions   $0.225   (25%) ⭐
verification    (sonnet)   15 actions   $0.045   (5%)
implementation  (sonnet)   15 actions   $0.045   (5%)
quality         (sonnet)   30 actions   $0.090   (10%)
security        (sonnet)   15 actions   $0.045   (5%)
version         (sonnet)   15 actions   $0.045   (5%)
context         (sonnet)    5 actions   $0.015   (2%)
documentation   (sonnet)   15 actions   $0.045   (5%)

By Model:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Opus:    15 actions   $0.225   (25%)
Opus: 140 actions   $0.420   (75%)

Cost Efficiency:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Smart model assignment savings:
- Actual cost:     $0.2475
- All-opus cost: $1.4850
- Savings:         $1.2375 (83%)

Average cost per feature:
- With smart assignment: $0.0165
- With all-opus:       $0.0990
- Savings per feature:   $0.0825

Cost breakdown per feature:
┌─────────────────┬────────┬──────────┬──────────┐
│ Concept         │ Model  │ Cost     │ % Total  │
├─────────────────┼────────┼──────────┼──────────┤
│ Story           │ Opus │ $0.003   │  5%      │
│ Code-Analysis   │ Opus │ $0.003   │  5%      │
│ Architecture    │ Opus   │ $0.015   │ 25% ⭐   │
│ Verification    │ Opus │ $0.003   │  5%      │
│ Implementation  │ Opus │ $0.003   │  5%      │
│ Quality (x2)    │ Opus │ $0.006   │ 10%      │
│ Security        │ Opus │ $0.003   │  5%      │
│ Version         │ Opus │ $0.003   │  5%      │
│ Context         │ Opus │ $0.003   │  5%      │
│ Documentation   │ Opus │ $0.003   │  5%      │
└─────────────────┴────────┴──────────┴──────────┘

Insights:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✓ Smart model assignment working as designed
✓ Architecture (Opus) accounts for 25% of cost
✓ This is expected - architecture requires deep reasoning
✓ Other 9 concepts efficiently use Opus (major cost savings)

Recent Trends (Last 7 Days):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Features completed: 3
Total cost: $0.0495
Average cost per feature: $0.0165
Model usage: 25% Opus, 75% Opus
Cost efficiency: Consistent 83% savings

Top Flows by Cost:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. flow-001 "Add dark mode" - $0.0165
2. flow-002 "User auth"     - $0.0185 (arch revision +$0.002)
3. flow-003 "API endpoints" - $0.0155
```

Key Insights:
- Architecture is expensive but necessary (prevents costly rework)
- Opus is sufficient for 9/10 concepts (major cost savings)
- Consistent cost per feature enables budget forecasting
- Can identify outliers (e.g., flow-002 with arch revision)

This command helps validate the smart model assignment strategy and identify opportunities for optimization.
