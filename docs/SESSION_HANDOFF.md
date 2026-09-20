# Session handoff — 2026-09-18

## Safe stopping point

Last deployed source revision: `4488eec` (`Remove deferred cluster and Node
tooling`); deployment/security evidence is committed in `96f73bb`. The
capacity/controller implementation itself is `c687dd9`.

The repository has a **complete, reviewed, committed, and paired-deployed**
implementation of ADR 0007. Development and personal paired deployments run
the matching local `4488eec` image tags. Controllers remain healthy; the
scoped endpoints reject unauthenticated calls; Web roots redirect to local
sign-in and sign-in routes respond. Signal remains running and healthy; its
container and external data volume were not recreated, restarted, or modified.

The disposable recovery drill is deliberately not runnable on the current
Docker Desktop context: a read-only context inventory on 2026-09-18 found only
`default` and the active `desktop-linux` context, not a dedicated drill daemon.
The drill design requires that isolated context so its Docker-socket authority
cannot affect the deployed pairs or Signal. This is an execution prerequisite,
not a reason to relax isolation or reuse the active daemon.

## Completed and committed

- Scoped control-plane/Web architecture and local-password Web session boundary.
- Legacy embedded controller UI retirement and prior live-UX correction.
- Active/passive source and dormant root Node tooling archived; legacy cluster
  configuration is rejected before controller startup.
- v0.1 scope and roadmap: [GOAL](../GOAL.md), [ADR 0007](adr/0007-scoped-capacity-and-controller-health.md), [visual design](environment-control-path-design.md), and [iterations](release-iterations.md).

## Deployed implementation awaiting owner-facing evidence

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

1. Implement and execute the independently re-reviewed disposable recovery
   drill workflow after the now-implemented, fail-closed dedicated-daemon
   preflight and stopped-snapshot verifier: deterministic revision sequencing,
   CLI/API assertions, consistent SQLite backup/restore, Docker-daemon
   isolation, and recorded non-impact on both deployed pairs and Signal.
2. Run the paired owner workflow and record the rendered controller-evidence,
   capacity-evidence, sign-in, controller-unready, and collector-failure
   states. Then continue the remaining v0.1 release gates.
3. Re-run from both modules if the candidate changes:

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
