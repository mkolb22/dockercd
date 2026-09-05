View and analyze reasoning chains from architecture decisions.

This command provides visibility into the Chain-of-Thought reasoning process
used by the architecture concept.

## Usage

```
/reasoning <arch-id>           - View reasoning chain for an architecture
/reasoning compare <id1> <id2> - Compare reasoning between two architectures
/reasoning stats               - Show reasoning mode usage statistics
/reasoning modes               - Display available reasoning modes
```

## Examples

### View Reasoning Chain

```
/reasoning arch-001
```

Output:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Reasoning Chain: arch-001
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Mode: standard (5 steps)
Method: linear
Model: sonnet
Confidence: 0.95

Step 1: Understand Requirements (450 tokens, 1.2s)
├─ Requirements: User authentication, Social login
└─ Constraints: Must integrate with existing session

Step 2: Explore Approaches (800 tokens, 2.1s)
├─ Approach 1: OAuth2 with Passport.js
├─ Approach 2: Custom OAuth2 implementation
└─ Approach 3: SAML with passport-saml

Step 3: Evaluate Trade-offs (600 tokens, 1.5s)
├─ OAuth2 + Passport: 8.5/10 (selected)
├─ Custom OAuth2: 3.2/10
└─ SAML: 5.1/10

Step 4: Decide (350 tokens, 0.9s)
├─ Selected: OAuth2 with Passport.js
├─ Confidence: 0.95
└─ Rationale: Battle-tested, team familiarity

Step 5: Design (500 tokens, 1.3s)
├─ Components: 3
├─ Interfaces: 2
└─ Data flow steps: 8

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total: 2,700 tokens | 7.0s | $0.005
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### View Deep Tree-of-Thought

```
/reasoning arch-cot-001
```

Output:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Reasoning Chain: arch-cot-001
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Mode: deep (10 steps)
Method: tree_of_thought
Model: opus
Confidence: 0.92

Phase 1: Deep Understanding (3 steps)
├─ Step 1: Decompose → 4 sub-problems identified
├─ Step 2: Requirements → analyzed
└─ Step 3: Constraints → mapped

Phase 2: Tree-of-Thought Exploration (3 steps)
│
├─ Branch 1: Structured Output (score: 8.0)
│   ├─ b1.1: Single-call variant (8.5) ✓ SELECTED
│   └─ b1.2: Multi-call variant (7.2) ✗ pruned
│
├─ Branch 2: Step-by-Step (score: 3.0) ✗ pruned
│   └─ Reason: 5-20x cost increase
│
└─ Branches pruned: 3 | Final depth: 3

Phase 3: Decision (2 steps)
├─ Risk analysis completed
└─ Final: Dual-Mode Reasoning (confidence: 0.92)

Phase 4: Design (2 steps)
├─ Architecture, Integration points

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total: 6,500 tokens | 20.0s | $0.015
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Compare Architectures

```
/reasoning compare arch-001 arch-002
```

Output:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Reasoning Comparison
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

                    arch-001        arch-002
Mode:               standard        deep
Steps:              5               10
Model:              sonnet          opus
Tokens:             2,700           6,500
Duration:           7.0s            18.5s
Cost:               $0.005          $0.015
Confidence:         0.95            0.97
Approaches:         3               5

Key Differences:
- arch-002 explored 2 more approaches
- arch-002 used Opus for deeper trade-off analysis
- arch-002 has higher confidence (+0.02)
- arch-002 cost 3x more but may prevent rework
```

### View Statistics

```
/reasoning stats
```

Output:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Reasoning Mode Statistics
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Mode Usage (last 30 days):
├─ quick:      12 (25%)  avg: $0.003, 3.2s
├─ standard:   28 (58%)  avg: $0.005, 7.8s
└─ deep:        8 (17%)  avg: $0.015, 19.2s

Total architectures: 48
Average confidence: 0.93
Total cost: $0.31

Auto-Mode Selection Accuracy:
├─ Correct mode selected: 45/50 (90%)
├─ Under-estimated: 3 (resulted in rework)
└─ Over-estimated: 2 (higher cost than needed)

Recommendations:
- Consider using 'deep' for authentication features
- 'quick' mode worked well for UI-only changes
```

### Display Available Modes

```
/reasoning modes
```

Output:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Available Reasoning Modes
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Mode          Steps   Model    Method          Cost      Use Case
──────────────────────────────────────────────────────────────────
quick         3       sonnet   linear          ~$0.003   Simple features, quick fixes
standard      5       sonnet   linear          ~$0.005   Typical features (default)
deep          10      opus     tree_of_thought ~$0.015   Complex features, critical decisions

Mode Selection:
1. Explicit prefix: /workflow deep "..."
2. Story tags: critical, security → deep
3. Keywords: distributed, migration → deep
4. Default: standard

Configuration: .claude/config/reasoning-modes.yaml
```

## Implementation

When invoked, this command:

1. **View reasoning chain**:
   - Read `koan/architecture/arch-{id}.yaml`
   - Extract `reasoning_chain` section
   - Format as hierarchical tree view
   - Show tokens/timing per step
   - For deep mode: render tree-of-thought exploration with pruning

2. **Compare architectures**:
   - Read both architecture files
   - Compare mode, steps, tokens, cost, confidence
   - Identify key differences in reasoning approach
   - Suggest which mode was more appropriate

3. **Show statistics**:
   - Scan all `koan/architecture/arch-*.yaml` files
   - Aggregate by reasoning mode
   - Calculate averages and distributions
   - Analyze auto-mode selection accuracy
   - Generate recommendations

4. **Display modes**:
   - Read `.claude/config/reasoning-modes.yaml`
   - Format mode table with costs
   - Show selection priority rules

## Related Commands

- `/workflow` - Execute workflow with reasoning mode
- `/trace` - View full provenance chain
- `/costs` - Cost analysis including reasoning costs
