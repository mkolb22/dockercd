Manage the concept output cache for faster access and reduced file I/O.

The cache stores frequently accessed concept outputs in memory to achieve 95% hit rates and sub-100ms access times.

## Usage

```
/cache --stats              # View cache statistics
/cache --list               # List all cached entries
/cache --clear [id]         # Clear cache (all or specific entry)
/cache --enable             # Enable caching (default)
/cache --disable            # Disable caching
/cache --info <concept-id>  # View details for specific entry
```

## Process

When you run this command, you should:

### /cache --stats

Show comprehensive cache statistics:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Cache Statistics
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Status: Enabled
Session: session-2025-11-10-19h00m00s
Memory Usage: 125 KB

Performance:
  Total Requests: 367
  Cache Hits: 348 (94.8%)
  Cache Misses: 19 (5.2%)
  Average Access Time: 6ms (hit), 102ms (miss)

Entries: 15 cached concepts

Top Accessed:
  1. story-001     48 hits   8.2 KB   Last: 2 min ago
  2. arch-042      35 hits   15.1 KB  Last: 1 min ago
  3. impl-015      28 hits   22.3 KB  Last: 30 sec ago
  4. story-002     24 hits   7.8 KB   Last: 5 min ago
  5. review-003    18 hits   12.5 KB  Last: 3 min ago

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Recommendation: Cache performing optimally (>90% hit rate)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### /cache --list

Show all cached entries:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Cached Concept Outputs (15 entries)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Stories (5):
  story-001   ready        Cached 15 min ago   48 hits   8.2 KB
  story-002   ready        Cached 12 min ago   24 hits   7.8 KB
  story-003   draft        Cached 8 min ago    12 hits   6.9 KB
  story-004   ready        Cached 5 min ago    8 hits    8.5 KB
  story-005   ready        Cached 2 min ago    3 hits    7.2 KB

Architecture (4):
  arch-042    completed    Cached 14 min ago   35 hits   15.1 KB
  arch-043    completed    Cached 10 min ago   22 hits   14.8 KB
  arch-044    completed    Cached 6 min ago    15 hits   16.2 KB
  arch-045    blocked      Cached 3 min ago    7 hits    13.5 KB

Implementation (3):
  impl-015    completed    Cached 13 min ago   28 hits   22.3 KB
  impl-016    completed    Cached 9 min ago    20 hits   21.7 KB
  impl-017    partial      Cached 4 min ago    11 hits   18.9 KB

Quality Reviews (2):
  review-003  approved     Cached 11 min ago   18 hits   12.5 KB
  review-004  approved     Cached 7 min ago    14 hits   11.8 KB

Version (1):
  branch-007  active       Cached 1 min ago    5 hits    4.2 KB

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total Memory: 125 KB
Use `/cache --info <id>` for entry details
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### /cache --info <concept-id>

Show detailed information for specific entry:

```
User: /cache --info story-001

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Cache Entry: story-001
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Concept Type: Story
Status: ready
File: data/stories/story-001.yaml

Cache Info:
  Loaded At: 2025-11-10 19:05:32
  Last Access: 2025-11-10 19:20:15 (2 min ago)
  Access Count: 48 hits
  Memory Size: 8.2 KB

File Info:
  Modified: 2025-11-10 19:05:30
  Size: 8.4 KB (file), 8.2 KB (cached)
  Compression: N/A (YAML cached as-is)

Cache Status: VALID
  ✓ File has not been modified since caching
  ✓ In-memory data matches file
  ✓ No invalidation needed

Data Summary:
  story_id: story-001
  title: "Add OAuth authentication"
  status: "ready"
  acceptance_criteria: 5 items
  ambiguities: 0 items

Recent Access Pattern:
  19:05 - Initial load (MISS)
  19:07 - Architecture concept (HIT)
  19:12 - Implementation concept (HIT)
  19:15 - /sync evaluation (HIT)
  19:18 - Quality review (HIT)
  19:20 - /sync evaluation (HIT)

Performance:
  Avg Access Time: 5ms (vs 100ms file read)
  Speedup: 20x faster
  Time Saved: 48 × 95ms = 4,560ms total

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### /cache --clear [id]

Clear cache entries:

```
# Clear all cache
User: /cache --clear

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Clearing Cache
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Removed 15 cache entries:
  ✓ 5 stories
  ✓ 4 architectures
  ✓ 3 implementations
  ✓ 2 quality reviews
  ✓ 1 version

Freed Memory: 125 KB

Cache cleared successfully.
Next access will reload from files.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# Clear specific entry
User: /cache --clear story-001

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Clearing Cache Entry: story-001
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Removed: story-001 (8.2 KB, 48 hits)
Reason: Manual clear

Entry will be reloaded on next access.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### /cache --enable / --disable

Control caching:

