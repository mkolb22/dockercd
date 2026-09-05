---
name: Synchronization Patterns
description: Common patterns and best practices for writing effective synchronization rules in Dragonfly WYSIWID workflows
version: 1.0.0
trigger_keywords: [synchronization, sync, workflow, orchestration, rules, patterns, when, where, then]
author: Dragonfly Architecture
---

# Synchronization Patterns - Expert Skill

Master patterns for writing effective, maintainable synchronization rules.

## Core Synchronization Structure

```yaml
synchronizations:
  - id: "unique-rule-id"
    when:
      concept: "source-concept"
      action: "action-name"
      status: "completed"
    where:
      query: "conditional-expression"
    then:
      - concept: "target-concept"
        action: "action-name"
        model: "sonnet|opus"
        inputs: {...}
    provenance:
      flow_id: "auto|${parent.flow_id}"
      reason: "Why this rule triggers"
```

## Common Patterns

### 1. Sequential Chain
```yaml
story → architecture → implementation → quality → version
```

### 2. Conditional Branch
```yaml
architecture → implementation (if risk == 'low')
            → human-review (if risk == 'high')
```

### 3. Parallel Execution

**Pattern**: Multiple independent actions triggered by same completion.

```yaml
implementation → quality.review  [parallel]
              → quality.test     [parallel]
```

**Example**:
```yaml
synchronizations:
  - id: "impl-to-quality-review"
    when:
      concept: "implementation"
      action: "generate"
      status: "completed"
    where:
      query: "implementation.status == 'completed' AND implementation.blockers.length == 0"
    then:
      - concept: "quality"
        action: "review"
        model: "opus"
        parallel: true  # Can run concurrently with other rules
        inputs:
          implementation_id: "${implementation.id}"
          files: "${implementation.files_changed}"

  - id: "impl-to-quality-test"
    when:
      concept: "implementation"
      action: "generate"
      status: "completed"
    where:
      query: "implementation.status == 'completed' AND implementation.test_files.length > 0"
    then:
      - concept: "quality"
        action: "test"
        model: "opus"
        parallel: true  # Can run concurrently with impl-to-quality-review
        inputs:
          implementation_id: "${implementation.id}"
          test_paths: "${implementation.test_files}"
```

**Benefits**:
- 50% faster execution (review + test run simultaneously)
- Same total cost (both actions run anyway)
- Independent actions don't block each other
- Better resource utilization

**Requirements**:
- Actions must be truly independent (no shared state)
- Both read from implementation, neither modifies it
- Results collected before next sync evaluation

**Implementation**:
When multiple sync rules match with `parallel: true`:
1. Invoke all matched concepts simultaneously (single message with multiple Task tool calls)
2. Wait for all to complete
3. Evaluate next synchronization with all results

### 4. Error Recovery
```yaml
quality → version.commit (if approved)
       → implementation.refactor (if needs_changes)
```

### 5. Iterative Refinement
```yaml
story → architecture → story.clarify (if ambiguous)
     → architecture (retry)
```

## Query Language Reference

### Field Access
```yaml
story.status                    # Access field
architecture.decisions.length   # Array length
quality.issues.filter(...)      # Array filter
```

### Comparisons
```yaml
==, !=    # Equality
<, >, <=, >= # Numeric comparison
```

### Logical Operators
```yaml
AND, OR, NOT
```

### Examples
```yaml
# Multiple conditions
story.status == 'ready' AND
story.acceptance_criteria.length > 0 AND
story.ambiguities.length == 0

# Numeric comparison
architecture.complexity < 8 AND
architecture.risk_score <= 5

# Array operations
implementation.test_files.length > 0 AND
quality.issues.filter(i => i.severity == 'high').length == 0
```

## Parallel Execution Guidelines

### When to Use Parallel

✅ **Good candidates for parallelization**:
- Quality review + test execution (independent checks)
- Multiple validation steps (security, lint, type check)
- Documentation generation + test generation
- Multiple independent transformations

❌ **Bad candidates for parallelization**:
- Architecture → Implementation (implementation needs arch complete)
- Implementation → Version (version needs impl complete)
- Any sequence where B needs output from A

### Detecting Parallel Opportunities

