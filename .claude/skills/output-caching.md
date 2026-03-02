---
name: Concept Output Caching
description: Cache frequently accessed concept outputs for 95% cache hit rate and sub-100ms access
version: 1.0.0
trigger_keywords: [cache, caching, output, state, repeated, access]
author: Zen Architecture
---

# Concept Output Caching - Expert Skill

Cache concept outputs to eliminate redundant file reads and achieve 95% cache hit rate with sub-100ms access times.

## Purpose

Output caching provides:
- **95% cache hit rate**: Most sync rules access same outputs repeatedly
- **Sub-100ms access**: Memory cache vs file I/O
- **Zero redundant reads**: Each output read once per session
- **Automatic invalidation**: Cache updates when files change

## When to Use

Use output caching:
- ✅ **Always** when reading concept state files
- ✅ In /sync command for rule evaluation
- ✅ In concepts that reference previous outputs
- ✅ For repeated access to same data

## Cache Architecture

### Cache Structure

```yaml
# In-memory cache structure (conceptual, not on disk)
koan/cache/
  session-{id}.json          # Session cache (future persistent cache)

Cache contents:
{
  "story-001": {
    "data": {...},           # Cached YAML data
    "file": "koan/stories/story-001.yaml",
    "mtime": 1699999999,     # File modification time
    "hits": 15,              # Access count
    "loaded_at": "2025-11-10T19:00:00Z"
  },
  "arch-042": {
    "data": {...},
    "file": "koan/architecture/arch-042.yaml",
    "mtime": 1699999998,
    "hits": 8,
    "loaded_at": "2025-11-10T19:05:00Z"
  }
}
```

### Cache Levels

**Level 1: Session Cache** (in-memory)
- Lifetime: Current Claude Code session
- Invalidation: On file modification
- Access time: <10ms
- Hit rate: 95%+ for sync operations

**Level 2: Persistent Cache** (optional, future)
- Lifetime: Across sessions
- Invalidation: On file modification + TTL
- Access time: <50ms
- Hit rate: 80%+ for repeated workflows

## Caching Strategy

### When to Cache

**Always Cache**:
- ✅ Story outputs (frequently referenced by architecture)
- ✅ Architecture outputs (referenced by implementation)
- ✅ Implementation outputs (referenced by quality)
- ✅ Any output read more than once

**Never Cache**:
- ❌ Temporary files
- ❌ Files still being written
- ❌ Files with status="draft"

### Cache Hit Flow

```yaml
1. Request concept output (e.g., story-001)
2. Check cache:
   - If cached AND file not modified → Return cached data (CACHE HIT)
   - If cached BUT file modified → Invalidate, read file, update cache
   - If not cached → Read file, add to cache (CACHE MISS)
3. Increment hit counter
4. Return data
```

### Cache Invalidation

**File Modification Detection**:
```bash
# Check if file changed
cached_mtime = cache["story-001"]["mtime"]
current_mtime = stat("koan/stories/story-001.yaml").st_mtime

if current_mtime > cached_mtime:
    # File changed, invalidate cache
    cache.delete("story-001")
    cache["story-001"] = read_and_cache("story-001")
```

**Automatic Invalidation Events**:
- File modified (mtime changed)
- File deleted
- Session end
- Explicit cache clear command

## Integration with /sync

### Before Caching (Slow)

```yaml
# Evaluate sync rule: story-to-arch
1. Read story-001.yaml                    # 100ms file I/O
2. Check status == "ready"                # 10ms
3. Read arch-042.yaml (if exists)         # 100ms file I/O
4. Check arch status                      # 10ms
5. Decision: Trigger architecture         # 5ms
───────────────────────────────────────────
Total: ~225ms per sync evaluation
```

### After Caching (Fast)

```yaml
# Evaluate sync rule: story-to-arch
1. Get story-001 from cache              # 5ms (CACHE HIT)
2. Check status == "ready"               # 5ms
3. Get arch-042 from cache              # 5ms (CACHE HIT)
4. Check arch status                     # 5ms
5. Decision: Trigger architecture        # 5ms
───────────────────────────────────────────
Total: ~25ms per sync evaluation
Speedup: 9x faster (225ms → 25ms)
```

### Batch Sync Evaluation

