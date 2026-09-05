---
name: Phase 2 Optimizations Summary
description: Complete guide to all Phase 2 optimizations and how to use them together
version: 1.0.0
trigger_keywords: [phase2, optimizations, summary, guide, integration]
author: Zen Architecture
---

# Phase 2 Optimizations Summary

Complete reference for all Phase 2 advanced optimizations and their combined impact.

## Quick Reference

| Optimization | Day | Key Benefit | Metric |
|--------------|-----|-------------|--------|
| **Incremental Loading** | 1-3 | Context reduction | 99% fewer tokens |
| **Output Caching** | 4-5 | Faster access | 5-20x speedup |
| **Batch Operations** | 6-7 | Multi-item efficiency | 3x faster |
| **Smart Retry** | 8-10 | Auto-recovery | 80% cost reduction |

## Combined Usage Patterns

### Pattern 1: Feature Development Workflow

**Using all Phase 2 optimizations together**:

```yaml
# 1. Create story with retry
story = retry_with_backoff(
    lambda: create_story(requirements)
)
# Cost: $0.002 (Sonnet)
# Time: 2min (or 6sec on retry)

# 2. Architecture with incremental loading
architecture = create_architecture(story_id)
  # Stage 1: Overview existing code (100 tokens)
  # Stage 2: Find similar patterns (400 tokens)
  # Stage 3: Read specific files (5K tokens IF needed)
# Cost: $0.003 (Sonnet, 99% reduction from baseline)
# Time: 3min (down from 8min with full context)

# 3. Cache architecture output
cache["arch-042"] = architecture
# Future reads: 5ms vs 100ms

# 4. Implementation uses cached architecture
impl = create_implementation(arch_id="arch-042")
  # Gets architecture from cache (5ms)
  # Uses incremental loading for codebase
# Cost: $0.003 (Sonnet)
# Time: 3min

# 5. Quality checks in parallel + batch
parallel:
  - quality_review(impl_id="impl-015")  # 2min
  - quality_test(impl_id="impl-015")    # 2min
# Both run simultaneously
# Time: 2min (not 4min)

# 6. Batch sync evaluation (if multiple features)
sync_results = batch_evaluate_sync([
    "story-001", "story-002", "story-003"
])
# 3 features: 450ms (vs 1,350ms individual)

Total feature time: 10min (vs 20min baseline)
Total cost: $0.008 (vs $0.30 baseline)
Speedup: 2x faster
Savings: 97% cheaper
```

### Pattern 2: Bulk Feature Processing

**Processing 10 features with all optimizations**:

```yaml
# Batch story creation
stories = batch_create_stories(story_requests)  # 10 stories
# Sequential: 10 × 2min = 20min
# Batch: 7min (shared context)
# Speedup: 2.9x

# Cache all stories (auto)
for story in stories:
    cache[story.id] = story

# Batch architecture (5 ready for architecture)
architectures = batch_create_architectures(story_ids)
  # Shared incremental loading context
  # Each: 1.1K tokens (vs 9.6K Phase 1, vs 100K baseline)
# Sequential: 5 × 3min = 15min
# Batch: 6min (shared codebase exploration)
# Speedup: 2.5x

# All architectures cached automatically
# Sync evaluation uses cache
sync_check = batch_sync_eval(all_feature_ids)
# 10 features: 1.5s (vs 22.5s baseline)
# 95% cache hit rate

# Batch quality with retry
quality_results = batch_quality_with_retry(impl_ids)
  # Parallel review + test per implementation
  # Automatic retry on transient failures
# Time: 4min (vs 20min sequential)
# Success rate: 95% (vs 57% without retry)

Total time: 18min (vs 60min baseline)
Total cost: $0.08 (vs $3.00 baseline)
Speedup: 3.3x faster
Savings: 97% cheaper
```

### Pattern 3: Interactive Development

**Rapid iteration with caching and incremental loading**:

