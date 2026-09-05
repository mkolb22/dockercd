---
name: Provenance Analysis
description: Expert techniques for querying, analyzing, and understanding provenance data to trace workflows, debug issues, and optimize costs
version: 1.0.0
trigger_keywords: [provenance, trace, flow, action, triggered_by, debugging, audit, history]
author: Zen Architecture
---

# Provenance Analysis - Expert Skill

Master the art of querying and analyzing provenance data to understand workflow execution, debug issues, and optimize system behavior.

## What is Provenance?

**Definition**: Complete audit trail tracking every action, its cause, cost, and outcome.

**Purpose**:
- **Traceability**: Every action links to its trigger
- **Debuggability**: Understand why things happened
- **Cost Attribution**: Track spending per feature
- **Auditing**: Complete history for compliance
- **Optimization**: Identify bottlenecks and inefficiencies

## Provenance Structure

### Action-Level Provenance

```yaml
# koan/provenance/actions/act-001.yaml
action_id: "act-001"
timestamp: "2025-11-09T22:00:00Z"
concept: "story"
model: "sonnet"
action: "create"
status: "completed"

# Workflow tracking
triggered_by: null  # User-initiated (no parent)
sync_id: null  # Not triggered by sync
flow_id: "flow-2025-11-09-22h00m00s"

# Cost tracking
cost:
  input_tokens: 1200
  output_tokens: 450
  cost_usd: 0.000175
  model_used: "sonnet"

# Context
git_branch: "feature/story-001-oauth"
git_commit: "abc123def"

# Outputs
outputs:
  story_id: "story-001"
  status: "ready"
```

### Flow-Level Provenance

```yaml
# koan/provenance/flows/flow-2025-11-09-22h00m00s.yaml
flow_id: "flow-2025-11-09-22h00m00s"
initiated_at: "2025-11-09T22:00:00Z"
initiated_by: "user"
status: "completed"
completed_at: "2025-11-09T22:18:30Z"
duration_seconds: 1110

actions:
  - action_id: "act-001"
    concept: "story"
    cost: 0.000175
  - action_id: "act-002"
    concept: "architecture"
    cost: 0.015
  - action_id: "act-003"
    concept: "implementation"
    cost: 0.000175
  # ...

total_cost: 0.0165
total_actions: 6
concepts_used: ["story", "architecture", "implementation", "quality", "version"]
models_used: {"sonnet": 5, "sonnet": 1}
```

## Basic Provenance Queries

### 1. Find All Actions

```bash
ls koan/provenance/actions/
# act-001.yaml
# act-002.yaml
# act-003.yaml
# ...
```

### 2. Find Latest Action

```bash
ls -t koan/provenance/actions/ | head -n 1
# act-042.yaml (most recent)
```

### 3. Find Actions by Concept

```bash
grep -l 'concept: "story"' koan/provenance/actions/*.yaml
# Lists all story actions
```

### 4. Find Actions in Flow

```bash
grep -l 'flow_id: "flow-2025-11-09"' koan/provenance/actions/*.yaml
# All actions in that flow
```

### 5. Calculate Total Cost

```bash
grep 'cost_usd:' koan/provenance/actions/*.yaml | \
awk '{sum += $2} END {printf "Total: $%.4f\n", sum}'
```

## Advanced Provenance Queries

### Trace Complete Workflow

**Goal**: Follow triggered_by chain from end to start

```bash
# Start with final action
action="act-006"

while [ -n "$action" ]; do
  echo "Action: $action"
  grep -h "action_id:\|concept:\|triggered_by:" \
    koan/provenance/actions/${action}.yaml

  # Get parent action
  action=$(grep 'triggered_by:' \
           koan/provenance/actions/${action}.yaml | \
           awk '{print $2}' | sed 's/"//g')

  [ "$action" = "null" ] && break
  echo "  ↑"
done
```