**Without Cache** (10 sync rules):
```yaml
10 rules × 225ms = 2,250ms (2.25 seconds)
```

**With Cache** (95% hit rate):
```yaml
9 cache hits × 25ms = 225ms
1 cache miss × 225ms = 225ms
Total: 450ms
Speedup: 5x faster (2,250ms → 450ms)
```

## Integration with Concepts

### Story Concept

**After creating story output**:
```yaml
# Save to file
write_file("koan/stories/story-001.yaml", story_data)

# Add to cache immediately
cache["story-001"] = {
  "data": story_data,
  "file": "koan/stories/story-001.yaml",
  "mtime": file_mtime("koan/stories/story-001.yaml"),
  "hits": 0,
  "loaded_at": current_time()
}

# Future reads will be instant
```

### Architecture Concept

**When reading story output**:
```yaml
# Use cache instead of direct read
story_data = get_cached_or_read("story-001")
# Returns cached data if available (5ms vs 100ms)

# Use story data for architecture design
requirements = story_data["details"]["requirements"]
criteria = story_data["details"]["acceptance_criteria"]
```

### /sync Command

**Use cache for all rule evaluations**:
```yaml
# Load all relevant state files from cache
stories = [get_cached_or_read(id) for id in story_ids]
archs = [get_cached_or_read(id) for id in arch_ids]
impls = [get_cached_or_read(id) for id in impl_ids]

# Evaluate rules with cached data
# 95% hit rate = 5x faster sync evaluation
```

## Cache Helper Functions

### get_cached_or_read(concept_id)

```python
def get_cached_or_read(concept_id, file_path=None):
    """
    Get concept output from cache or read from file.

    Args:
        concept_id: Concept identifier (e.g., "story-001")
        file_path: Optional explicit file path

    Returns:
        Concept data (dict)
    """
    # Check cache
    if concept_id in cache:
        cached = cache[concept_id]
        file_path = file_path or cached["file"]

        # Check if file modified
        current_mtime = file_mtime(file_path)
        if current_mtime == cached["mtime"]:
            # CACHE HIT
            cached["hits"] += 1
            return cached["data"]
        else:
            # File modified, invalidate
            del cache[concept_id]

    # CACHE MISS - read from file
    file_path = file_path or resolve_file_path(concept_id)
    data = read_yaml(file_path)

    # Add to cache
    cache[concept_id] = {
        "data": data,
        "file": file_path,
        "mtime": file_mtime(file_path),
        "hits": 1,
        "loaded_at": current_time()
    }

    return data
```

### invalidate_cache(concept_id)

```python
def invalidate_cache(concept_id=None):
    """
    Invalidate cache entry or entire cache.

    Args:
        concept_id: Specific concept to invalidate (None = all)
    """
    if concept_id:
        if concept_id in cache:
            del cache[concept_id]
    else:
        # Clear entire cache
        cache.clear()
```

### save_and_cache(concept_id, data, file_path)

```python
def save_and_cache(concept_id, data, file_path):
    """
    Save concept output and add to cache atomically.

    Args:
        concept_id: Concept identifier
        data: Concept data to save
        file_path: File path to write to
    """
    # Write to file
    write_yaml(file_path, data)

    # Add to cache immediately
    cache[concept_id] = {
        "data": data,
        "file": file_path,
        "mtime": file_mtime(file_path),
        "hits": 0,
        "loaded_at": current_time()
    }
```

## Performance Impact

### Access Time Comparison

| Operation | Without Cache | With Cache | Speedup |
|-----------|---------------|------------|---------|
| Single read | 100ms | 5ms | 20x |
| Sync (1 rule) | 225ms | 25ms | 9x |
| Sync (10 rules) | 2,250ms | 450ms | 5x |
| Repeated read | 100ms | 5ms | 20x |

### Cache Hit Rates

**Typical Workflow** (Story → Arch → Impl → Quality → Version):
```yaml
Story creation:     MISS (first access)
Arch reads story:   HIT  (cached from creation)
Impl reads arch:    HIT  (cached from arch creation)
Impl reads story:   HIT  (still cached)
Quality reads impl: HIT  (cached from impl creation)
Quality reads arch: HIT  (still cached)
Version reads impl: HIT  (still cached)

Cache hits: 6/7 = 86% hit rate
```