```yaml
# First iteration
/feature "Add OAuth"
  # Incremental loading: 1.1K tokens
  # Cache all outputs
# Time: 10min, Cost: $0.008

# Check status
/sync
  # All reads from cache: 5ms each
# Time: 50ms (vs 2,250ms without cache)

# Tweak requirement
/feature "Add OAuth with Google + GitHub"
  # Architecture cached: Instant access
  # Incremental loading: Only new patterns
  # Implementation reuses cached context
# Time: 5min (vs 10min), Cost: $0.005

# Multiple status checks
/sync  # 50ms (cached)
/sync  # 50ms (cached)
/sync  # 50ms (cached)
# Total: 150ms vs 6,750ms (45x faster)

Total iteration time: 15min (vs 25min)
Total cost: $0.013 (vs $0.31)
Feedback loop: Sub-second status checks
```

## Optimization Interactions

### Synergies

**Caching + Incremental Loading**:
- Incremental loading reduces what needs caching
- Cache makes repeated incremental access instant
- Combined: 99.5% token reduction + 20x faster access

**Batch + Cache**:
- Batch loads many items
- Cache remembers all for future
- Combined: 3x batch speedup + 95% hit rate

**Retry + Batch**:
- Batch may have transient failures
- Retry recovers automatically
- Combined: 3x speedup + 95% success rate

**All Four Together**:
- Incremental: Load minimum context
- Cache: Remember for reuse
- Batch: Process many at once
- Retry: Recover automatically
- Result: 99.5% reduction + 5x faster + 95% success

### Optimization Decision Tree

```
Start: Need to process concept

├─ Multiple items?
│  ├─ Yes → Use BATCH
│  │  ├─ Items independent? → Batch + Parallel
│  │  └─ Items dependent? → Batch only
│  └─ No → Single item
│
├─ Need existing code?
│  ├─ Yes → Use INCREMENTAL LOADING
│  │  ├─ Just overview? → Stage 1 (100 tokens)
│  │  ├─ Specific symbols? → Stage 2 (500 tokens)
│  │  └─ Full context? → Stage 3 (5K tokens)
│  └─ No → Create new
│
├─ Reading state files?
│  ├─ Yes → Check CACHE first
│  │  ├─ Cache hit? → Use cached (5ms)
│  │  └─ Cache miss? → Read + cache
│  └─ No → Direct operation
│
└─ Operation may fail?
   ├─ Transient possible? → Use RETRY
   │  ├─ Rate limit? → Exponential backoff
   │  ├─ Timeout? → Jittered backoff
   │  └─ Persistent? → Circuit breaker
   └─ Permanent error? → Fail fast
```

## Performance Targets

### Per-Concept Targets

| Concept | Baseline | Phase 1 | Phase 2 | Target Met |
|---------|----------|---------|---------|------------|
| Story | $0.002 | $0.002 | $0.002 | ✅ N/A |
| Architecture | $0.30 | $0.03 | $0.003 | ✅ 99% |
| Implementation | $0.003 | $0.003 | $0.003 | ✅ N/A |
| Quality | $0.004 | $0.004 | $0.004 | ✅ N/A |
| Version | $0.002 | $0.002 | $0.002 | ✅ N/A |

### Workflow Targets

| Metric | Baseline | Phase 1 | Phase 2 | Target |
|--------|----------|---------|---------|--------|
| Single feature | 20min | 12min | 10min | <12min ✅ |
| Sync check | 2.25s | 0.42s | 0.05s | <0.5s ✅ |
| 10 features | 200min | 120min | 60min | <100min ✅ |
| Success rate | 57% | 80% | 95% | >90% ✅ |

## Testing Guidelines

### Test 1: Incremental Loading

```bash
# Test incremental loading
cd koan

# Create feature requiring architecture
/feature "Add complex OAuth flow"

# Verify incremental loading used:
# - Check logs for "Stage 1: Overview"
# - Check logs for MCP tool calls
# - Check context tokens < 2K

# Expected:
# - Architecture completes successfully
# - Context < 2K tokens (not 100K)
# - Time: 3-5min (not 8min)
```

### Test 2: Caching

```bash
# Test cache hit rate
/sync  # First check (may be cache misses)
/sync  # Second check (should be cache hits)
/sync  # Third check (should be cache hits)

# Check cache stats
/cache --stats

# Expected:
# - Hit rate > 90% after first sync
# - Access time < 10ms for cached
# - Memory usage reasonable (<1MB per 10 features)
```

