---
name: WYSIWID Principles
description: Expert knowledge of WYSIWID (What You See Is What It Does) architecture pattern for legible software systems
version: 1.0.0
trigger_keywords: [WYSIWID, legibility, modularity, concepts, synchronizations, declarative, behavioral transparency]
author: Dragonfly Architecture
references:
  - "What You See Is What It Does: A Structural Pattern for Legible Software (Eagon Meng & Daniel Jackson, MIT)"
---

# WYSIWID Principles - Expert Skill

Deep expertise in the WYSIWID (What You See Is What It Does) architectural pattern for creating legible, maintainable software systems.

## Core Philosophy

**The Problem**: Software illegibility - code structure doesn't match observable behavior
**The Solution**: WYSIWID architecture where system behavior is predictable from reading declarative rules
**The Result**: Legible systems that humans and AI can understand and maintain

## The Three Pillars of WYSIWID

### 1. Concepts (Independent Services)

**Definition**: Self-contained, stateful services that perform specific actions.

**Key Characteristics**:
- **Independence**: Concepts never call other concepts (enforced modularity)
- **Polymorphism**: Work for ANY similar domain (story works for requirements, tickets, issues)
- **State**: Maintain their own state in isolated storage
- **Actions**: Well-defined operations they can perform

**In Dragonfly**:
```
story       - Captures requirements (any requirements system)
architecture - Designs solutions (any architecture approach)
implementation - Generates code (any programming paradigm)
quality     - Reviews and tests (any quality methodology)
version     - Manages git (any version control workflow)
context     - Manages tokens (any context strategy)
```

**Anti-Pattern**:
```markdown
❌ WRONG: Architecture concept calls Implementation
✅ RIGHT: Architecture completes → Sync triggers Implementation
```

### 2. Synchronizations (Declarative Orchestration)

**Definition**: YAML rules that define WHEN concepts trigger and HOW they interact.

**Structure**:
```yaml
- id: "rule-name"
  when:
    concept: "source"
    action: "action-name"
    status: "completed"
  where:
    query: "condition to evaluate"
  then:
    - concept: "target"
      action: "action-name"
      model: "sonnet|opus"
      inputs: {...}
```

**Key Principles**:
- **Declarative**: Rules describe WHAT happens, not HOW
- **Evaluable**: Humans can read and predict behavior
- **Observable**: What you see (rules) is what it does (behavior)
- **Modifiable**: Change rules without touching concepts

**Query Language**:
```yaml
where:
  query: |
    story.status == 'ready' AND
    story.acceptance_criteria.length > 0 AND
    story.ambiguities.length == 0
```

Supports:
- Field access: `story.status`, `architecture.risk`
- Comparisons: `==`, `!=`, `<`, `>`, `<=`, `>=`
- Logical: `AND`, `OR`, `NOT`
- Array operations: `.length`, `.filter()`, `.includes()`

### 3. Provenance (Complete Audit Trail)

**Definition**: Every action tracked with complete context.

**What's Tracked**:
```yaml
action_id: "act-001"
timestamp: "2025-11-09T22:00:00Z"
concept: "story"
model: "opus"
action: "create"
status: "completed"
triggered_by: null  # or parent action_id
sync_id: "story-to-arch"  # which sync triggered this
flow_id: "flow-2025-11-09-22h00m00s"
cost:
  input_tokens: 1200
  output_tokens: 450
  cost_usd: 0.000175
```

**Benefits**:
- **Traceability**: Every action links to its cause
- **Cost attribution**: Track spending per feature
- **Debugging**: Understand why things happened
- **Auditing**: Complete history for compliance

## WYSIWID in Practice

### Example: Feature Development Workflow

**Traditional (Illegible)**:
```python
def process_feature(request):
    story = create_story(request)
    if story.ready:
        arch = design_architecture(story)  # Hidden logic
        if arch.risk != 'high':
            impl = implement(arch)  # More hidden logic
            # ... complexity hidden in code
```

**WYSIWID (Legible)**:
```yaml
# .claude/synchronizations/feature-development.yaml

# Story → Architecture
- when: {concept: story, status: completed}
  where: "story.status == 'ready'"
  then: {concept: architecture, action: design}

# Architecture → Implementation
- when: {concept: architecture, status: completed}
  where: "architecture.risk != 'high'"
  then: {concept: implementation, action: generate}
```

**Key Difference**:
- Traditional: Behavior hidden in imperative code
- WYSIWID: Behavior visible in declarative rules

Anyone reading the YAML can predict exactly what the system will do.

## Applying WYSIWID Principles

### When to Use Concepts