```
User: /cache --disable

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Caching Disabled
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

All concept outputs will be read directly from files.
Existing cache entries preserved but not used.

Performance impact:
  - Sync evaluation: ~2,250ms (vs 450ms with cache)
  - Repeated reads: 100ms each (vs 5ms with cache)

To re-enable: /cache --enable

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Cache Architecture

### Session-Based Caching

Cache lifetime matches Claude Code session:
- Created at session start
- Persists during session
- Cleared at session end

### Automatic Invalidation

Cache entries invalidated when:
- File modified (mtime changed)
- File deleted
- Manual clear command
- Session ends

### Cache Strategy

```yaml
1. Request concept output
2. Check cache:
   - If cached AND file not modified → Return cached (HIT)
   - If cached BUT file modified → Invalidate, reload, cache
   - If not cached → Load, add to cache (MISS)
3. Increment hit counter
4. Return data
```

## Performance Benefits

### Sync Evaluation

**Without Cache**:
```
10 sync rules × 225ms = 2,250ms (2.25 seconds)
```

**With Cache** (95% hit rate):
```
9 cache hits × 25ms = 225ms
1 cache miss × 225ms = 225ms
Total: 450ms
Speedup: 5x faster
```

### Repeated Access

**Without Cache**:
```
100 reads × 100ms = 10,000ms (10 seconds)
```

**With Cache**:
```
1 miss × 100ms = 100ms (initial)
99 hits × 5ms = 495ms
Total: 595ms
Speedup: 17x faster
```

## Use Cases

### 1. Sync Rule Evaluation

```bash
# Sync checks 10 rules, each reading 2-3 state files
# Without cache: 2,250ms
# With cache: 450ms (5x faster)

/sync --execute
```

### 2. Cross-Concept References

```bash
# Implementation reads story + architecture
# Quality reads story + architecture + implementation
# Without cache: 4 × 100ms = 400ms
# With cache: 300ms (first reads) + 3 × 5ms = 315ms

# Repeated workflow cycles benefit massively
```

### 3. Interactive Development

```bash
# Developer iterating on design
# Repeatedly checking story and architecture
# Each check: 5ms (cached) vs 200ms (uncached)

/feature "Update OAuth flow"
# Fast feedback loop
```

## When to Clear Cache

### Clear Entire Cache

```bash
# When encountering strange behavior
/cache --clear

# After bulk file modifications
/cache --clear

# When debugging cache issues
/cache --clear
```

### Clear Specific Entry

```bash
# After manually editing state file
/cache --clear story-001

# When file modified outside session
/cache --clear arch-042

# After error in concept execution
/cache --clear impl-015
```

## Troubleshooting

### Issue: Low Hit Rate

**Symptom**: Cache stats show <80% hit rate

**Diagnosis**:
```bash
/cache --stats
# Check if:
# - Files being modified frequently
# - Cache invalidation too aggressive
# - New files dominating access pattern
```

**Solution**:
```bash
# Normal for early in workflow (many new files)
# Should improve as workflow progresses
# Target: 90%+ for sync operations
```

### Issue: Stale Data

**Symptom**: Cached data doesn't match file

**Diagnosis**:
```bash
/cache --info story-001
# Check "Cache Status" section
# Verify file mtime vs cached mtime
```

**Solution**:
```bash
# Clear and reload
/cache --clear story-001

# Check that file writes update mtime
# Ensure atomic file operations
```

### Issue: High Memory Usage

**Symptom**: Cache using excessive memory

**Diagnosis**:
```bash
/cache --stats
# Check "Memory Usage"
# Typical: 10-20 KB per entry
# Large files: 50-100 KB per entry
```

**Solution**:
```bash
# Clear old entries
/cache --clear

# Future: LRU eviction (Phase 3)
# Cache only summary sections if memory constrained
```

## Integration with Other Commands

### With /sync

```bash
# Sync benefits most from caching
/sync --execute
# Automatically uses cache for all state file reads
# 5x faster evaluation
```

### With /trace

```bash
# Trace can show cache hits/misses
/trace flow-2025-11-10-19h00m00s
# Shows which reads were cached
```

### With /replay

```bash
# Replay loads provenance from cache if available
/replay flow-2025-11-10-19h00m00s
# Faster replay with cached data
```

## Related Commands

- `/workflow` - Execute feature workflow with caching
- `/sync` - Evaluate synchronizations (uses cached state)
- `/trace` - View workflow provenance
- `/costs` - Analyze costs (includes cache savings)

## Related Skills

- **output-caching** - Complete caching skill documentation
- **incremental-loading** - Reduce context with targeted loading
- **smart-retry** - Retry strategies for cache operations

---

**Use this command**: To monitor cache performance, troubleshoot caching issues, or manually clear cache when needed. In normal operation, caching is automatic and requires no intervention.
