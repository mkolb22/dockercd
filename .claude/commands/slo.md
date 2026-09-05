# SLO Command

View Service Level Objectives performance metrics and violations.

## Usage

```
/slo [subcommand] [options]
```

## Subcommands

### `report` (default)
Generate SLO performance dashboard for a time period.

```
/slo report
/slo report --timeframe=7d
/slo report --timeframe=30d --concept=architecture
```

**Options**:
- `--timeframe=<period>` - Time period: 1d, 7d, 30d, all (default: 7d)
- `--concept=<name>` - Filter by concept name

**Output**:
```
SLO Performance Report (Last 7 Days)
=====================================

Overall Compliance: 94% (47/50 actions within SLOs)

By Concept:
  story:          100% | p50: 1.2s | avg cost: $0.000175
  architecture:    94% | p50: 11s  | avg cost: $0.003
  implementation:  95% | p50: 2.1s | avg cost: $0.000175
  quality:         92% | p50: 1.8s | avg cost: $0.000175
  version:        100% | p50: 0.8s | avg cost: $0.000175
  context:        100% | p50: 1.5s | avg cost: $0.000175

Violations (3):
  - architecture: 2 timeout (resolved via retry)
  - quality: 1 cost exceeded (alerted)

Recommendations:
  - Consider increasing architecture timeout from 60s to 90s
  - Investigate quality cost spikes in flow-003
```

### `violations`
List SLO violations with optional filtering.

```
/slo violations
/slo violations --concept=architecture
/slo violations --type=timeout
/slo violations --timeframe=30d
```

**Options**:
- `--concept=<name>` - Filter by concept
- `--type=<violation_type>` - Filter by type: timeout, cost_exceeded, context_exceeded, quality_below_target
- `--timeframe=<period>` - Time period: 1d, 7d, 30d, all (default: 7d)
- `--status=<status>` - Filter by resolution status: pending, resolved, ignored

**Output**:
```
SLO Violations (Last 7 Days)
============================

viol-001 | 2025-12-05 10:35 | architecture | timeout
  Expected: max 60s | Actual: 72s (+20%)
  Handler: retry (1 attempt) -> succeeded
  Status: resolved

viol-002 | 2025-12-05 14:22 | architecture | timeout
  Expected: max 60s | Actual: 85s (+42%)
  Handler: retry (1 attempt) -> failed -> escalated
  Status: resolved (timeout increased to 90s)

viol-003 | 2025-12-06 09:15 | quality | cost_exceeded
  Expected: max $0.0005 | Actual: $0.0012 (+140%)
  Handler: alert sent to budget-alerts
  Status: pending investigation
```

### `validate`
Validate all SLO configurations in sync rules.

```
/slo validate
```

**Output**:
```
SLO Configuration Validation
============================

Checking: feature-development.yaml
  story-to-arch:        OK (6 SLOs defined)
  arch-to-impl:         OK (6 SLOs defined)
  impl-to-quality:      OK (6 SLOs defined)
  quality-to-version:   OK (6 SLOs defined)

Checking: slo-monitoring.yaml
  post-action-slo-monitor: OK (monitoring rule)

Summary: 5 rules OK, 0 warnings

All SLO configurations valid!
```

### `concept`
Show SLO configuration and performance for a specific concept.

```
/slo concept <concept_name>
/slo concept architecture
```

**Output**:
```
SLO Configuration: architecture
================================

Defined in: feature-development.yaml (story-to-arch)

Thresholds:
  Duration:  expected 12s, max 60s
  Cost:      expected $0.003, max $0.015
  Context:   expected 1100 tokens, max 10000
  Success:   target 95%

Handlers:
  on_timeout:         retry (max 1) -> escalate
  on_cost_exceeded:   alert (continue: true)
  on_context_exceeded: alert + investigate

Last 7 Days:
  Executions: 12
  Compliance: 92%
  Violations: 1 timeout (resolved)

Duration Stats:
  p50: 11s
  p95: 14s
  p99: 18s

Cost Stats:
  avg: $0.0031
  p95: $0.0038
  total: $0.037

Context Stats:
  avg: 1150 tokens
  p95: 1400 tokens
```

## Process

When you run this command:

1. **Parse Subcommand and Options**
   - Determine which action to invoke
   - Extract filters and parameters

2. **Invoke SLO Concept**
   - `report` → `slo.report` action
   - `violations` → `slo.report` with violation filter
   - `validate` → `slo.validate` action
   - `concept` → `slo.report` with concept filter

3. **Load Data**
   - Monthly metrics from `data/metrics/{concept}/metrics-{YYYY-MM}.yaml`
   - Violations from `data/violations/viol-*.yaml`
   - SLO configs from `.claude/synchronizations/*.yaml`

4. **Format Output**
   - Apply filters
   - Calculate aggregations
   - Format as human-readable tables
   - Include actionable recommendations

## Data Storage

SLO data is stored in:

```
data/
├── metrics/
│   ├── architecture/
│   │   └── metrics-2025-12.yaml
│   ├── implementation/
│   │   └── metrics-2025-12.yaml
│   └── quality/
│       └── metrics-2025-12.yaml
├── violations/
│   ├── viol-001.yaml
│   ├── viol-002.yaml
│   └── viol-003.yaml
└── reports/
    └── report-2025-12-06.yaml
```

## SLO Expectations

SLOs are declared in synchronization rules:

```yaml
- id: "story-to-arch"
  when:
    concept: "story"
    status: "completed"
  then:
    - concept: "architecture"
      action: "design"

  slo_expectations:
    expected_duration_ms: 12000
    max_duration_ms: 60000
    expected_cost_usd: 0.003
    max_cost_usd: 0.015
    expected_context_tokens: 1100
    max_context_tokens: 10000
    success_rate_target: 0.95

    on_timeout:
      action: "retry"
      max_retries: 1
      on_exhausted: "escalate"

    on_cost_exceeded:
      action: "alert"
      continue: true
```

## Benefits

1. **Visibility** - See performance expectations and actual metrics
2. **Anomaly Detection** - Automatic violation detection
3. **Trend Analysis** - Track performance over time
4. **Cost Control** - Alert on budget overruns
5. **Quality Assurance** - Monitor success rates
6. **Phase 2 Verification** - Confirm context optimizations working

## Integration

SLO monitoring happens automatically:
- After each concept action completes
- Compares actual performance to declared expectations
- Executes handlers for violations
- Updates monthly metrics
- No manual intervention required

Use `/slo` commands to view and analyze the collected data.

## Example Workflow

```bash
# View overall performance
/slo report

# Check recent violations
/slo violations --timeframe=7d

# Investigate specific concept
/slo concept architecture

# Validate configuration after changes
/slo validate
```

## Tips

- Set realistic SLO values based on historical data
- Use progressive thresholds (expected < max)
- Configure appropriate handlers for each violation type
- Review violations regularly to identify trends
- Adjust SLOs as system evolves
- Use investigation tasks for anomalies

## See Also

- `/costs` - View detailed cost breakdown
- `/trace` - Follow provenance chains
- `/health` - Check context health
