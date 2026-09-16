# ADR 0002: Additive scoped control-plane API for presentation clients

| Field | Value |
| --- | --- |
| Status | Accepted — controller read foundation is opt-in; live browser presentation remains gated |
| Date | 2026-09-15 |
| Related | [ADR 0001](0001-separate-control-plane-and-presentation.md), [Web UI architecture](../web-ui-architecture.md) |

## Context

The current `/api/v1` server accepts one optional broad bearer token. When the
embedded browser UI uses a session, it stores that same token in a 30-day
cookie. Existing collection responses include application specifications and
recent history, and the global stream broadcasts events without resource
filtering. Those are useful legacy-admin mechanics, but they cannot safely be
given to an unprivileged presentation container acting for an individual.

ADR 0001 requires controller-enforced, capability-scoped identity before the
separate Web UI makes any live request. A middleware-only scope check is not
sufficient: collection payloads, history, logs, and events must also be
resource-filtered and redacted.

## Decision

1. Add a **new, additive presentation API surface** beneath `/api/v1`; do not
   reinterpret legacy bearer authentication or broaden any existing endpoint.
2. Define a controller-verified principal with immutable `subject`, `audience`,
   expiry, named capabilities, and an explicit application-resource allowlist.
   Invalid, expired, wrong-audience, or unscoped credentials fail closed.
3. Keep the existing API token and cookie session **legacy-admin only**. A
   credential that fails scoped verification never falls back to legacy admin
   access. The new Web presentation never receives the legacy token.
4. Start with read-only DTOs that are purpose-built and redacted:

   | Route | Required capability | Data rule |
   | --- | --- | --- |
   | `GET /api/v1/presentation/capabilities` | authenticated presentation principal | scoped compatibility handshake: effective presentation features, expiry, and public limits only |
   | `GET /api/v1/presentation/permissions` | authenticated presentation principal | actual subject, capabilities, and allowed resources only |
   | `GET /api/v1/presentation/fleet` | `fleet:read` | bounded fleet summaries; no manifest specification, secrets, or raw history |
   | `GET /api/v1/presentation/applications/{name}` | `application:read` and resource grant | redacted status detail for the named application; ungranted names are indistinguishable from absent applications |
   | `GET /api/v1/presentation/activity` | `application:read` and explicit application grants | bounded cross-fleet redacted event metadata; no message, raw payload, or ungranted application |
   | `GET /api/v1/presentation/applications/{name}/desired` | `application:read` and resource grant | bounded, redacted desired topology |
   | `GET /api/v1/presentation/applications/{name}/diff` | `application:read` and resource grant | bounded diff summary |
   | `GET /api/v1/presentation/applications/{name}/events` | `application:read` and resource grant | paginated, resource-filtered events |
   | `GET /api/v1/presentation/applications/{name}/services/{service}/logs` | `logs:read` and resource grant | bounded, redacted logs only |

5. Do not enable presentation mutations in this tranche. Sync, rollback,
   update, and delete require a later idempotency/operation-status contract,
   per-operation capability check, CSRF/session design, and audit record.
6. Use an injected verifier interface. Its first production-capable form is an
   operator-provisioned registry of high-entropy opaque credentials stored only
   as SHA-256 digests alongside subject, credential ID, audience, validity,
   capability, resource, and revocation metadata. The registry is immutable
   after validation and may be atomically reloaded for revocation. Raw tokens
   are never persisted, logged, returned, or placed in a browser page.
7. A human-facing presentation deployment has a separate session boundary:
   the Web process keeps a user-scoped, short-lived controller credential only
   in server-side session state; the browser receives an opaque, host-only,
   `HttpOnly`, `Secure`, `SameSite` session identifier and never a controller
   credential. Login rotation, expiry, logout, origin checks, and synchronizer
   CSRF tokens are required before browser mutations. An arbitrary user header
   or a single configured human subject is not authentication.

### Initial registry configuration

The controller enables this additive surface only when all of the following
are configured: a legacy `api_token` of at least 32 characters,
`presentation_credentials_file`, and `presentation_audience`. The credential
file is a bounded, strict JSON document containing only `token_sha256`
(lowercase SHA-256 digest), credential metadata, capabilities, explicit
application names, revocation state, and validity timestamps. It is loaded and
validated at startup into an immutable snapshot; an invalid, empty, oversized,
or unknown-field registry prevents startup rather than silently disabling
authorization. This is an operator-only controller configuration file, never a
browser-delivered asset or Web container environment variable. Registry changes
(including revocation) take effect on the next controller restart; safe atomic
reload is a later, separately reviewed operation.

## Consequences

- Existing CLI and embedded UI behavior remain compatible and unchanged.
- The future Web container can receive only a bounded reader identity and has
  no route to Docker, Git, SQLite, or a legacy administrator credential.
- SSE is excluded from the first live integration. A later stream must filter
  every event by principal/resource and make replay, reconnect, and slow-client
  behavior explicit.
- The controller does not gain a new host-published listener. The future Web
  container continues to use the existing private endpoint only.

## Required acceptance evidence

- Every presentation route rejects missing, expired, wrong-audience, unknown,
  and insufficient-capability credentials with no legacy fallback.
- Resource-restricted credentials cannot enumerate, infer counts for, read,
  diff, inspect, or obtain event/log data for another application.
- Fleet DTOs omit app specs, raw manifests, source credentials, and full sync
  history; list sizes, response bodies, and log lines are bounded.
- The permissions endpoint returns grants for the verified principal only and
  contains no credential material.
- Audit evidence records subject, route, resource, capability decision, and
  request ID without a token value.
- A live browser client refuses a controller without scoped-auth support or a
  verified session-to-subject binding; it never falls back to legacy or
  anonymous access.
- Existing `/api/v1` contract tests remain green and no listener, Docker mount,
  Git credential, or embedded UI deployment behavior changes.

## Alternatives rejected

- Reusing the single `api_token` in `dockercd-web`: it turns every Web request
  into an untraceable administrator action.
- Adding scopes only to existing `/applications`: its current DTO is too broad
  for a fleet reader and resource filtering would silently change clients.
- Browser session cookies containing controller credentials: they create an
  unnecessary credential-exposure and CSRF surface for a no-JavaScript UI.
- A generic API proxy: it would permit endpoint expansion without a reviewed
  capability and redaction decision.
