---
name: Cost Optimization
description: Expert strategies for optimizing AI model costs in Dragonfly WYSIWID workflows through smart model selection and efficient execution
version: 1.0.0
trigger_keywords: [cost, budget, haiku, sonnet, optimization, tokens, spending, efficiency]
author: Dragonfly Architecture
---

# Cost Optimization - Expert Skill

Master strategies for minimizing AI costs while maintaining quality in Dragonfly workflows.

## The Dragonfly Cost Philosophy

**Smart Model Assignment**: Use the right model for the right task
- **Opus**: Fast, cheap ($0.00025 input, $0.00125 output per 1K tokens)
- **Opus**: Deep reasoning ($0.003 input, $0.015 output per 1K tokens)

**Key Insight**: Opus is 6x more expensive than Opus, but only needed for 1/6 of tasks.

## Dragonfly's Default Model Strategy

### Architecture (Opus) - 91% of Cost
**Why Opus**:
- Complex trade-off analysis
- Multi-step reasoning
- Novel problem solving
- Pattern synthesis across domains
- Risk evaluation

**Cost**: ~$0.015 per action
**Justification**: Poor architecture costs far more in rework

### Everything Else (Opus) - 9% of Cost
**Why Opus**:
- Story: Template filling, validation
- Implementation: Code from clear specs
- Quality: Pattern matching, rule checking
- Version: Git command execution
- Context: Token counting, compression

**Cost**: ~$0.000175 per action
**Justification**: These tasks don't require deep reasoning

## Cost Breakdown per Feature

```
Typical Feature Workflow:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Story (Opus):         $0.000175  (1%)
Architecture (Opus): $0.015000  (91%) ⭐
Implementation (Opus):$0.000175  (1%)
Quality x2 (Opus):    $0.000350  (2%)
Version (Opus):       $0.000175  (1%)
Context (Opus):       $0.000175  (1%)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total:                 $0.0165

vs All-Opus:         $0.099
Savings:               83%
```

**Key Takeaway**: Architecture is expensive but necessary. The other 9 concepts achieve cost efficiency by using Opus.

## When to Use Each Model

### Use Opus When:
✅ Evaluating multiple approaches with complex trade-offs
✅ Designing novel solutions (no existing patterns)
✅ Predicting long-term consequences
✅ Synthesizing patterns from different domains
✅ Making architectural decisions
✅ Analyzing security implications
✅ Evaluating risks and mitigations

### Use Opus When:
✅ Following clear specifications
✅ Applying known patterns
✅ Generating code from templates
✅ Validating against rules
✅ Executing commands
✅ Counting or measuring
✅ Pattern matching
✅ CRUD operations

### Signs You're Using Wrong Model:

**Opus Overuse** (wasting money):
- Simple validation tasks
- Template filling
- Command execution
- Straightforward code generation

**Opus Underuse** (poor quality):
- Complex architectural decisions
- Novel problem solving
- Deep trade-off analysis
- High-risk designs

## Cost Optimization Strategies

### 1. Batch Operations

**Expensive**:
```bash
for each file:
    invoke concept  # 5 separate calls
```
Cost: 5 × $0.000175 = $0.000875

**Optimized**:
```bash
invoke concept with all files  # 1 call
```
Cost: 1 × $0.000175 = $0.000175
**Savings: 80%**

### 2. Progressive Detail

**Expensive**:
```bash
# Load everything upfront
Read entire codebase
Invoke architecture with full context
```
Cost: Large context = higher input tokens

**Optimized**:
```bash
# Load incrementally
Read summaries first
Get details only if needed
```
Cost: Smaller context = lower input tokens
**Savings: 30-50%**

### 3. Caching Results

**Expensive**:
```bash
# Regenerate every time
/feature "Add OAuth"  # Architecture from scratch
```

**Optimized**:
```bash
# Reuse when possible
Check if similar architecture exists
Adapt rather than regenerate
```
**Savings: Variable, up to 90%**

### 4. Concept Reuse

