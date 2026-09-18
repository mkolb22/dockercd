# DockerCD release iterations

DockerCD starts at **v0.1**. The control plane has valuable foundations, but
the separated presentation service is still being refined into a complete,
evidence-first operator experience. A `0.x` sequence makes that work explicit
without treating an unfinished monitoring contract as a v1 compatibility
promise.

## v0.1 — dependable single-host foundation

The active release scope in [GOAL.md](../GOAL.md) covers one Docker host,
Git-managed Compose reconciliation, authenticated recovery controls, legacy UI
retirement, a separate read-only Web service, and the essential environment
evidence needed to operate it: controller state-database readiness, scoped
response freshness, aggregate current capacity, application health, and
bounded activity.

## v0.2 — secure local-network presentation

Candidate work remains backlog work until an ADR admits it. The leading
candidate is native `dockercd-web` TLS for a two-container MacBook/server
deployment. It includes certificate lifecycle, direct-network exposure policy,
and real TLS-client validation; the control-plane API stays private.

## Later iterations

Later releases may add redacted desired-state/diff/history evidence,
service-level inspection, durable browser operation resources, multi-controller
presentation, or high-availability hardening. Each is independently admitted
only after its trust boundary, failure behavior, bounded-work budget, tests,
and release target are recorded in an ADR.

## Versioning rule

- A release candidate identifies one tested commit, image digest, migration
  record, and owner approval.
- Patch releases correct defects without widening capabilities or changing the
  presentation contract unexpectedly.
- A minor `0.x` increment is used for an intentionally admitted feature
  tranche, including its documented compatibility and review evidence.
- v1.0 is considered only after several owner-validated iterations establish a
  stable single-host control plane, local-network presentation path, recovery
  evidence, and scoped monitoring contract.