**Output**:
```
Action: act-006 (version.commit)
  ↑
Action: act-005 (quality.test)
  ↑
Action: act-003 (implementation.generate)
  ↑
Action: act-002 (architecture.design)
  ↑
Action: act-001 (story.create)
  ↑
(user-initiated)
```

### Cost by Concept

```bash
# Aggregate costs by concept
grep -h 'concept:\|cost_usd:' koan/provenance/actions/*.yaml | \
awk '
  /concept:/ {concept=$2; gsub(/"/, "", concept)}
  /cost_usd:/ {costs[concept] += $2}
  END {
    for (c in costs) {
      printf "%s: $%.4f\n", c, costs[c]
    }
  }
' | sort -t: -k2 -nr
```

**Output**:
```
architecture: $0.2250  (91%)
quality: $0.0105  (4%)
story: $0.0026  (1%)
implementation: $0.0026  (1%)
version: $0.0017  (1%)
context: $0.0003  (<1%)
```

### Cost by Model

```bash
grep -h 'model:\|cost_usd:' koan/provenance/actions/*.yaml | \
awk '
  /^model:/ {model=$2; gsub(/"/, "", model)}
  /cost_usd:/ {costs[model] += $2}
  END {
    total = 0
    for (m in costs) total += costs[m]
    for (m in costs) {
      pct = (costs[m] / total) * 100
      printf "%s: $%.4f (%.0f%%)\n", m, costs[m], pct
    }
  }
'
```

**Output**:
```
sonnet: $0.2250 (91%)
sonnet: $0.0227 (9%)
```

### Actions per Day

```bash
for date in $(ls koan/provenance/actions/*.yaml | \
              sed 's/.*\/act-//;s/\.yaml//' | \
              cut -d- -f1-3 | sort -u); do
  count=$(grep -l "timestamp.*$date" \
          koan/provenance/actions/*.yaml | wc -l)
  echo "$date: $count actions"
done
```

### Failed Actions

```bash
grep -l 'status: "failed"' koan/provenance/actions/*.yaml | \
while read file; do
  echo "=== $(basename $file) ==="
  grep -A5 'status: "failed"' "$file"
done
```

### Synchronization Triggers

```bash
# Which syncs triggered most often
grep 'sync_id:' koan/provenance/actions/*.yaml | \
awk '{print $2}' | sort | uniq -c | sort -nr
```

**Output**:
```
15 story-to-arch
12 arch-to-impl
12 impl-to-quality-review
12 impl-to-quality-test
10 quality-to-version
```

## Using /trace Command

### Trace by Story ID

```bash
/trace story-001
```

**Shows**:
- All actions for that story
- Cost breakdown
- Duration
- Synchronization triggers
- Status of each phase

### Trace by Flow ID

```bash
/trace flow-2025-11-09-22h00m00s
```

**Shows**:
- Complete workflow from start to finish
- Triggered_by chains
- Parallel executions
- Total cost and time

### Trace by Action ID

```bash
/trace act-002
```

**Shows**:
- This action's details
- What triggered it
- What it triggered
- Cost and model used

## Debugging with Provenance

### Scenario 1: Workflow Stopped Unexpectedly

**Symptoms**: Feature incomplete, no error message

**Investigation**:
```bash
# 1. Find last action
ls -t koan/provenance/actions/ | head -n 1
# act-003.yaml

# 2. Check its status
grep 'status:' koan/provenance/actions/act-003.yaml
# status: "completed"

# 3. Check what should trigger next
grep 'sync_id:' koan/provenance/actions/act-003.yaml
# sync_id: null (manually invoked, no auto-trigger)

# 4. Check synchronization rules
grep -A10 "when:.*implementation" \
  .claude/synchronizations/feature-development.yaml
```

**Root Cause**: Synchronization rule didn't match (e.g., where condition failed)

**Fix**: Check implementation output status, adjust sync rule, or trigger manually

### Scenario 2: Unexpected Cost Spike