**Expensive**:
```bash
# Custom concept for each domain
user-auth-story
api-auth-story
oauth-story
```

**Optimized**:
```bash
# Polymorphic concept
story (works for all authentication types)
```
**Savings: Maintenance cost, not immediate**

### 5. Sync Optimization

**Expensive**:
```yaml
# Trigger architecture for every story
- when: {concept: story, status: completed}
  then: {concept: architecture}  # No conditions
```

**Optimized**:
```yaml
# Only trigger when ready
- when: {concept: story, status: completed}
  where: "story.status == 'ready' AND story.complexity > 'low'"
  then: {concept: architecture}
```
**Savings: Skip unnecessary architecture for simple stories**

## Token Management

### Input Token Optimization

**Sources of Input Tokens**:
1. Concept documentation (~2-5K tokens)
2. Previous context (~10-20K tokens)
3. State files (~1-5K tokens per file)
4. Synchronization rules (~1-2K tokens)

**Optimization Strategies**:
```bash
# ❌ Load everything
Read all stories
Read all architectures
Read all implementations

# ✅ Load selectively
Read only latest story
Read only relevant architecture
Skip completed implementations
```

### Output Token Optimization

**Verbose Output** (expensive):
```yaml
# 2000 tokens of detailed explanation
story_id: "story-001"
title: "Add OAuth"
description: |
  [500 lines of detailed explanation]
  [Examples]
  [Edge cases]
  ...
```

**Concise Output** (optimized):
```yaml
# 200 tokens of essential info
story_id: "story-001"
title: "Add OAuth"
description: "OAuth2 with Google/GitHub providers"
acceptance_criteria: [9 items]
status: "ready"
```
**Savings: 90% on output tokens**

## Budget Management

### Setting Budgets

**Project Level**:
```yaml
# .claude/config.yaml
cost_optimization:
  daily_budget: 1.00  # $1/day
  weekly_budget: 5.00  # $5/week
  alert_threshold: 0.80  # Alert at 80%
```

**Feature Level**:
```bash
Expected cost per feature: $0.015-0.025
Features per dollar: 40-65
```

**Workflow Level**:
```bash
Story:          $0.000175
Architecture:   $0.015 (most expensive)
Implementation: $0.000175
Quality:        $0.00035 (2 actions)
Version:        $0.000175
```

### Tracking Spending

**Query Provenance**:
```bash
# Total spend
grep 'cost_usd:' data/provenance/actions/*.yaml | \
awk '{sum += $2} END {printf "Total: $%.4f\n", sum}'

# By concept
grep -h 'concept:\|cost_usd:' data/provenance/actions/*.yaml | \
awk '/concept:/ {c=$2} /cost_usd:/ {sum[c]+=$2} \
END {for(c in sum) printf "%s: $%.4f\n", c, sum[c]}'

# By model
grep -h 'model:\|cost_usd:' data/provenance/actions/*.yaml | \
awk '/model:/ {m=$2} /cost_usd:/ {sum[m]+=$2} \
END {for(m in sum) printf "%s: $%.4f\n", m, sum[m]}'
```

**Use `/costs` Command**:
```bash
/costs                  # All-time summary
/costs --last-week      # Last 7 days
/costs --by-concept     # Breakdown by concept
/costs --by-flow        # Breakdown by flow
```

## Cost-Quality Trade-offs

### When to Invest in Opus

**Scenario 1: New Domain**
```bash
First feature in new domain → Use Opus for architecture
Subsequent features → Can reuse patterns with Opus
```
**ROI**: Upfront investment, long-term savings

**Scenario 2: High-Risk Features**
```bash
Security-critical features → Use Opus
Routine CRUD operations → Use Opus
```
**ROI**: Prevent costly security vulnerabilities

**Scenario 3: Novel Problems**
```bash
No existing solution → Use Opus
Adapting known solution → Use Opus
```
**ROI**: Better design worth the cost

### When to Stick with Opus

**Scenario 1: Clear Specifications**
```bash
Architecture already defined → Opus for implementation
Tests already written → Opus for code
```

