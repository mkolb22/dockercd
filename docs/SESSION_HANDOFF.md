# Session handoff — 2026-09-18

## Safe stopping point

Last committed and pushed revision: `c687dd9` (`Add scoped capacity and
controller evidence`).

The repository has a **complete, reviewed, committed, undeployed**
implementation of ADR 0007. Development and personal paired deployments
remain on the prior reviewed image. Controllers remain healthy. Signal and its
external data volume were not recreated, restarted, or modified.

## Completed and committed

- Scoped control-plane/Web architecture and local-password Web session boundary.
- Legacy embedded controller UI retirement and prior live-UX correction.
- v0.1 scope and roadmap: [GOAL](../GOAL.md), [ADR 0007](adr/0007-scoped-capacity-and-controller-health.md), [visual design](environment-control-path-design.md), and [iterations](release-iterations.md).

## Committed implementation ready for release-candidate deployment

The current tree adds `controller:status` and host-global `capacity:read`
presentation routes/capabilities, database-only readiness, an aggregate
capacity sampler, typed Web client/Fleet rendering, controller/capacity
evidence drill-down, and removal of the obsolete fixture-only `/system`
route/templates. It has a five-second coalescing cache, bounded Docker
metadata/stat bodies, a hard returned-list cap, fixed workers, deadline tests,
strict cross-module fixtures, and redacted failure paths.

## Completed review and validation evidence

Independent high-reasoning review found **no P0, P1, or P2**. The reviewer
verified bounded metadata and stat reads, CPU baselines/pruning, list/work
limits, caller and internal deadlines, valid-but-unscoped denial, redacted
collector failure, cache coalescing, strict fixtures, truthful Web evidence
mapping, and rendered drill-down/failure states. Full `test`, `vet`, and
`race` suites passed in both Go modules at this working-tree revision.

## Required completion sequence

1. Update local, ignored credential registries to grant only
   `controller:status` and `capacity:read` to the intended Web subjects. Never
   print or commit registries or credentials.
2. Build matching controller/Web images and deploy the paired development and
   personal services only after recording the tested revision. Do not touch
   Signal data or restart its existing workload without the separate cutover
   process.
3. Run the paired owner workflow and record the rendered controller-evidence,
   capacity-evidence, sign-in, controller-unready, and collector-failure
   states. Then continue the remaining v0.1 release gates.
4. Re-run from both modules if the candidate changes:

   ```sh
   cd src && go test ./... && go vet ./... && go test -race ./...
   cd web && go test ./... && go vet ./... && go test -race ./...
   ```


## Safety constraints

- Never log or commit tokens, passwords, registries, or secret values.
- Keep the controller private; never give `dockercd-web` Docker, Git, SQLite, source-cache, or admin-token access.
- `capacity:read` is host-global aggregate authority; it never returns workload identities, configuration, logs, or per-container values.
- Current capacity is not a deployment-admission decision.
- Do not restart/migrate Signal or retire legacy containers without the separate backup/cutover process.
