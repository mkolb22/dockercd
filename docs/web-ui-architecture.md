# Web presentation architecture

## Status and intent

**Architecture approved; the owner-approved fixture UI, unprivileged image,
and opt-in local-password live-read boundary are implemented. No existing
controller deployment has changed.**

This design implements the direction in [ADR 0001](adr/0001-separate-control-plane-and-presentation.md) and [ADR 0002](adr/0002-scoped-presentation-api.md): the browser UI is an unprivileged
presentation service, not part of the dockercd control plane. It begins as a
fixture-backed mockup and transitions to a capability-scoped API client only
after the owner approves the experience.

The product-level requirements for tight controller/Web integration are
maintained in the [presentation integration contract](presentation-integration-contract.md).

## System at a glance

```text
                                ┌────────────────────────┐
                                │       Human operator    │
                                └───────────┬────────────┘
                                            │ HTTPS (local login now; OIDC later)
                                            ▼
                         ┌──────────────────────────────────┐
                         │  dockercd Web presentation        │
                         │  Go · HTML templates · CSS · SVG  │
                         │  no JavaScript · no Docker mount  │
                         └───────────────┬──────────────────┘
                                         │ internal, versioned API
                                         │ scoped delegated identity
                                         ▼
┌────────────────────────┐    ┌──────────────────────────────────┐
│ dockercd Console       │───▶│ dockercd control plane            │
│ SwiftUI macOS client   │    │ reconciliation · API · audit      │
└────────────────────────┘    │ Git cache · SQLite · event stream │
                               └───────┬─────────────┬────────────┘
                                       │             │
                                Docker socket     Git / secret provider
                                       │             │
                                       ▼             ▼
                                Managed Compose   Desired state
                                  applications       repositories
```

The only component allowed to reconcile, write to Docker, access Git
credentials, or access controller state is the control plane. The Web UI has
no socket, database, Git cache, source repository, or deployment executor
mount.

## Current and target states

| Concern | Current compatibility state | Target state |
|---|---|---|
| Browser UI | Embedded assets in dockercd | Separate `dockercd-web` container |
| macOS UI | SwiftUI Console client | Remains an independent first-class client |
| Controller | API and reconciliation in one service | Same control-plane responsibility |
| Browser data | Embedded UI reads controller-owned state | Web service calls the versioned API only |
| Authorization | Existing controller configuration | Capability-scoped, delegated user identity at the controller |
| Docker/Git/state access | Control plane only | Control plane only |
| Cluster topology | Optional active/passive implementation exists | Existing behavior remains untouched; HA hardening and guarantees are deferred |

The embedded browser UI is not removed during this work. It remains until the
separate Web UI has owner-validated workflow parity and the identity model is
in place.

## Web service internals

```text
HTTP request
    │
    ▼
Router and page controller
    │
    ├── layout/context builder ──────────── controller, freshness, permissions
    │
    ├── FleetPresenter ─┐
    ├── AppPresenter ───┼── PresentationSource interface
    ├── TimelinePresenter┘       │
    │                            ├── FixtureSource (mockup phase)
    │                            └── ControlPlaneSource (integration phase)
    ▼
html/template + server-rendered SVG + CSS assets
    │
    ▼
HTML response
```

### Proposed workspace layout

```text
web/
├── cmd/dockercd-web/             # process entry point and configuration
├── internal/
│   ├── presentation/             # page view models and semantic status mapping
│   ├── source/                   # PresentationSource contract and fixtures
│   ├── controlplane/             # future typed /api/v1 client only
│   └── httpui/                   # routes, handlers, template rendering, CSRF
├── templates/                    # layouts, pages, accessible partials
├── static/                       # CSS, font declarations, non-data SVG assets
├── testdata/                     # deterministic fixture scenarios
├── Dockerfile                    # no Docker CLI or privileged mounts
└── README.md                     # run, review, and non-goals
```

The mockup creates `FixtureSource` and view models first. The future
`ControlPlaneSource` implements the same narrow interface. Templates never
decode controller API JSON directly, and handlers do not expose a generic API
proxy.

## Rendering and interaction model

The Web UI is server rendered. A request produces a complete, meaningful HTML
document; HTML forms perform operations; success returns through
Post/Redirect/Get. There is no client-side application state and no browser
JavaScript runtime.