**Symptoms**: Daily budget exceeded

**Investigation**:
```bash
# 1. Find today's actions
today=$(date +%Y-%m-%d)
grep -l "timestamp.*$today" koan/provenance/actions/*.yaml | \
while read file; do
  grep -h 'concept:\|cost_usd:' "$file"
done | awk '
  /concept:/ {c=$2}
  /cost_usd:/ {printf "%s: $%.4f\n", c, $2}
'
```

**Output**:
```
architecture: $0.0450  # ⚠️ 3x normal
story: $0.0002
implementation: $0.0002
```

**Root Cause**: Architecture action cost 3x normal

**Investigation Continues**:
```bash
# 2. Find the expensive architecture action
grep -l 'concept: "architecture"' koan/provenance/actions/*.yaml | \
while read file; do
  cost=$(grep 'cost_usd:' "$file" | awk '{print $2}')
  if (( $(echo "$cost > 0.02" | bc -l) )); then
    echo "$file: $cost"
    grep 'input_tokens:\|output_tokens:' "$file"
  fi
done
```

**Output**:
```
act-042.yaml: 0.045
input_tokens: 45000  # ⚠️ Unusually high
output_tokens: 5000
```

**Root Cause**: Large input context (45K tokens vs normal 25K)

**Fix**: Investigate why context was so large, optimize input

### Scenario 3: Sync Not Triggering

**Symptoms**: Expected workflow step didn't happen

**Investigation**:
```bash
# 1. Check last completed action
last=$(ls -t koan/provenance/actions/ | head -n 1)
grep 'concept:\|action:\|status:' koan/provenance/actions/$last
```

**Output**:
```
concept: "architecture"
action: "design"
status: "completed"
```

**Expected**: Implementation should trigger via arch-to-impl sync

**Investigation Continues**:
```bash
# 2. Read the sync rule
grep -A15 'id: "arch-to-impl"' \
  .claude/synchronizations/feature-development.yaml
```

**Output**:
```yaml
where:
  query: |
    architecture.decisions.length > 0 AND
    architecture.estimated_risk != 'high'
```

**Investigation Continues**:
```bash
# 3. Check architecture output
arch_id=$(grep 'architecture_id:' koan/provenance/actions/$last | \
          awk '{print $2}' | sed 's/"//g')
grep 'estimated_risk:' koan/architecture/${arch_id}.yaml
```

**Output**:
```
estimated_risk: "high"
```

**Root Cause**: Risk was high, so sync rule didn't match (as designed)

**Fix**: Review architecture, mitigate risks, or manually trigger implementation

## Cost Attribution

### Cost per Feature

```bash
# Group by flow_id (feature)
for flow in $(grep 'flow_id:' koan/provenance/flows/*.yaml | \
              awk '{print $2}' | sed 's/"//g' | sort -u); do
  cost=$(grep -h "flow_id: \"$flow\"" koan/provenance/actions/*.yaml | \
         head -n 1 | xargs -I{} dirname {} | xargs -I{} basename {} | \
         xargs -I{} grep -h 'cost_usd:' koan/provenance/actions/*.yaml | \
         awk '{sum += $2} END {print sum}')
  story=$(grep "flow_id: \"$flow\"" koan/provenance/actions/*.yaml | \
          head -n 1 | xargs dirname | xargs basename | \
          xargs -I{} grep 'story_id:' koan/provenance/actions/{} | \
          awk '{print $2}')
  echo "$story: \$$cost"
done
```

### Cost per Engineer

If provenance tracks user:

```bash
grep -h 'initiated_by:\|total_cost:' koan/provenance/flows/*.yaml | \
awk '
  /initiated_by:/ {user=$2; gsub(/"/, "", user)}
  /total_cost:/ {costs[user] += $2}
  END {
    for (u in costs) printf "%s: $%.2f\n", u, costs[u]
  }
'
```

### Cost per Time Period