Create a concept when you have:
1. **A distinct responsibility** (capture requirements, design architecture, etc.)
2. **Independent state** (needs its own storage)
3. **Reusable actions** (works across different contexts)
4. **Clear boundaries** (doesn't need to know about other concepts)

### When to Use Synchronizations

Create a sync rule when:
1. **Workflow transition** needed (story complete → start architecture)
2. **Conditional logic** required (only if risk is low)
3. **Parallel execution** needed (review + test simultaneously)
4. **Error handling** required (architecture fails → clarify story)

### When to Use Provenance

Always! Provenance is not optional in WYSIWID:
- Track every concept action
- Record synchronization triggers
- Maintain flow identifiers
- Calculate costs

## Common WYSIWID Patterns

### 1. Sequential Workflow
```yaml
story → architecture → implementation → quality → version
```
Each step triggers next via synchronization.

### 2. Parallel Execution
```yaml
implementation →  quality.review
               →  quality.test
```
Multiple concepts triggered simultaneously.

### 3. Conditional Branching
```yaml
architecture → implementation (if risk == 'low')
            → human-review (if risk == 'high')
```
Different paths based on state.

### 4. Error Recovery
```yaml
implementation → quality.review → version.commit (if approved)
              → implementation.refactor (if needs_changes)
              → architecture.revise (if architectural_issues)
```
Failed paths trigger correction workflows.

### 5. Iterative Refinement
```yaml
story → architecture → story.clarify (if ambiguous)
     → architecture (retry with clarity)
```
Loop back for refinement.

## Anti-Patterns to Avoid

### ❌ Concept Calling Concept
```markdown
# architecture.md
After designing, I'll call the implementation concept...
```
**Why wrong**: Breaks modularity, creates hidden coupling
**Fix**: Let synchronization trigger implementation

### ❌ Imperative Synchronizations
```yaml
then:
  - concept: implementation
    action: |
      if complexity > 10:
        use_sonnet()
      else:
        use_sonnet()
```
**Why wrong**: Logic hidden in code, not declarative
**Fix**: Use separate sync rules with clear conditions

### ❌ Missing Provenance
```yaml
# Concept completes but doesn't log action
```
**Why wrong**: Lost traceability, can't debug
**Fix**: Always emit provenance entries

### ❌ Ambiguous Concept Boundaries
```markdown
# story.md
The story concept also validates technical feasibility...
```
**Why wrong**: Overlaps with architecture responsibility
**Fix**: Keep concepts focused on single responsibility

## Benefits of WYSIWID Architecture

### 1. Legibility
- Read synchronizations → predict behavior
- No hidden logic in imperative code
- Clear cause-and-effect chains

### 2. Maintainability
- Change rules without touching concepts
- Concepts are independently testable
- Refactor one concept without affecting others

### 3. Debuggability
- Provenance shows exactly what happened
- Trace any action to its root cause
- Identify bottlenecks and failures

### 4. AI-Friendly
- Declarative rules easier for AI to generate
- Clear structure for AI comprehension
- Concepts provide context boundaries

### 5. Cost Optimization
- Track spending per concept
- Optimize model selection by concept type
- Identify expensive operations

## WYSIWID vs Traditional Architectures

| Aspect | Traditional MVC | Microservices | WYSIWID |
|--------|----------------|---------------|---------|
| **Modularity** | Layers | Services | Concepts |
| **Orchestration** | Controllers | API Gateway | Synchronizations |
| **Coupling** | Tight (method calls) | Loose (HTTP) | None (declarative) |
| **Legibility** | Code reading | API docs | YAML rules |
| **Tracing** | Logs (maybe) | Distributed tracing | Provenance (always) |
| **Testing** | Unit + Integration | Contract tests | Concept + Sync tests |

## Implementation Guidance

### Starting a New WYSIWID Project

1. **Identify Concepts**
   - What are the major responsibilities?
   - What needs independent state?
   - What actions are reusable?

2. **Define Actions**
   - What can each concept do?
   - What inputs does it need?
   - What outputs does it produce?

3. **Map Workflows**
   - How do concepts interact?
   - What triggers what?
   - What conditions apply?

4. **Write Synchronizations**
   - Create YAML rules
   - Test rule evaluation
   - Verify legibility (can humans predict behavior?)

5. **Implement Provenance**
   - Log every action
   - Track synchronization triggers
   - Maintain flow identifiers

### Migrating to WYSIWID

1. **Make Implicit Explicit**
   - Identify hidden orchestration logic
   - Extract to synchronization rules
   - Document why each rule exists

2. **Isolate Concepts**
   - Find coupled components
   - Break direct dependencies
   - Route through synchronizations

3. **Add Provenance**
   - Start logging actions
   - Build traceability chains
   - Analyze and optimize

## Questions WYSIWID Answers

**"Why did this happen?"**
→ Check provenance, trace triggered_by chain

**"What happens next?"**
→ Read synchronizations, find matching rules

**"Can I change this workflow?"**
→ Edit YAML rules, behavior changes immediately

**"How much does this cost?"**
→ Query provenance by flow_id, sum costs

**"Is this component reusable?"**
→ Yes, concepts are polymorphic and independent

## Further Reading

- Original WYSIWID paper: "What You See Is What It Does" (Meng & Jackson, MIT)
- Dragonfly synchronization documentation: `.claude/synchronizations/`
- Concept development guide: See `concept-development` skill
- Provenance analysis: See `provenance-analysis` skill

---

**Use this skill when**: Discussing WYSIWID principles, designing workflows, explaining architecture decisions, debugging concept interactions, or teaching WYSIWID to others.