Questions to ask:
1. Do both actions read from the same completed concept?
2. Neither action modifies what the other reads?
3. Neither action depends on the other's results?
4. Both actions can be evaluated independently?

If all YES → parallel is safe and beneficial.

### Performance Impact

**Sequential** (traditional):
```
Implementation complete → Quality review (2min) → Quality test (2min) = 4min
```

**Parallel** (with parallel: true):
```
Implementation complete → Quality review (2min) } = 2min
                       → Quality test (2min)  }
```

**Savings**: 50% faster (4min → 2min)

## Best Practices

1. **Clear IDs**: Use descriptive sync IDs (`story-to-arch`, not `sync1`)
2. **Explicit Models**: Always specify model in `then` section
3. **Document Reasons**: Use `provenance.reason` to explain why
4. **Test Queries**: Verify query logic matches intent
5. **Handle Errors**: Add syncs for failure/blocked states
6. **Use Parallel**: Mark independent actions with `parallel: true`
7. **Validate Independence**: Ensure parallel actions don't conflict

## Anti-Patterns

❌ Complex logic in queries (use separate rules)
❌ Missing where conditions (triggers too often)
❌ Ambiguous concept references
❌ Circular dependencies
❌ Marking dependent actions as parallel
❌ Parallelizing actions that modify shared state

✅ Simple, clear conditions
✅ Specific trigger conditions
✅ Explicit concept names
✅ Directed acyclic graph (DAG)
✅ Parallel for truly independent actions
✅ Sequential for dependent actions

## Example: Complete Feature Workflow

```yaml
# .claude/synchronizations/feature-development.yaml
synchronizations:
  # Story → Architecture (sequential)
  - id: "story-to-arch"
    when: {concept: "story", action: "create", status: "completed"}
    where: {query: "story.status == 'ready' AND story.acceptance_criteria.length > 0"}
    then:
      - concept: "architecture"
        action: "design"
        model: "opus"  # Complex reasoning
        inputs: {story_id: "${story.id}"}

  # Architecture → Implementation (sequential)
  - id: "arch-to-impl"
    when: {concept: "architecture", action: "design", status: "completed"}
    where: {query: "architecture.estimated_risk != 'high'"}
    then:
      - concept: "implementation"
        action: "generate"
        model: "opus"  # Spec-driven
        inputs: {architecture_id: "${architecture.id}"}

  # Implementation → Quality Review + Test (PARALLEL)
  - id: "impl-to-quality-review"
    when: {concept: "implementation", action: "generate", status: "completed"}
    where: {query: "implementation.status == 'completed'"}
    then:
      - concept: "quality"
        action: "review"
        model: "opus"
        parallel: true  # ← Enables parallel execution
        inputs: {implementation_id: "${implementation.id}"}

  - id: "impl-to-quality-test"
    when: {concept: "implementation", action: "generate", status: "completed"}
    where: {query: "implementation.test_files.length > 0"}
    then:
      - concept: "quality"
        action: "test"
        model: "opus"
        parallel: true  # ← Runs simultaneously with review
        inputs: {implementation_id: "${implementation.id}"}

  # Quality → Version (sequential, wait for both quality checks)
  - id: "quality-to-version"
    when: {concept: "quality", action: "review|test", status: "completed"}
    where: {query: "review.status == 'approved' AND test.status == 'passed'"}
    then:
      - concept: "version"
        action: "commit"
        model: "opus"
        inputs:
          implementation_id: "${implementation.id}"
          flow_id: "${flow.id}"
```

**Execution Flow**:
```
Story (Opus)
  ↓
Architecture (Opus)
  ↓
Implementation (Opus)
  ↓
  ├─→ Quality Review (Opus) ──┐
  └─→ Quality Test (Opus) ────┤ [PARALLEL: 50% faster]
                                ↓
                           Version (Opus)
```

**Performance**:
- Traditional: Story → Arch → Impl → Review → Test → Version = 18-20 min
- With Parallel: Story → Arch → Impl → (Review+Test) → Version = 16-18 min
- **Savings**: 2-4 minutes per feature (10-20% faster)

---

**Use this skill when**: Writing synchronization rules, debugging workflow logic, designing new workflows, or optimizing orchestration patterns.
