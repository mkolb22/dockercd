---
name: predict-cost
description: Predict the cost of implementing a feature before running it
---

# Predict Cost Command

Estimate the cost of a feature implementation before actually running it.

## Usage

```bash
/predict-cost "Feature description"

# Examples
/predict-cost "Add OAuth authentication"
/predict-cost "Implement dark mode toggle"
/predict-cost "Create REST API for users"
```

## How It Works

Analyzes the feature description to estimate which concepts will be invoked and predicts the total cost based on Dragonfly's standard workflow.

## Implementation

When invoked, this command:

1. **Parses** the feature description
2. **Estimates complexity** (simple, medium, complex)
3. **Predicts workflow path**:
   - Story → Architecture → Implementation → Quality → Version
   - Plus any rework cycles (based on historical data)
4. **Calculates cost** using current model pricing
5. **Shows breakdown** by concept and model

## Cost Prediction Model

### Base Workflow (95% of features)

```yaml
story:
  model: opus
  cost: $0.003

architecture:
  model: opus
  cost: $0.015  # Uses Opus for deep reasoning
  note: "~50% of total cost"

implementation:
  model: opus
  cost: $0.003

quality_review:
  model: opus
  cost: $0.003
  parallel: true

quality_test:
  model: opus
  cost: $0.003
  parallel: true

version:
  model: opus
  cost: $0.003

total_base: ~$0.030
```

### Complexity Adjustments

**Simple Features** (80% probability):
- Single component changes
- Clear requirements
- Low risk
- Expected cost: ~$0.030
- Success rate: 95%

**Medium Features** (15% probability):
- Multi-component changes
- Some ambiguity
- Medium risk
- Expected cost: ~$0.035 (includes 1 rework cycle)
- Success rate: 90%

**Complex Features** (5% probability):
- Major architectural changes
- High ambiguity
- High risk
- Expected cost: ~$0.050 (includes 2 rework cycles)
- Success rate: 85%
- May require manual review

### Rework Probability

Based on historical data:
- **5% chance**: Quality review needs changes (+$0.003)
- **3% chance**: Tests fail (+$0.003)
- **2% chance**: Architecture needs revision (+$0.015)

## Example Output

```
💰 Cost Prediction

Feature: "Add OAuth authentication"
Complexity: Medium
Risk: Medium

Predicted Workflow:
✓ Story (Opus)          $0.003    10%
✓ Architecture (Opus)     $0.015    50%  ← Deep reasoning
✓ Implementation (Opus) $0.003    10%
✓ Quality Review (Opus) $0.003    10%  │ parallel
✓ Quality Test (Opus)   $0.003    10%  │
✓ Version (Opus)        $0.003    10%
────────────────────────────────────────
Baseline Total:           ~$0.030   100%

Rework Probability (based on historical data):
  5% chance: Quality needs changes  +$0.003
  3% chance: Tests fail             +$0.003
  2% chance: Architecture revision  +$0.015

Expected Cost (with rework): ~$0.032
Maximum Cost (worst case):   ~$0.050
Minimum Cost (best case):    ~$0.030

Confidence: Medium (based on description analysis)
Estimated Duration: 12-15 minutes

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Cost Breakdown by Model:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Opus:    $0.015     (50% of cost, 1 action)
Opus:  $0.015     (50% of cost, 5 actions)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Smart Model Assignment:
Architecture uses Opus for deep reasoning
Other concepts use Opus for efficiency
```

## Complexity Detection

The prediction analyzes the description for:

**Simple Indicators**:
- "add", "update", "fix"
- Single component mentioned
- Clear, specific requirements
- Low-risk patterns

**Medium Indicators**:
- "implement", "create", "build"
- Multiple components
- Some architectural decisions needed
- Standard integrations

**Complex Indicators**:
- "migrate", "refactor", "redesign"
- System-wide changes
- New integrations
- Security/performance critical
- "real-time", "distributed", "scalable"

## Historical Data Integration

If provenance data exists in `data/provenance/`, the prediction uses it to improve accuracy:

```bash
# Uses historical data to calculate:
# - Average cost per feature type
# - Rework frequency
# - Success rates by complexity
# - Actual vs predicted costs

# Shows historical comparison:
Historical Similar Features:
  OAuth integration:   $0.032 (12 min)
  SAML integration:    $0.035 (14 min)
  JWT authentication:  $0.029 (11 min)
  Average:             $0.032

Predicted for this feature: $0.032 ✓ Within range
```

## Configuration

Edit `.claude/config.yaml` to customize:

```yaml
cost_prediction:
  enabled: true
  use_historical_data: true
  confidence_threshold: 0.7  # Min confidence to show prediction

  # Model costs (updated automatically)
  opus:
    cost_per_action: 0.015    # Deep reasoning for architecture
  sonnet:
    cost_per_action: 0.003    # Standard execution

  # Rework probabilities (update based on your data)
  rework_rates:
    quality_changes: 0.05     # 5%
    test_failures: 0.03       # 3%
    arch_revision: 0.02       # 2%
```

## Limitations

- Prediction is an estimate based on patterns
- Actual cost may vary by ±20%
- Cannot predict external dependencies
- Assumes standard workflow (no custom syncs)
- Works best with historical provenance data

## Advanced Usage

### Compare Multiple Approaches

```bash
/predict-cost "Add OAuth using passport.js"
# Predicted: ~$0.032

/predict-cost "Add OAuth with custom implementation"
# Predicted: ~$0.045 (higher risk = more rework)

# Compare to make informed decision
```

### Track Prediction Accuracy

```bash
# After implementing a feature
/costs --compare story-001

# Shows:
# Predicted: ~$0.032
# Actual:    $0.029
# Accuracy:  91%
```

## See Also

- `/costs` - View actual costs after implementation
- `/trace` - See complete workflow with costs
- `/workflow` - Alternative entry point with prediction
