# ADR 0004: Controller-authored freshness metadata for presentation reads

| Field | Value |
| --- | --- |
| Status | Accepted |
| Date | 2026-09-16 |
| Related | [ADR 0002](0002-scoped-presentation-api.md), [presentation integration contract](../presentation-integration-contract.md) |

## Context

The presentation read API already returns desired Git revisions, last successful
sync time, and the persisted time and result of a completed health observation.
Those are distinct facts. The Web mapper nevertheless used its own clock to
describe when a fleet response was fetched, and it had to infer whether an
observation pair was complete from optional fields. That risks making stale
controller data appear current and makes a partial or malformed response hard
to explain consistently.

The browser must not infer a controller observation, reconcile state, or
response generation time. It also must not receive raw Docker, Git, or error
evidence merely to explain a status badge.

## Decision

1. Additive scoped read DTO fields carry a controller-generated
   `responseGeneratedAt` timestamp on fleet, application, and recent-activity
   responses. It records when the controller formed that response, not an
   observation or sync time.
2. Each application summary carries `observationCompleteness`, with only
   `complete` or `unavailable` in this tranche. `complete` means one persisted
   health status and RFC 3339 observation time were recorded together;
   `unavailable` means neither is available. The controller must never emit a
   health claim with `complete` when either half is absent.
3. Existing `headSHA`, `lastSyncedSHA`, `lastSyncTime`, `lastObservedAt`, and
   `observedHealthStatus` remain additive, source-authored freshness facts.
   No new reconciliation-state inference or reason/evidence field is added:
   those need durable controller lifecycle and authorized evidence contracts.
4. The scoped capability handshake advertises
   `presentation.status-metadata` whenever the principal can read fleet or
   application status. The live Web mapper requires this capability for
   status-bearing pages and fails safely for an older controller instead of
   substituting its own clock.
5. The Web renderer maps absent, malformed, or unavailable metadata to
   explicit unavailable language. It never substitutes client time or labels
   incomplete observations as healthy.

## Consequences

- Existing scoped clients remain compatible because fields and feature flags
  are additive. A current Web client fails clearly against a controller that
  lacks the metadata it requires for honest live status.
- Frozen controller/Web fixtures cover the exact new wire shape and mixed
  observation states. No raw diagnostics, secrets, manifests, services, or
  logs enter the presentation API.
- No endpoint, credential scope, listener, container mount, or network policy
  changes. This remains a read-only contract refinement.

## Alternatives rejected

- **Use browser receipt time as freshness:** it says nothing about when the
  controller formed the response and hides clock skew.
- **Infer completion from displayed health alone:** a health string without its
  paired persisted observation time is not evidence of current live state.
- **Return raw error text as the explanation:** daemon and Git failures can
  disclose sensitive configuration; an authorized evidence design is deferred.