**Scenario 2: Repetitive Tasks**
```bash
Similar to previous features → Opus throughout
Known patterns → Opus throughout
```

**Scenario 3: Low Complexity**
```bash
Simple CRUD operations → Opus
Minor bug fixes → Opus
Documentation updates → Opus
```

## ROI Analysis

### Cost of Poor Architecture

**Scenario**: Skip Opus, use Opus for architecture

```bash
Opus architecture:  $0.000175
Rework cycle 1:      $0.000175
Rework cycle 2:      $0.000175
Rework cycle 3:      $0.000175
Engineer time:       $50-100/hour
Final fix:           $0.000175
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total: $0.001 + engineer time

vs

Opus architecture: $0.015
Gets it right first time
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total: $0.015

Savings: Engineer time (~$50-100)
```

**Conclusion**: Opus for architecture is cost-effective.

### Cost of Opus Overuse

**Scenario**: Use Opus for everything

```bash
Story (Opus):          $0.0087  (vs $0.000175)
Architecture (Opus):   $0.0150  (appropriate)
Implementation (Opus): $0.0087  (vs $0.000175)
Quality (Opus):        $0.0174  (vs $0.000350)
Version (Opus):        $0.0087  (vs $0.000175)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total: $0.0585 vs $0.0165

Waste: $0.0420 per feature (254% more)
```

**Conclusion**: Use Opus where appropriate.

## Monitoring and Alerts

### Cost Anomaly Detection

**Normal Pattern**:
```bash
Story: $0.000175
Arch:  $0.015
Impl:  $0.000175
```

**Anomaly**:
```bash
Story: $0.000175
Arch:  $0.045  # ⚠️ 3x higher
Impl:  $0.000175
```

**Investigation**:
- Was architecture more complex?
- Did it require multiple iterations?
- Was context unnecessarily large?

### Budget Alerts

**Pre-Action Alert**:
```bash
# Before invoking concept
Current spend: $0.85
Budget: $1.00
This action: ~$0.015
Projected: $0.865 (86% of budget)
```

**Post-Action Alert**:
```bash
# After concept completes
Spend: $0.90 (90% of budget)
Remaining: $0.10
⚠️ Approaching budget limit
```

## Best Practices Summary

### Model Selection
1. ✅ Default to Opus unless deep reasoning needed
2. ✅ Use Opus for architecture and high-risk decisions
3. ✅ Track actual costs to validate assumptions
4. ❌ Don't use Opus for routine tasks
5. ❌ Don't use Opus for novel/complex problems

### Token Management
1. ✅ Load context progressively (summaries → details)
2. ✅ Generate concise outputs
3. ✅ Batch operations when possible
4. ❌ Don't load entire codebase at once
5. ❌ Don't generate verbose documentation

### Budget Control
1. ✅ Set daily/weekly budgets
2. ✅ Monitor spending with `/costs`
3. ✅ Alert at 80% threshold
4. ✅ Analyze anomalies
5. ❌ Don't ignore cost trends

### Quality Balance
1. ✅ Invest in Opus for architecture
2. ✅ Use Opus for implementation from specs
3. ✅ Measure ROI (cost vs rework)
4. ❌ Don't skimp on critical decisions
5. ❌ Don't overspend on simple tasks

## Tools and Commands

### Cost Analysis
```bash
/costs                   # View all spending
/costs --by-concept      # See which concepts cost most
/costs --by-model        # Opus vs Opus breakdown
/costs --efficiency      # Savings percentage
```

### Provenance Queries
```bash
/trace <flow-id>         # See complete workflow costs
grep 'cost_usd' data/provenance/actions/*.yaml  # Raw cost data
```

### Budget Monitoring
```bash
# In .claude/config.yaml
cost_optimization:
  track_costs: true
  alert_threshold: 0.80
  daily_budget: 1.00
```

---

**Use this skill when**: Planning workflows, selecting models, analyzing costs, setting budgets, investigating spending anomalies, or optimizing for cost efficiency.