```text
GET /fleet
  → FleetPresenter builds FleetView from fixture/API source
  → template renders attention, health, deployment pulse, roster

GET /applications/{id}
  → AppPresenter builds ApplicationView
  → template renders deployment hero, service topology, safe navigation

POST /applications/{id}/sync
  → validate intent + future CSRF/session policy
  → authorized ControlPlaneSource action
  → 303 redirect to application timeline with outcome message
```

The static mockup implements the route shapes and confirmation states but does
not execute real mutations or make network calls. It is deliberately safe to
run without a controller.

### Freshness and live data

During the mockup phase, fixture data includes a timestamp and simulated
connection state. It does not pretend to update live.

During integration, the initial browser experience uses explicit refresh by
default. An automatic full-page refresh must never interrupt a form or reset an
operator's reading position; it requires an explicit opt-in design. Server-Sent
Events, partial page updates, or any browser-side runtime require a separate
ADR because they could conflict with the no-authored-JavaScript decision. The
macOS Console remains the preferred live, event-driven operator surface.

## Page and navigation architecture

```text
Shared shell
├── Brand + controller/environment context
├── Persistent primary rail
│   ├── Fleet
│   ├── Applications
│   ├── Activity
│   ├── System
│   └── Settings
└── Utility row: freshness, connection state, refresh action, future command entry

Fleet
├── Fleet evidence hero: displayed health, observation and fetch freshness
├── Attention queue
├── Deployment pulse
└── Fleet roster

Application
├── Breadcrumb: Fleet / application name
├── Deployment hero: revision, sync, health, last meaningful event
├── Overview: service topology and service cards
├── Deploy: desired/live comparison
├── Timeline: sync history and controller events
└── Inspect: service metrics and logs (demand-loaded after integration)
```

This makes the default path `Fleet → application → evidence` obvious. The
navigation never turns a log or diff view into a dead end: controller,
application, revision, and freshness context remain visible.

Health language is evidence-backed. A page distinguishes **fetched at** (when
the presentation obtained its response), **observed at** (when the controller
observed live state, if available), **last deployment**, and **unknown or stale
observation**. Until controller observations expose an authoritative timestamp,
the fleet hero says “no known issues in displayed data,” not “safe to deploy.”

## Data and API boundary

The browser service needs page-oriented view data, not unrestricted control
plane access. The integration client is typed around the existing versioned
API and only requests fields needed for the active page.

| Page | Read need | Future action need |
|---|---|---|
| Fleet | app summaries, freshness, recent operations | none |
| Application overview | app detail, services, deployed revision | sync |
| Deploy | desired state, live diff, history | sync, rollback |
| Timeline | events and sync history | none |
| Inspect | service detail, metrics, logs | none |
| System | host and controller snapshot | controller administration |

No template receives raw secrets, Git tokens, unredacted environment values,
or arbitrary controller response maps. The presentation layer maps typed API
responses into redacted, page-specific view models.

### Current API inventory and required gaps

This inventory prevents the mockup from inventing a source contract. It is
based on the current `/api/v1` routes and response types; it must be rechecked
before an integration adapter is written.

| Need | Current source | Status and presentation rule |
|---|---|---|
| Fleet application state | `GET /applications` | Available, including a limited recent history per application; no cross-fleet durable event feed or pagination is assumed. |
| Application and services | `GET /applications/{name}` | Available; response freshness is not the same as live-observation freshness. |
| Desired/live comparison | `GET /applications/{name}/desired`, `/diff` | Available on demand; desired topology is labelled desired Compose dependency topology, never observed network traffic. |
| Cross-fleet activity | `GET /api/v1/presentation/activity` | Available as a redacted, authorization-filtered recent window (1–100 items); it is not an exhaustive audit history. Cursor-paginated event history remains a later capability. |
| Metrics and logs | Per-application and per-service endpoints | Available on demand and bounded by controller policy; not collected in fleet page rendering. |
| System | `GET /system`, `/system/stats` | Host information and snapshot stats are available; do not label it controller version, uptime, or time-series history. |
| Feature detection | `GET /capabilities` | Available only for API version/features; it is not a permissions endpoint. |
| Scoped identity and audit subject | `permissions` and redacted `fleet` routes are enabled only by a validated, digest-only controller registry plus explicit audience and existing strong admin authentication | Browser session-to-subject binding, registry reload/provisioning, and full resource-filtered read contracts remain required before any live Web UI adapter. |
| Mutation idempotency / operation status | Sync and rollback return current operation outcomes | Required before browser mutations; never retry an ambiguous request automatically. |