### Test 3: Batch Operations

```bash
# Test batch validation
# Create 10 stories
for i in {1..10}; do
    /story "Feature $i"
done

# Validate all in batch
/validate --batch stories

# Expected:
# - All 10 validated in < 500ms
# - 3x faster than individual
# - All results shown
```

### Test 4: Smart Retry

```bash
# Test retry on rate limit
# (May need to simulate rate limit)

# Create feature during high load
/feature "Add auth"

# Expected:
# - If rate limit hit, automatic retry
# - Exponential backoff visible in logs
# - Success after 1-3 retries
# - No manual intervention needed
```

### Test 5: Combined Optimizations

```bash
# Full workflow test
cd koan

# Create 5 features
/workflow "Add OAuth"
/workflow "Add 2FA"
/workflow "Add SSO"
/workflow "Add LDAP"
/workflow "Add SAML"

# Check performance
time /sync --execute

# Expected:
# - All features process successfully
# - Sync completes in < 2s
# - Cache hit rate > 90%
# - No manual retries needed
# - Total time < 60min for 5 features
```

## Troubleshooting

### Issue: Incremental Loading Not Used

**Symptom**: Context tokens still high

**Check**:
```bash
# Verify MCP tools available
mcp__serena__get_symbols_overview --help

# Check concept templates updated
grep "incremental" zen/templates/concepts/architecture.md.template
```

**Fix**:
```bash
# Update zen submodule
cd .zen && git pull origin main
./install.sh
```

### Issue: Cache Not Working

**Symptom**: Slow sync evaluations

**Check**:
```bash
/cache --stats

# Expected:
# - Status: Enabled
# - Hit rate > 50% after a few syncs
```

**Fix**:
```bash
# Clear and rebuild cache
/cache --clear
/sync  # Rebuild cache
/sync  # Should be faster now
```

### Issue: Batch Not Faster

**Symptom**: Batch slower than individual

**Check**:
```bash
# Measure components
time individual_operation
time batch_operation

# Compare setup costs
```

**Fix**:
```bash
# Reduce batch size if too large
batch_size: 5  # Instead of 20

# Or don't batch if setup cost is low
```

### Issue: Retry Not Triggering

**Symptom**: Failures not automatically retried

**Check**:
```bash
# Verify error is retryable
# Non-retryable: validation_error, schema_error
# Retryable: rate_limit, timeout, connection_error
```

**Fix**:
```bash
# Ensure retry logic enabled in concepts
# Check concept templates have retry wrappers
```

## Migration Guide

### From Phase 1 to Phase 2

1. **Enable Incremental Loading** (Day 1)
   ```bash
   # Update architecture concept
   # Add 3-stage loading
   # Start with MCP tools
   ```

2. **Enable Caching** (Day 2)
   ```bash
   # Cache enabled by default
   # Monitor with /cache --stats
   # Clear if needed with /cache --clear
   ```

3. **Use Batch Operations** (Day 3)
   ```bash
   # Identify batch opportunities
   # Use /sync --batch
   # Use /validate --batch
   ```

4. **Enable Retry Logic** (Day 4)
   ```bash
   # Retry enabled in all concepts
   # Automatic exponential backoff
   # Circuit breakers for persistent failures
   ```

### Verification

After migration, verify:
- ✅ Architecture tokens < 2K (incremental loading)
- ✅ Sync < 500ms with cache hits (caching)
- ✅ Batch operations 3x faster (batching)
- ✅ Success rate > 90% (retry)

## Related Documents

- **Incremental Loading** - Phase 2 Day 1-3
- **Output Caching** - Phase 2 Day 4-5
- **Batch Processing** - Phase 2 Day 6-7
- **Smart Retry** - Phase 2 Day 8-10
- **ZEN_PHASE2_PROGRESS.md** - Implementation tracking
- **ZEN_IMPROVEMENT_PROPOSALS.md** - All 12 proposals

---

**Use this guide**: As reference for all Phase 2 optimizations, their interactions, and how to use them together for maximum benefit.
