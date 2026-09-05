---
name: Batch Processing
description: Process multiple similar operations together for 3x speedup and reduced overhead
version: 1.0.0
trigger_keywords: [batch, bulk, multiple, parallel, group, aggregate]
author: Dragonfly Architecture
---

# Batch Processing - Expert Skill

Process multiple similar operations together to reduce overhead, improve throughput, and optimize resource usage.

## Purpose

Batch processing provides:
- **3x faster execution**: Process 10 items in time of 3-4 individual items
- **Reduced overhead**: Setup cost amortized across batch
- **Better resource utilization**: Single context, multiple outputs
- **Parallelization opportunities**: Process independent items concurrently

## When to Use

Use batch processing:
- ✅ Multiple features ready for same concept
- ✅ Bulk validation of outputs
- ✅ Mass sync rule evaluation
- ✅ Multiple similar transformations
- ✅ Parallel quality checks

## Batch Patterns

### Pattern 1: Batch Validation

**Single Validation** (slow):
```bash
# Validate 10 outputs individually
for output in outputs:
    validate(output)  # 100ms each

Total: 10 × 100ms = 1,000ms
```

**Batch Validation** (fast):
```bash
# Validate all outputs in one operation
validate_batch(outputs)  # 300ms total

Total: 300ms
Speedup: 3.3x faster
```

**Implementation**:
```python
def validate_batch(outputs):
    """
    Validate multiple concept outputs in batch.

    Args:
        outputs: List of (concept_id, file_path) tuples

    Returns:
        List of validation results
    """
    # Load all schemas once
    schemas = load_schemas()  # 50ms

    # Validate in parallel
    results = []
    for concept_id, file_path in outputs:
        schema = schemas[concept_type(concept_id)]
        result = validate_file(file_path, schema)  # 25ms each
        results.append(result)

    return results

# vs individual validation:
# load_schema() × 10 = 500ms
# validate_file() × 10 = 250ms
# Total: 750ms

# Batch:
# load_schema() × 1 = 50ms
# validate_file() × 10 = 250ms
# Total: 300ms
# Savings: 450ms (60%)
```

### Pattern 2: Batch Concept Execution

**Sequential Execution** (slow):
```bash
# Create 5 stories sequentially
for story in story_requests:
    invoke_concept("story", story)  # 2min each

Total: 5 × 2min = 10 minutes
```

**Batch Execution** (fast):
```bash
# Process all stories in batch
batch_invoke_concept("story", story_requests)  # 4min total

Total: 4 minutes
Speedup: 2.5x faster
```

**Implementation**:
```yaml
# Batch story creation
concept: story
action: create_batch
inputs:
  stories:
    - {title: "Add OAuth", description: "..."}
    - {title: "Add 2FA", description: "..."}
    - {title: "Add SSO", description: "..."}

# Shared context loaded once:
# - Existing user model
# - Authentication patterns
# - Test patterns
# - Documentation style

# Then generate all stories with shared context
# Amortized setup cost: 30 seconds
# Individual story generation: 30 seconds each
# Total: 30s + (5 × 30s) = 3 minutes
# vs Sequential: 5 × (30s + 30s) = 5 minutes
```

### Pattern 3: Parallel Processing

**Sequential Processing** (slow):
```bash
# Review and test sequentially
review(impl-001)  # 2min
test(impl-001)    # 2min

Total: 4 minutes
```

**Parallel Processing** (fast):
```bash
# Review and test concurrently
parallel:
  - review(impl-001)  # 2min
  - test(impl-001)    # 2min

Total: 2 minutes (both run simultaneously)
Speedup: 2x faster
```

**Implementation** (from Phase 1 Day 5):
```yaml
# Already implemented in synchronization rules
synchronizations:
  - id: "impl-to-quality-review"
    then:
      - concept: "quality"
        action: "review"
        parallel: true

  - id: "impl-to-quality-test"
    then:
      - concept: "quality"
        action: "test"
        parallel: true
```

### Pattern 4: Batch Sync Evaluation

**Individual Evaluation** (slow):
```bash
# Check each feature individually
for feature in features:
    evaluate_sync_rules(feature)  # 450ms each (with cache)

Total: 10 × 450ms = 4,500ms (4.5 seconds)
```

**Batch Evaluation** (fast):
```bash
# Evaluate all features together
batch_evaluate_sync_rules(features)  # 1,500ms total

Total: 1,500ms (1.5 seconds)
Speedup: 3x faster
```

