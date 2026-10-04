---
topic: evidence-driven tranche workflow
tags: [software-engineering, provenance, validation, review]
source_type: DockerCD-local adaptation of Bodhi commit ca7d286a712441250dff6cda75bcb97e03e37719 knowledge/computer-science/evidence-driven-tranche-workflow.md, informed by NIST AI RMF 1.0 and SLSA provenance
confidence: medium
acquired: 2026-10-04
load_when: framing, resuming, reviewing, or accepting a meaningful DockerCD tranche
limitations: Declared evidence and hashes do not establish semantic correctness, current external facts, or approval.
---

# Evidence-driven tranche workflow

Frame the exact boundary and candidate before coding. Record bounded local
evidence, content hashes, a knowledge-gap disposition, and the design/test
invariants that follow. A `blocked` gap prevents dependent implementation;
`no_gap` is valid and must not create filler knowledge.

Validate the exact candidate, obtain an independent review, repair confirmed
findings, and revalidate. On resume, hash checks detect stale local evidence.
This provides review context only: it cannot infer unrecorded work, authorize
Docker access, promote knowledge, or accept a release.

Sources: [NIST AI RMF 1.0](https://doi.org/10.6028/NIST.AI.100-1) and
[SLSA Provenance v1.2](https://slsa.dev/spec/v1.2/provenance). These sources
inform lifecycle evidence and artifact identity; they do not certify DockerCD
or this workflow.
