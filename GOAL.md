# DockerCD v0.1 Release Scope Lock

## Objective

Ship DockerCD v0.1 as a secure, dependable GitOps controller for **one Docker
Compose host**, with an honest, unprivileged Web monitoring experience. This is
not a general-purpose container platform, multi-cluster orchestrator, or
browser-based administrator proxy.

The scope is locked: new product capabilities do not enter v0.1 unless they
correct a release-blocking defect, security vulnerability, data-integrity risk,
or documented v0.1 acceptance gap. All other requests enter the
[product backlog](docs/BACKLOG.md).

## v0.1 Product Promise

> DockerCD continuously reconciles Git-managed Compose applications on one
> Docker host, exposes trustworthy deployment and health evidence through an
> authenticated API and a least-privileged Web presentation, and gives
> operators deterministic CLI/API recovery controls.

## Active v0.1 Tranche: environment control path and capacity evidence

ADR 0007 admits a paired, read-only controller/Web feature that lets an
operator understand the control-plane state and current aggregate Docker
pressure without restoring an administrator-token browser path.

- The controller exposes only `controller:status` (process response plus
  state-database readiness) and host-global aggregate `capacity:read`.
- The Web Fleet view consumes both typed contracts to render the two-node
  control path, controller-authored freshness, and CPU/memory/container sample
  evidence. It must distinguish ready, unready, unavailable, partial,
  truncated, stale, and malformed evidence; it must never silently substitute
  zero values or browser-clock freshness.
- The capacity collector must have bounded metadata/stat response bodies,
  Docker-side list limits, fixed worker concurrency, deadlines, coalescing,
  failure backoff, counter-baseline validation, and no disk/image/per-container
  output. It is a current-pressure sample, never deployment admission proof.
- The obsolete fixture-only System route/templates are removed as part of this
  tranche. No new controller capability may be left without its typed Web
  consumer, contract fixture, failure-path tests, and release evidence.

This tranche remains **in progress**. It cannot be committed or deployed until
the open P1/P2 findings in [SESSION_HANDOFF.md](docs/SESSION_HANDOFF.md) are
resolved and an independent high-reasoning re-review is clean.

## Required v0.1 Features

### 1. Single-host GitOps control plane

- Validate application manifests and reconcile Git-managed Docker Compose
  applications to one configured Docker host.
- Support the standard Compose deployment path only.
- Retain desired revision, successful deployment time, reconciliation result,
  bounded history, and health-observation evidence.
- Provide explicit authenticated CLI/API sync, dry-run/diff, and rollback to a
  known retained revision. A redirect, lost response, or browser page is never
  treated as proof of an operation outcome.

### 2. Reliable operational evidence

- Report distinct desired revision, successful sync time, controller response
  time, and live Docker observation time; never synthesize freshness from a
  browser clock.
- Provide bounded, redacted event/status data, health/readiness checks,
  restart recovery, migrations, and documented backup/recovery steps.
- Keep polling, Git/Docker work, request bodies, queues, inspections, and
  concurrency bounded with deadlines and cancellation.
- Expose capability-scoped controller-ready evidence and a cached aggregate
  CPU/memory/container sample to the Web presentation. This shows current
  pressure; it never guarantees that a future deployment fits.

### 3. Secure, deployable controller

- Require authenticated non-loopback control-plane access and preserve the
  completed secret redaction, Git-source validation, audit, and dependency
  remediation work.
- Keep Docker socket, Git credentials, controller registry, SQLite state, and
  source cache inside the controller trust boundary.
- Maintain reproducible images, safe Compose examples, configuration
  validation, and release evidence for tests, race detection, image builds,
  migrations, and recovery.

### 4. Separate Web presentation service

- Ship `dockercd-web` as an unprivileged, server-rendered, no-authored-
  JavaScript monitoring surface with no Docker, Git, SQLite, source-cache, or
  broad administrator-token access.
- Use only the versioned, capability-scoped, resource-filtered presentation
  API and controller-authored freshness metadata.
- Support the implemented local-password bootstrap with server-side opaque
  sessions and scoped controller credentials. OIDC is not a v0.1 requirement.
- Keep the browser experience **read-only** in v0.1. Mutations remain on the
  authenticated CLI/API until a durable, idempotent operation contract exists.

### 5. Finished-codebase requirement: remove the legacy embedded UI

The old controller-embedded browser UI is a migration aid, not a supported
v0.1 product surface. Before declaring v0.1 complete:

