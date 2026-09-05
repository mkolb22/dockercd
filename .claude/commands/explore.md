---
name: explore
description: "Explore multiple solution approaches using Tree-of-Thoughts reasoning"
usage: "/explore <problem description>"
---

# Explore Command

Use Tree-of-Thoughts reasoning to explore multiple approaches to a complex problem before committing to a solution.

## Usage

```bash
/explore "Design a caching strategy for the API"
/explore "Refactor the user service for better testability"
/explore "Debug the intermittent authentication failures"
```

## When to Use

- Complex architectural decisions with multiple valid approaches
- Debugging problems where the root cause is unclear
- Refactoring with multiple strategies to consider
- Any decision where the stakes are high and reversal is costly

## Process

When you invoke `/explore`, the following happens:

### 1. Problem Analysis

The problem is decomposed into:
- Sub-goals that need to be achieved
- Constraints that must be satisfied
- Decision points where alternatives exist

### 2. Branch Generation

Multiple solution approaches are generated:
- Each branch is a coherent strategy
- Branches are meaningfully different (not minor variations)
- Typically 2-4 branches are explored

### 3. Evaluation

Each branch is scored on:
- **Feasibility** (1-10): Can we actually build this?
- **Maintainability** (1-10): Will it be easy to maintain?
- **Scalability** (1-10): Will it grow with our needs?
- **Security** (1-10): Are there security concerns?
- **Complexity** (1-10): How hard is implementation?

### 4. Selection

The highest-scoring path is selected:
- Clear winners (>1.5 point lead) are chosen confidently
- Close scores may trigger hybrid consideration
- Low confidence (<0.7) triggers deeper evaluation

### 5. Documentation

Results are stored in `data/explorations/` for future reference.

## Output Format

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Exploration: Design a caching strategy for the API
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Problem Decomposition:
- Goal: Reduce API latency for frequent queries
- Constraints: Must invalidate on data changes
- Decision Points: Cache location, invalidation strategy

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Branch 1: Redis with TTL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Score: 8.5/10

Steps:
1. Set up Redis cluster
2. Implement cache-aside pattern
3. TTL-based expiration

Pros:
✓ Proven technology
✓ Good performance
✓ Easy to debug

Cons:
✗ Requires Redis infrastructure
✗ TTL may serve stale data

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Branch 2: In-memory with event invalidation
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Score: 7.8/10

Steps:
1. Use in-memory cache per instance
2. Pub/sub for invalidation events
3. Background refresh

Pros:
✓ No external dependencies
✓ Immediate invalidation
✓ Simpler ops

Cons:
✗ Memory pressure per instance
✗ Cold start problem

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Branch 3: CDN edge caching
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Score: 6.2/10

Steps:
1. Configure CDN cache headers
2. Implement cache purge API
3. Vary headers for personalization

Pros:
✓ Global distribution
✓ Offloads origin

Cons:
✗ Limited control
✗ Personalization challenges
✗ Purge latency

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Selected: Branch 1 - Redis with TTL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Confidence: 0.85

Rationale:
Clear winner with best balance of performance and reliability.
TTL staleness mitigated by short expiration for volatile data.

Why others rejected:
- In-memory: Memory constraints with large datasets
- CDN: Personalization needs make edge caching impractical

Next Steps:
1. Set up Redis cluster in staging
2. Implement cache service wrapper
3. Add cache hit/miss metrics

Exploration saved: data/explorations/exp-001.yaml
```

## Options

```bash
/explore "problem" --branches 5    # Explore 5 paths instead of default 3
/explore "problem" --depth 3       # Explore deeper (more steps per path)
/explore "problem" --quick         # Faster evaluation, less thorough
```

## Backtracking

If you later discover the chosen path doesn't work:

```bash
/explore --backtrack "Redis scaling is problematic"
```

This will:
1. Document the failure
2. Store the learning
3. Re-evaluate remaining paths
4. Suggest alternative

## Integration

Exploration integrates with:
- **Architecture**: Complex designs trigger exploration automatically
- **Debugging**: Repeated failures trigger exploration
- **Retrospective**: Learnings from explorations stored for future

## Files Created

- `data/explorations/exp-{id}.yaml` - Full exploration record
- `data/learnings/patterns/` - Extracted decision patterns
