---
name: pipeline-planning
description: "Guide workflow composition using WYSIWID Pipeline DSL — translate task intent into a validated concept sequence with parallel steps, model hints, and SLO annotations"
applies_to:
  - architecture-concept
  - story-concept
  - implementation-concept
trigger_keywords:
  - workflow
  - pipeline
  - complex task
  - multi-step
  - architecture
  - parallel
  - sequence
  - feature
  - large
  - plan
priority: high
---

# Pipeline Planning Skill

When planning or executing a complex workflow, compose the task as a Pipeline DSL string and validate it before starting execution. The Pipeline DSL makes workflow intent explicit and readable — what you see is what it does (WYSIWID).

## When to Apply

Apply this skill when:
- The task spans multiple concepts (story → architecture → implementation)
- Steps can be parallelized (e.g. architecture and security analysis together)
- You need a clear audit trail of workflow intent
- The task is classified as medium or large complexity

## DSL Syntax Reference

```
story | architecture | implementation | quality | version
story | parallel(architecture, security) | implementation | quality | version @slo:thorough
implementation | quality @slo:fast @errors:graceful
story | arch:opus | impl:opus | verification[2] @slo:thorough
```

**Concepts**: story, architecture, implementation, quality, version, security, documentation, code-analysis, verification, context, retrospective

**Aliases**: arch, impl, verify, docs, sec, retro, qa, ship

**Model hints**: `:opus`, `:opus`, `:opus` — override per-step model

**Pass counts**: `[N]` — run concept N times (e.g. `verification[2]`)

**Actions**: `.action` — target a sub-action (e.g. `quality.review`)

**Annotations** (append after pipeline):
- `@slo:standard` | `@slo:fast` | `@slo:thorough` — execution speed profile
- `@errors:graceful` | `@errors:strict` | `@errors:best_effort` — error handling policy

## Workflow

1. **Classify the task** — bugfix / feature / refactor / docs
2. **Estimate complexity** — small / medium / large based on scope, word count, indicators
3. **Select or compose a DSL string** using the patterns above
4. **Call `dragonfly_compose`** to parse, validate, and render the pipeline:
   ```
   dragonfly_compose({ pipeline: "your | dsl | here @slo:standard" })
   ```
5. **Review the rendered diagram and any warnings** — fix before proceeding
6. **Call `dragonfly_flow_plan`** if you need an execution plan with step-by-step instructions:
   ```
   dragonfly_flow_plan({ pipeline: "story | architecture | implementation | quality | version" })
   ```
7. **Start the workflow** using `dragonfly_start_workflow` — it will auto-select the right DSL and return it as `pipelineDsl` in the response

## Common Pipeline Templates

| Task | Complexity | Pipeline |
|---|---|---|
| Bug fix | small | `implementation \| quality @slo:fast` |
| Bug fix | large | `story \| parallel(architecture, code-analysis) \| implementation \| quality \| version` |
| Feature | medium | `story \| architecture \| implementation \| quality \| version @slo:standard` |
| Feature | large | `story \| parallel(architecture, security) \| implementation \| quality \| version @slo:thorough` |
| Refactor | medium | `architecture \| implementation \| quality \| version @slo:standard` |
| Documentation | any | `documentation @slo:fast` |

## Reading the Pipeline in Agent Context

When `dragonfly_advance_workflow` returns your step, the `enrichedPrompt` includes a **Workflow Pipeline** header showing the full DSL and your current position:

```
## Workflow Pipeline

`story | parallel(architecture, security) | implementation | quality | version @slo:thorough`

**Current step**: architecture (step 2 of 6)
```

This tells you what came before, what runs in parallel with you, and what follows — so you can calibrate the depth of your output accordingly.

## Validation Rules

**Errors** (block execution):
- Unknown concept name
- Unknown model hint (valid: opus, sonnet, haiku)
- `parallel()` with fewer than 2 concepts

**Warnings** (proceed with awareness):
- Story is not the first step
- Implementation precedes architecture
- Concept appears more than once
- Pass count outside 1–3 range
- Unrecognized SLO profile or error policy
