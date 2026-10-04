---
topic: quality-first development workflow
tags: [research, review, documentation, evaluation]
source_type: DockerCD-local adaptation of bodhi-ai@ca7d286a712441250dff6cda75bcb97e03e37719 knowledge/epistemics/quality-first-ai-development-workflow.md
confidence: medium
acquired: 2026-10-04
load_when: planning a meaningful DockerCD change or evaluating process evidence
limitations: More agents, context, or tests do not prove mergeability or eliminate defects.
---

# Quality-first development workflow

Treat a reviewed, documented, validated candidate—not generated output or task
count—as the unit of progress. Research/reuse and behavior design precede
implementation; documentation reconciles as-built behavior; independent review
remains necessary after tests.

Use small, reversible changes and distinguish declared evidence from observed
runtime state. The workflow is a bounded pilot. Evaluate its value through
fewer repeated defects, correction effort, owner attention, and comparable
future work; do not claim token savings or quality improvement from one run.