**Implementation**:
```python
def batch_evaluate_sync_rules(feature_ids):
    """
    Evaluate sync rules for multiple features in batch.

    Args:
        feature_ids: List of feature identifiers

    Returns:
        Dict of feature_id → matched rules
    """
    # Load all rules once
    rules = load_sync_rules()  # 100ms

    # Get all state files from cache (Phase 2 optimization)
    states = {
        fid: load_feature_states(fid)  # Uses cache
        for fid in feature_ids
    }

    # Evaluate all rules for all features
    results = {}
    for feature_id in feature_ids:
        results[feature_id] = evaluate_rules(
            rules,
            states[feature_id]
        )

    return results
```

## Batching Strategies

### When to Batch

**Good Candidates for Batching**:
- ✅ **Homogeneous operations**: All items need same processing
- ✅ **Independent items**: No dependencies between items
- ✅ **Shared setup cost**: Expensive initialization
- ✅ **High volume**: 5+ items to process
- ✅ **Same concept**: All use same model/configuration

**Poor Candidates for Batching**:
- ❌ **Heterogeneous operations**: Different processing per item
- ❌ **Dependent items**: Item N needs output of item N-1
- ❌ **Low volume**: 1-2 items
- ❌ **Different concepts**: Mixed models/configurations
- ❌ **Sequential requirements**: Order matters

### Batch Size Selection

```yaml
# Small batches (2-5 items)
- Fast feedback
- Lower memory usage
- Good for interactive work

# Medium batches (5-20 items)
- Balanced performance
- Optimal for most workflows
- Recommended default

# Large batches (20+ items)
- Maximum throughput
- Higher memory usage
- Good for bulk operations
- Risk of timeout/OOM
```

### Batch Execution Modes

**Mode 1: Fail-Fast**
```yaml
# Stop on first failure
mode: fail_fast

# Use when:
# - Dependencies between items
# - Must succeed in order
# - Early detection critical

Example:
  batch_create_stories([s1, s2, s3])
  → s1 succeeds
  → s2 fails (invalid input)
  → STOP (s3 not processed)
```

**Mode 2: Best-Effort**
```yaml
# Process all items, collect failures
mode: best_effort

# Use when:
# - Items independent
# - Want all results
# - Can handle partial success

Example:
  batch_create_stories([s1, s2, s3])
  → s1 succeeds
  → s2 fails (invalid input)
  → s3 succeeds
  → Return: [success, failure, success]
```

**Mode 3: All-or-Nothing**
```yaml
# Transactional: commit all or rollback
mode: transactional

# Use when:
# - Atomicity required
# - Partial success unacceptable
# - Can rollback changes

Example:
  batch_create_stories([s1, s2, s3])
  → s1 succeeds (temp)
  → s2 fails (invalid)
  → Rollback s1
  → Return: all failed
```

## Integration with Commands

### /sync --batch

Batch sync evaluation for multiple features:

```bash
# Check sync rules for all active features
/sync --batch

Output:
Feature   Matched Rules        Action
────────────────────────────────────────
story-001 story-to-arch       → Ready to design
story-002 story-to-arch       → Ready to design
story-003 none                → Waiting
arch-042  arch-to-impl (LOW)  → Ready to implement
arch-043  arch-to-impl (LOW)  → Ready to implement
impl-015  impl-to-quality     → Ready for review

Batch Actions:
  5 features ready for next step
  Process as batch? (yes/no): yes

Creating batch:
  ✓ Architecture batch: [story-001, story-002]
  ✓ Implementation batch: [arch-042, arch-043]
  ✓ Quality batch: [impl-015]

Processing...
  Architecture batch: 5min (vs 8min sequential)
  Implementation batch: 6min (vs 10min sequential)
  Quality batch: 2min

Total: 13min (vs 18min sequential)
Savings: 5 minutes (28% faster)
```

### /validate --batch

Batch validation of multiple outputs:

```bash
# Validate all story outputs
/validate --batch stories

Validating 10 stories...

Results:
  ✓ story-001  Valid
  ✓ story-002  Valid
  ✗ story-003  Invalid (2 errors)
     - story_id pattern mismatch
     - acceptance_criteria empty
  ✓ story-004  Valid
  ✓ story-005  Valid
  ✓ story-006  Valid
  ✓ story-007  Valid
  ✗ story-008  Invalid (1 error)
     - status not in enum
  ✓ story-009  Valid
  ✓ story-010  Valid

Summary:
  8 valid, 2 invalid
  Time: 300ms (vs 1,000ms individual)
  Speedup: 3.3x faster
```

### /quality --batch

Batch quality checks:

```bash
# Review and test multiple implementations
/quality --batch impl-015 impl-016 impl-017

Processing batch of 3 implementations...

Parallel execution:
  ⟳ Review:  impl-015, impl-016, impl-017  (3min)
  ⟳ Test:    impl-015, impl-016, impl-017  (3min)
  ⟳ Both complete simultaneously

Results:
  impl-015  ✓ Review: approved  ✓ Test: 18/18 passed
  impl-016  ✓ Review: approved  ✓ Test: 22/22 passed
  impl-017  ⚠ Review: 2 issues  ✓ Test: 15/15 passed

Total: 3min (vs 12min sequential reviews + tests)
Speedup: 4x faster
```