The future source client applies a request deadline, maximum response size,
request cancellation, and bounded fan-out. It does not perform fleet-wide
service inspection merely to render the fleet page. If it caches last-known
data, cache entries are authorization-aware, page-scoped, short-lived, and
invalidated when an identity or permission changes; they are never shared by
controller URL alone.

### Live adapter boundary

The first live adapter is an internal Go view-model mapper, not a generic HTTP
proxy and not a browser-facing API. Its constructor accepts an already-built
typed scoped client and non-secret display labels only. The caller must create
that client from the authenticated browser session's server-side subject
exchange; there is deliberately no environment variable, browser form field,
cookie value, or singleton controller token that can construct it.

For each request the adapter:

1. performs the scoped capabilities handshake;
2. requires the feature needed by the route before requesting its DTO;
3. maps only controller-provided redacted fields into page view models;
4. presents activity as a bounded recent window and makes absent detail a
   visible product limitation rather than inventing service, diff, or history
   data; and
5. propagates cancellation and returns a generic server-side error to the
   future session-aware handler.

The executable remains fixture-only by default. It configures a live source
only after an explicit local-password configuration passes the session and
HTTPS-origin gates in [ADR 0003](adr/0003-local-password-bootstrap-for-web-presentation.md).
This lets the adapter be tested against the real versioned API contract while
preserving the identity gate.

The renderer's integration seam is a **per-request source provider**. In
fixture mode it returns the immutable fixture source. In local-auth live mode,
it first resolves an opaque, server-side browser session, validates that it is
bound to a non-empty subject and session identifier, builds a scoped typed
client from that session's server-held token source, and returns a fresh live
source for that request. Resolver errors redirect to sign-in; controller
availability errors produce a generic unavailable page. The renderer never
falls back to a fixture, anonymous request, legacy token, or a source cached
across subjects.

## Identity and authorization design

```text
Browser session / future identity provider
                  │
                  ▼
Web presentation validates session and intent
                  │ delegated, short-lived capability token
                  ▼
Control plane authorizes scope and writes audit event
```

The control plane remains the final authorization point. The Web UI cannot
rely on a broad shared administrator token for human operations. The scope
model is recorded in the presentation architecture: fleet read, application
read, logs read, sync, application write/delete, and controller admin.

This is an integration gate, not a later enhancement. Before any live Web UI
read or write, the controller must enforce scopes and validate a credential
with a subject, audience, expiration, resource restriction, and audit
attribution. The Web UI must specify session-cookie and CSRF behavior at the
same time.

### First identity boundary: local password login

The first single-instance deployment uses the local identity boundary in
[ADR 0003](adr/0003-local-password-bootstrap-for-web-presentation.md). The
Web service receives one service-specific Docker Compose secret file with
Argon2id password verifiers and per-user controller-scoped bearers. The
controller receives only SHA-256 bearer digests plus subject, audience, expiry,
capability, resource, and revocation metadata in its *separate* registry.

```text
Browser ── HTTPS ──> reverse proxy ── private network ──> dockercd-web
                                                              │ verifies Argon2id password
                                                              │ keeps opaque session + bearer in memory
                                                              ▼
                                                    dockercd controller
                                                    validates bearer digest + scope
```

The browser receives only an opaque `HttpOnly`, `Secure`, `SameSite=Lax`
session cookie. Login uses a signed double-submit CSRF value and logout uses a
session-bound CSRF value; login challenges
and sessions expire; a bounded in-memory implementation intentionally signs
users out on restart. A browser page, cookie, template, log, or API response
never receives a controller bearer. The first live path is read-only.

Compose file-backed secrets are local files mounted only into a declared
service. They are a practical local mechanism, not encrypted secret storage:
protect the host, deployment account, backups, and source secret file.

### Recommended future identity boundary: OIDC

Use an existing organization identity provider through **OpenID Connect
Authorization Code Flow with PKCE**, handled by the Web server. This is the
recommended path for both a networked browser UI and the future macOS client:
the human signs in once with an issuer that already owns their identity, while
the controller remains the only authority that grants DockerCD capabilities.

