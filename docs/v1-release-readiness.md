# v1.0 release readiness matrix

## How to use this matrix

This document converts the locked [v1.0 goal](../GOAL.md) into release gates.
“Implemented” means code exists and has prior evidence; it does **not** mean a
feature is ready to ship until its current-revision validation and release
record are complete.

## Core readiness

| Release gate | Current state | Required completion evidence |
| --- | --- | --- |
| Git-managed manifest reconciliation | Implemented | Current-revision manifest, Git-sync, scheduler, and failure-path tests; operator runbook. |
| Standard Compose deployment | Implemented | Normal deployment, failed health, retry, and rollback evidence with blue-green disabled/absent from v1 config. |
| Authenticated CLI/API recovery | Runbook designed | Execute the [operator recovery runbook](operator-recovery-runbook.md) against a disposable deployment, record failure-path evidence, and prove no required browser-admin path. |
| Status, history, and observation truthfulness | Implemented foundation | Current controller/Web contract fixtures and mixed-age/failed/unknown state review. |
| Security and bounded work | Implemented remediation | Re-run documented security/dependency checks and record residual findings for the release revision. |
| Code quality, refactoring, and performance review | In progress | Complete focused cleanup of every v1 release tranche; preserve behavior with regression tests; record independent review and hot-path bounded-work/performance evidence. No unresolved P0/P1 and no undocumented P2 finding. |
| Backup, migrations, and recovery | Partially evidenced | Fresh backup/restore drill against a disposable copy, migration upgrade test, and recovery runbook. |
| Separate read-only Web monitoring | Implemented foundation | Owner workflow/accessibility validation, local-auth deployment proof, and scoped-controller failure/restart evidence. |
| Minimal paired deployment | Source/configuration complete; no live cutover | Compose-render proof and high-reasoning review are recorded. Before any personal cutover: verify Signal backup/restore, pin or pause the existing `main`-tracking controller, and use a separate Docker daemon/host if development/personal security isolation is required. |
| Legacy embedded UI removal | Source retirement implemented | Record replacement-workflow proof, tested image digest/binary and route evidence, release notes, and final release-owner approval. See [ADR 0005](adr/0005-retire-legacy-embedded-controller-ui.md). |

## Decisions to close before deletion work

### Application bootstrap and editing

**Recommendation:** make Git-managed manifests the only supported application
source of truth. Keep a narrowly documented authenticated CLI/API bootstrap
path only if it writes the same manifest source of truth; otherwise retire the
direct create/update/delete flow during the cleanup release.

This avoids two competing desired-state authorities: a Git manifest repository
and mutable controller database records.

### Controller observability

**Recommendation:** retain bounded health, status, recent events, the single
host snapshot, and the existing authenticated controller event stream for
native/API clients. Defer **browser live updates**, charts, detailed service
metrics, broad logs, and topology. A v1 operator needs evidence to recover,
not a second dashboard platform.

### Deployment strategy

**Recommendation:** ship in-place standard Compose reconciliation only. Mark
blue-green and adoption unsupported in v1 configuration and documentation,
then remove or isolate their code after compatibility review.

## Legacy UI retirement status

1. The recovery runbook, retirement ADR, and compatibility inventory are
   recorded.
2. The controller's root/UI redirects, embedded assets, browser-session routes,
   cookie fallback, and cookie-only CSRF code are removed. Bearer API, scoped
   presentation, SSE, probes, and webhooks remain.
3. Regression tests prove the retired routes are absent, cookies cannot
   authenticate JSON or SSE, a malformed bearer cannot fall back to a cookie,
   and valid bearer SSE remains available without the former CSRF header.
4. Remaining gates: execute replacement workflows against a disposable
   deployment, inspect and record the final controller image digest/binary,
   publish the migration note, and obtain final release-owner approval.

## First implementation tranche after reset

The initial inventory and removal design are complete in
[ADR 0005](adr/0005-retire-legacy-embedded-controller-ui.md) and its linked
[inventory](legacy-embedded-ui-inventory.md). The next tranche is replacement
workflow proof and final release validation, not new product capability.