```bash
# By week
for week in $(seq 1 52); do
  year=2025
  start=$(date -j -f "%Y %U %u" "$year $week 1" "+%Y-%m-%d" 2>/dev/null)
  [ $? -ne 0 ] && continue

  cost=$(grep "timestamp.*$year-.*-$start" \
         koan/provenance/actions/*.yaml | \
         xargs -I{} grep 'cost_usd:' {} | \
         awk '{sum += $2} END {print sum}')

  [ -n "$cost" ] && echo "Week $week ($start): \$$cost"
done
```

## Performance Analysis

### Average Duration per Concept

```bash
# Requires timestamps in provenance
grep -h 'concept:\|duration_ms:' koan/provenance/actions/*.yaml | \
awk '
  /concept:/ {c=$2; gsub(/"/, "", c)}
  /duration_ms:/ {
    durations[c] += $2
    counts[c]++
  }
  END {
    for (c in durations) {
      avg = durations[c] / counts[c]
      printf "%s: %.0fms (avg of %d actions)\n", c, avg, counts[c]
    }
  }
' | sort -t: -k2 -n
```

### Bottleneck Identification

```bash
# Find slowest actions
grep -h 'action_id:\|duration_ms:' koan/provenance/actions/*.yaml | \
awk '
  /action_id:/ {id=$2}
  /duration_ms:/ {printf "%s: %dms\n", id, $2}
' | sort -t: -k2 -nr | head -n 10
```

### Parallel vs Sequential Analysis

```bash
# Find actions with same parent (parallel execution)
for parent in $(grep 'triggered_by:' koan/provenance/actions/*.yaml | \
                awk '{print $2}' | sed 's/"//g' | sort | uniq -c | \
                awk '$1 > 1 {print $2}'); do
  echo "Parallel from $parent:"
  grep -l "triggered_by: \"$parent\"" koan/provenance/actions/*.yaml | \
  while read file; do
    grep 'concept:\|action:' "$file" | tr '\n' ' '
    echo
  done
done
```

## Provenance Best Practices

### 1. Always Log Actions

```bash
# In post-concept-action hook
cat > koan/provenance/actions/${ACTION_ID}.yaml << EOF
action_id: "$ACTION_ID"
timestamp: "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
concept: "$CONCEPT"
# ... all required fields
EOF
```

### 2. Use Consistent IDs

```bash
# Action IDs
act-$(date +%s)

# Flow IDs
flow-$(date +%Y-%m-%d-%Hh%Mm%Ss)
```

### 3. Track Sync Triggers

```bash
# Always record which sync triggered action
sync_id: "story-to-arch"
triggered_by: "act-001"
```

### 4. Include Context

```bash
# Git context
git_branch: "$(git rev-parse --abbrev-ref HEAD)"
git_commit: "$(git rev-parse HEAD)"

# Environment
claude_version: "..."
zen_version: "1.0.0"
```

### 5. Archive Old Provenance

```bash
# Move old actions to archive
find koan/provenance/actions/ -name "*.yaml" -mtime +90 \
  -exec mv {} koan/provenance/archive/ \;
```

## Tools and Commands

### Built-in Commands

```bash
/trace <id>              # Trace story, flow, or action
/costs                   # View cost analysis
/costs --by-concept      # Cost breakdown by concept
/costs --by-flow         # Cost per feature
```

### Shell Scripts

```bash
# Find expensive actions
grep 'cost_usd:' koan/provenance/actions/*.yaml | \
sort -t: -k3 -nr | head -n 10

# Find failed actions
grep -l 'status: "failed"' koan/provenance/actions/*.yaml

# Count actions by concept
grep 'concept:' koan/provenance/actions/*.yaml | \
awk '{print $2}' | sort | uniq -c
```

---

**Use this skill when**: Debugging workflows, analyzing costs, tracing actions, identifying bottlenecks, auditing system behavior, or investigating anomalies.