```text
Browser / macOS client
  └── OIDC sign-in with state + nonce + PKCE
        └── dockercd-web server
              └── private controller token exchange / scoped API
                    └── dockercd verifies subject, audience, expiry,
                        capability, resource grant, and writes audit evidence
```

For a later OIDC single-Web-container deployment, the Web server should retain a
short-lived, controller-scoped credential only in memory under an opaque
server-side session. A restart intentionally signs users out rather than
persisting a credential. The browser receives only a random session cookie
with `HttpOnly`, `Secure`, and `SameSite=Lax` attributes; callback `state` and
`nonce` are verified, and mutations later add synchronizer CSRF protection.

The controller must validate the identity-provider assertion itself (or a
separately designed token-exchange proof) before issuing/accepting its
short-lived scoped credential. A reverse proxy identity header alone is not
adequate, and neither a shared API token nor a static Web service token may
stand in for an individual. A multi-replica Web session store is a separate
availability design; it is not needed for the first, intentionally
restart-logs-out deployment.

If an OIDC provider already exists, use it rather than introducing a new
identity product. The accepted local bootstrap does **not** add a password
database: it reads a bounded, operator-provisioned Compose secret and keeps no
password or session persistence. OIDC replaces only Web authentication;
controller scope checks remain unchanged.

### Mutation outcomes

Sync, rollback, edit, and delete views must name the controller, application,
and (where relevant) reviewed revision before submission. A redirected page
does not prove a request ran once: a dropped response can mean success, failure,
in-progress, or unknown outcome. Before live mutation workflows are enabled,
the control plane must offer idempotency or an equivalent durable operation
contract. The Web UI maps the controller's actual outcome and shows “outcome
unknown — check history” for ambiguity; it never retries automatically or
fails over a write to another cluster node.

## Deployment design — after mockup approval

```text
Public / trusted network
    └── reverse proxy or future identity gateway
            └── dockercd-web (published browser port)
                    └── private Docker network
                            └── dockercd API (not publicly published for Web UI use)

Private volumes only on dockercd
    ├── Docker socket
    ├── SQLite state
    ├── Git cache
    └── controller credentials
```

The fixture does not modify Compose files. Its separate scratch-based
container image runs as numeric non-root user `65532` and contains only the Go
binary. The opt-in local-auth deployment adds exactly one read-only Web-user
secret mount; it has no Docker, Git, SQLite, cache, or controller-registry
mount. The controller stays on its private Compose network and has its own
digest-only registry secret. A TLS reverse proxy is the only host-published
browser entry point. The Web container runs non-root, with a read-only
filesystem, bounded temporary storage, no privileged mounts, and only the
dedicated scoped user credential after authentication.

## Architecture acceptance checks

Before beginning API integration, verify all of the following:

- The mockup runs with networking disabled and without a controller.
- No Web UI image or mount includes Docker, Git, SQLite, a controller registry,
  or legacy administrator credential. Its one optional local-auth mount has
  only the per-user password verifier and scoped controller bearer.
- Templates render only typed, redacted view models.
- A visual review passes the fleet-to-evidence owner journey.
- Keyboard navigation, visible focus, 200% text zoom, light/dark mode, and
  non-color status cues are verified.
- Rendered evidence covers desktop and narrow widths, light/dark modes, zoom,
  empty/error/stale/unknown states, and the correct action-selection journey.
- The approved page models identify the exact control-plane API fields and
  capability scopes needed for each route.

## Review gates

Every completed feature tranche receives an independent review by a
higher-capability OpenAI model before it advances. The reviewer examines the
actual diff and tests, challenges privilege and data assumptions, and returns
prioritized recommendations. Findings that affect correctness, security,
architecture, accessibility, or owner workflow are resolved or explicitly
accepted and documented before the next tranche begins.

The completed architecture-design tranche received that review. The next gate
occurs after the fixture-backed mockup is implemented and visually validated;
subsequent gates follow API-contract/scoping work, live read integration, and
each mutation workflow tranche.

## Deferred decisions

The following require separate approval and are intentionally excluded:

- changes to the existing active/passive cluster behavior, or HA hardening for
  membership, leader election, fencing, replication, promotion, and failover;
- browser-side runtime or live-update technology;
- external identity provider and credential-exchange implementation;
- public exposure of the control-plane API; and
- retirement of embedded Web UI assets.
