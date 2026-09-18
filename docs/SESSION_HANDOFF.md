# Session handoff — 2026-09-18

## Safe stopping point

Last committed and pushed revision: `70a2140` (`Design scoped capacity observability for v0.1`).

The working tree has an **incomplete, uncommitted, undeployed** implementation of ADR 0007. Do not commit, push, build, or deploy it as-is. Development and personal paired deployments remain on the prior reviewed image. Controllers remain healthy. Signal and its external data volume were not recreated, restarted, or modified.

## Completed and committed

- Scoped control-plane/Web architecture and local-password Web session boundary.
- Legacy embedded controller UI retirement and prior live-UX correction.
- v0.1 scope and roadmap: [GOAL](../GOAL.md), [ADR 0007](adr/0007-scoped-capacity-and-controller-health.md), [visual design](environment-control-path-design.md), and [iterations](release-iterations.md).

## Uncommitted implementation

The current tree adds `controller:status` and host-global `capacity:read` presentation routes/capabilities, database-only readiness, an aggregate capacity sampler, typed Web client/Fleet rendering, and removal of the obsolete fixture-only `/system` route/templates. It includes a first-pass five-second capacity cache and bounded per-container workers, but is not release-ready.

## Blocking review findings

Independent high-reasoning review found no P0, but these remain open:

1. **P1:** Docker `Info` and `ContainerList` have no ADR-required 1 MiB response bound. List count does not bound labels/JSON bytes. Add a narrow bounded metadata adapter and oversized-response tests.
2. **P1:** Add CPU baseline tests: first sample partial/CPU unavailable, second sample normalized current CPU, counter rollback rejection, and bounded stale-baseline pruning. Docker one-shot stats do not populate `PreCPUStats`.
3. **P2:** Web currently ignores controller-authored sample age/order, observed-versus-eligible counts, partial/truncated/unavailable state, and invalid numbers. Enforce the ADR 15-second rule from `responseGeneratedAt - sampleCompletedAt`; reject future/inconsistent data.
4. **P2:** Render database-unready, unavailable capability, and failed capacity as distinct named evidence. Do not hide capacity failures or show zeroes.
5. **P2:** Add API authorization/redaction/cache tests, strict controller/Web JSON fixtures, inspector bounds/CPU tests, and Web state tests.

Authorization direction and aggregate DTO allowlisting were reviewed as sound. Do not reuse broad administrator endpoints/tokens to shortcut this work.

## Required completion sequence

1. Finish bounded metadata/capacity collection and test cache/failure behavior.
2. Complete Web freshness/completeness/failure-state rendering.
3. Add controller, contract, inspector, and Web regression coverage.
4. Run from both modules:

   ```sh
   cd src && go test ./... && go vet ./... && go test -race ./...
   cd web && go test ./... && go vet ./... && go test -race ./...
   ```

5. Obtain a fresh high-reasoning review; resolve P0/P1 and document P2.
6. Commit/push only when clean. Then explicitly update local credential registries to grant `controller:status` and `capacity:read` without printing or committing secrets, build matching images, and deploy both paired controller/Web services. Do not touch Signal.

## Safety constraints

- Never log or commit tokens, passwords, registries, or secret values.
- Keep the controller private; never give `dockercd-web` Docker, Git, SQLite, source-cache, or admin-token access.
- `capacity:read` is host-global aggregate authority; it never returns workload identities, configuration, logs, or per-container values.
- Current capacity is not a deployment-admission decision.
- Do not restart/migrate Signal or retire legacy containers without the separate backup/cutover process.
