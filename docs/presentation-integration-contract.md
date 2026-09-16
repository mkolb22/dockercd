# Presentation integration contract

## Purpose

The control plane and Web presentation are separate containers with different
privileges, but they are one operator experience. This contract defines the
controller capabilities that let the Web UI be fast, honest, visually clear,
and safe without turning it into an administrator proxy.

It supplements [ADR 0001](adr/0001-separate-control-plane-and-presentation.md)
and [ADR 0002](adr/0002-scoped-presentation-api.md). It does not change
deployment exposure: the controller remains private to the presentation
container, and controller-side authorization remains final.

## Product rules

1. **Purpose-built data, never scraped pages.** Each presentation route has a
   typed, versioned DTO whose fields are reviewed for the exact visual it
   supports. The Web UI does not transform a legacy administrator response.
2. **Freshness is visible data.** The UI distinguishes response generation,
   desired Git state, last reconciliation, and actual Docker observation.
   A new response must never make stale persisted health look newly observed.
   Each read model carries only the independent freshness dimensions it can
   truthfully support.
3. **No hidden fan-out.** Fleet cards arrive from a bounded controller
   projection; rendering a page never causes one Docker inspection per app.
   Details, metrics, diff, and logs are on-demand, cancellable, and bounded.
4. **Authorization shapes data.** Capability and application-resource grants
   are checked before work. Lists, totals, cursors, event streams, and errors
   must not expose an ungranted application.
5. **Operations are durable facts.** Future mutations return an operation ID
   and lifecycle state. The UI never equates a redirect or broken connection
   with success and never retries an ambiguous write.
6. **An explanation accompanies each status.** A status badge has a short
   human-safe reason code, source time, and stable correlation ID leading to
   bounded evidence. Raw errors and unbounded logs never drive primary UI.

## API contract backlog

| Priority | Controller feature | Web UI outcome | Required guardrails |
| --- | --- | --- | --- |
| Implemented foundation | Scoped capabilities handshake, permissions, fleet/app status, redacted recent activity, and persisted successful health-observation time | Trustworthy compatibility preflight plus fleet/app status cards and a safe activity rail with distinct observed age | Explicit capability/resource grants, deadline, redaction, audit |
| Implemented | Frozen, redacted presentation-v1 fixtures consumed by controller DTO and Web typed-client tests | Independent Web/controller releases detect wire-shape drift before image build | Additive only; scoped handshake; fixture tests in both Go modules |
| Implemented | Controller-authored response time, desired revision, separate successful-sync and live-observation times, and paired observation completeness | Honest response/desired/deployed/observed language; the Web UI never substitutes client time | Frozen mixed-age fixtures; `complete`/`unavailable` observation enum; a current Web client requires `presentation.status-metadata` |
| Next | Resource-filtered desired topology, diff summary, cursor-paginated event history, bounded logs | Deep drill-down pages with provenance and evidence | Separate capabilities; opaque cursor; redaction; per-route limits/deadlines |

The initial `presentation.activity` endpoint is deliberately a recent activity
window, rather than historical event browsing: a request asks for 1–100 items
(50 default), and the controller first reads at most that many rows per
authorized application before the final global merge. This makes a refresh
cost proportional to grants and the requested window, not retained event
history. The compatibility handshake advertises `presentation.activity` only
when `application:read` is effective. Cursor-based history remains a separate,
later capability so the UI never mistakes this window for an exhaustive audit
trail.
| Next | Controller-generated status reason codes and evidence references | Explainability chips and accessible non-color status detail | Stable schema; authorized evidence only; no raw daemon/Git error |
| Before mutations | Durable operation resource: create/status/cancel, idempotency key, correlation ID, and desired-revision precondition | Safe Sync/Rollback confirmations and truthful progress | Per-operation grant, revision-bound intent, audit, bounded backoff, no ambiguous retry; cancellation is best-effort only |
| Before live browser | Session-to-subject exchange and controller credential rotation/revocation | Per-human attribution without browser-held controller token | Server-side session, secure opaque cookie, CSRF, short expiry, strict audience |
| Later | Resource-filtered resumable event feed | Optional near-live status without fleet polling | Replay cursor, backpressure, reconnect budget, per-event authorization |

## Read model envelope

Every future presentation response should add these fields where meaningful:

```text
data                 typed, redacted route data
responseGeneratedAt  RFC 3339 controller response generation time
observedAt           actual Docker observation time (only when persisted)
sourceRevision       Git/controller revision informing desired state (if any)
reconciliationState  independent reconciliation state
completeness         complete | partial | unavailable
reason               stable, human-safe reason code (optional)
evidenceId           stable authorized status-cause reference (optional)
requestId            per-read controller correlation ID
```

The controller sets these values. `responseGeneratedAt` is not `observedAt`;
`observedAt` is rendered only with the health result from that same complete
Docker inspection. A missing live observation remains partial or
unavailable—not zero, healthy, or live. The Web UI maps stable values to copy,
iconography, motion, and accessible text.

The initial implementation records `responseGeneratedAt` on fleet,
application, and activity reads. Application summaries additionally use
`observationCompleteness` (`complete` or `unavailable`) to attest whether
`lastObservedAt` and `observedHealthStatus` are one persisted observation pair.
`headSHA`, `lastSyncedSHA`, and `lastSyncTime` remain distinct desired and
deployment evidence. See [ADR 0004](adr/0004-presentation-read-freshness-metadata.md).

## Tight integration test matrix

The two containers ship only when integration proves:

- Web fixtures decode against the published controller schema.
- A scoped reader cannot infer an ungranted application through totals,
  cursors, status codes, errors, or event replay.
- The UI labels stale, partial, desired, reconciled, and observed data
  differently, with accessible text for every visual cue.
- Controller deadlines, cancellation, body limits, and concurrency behavior
  hold under concurrent Web requests; separately limited legacy detail work
  cannot consume presentation-read capacity. Shared SQLite or host resources
  can still delay a fleet response and must remain observable and bounded.
- Allowed and denied operations have request/correlation ID, subject,
  credential ID, route, capability, resource, and decision audit evidence—no
  bearer value.
- An older Web client refuses a missing required feature clearly and safely;
  it never falls back to legacy admin or anonymous endpoints.
- Lifecycle and compatibility tests cover credential expiry/revocation/logout,
  permission reduction with retained data, controller and Web restarts,
  unavailable/oversized/malformed responses, unsupported enums, schema
  mismatch, and recovery under load.
- The Web image runs non-root, read-only, network-restricted to its private
  controller endpoint, without Docker/Git/SQLite/controller-admin mounts or
  credentials.

## Deliberate non-goals

- Publicly exposing the controller API.
- Giving Web a Docker socket, Git credential, database, or broad admin token.
- Retiring the embedded UI before owner-workflow parity is validated.
- Active/passive control-plane redesign or automatic write failover.