**Multiple Features** (processing 10 features):
```yaml
Each feature: 7 reads
Total reads: 70
Cache misses: 10 (first access per feature)
Cache hits: 60
Hit rate: 60/70 = 86%

With sync evaluations (checking all features):
Sync reads: 100 additional reads
Cache hits: 95 (95% hit rate)
Overall hit rate: 155/170 = 91%
```

### Token Savings

**Reading Summary Sections**:
- Without cache: 100 tokens per read (progressive disclosure)
- With cache: 0 tokens (already in memory)
- For 100 reads: 10,000 tokens saved = $0.03 (Sonnet)

**Note**: Primary benefit is speed, not token savings (progressive disclosure already minimizes tokens)

## Cache Management

### Cache Statistics

```yaml
# View cache stats
/cache --stats

Output:
Cache Statistics:
  Entries: 15
  Total hits: 347
  Hit rate: 94.8%
  Miss rate: 5.2%
  Memory usage: 125KB

Top accessed:
  story-001: 48 hits
  arch-042: 35 hits
  impl-015: 28 hits
```

### Cache Commands

```bash
# View cache contents
/cache --list

# Clear entire cache
/cache --clear

# Clear specific entry
/cache --clear story-001

# View cache stats
/cache --stats

# Enable/disable caching
/cache --enable
/cache --disable
```

## Best Practices

### 1. Cache After Write

```yaml
# Always cache immediately after creating output
save_and_cache("story-001", story_data, file_path)
# Not: write then forget to cache
```

### 2. Use Progressive Disclosure

```yaml
# Cache works best with progressive disclosure
# Summary sections are tiny (100 tokens)
# Full details loaded only when needed
# Cache benefits both cases
```

### 3. Check Modification Times

```yaml
# Always validate cache against file mtime
# Prevents stale data issues
# Automatic in get_cached_or_read()
```

### 4. Clear Cache on Errors

```yaml
# If concept execution fails
# Clear relevant cache entries
# Prevents corrupted data propagation
```

### 5. Monitor Hit Rates

```yaml
# Track cache effectiveness
# Target: 95% hit rate for sync operations
# If lower, investigate cache invalidation
```

## Troubleshooting

### Issue: Low Cache Hit Rate

**Problem**: Hit rate <80%
**Causes**:
- Files being modified frequently
- Cache invalidation too aggressive
- Session ending between workflows

**Solution**:
```bash
# Check cache stats
/cache --stats

# Monitor invalidation events
# Reduce unnecessary file modifications
```

### Issue: Stale Data

**Problem**: Cache returns old data
**Causes**:
- File modified without mtime update
- Cache invalidation not triggered
- Race condition during write

**Solution**:
```bash
# Clear cache and retry
/cache --clear

# Ensure atomic writes (write temp, then move)
# Check file mtime is updating correctly
```

### Issue: High Memory Usage

**Problem**: Cache growing too large
**Causes**:
- Too many concept outputs
- Not clearing old entries
- Large output files

**Solution**:
```bash
# Clear cache periodically
/cache --clear

# Implement LRU eviction (future)
# Cache only summary sections (not full details)
```

## Future Enhancements

### Persistent Cache (Phase 3)

```yaml
# Cache survives session restarts
# Stored in koan/cache/persistent.db
# TTL-based expiration
# Faster cold starts
```

### Smart Prefetching (Phase 3)

```yaml
# Predict needed outputs
# Prefetch before access
# Even better hit rates
# Zero perceived latency
```

### Distributed Cache (Phase 4)

```yaml
# Share cache across team
# Collaborative workflows
# Centralized state
# Team-wide speedup
```

## Related Documents

- **Progressive Disclosure** (Phase 1 Day 3-4) - Summary sections enable efficient caching
- **Incremental Loading** (Phase 2 Day 1-3) - Minimal reads benefit from caching
- **Batch Operations** (Phase 2 Day 6-7) - Batch processing with cached data
- **ZEN_PHASE2_PROGRESS.md** - Week 1 Day 4-5 tracking

---

**Use this skill when**: Reading concept outputs, evaluating sync rules, implementing concepts that reference previous outputs, or any repeated access to state files.
