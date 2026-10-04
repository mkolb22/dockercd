---
topic: DevOps and GitOps quality-first development
tags: [devops, gitops, validation, recovery, provenance]
source_type: DockerCD-local adaptation of bodhi-ai@ca7d286a712441250dff6cda75bcb97e03e37719 knowledge/technology/devops-gitops-quality-first-development.md plus DORA, OpenGitOps, and SLSA guidance
confidence: medium
acquired: 2026-10-04
load_when: planning DockerCD delivery, validation, recovery, or documentation work
limitations: Versioned source and checks do not authorize deployment or replace runtime evidence.
---

# DevOps and GitOps quality-first development

Use small coherent changes, continuous targeted testing, exact candidate
identities, independent review, and recovery planning. Keep delivery readiness,
code publication, and Docker deployment as separate decisions. Git rollback
does not undo external operations or data changes.

Document architecture, rationale, risks, evaluation, cost, and operations in
proportion to the change. Treat observed runtime drift as a prompt for an
evidence-backed repair, never an automatic reconciliation permission.

Sources: [DORA continuous delivery](https://dora.dev/capabilities/continuous-delivery/),
[DORA small batches](https://dora.dev/capabilities/working-in-small-batches/),
[OpenGitOps](https://opengitops.dev/), and [SLSA provenance](https://slsa.dev/spec/v1.2/provenance).