## Performance Impact

### Batch Validation

| Items | Individual | Batch | Speedup |
|-------|-----------|-------|---------|
| 1     | 100ms     | 100ms | 1x      |
| 5     | 500ms     | 250ms | 2x      |
| 10    | 1,000ms   | 300ms | 3.3x    |
| 20    | 2,000ms   | 400ms | 5x      |

### Batch Concept Execution

| Items | Individual | Batch | Speedup |
|-------|-----------|-------|---------|
| 2     | 4min      | 2.5min| 1.6x    |
| 5     | 10min     | 4min  | 2.5x    |
| 10    | 20min     | 8min  | 2.5x    |

### Batch Sync Evaluation (with cache)

| Features | Individual | Batch | Speedup |
|----------|-----------|-------|---------|
| 5        | 2.25s     | 1s    | 2.25x   |
| 10       | 4.5s      | 1.5s  | 3x      |
| 20       | 9s        | 2.5s  | 3.6x    |

## Best Practices

### 1. Identify Batch Opportunities

```yaml
# Look for patterns like:
for item in items:
    expensive_operation(item)

# Consider batching if:
# - expensive_operation has setup cost
# - items are independent
# - count > 3
```

### 2. Shared Context Loading

```yaml
# Load shared context once
context = load_context()  # Expensive

# Use for all items
for item in items:
    process(item, context)  # Cheap

# vs loading per item:
for item in items:
    context = load_context()  # Expensive × N
    process(item, context)
```

### 3. Error Handling

```yaml
# Collect all errors, don't stop early
results = []
errors = []

for item in items:
    try:
        result = process(item)
        results.append(result)
    except Exception as e:
        errors.append((item, e))

# Return both successes and failures
return {
    "results": results,
    "errors": errors
}
```

### 4. Progress Reporting

```yaml
# Show progress for large batches
total = len(items)
for i, item in enumerate(items):
    process(item)
    if i % 5 == 0:
        print(f"Progress: {i}/{total} ({i*100//total}%)")

# Output:
# Progress: 0/20 (0%)
# Progress: 5/20 (25%)
# Progress: 10/20 (50%)
# Progress: 15/20 (75%)
# Progress: 20/20 (100%)
```

### 5. Memory Management

```yaml
# For large batches, process in chunks
def process_large_batch(items, chunk_size=10):
    results = []

    for i in range(0, len(items), chunk_size):
        chunk = items[i:i+chunk_size]
        chunk_results = process_batch(chunk)
        results.extend(chunk_results)

        # Clear memory between chunks
        gc.collect()

    return results
```

## Troubleshooting

### Issue: Batch Slower Than Individual

**Problem**: Batch processing takes longer than individual

**Causes**:
- Setup cost low, per-item cost high
- Items not actually independent
- Overhead from batching logic

**Solution**:
```bash
# Measure components:
# - Setup: 50ms
# - Per-item: 200ms
# - Batch overhead: 100ms

# Individual (5 items): 5 × (50 + 200) = 1,250ms
# Batch: 50 + 100 + (5 × 200) = 1,150ms
# Savings: 100ms (8%)

# If savings < 20%, don't batch
```

### Issue: Some Items Fail in Batch

**Problem**: Batch fails, but items work individually

**Causes**:
- Shared context pollution
- Resource exhaustion
- Timeout on large batch

**Solution**:
```bash
# Use best-effort mode
mode: best_effort

# Process smaller batches
chunk_size: 5

# Isolate context per item
for item in items:
    with isolated_context():
        process(item)
```

### Issue: Out of Memory

**Problem**: Large batch exhausts memory

**Causes**:
- Too many items
- Large items
- Context not released

**Solution**:
```bash
# Process in chunks
chunk_size: 10

# Stream results (don't accumulate)
# Use generators:
def process_batch_stream(items):
    for item in items:
        yield process(item)

# Clear memory between chunks
gc.collect()
```

## Related Documents

- **Parallel Quality** (Phase 1 Day 5) - Parallel execution patterns
- **Incremental Loading** (Phase 2 Day 1-3) - Context optimization
- **Output Caching** (Phase 2 Day 4-5) - Cache benefits batching
- **DRAGONFLY_PHASE2_PROGRESS.md** - Week 1 Day 6-7 tracking

---

**Use this skill when**: Processing multiple similar items, bulk validation, mass sync evaluation, or any operation with significant setup cost that can be amortized across multiple items.