1. Inventory every embedded static asset, browser session/login route, UI
   redirect, documentation reference, test, and deployment assumption.
2. Confirm that the v0.1 Web service provides the supported monitoring journey
   and that documented CLI/API workflows cover required sync, dry-run/diff,
   rollback, and recovery operations.
3. Remove the embedded SPA/static assets, UI-only browser session endpoints,
   redirects, dead configuration, tests, and documentation. Do not retain
   compatibility shims that leave a second human UI path in the controller.
4. Preserve versioned authenticated API and CLI compatibility. If removing a
   UI-only path would break an identified client, document the migration and
   obtain release-owner approval before the incompatible change.
5. Prove the controller image no longer contains the legacy UI assets and the
   Web image remains the only browser presentation surface.

This removal is intentionally a **release-completion gate**, not an immediate
deletion: it happens only after the replacement workflows and migration
evidence are complete.

### 6. Minimal paired deployment and safe migration

- Ship only the paired `dockercd` and `dockercd-web` development deployment.
- Keep the personal Signal-only pair on a dedicated migration branch until its
  current controller is pinned or paused in an explicit migration window;
  publishing a removed manifest to an active controller is not a safe cleanup.
- Preserve existing Signal data storage by default. Any new-volume migration
  needs separate backup, restore verification, and release-owner approval.
- Treat separate Compose project names, networks, volumes, and credentials as
  configuration separation only on a shared Docker daemon. Strong
  development/personal isolation requires separate Docker daemons or hosts.

## Explicitly Deferred to the Backlog

The detailed admission criteria and deferred-item record live in
[docs/BACKLOG.md](docs/BACKLOG.md). The following list is the v0.1 scope lock:

- Active/passive control-plane hardening, automatic failover, leader fencing,
  state replication, and multi-node recovery.
- Multi-host or remote Docker fleet management.
- Blue-green deployment strategy and advanced adoption/import workflows.
- Browser mutation flows, approval UX, idempotent operation resources,
  operation cancellation, and replay-safe retries.
- OIDC/SSO, controller credential reload/rotation, and multi-instance Web
  session storage.
- Native TLS termination in `dockercd-web` (planned for v0.2), including
  certificate lifecycle and direct network browser exposure.
- SSE/live browser updates, retained metrics/charts, broad log streaming,
  advanced desired topology, deep diffs, and service inspection views.
- Swift macOS client implementation.
- AI-assisted operator features or any model with control-plane authority.

## Clean-Code Requirements

- Keep controller, presentation API, Web rendering, and deployment concerns in
  explicit packages with typed contracts; no generic API proxy or direct
  browser-to-controller credential path.
- Delete dead code, obsolete configuration, unused dependencies, stale tests,
  and duplicate documentation as each v0.1 release gate completes.
- Treat code review, targeted refactoring, and performance/bounded-work review
  as release work, not optional polish. Refactoring must preserve documented
  behavior, reduce a demonstrated risk or duplication, and include regression
  evidence; it must not become an open-ended rewrite.
- Make compatibility decisions deliberate: additive versioned API changes by
  default; explicit migration notes for any removal.
- Each feature tranche requires design evidence, focused regression tests,
  full relevant test/vet/race validation, and an independent high-reasoning
  review. No P0/P1 finding may remain open; every P2 finding requires a
  documented resolution or explicit release-owner disposition.

## Definition of Done

1. Every required feature above is implemented, documented, and covered by
   behavior and failure-path tests.
2. Deferred features are absent from v0.1 release documentation and tracked
   only in the backlog.
3. The legacy embedded UI and its controller-only browser paths are removed
   following the migration gate above; no dead UI code remains in release
   images or runtime routes.
4. `go test ./...`, `go vet ./...`, and `go test -race ./...` pass in both
   `src/` and `web/`; required security/dependency checks and image builds are
   recorded.
5. A release record identifies the tested revision, image digests, migration
   notes, backup/restore evidence, presentation contract compatibility,
   accessibility/owner evidence, independent-review disposition, and
   performance/bounded-work review results.
6. The release owner explicitly approves the v0.1 candidate and any
   documented compatibility migration.

The current evidence and ordered gates are tracked in
[docs/v0.1-release-readiness.md](docs/v0.1-release-readiness.md).

## Backlog Admission Rule

A new idea starts as a backlog item with its user problem, security impact,
operational cost, dependencies, and release target. It moves into an active
release only through an approved ADR and a deliberate scope change; it does
not enter by implementation momentum.
