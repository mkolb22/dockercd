# DockerCD quality-first development practice

Version: 0.1. This is a DockerCD-local adaptation of Bodhi's shared practice,
adopted on 2026-10-04. Upstream provenance: `bodhi-ai` commit
`ca7d286a712441250dff6cda75bcb97e03e37719`,
`docs/quality-first-development-practice.md`. This adaptation is not evidence
that the workflow is universally enforced or experimentally proven.

## Lifecycle

For each meaningful tranche, record one JSON packet under
`docs/tranche-packets/` and use the validator described in `CLAUDE.md`.

1. Frame scope, baseline, owner authority, side effects, and acceptance.
2. Retrieve bounded project and engineering evidence, hash repository-local
   sources, and record `no_gap`, `curated`, or `blocked` before dependent code.
3. Derive invariants and tests, implement the smallest coherent candidate, and
   bind validation to its exact revision or content identity.
4. On a resumed session, revalidate recorded source hashes. Missing or changed
   evidence is stale until refreshed.
5. Before acceptance, record documentation coverage, independent review and
   repair, outcome, recommendations, and learning. The validator remains
   advisory; it never grants acceptance, commit, push, or deployment authority.

## DockerCD-specific safety

Docker socket access, controller credentials, Git credentials, SQLite state,
and personal workloads are safety boundaries. Fixture-only checks are preferred
for development. The disposable recovery drill may execute only on its
purpose-built daemon after the documented preflight; development, personal,
Signal, default, protected, and ambiguous contexts are not substitutes.

Documentation is risk-scaled: explain architecture, decisions, risks,
evaluation, cost, and operations in existing documents or explain why a
category is unchanged or not applicable. A passing test suite does not replace
independent review or owner-authorized release decisions.
