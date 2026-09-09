# dockercd macOS client plan

## Goal

Replace the embedded browser UI with a native macOS SwiftUI client that manages
one or more dockercd controllers through the existing versioned HTTP API. The
controller remains responsible for reconciliation, Docker access, persistence,
and events; the client is an owner-facing control surface.

The client must support both local and network controller connections from its
first release. Security hardening is intentionally a later phase, but the
connection model must accommodate tokens, HTTPS, certificate pinning, and mTLS
without a later UX redesign.

## Product model

A saved controller connection is a first-class object:

```text
Controller connection
├── Display name            e.g. “Development”, “My Apps”
├── Base URL                e.g. http://127.0.0.1:8080
├── Refresh mode            Live, 5 seconds, 10 seconds, Manual
├── Connection state        Connected, Connecting, Degraded, Disconnected
├── Last successful refresh
└── Future credentials      Keychain token, TLS client certificate, trust policy
```

Examples:

| Profile | Endpoint | Intended mode |
|---|---|---|
| Development | `http://127.0.0.1:8080` | Live or 5 seconds |
| My Apps | `http://<host>:8090` | 10 seconds |
| Production | `https://controller.example.com` | Live or 10 seconds |

Native `URLSession` requests do not have browser CORS restrictions, so the
client can connect directly to a controller over a trusted network. Plain HTTP
is a development/trusted-network capability only; later security work will
make remote HTTPS authentication the normal production path.

## Owner-facing experience

```text
dockercd Console
├── Connections
│   ├── Saved controllers
│   ├── Add / edit controller
│   ├── Test connection through /healthz
│   └── Select active controller
├── Dashboard
│   ├── Application health and sync summary
│   ├── Recent activity
│   └── Controller status and data freshness
├── Applications
│   ├── Searchable application list
│   ├── Health, commit, sync status, and last update
│   └── Create, edit, and delete application
├── Application detail
│   ├── Overview
│   ├── Desired vs. live diff
│   ├── Sync and rollback controls
│   ├── History and events
│   ├── Service health and metrics
│   └── Service logs
├── System
│   ├── Docker host information
│   ├── Host statistics
│   └── Polling settings
└── Settings
    ├── Controller profiles
    ├── Session behavior
    └── Future authentication and certificates
```

Destructive or consequential actions, especially rollback, delete, and sync,
should show a confirmation sheet with the target controller and application
clearly named. The client should surface stale data age and controller
reachability rather than silently replacing healthy prior data with an error
state.

## Swift architecture

```text
DockercdApp
├── SwiftUI views
├── View models (@MainActor)
├── ConnectionSession actors
├── API layer
│   ├── DockercdAPI protocol
│   ├── URLSessionDockercdAPI
│   ├── Codable request / response models
│   └── Server-sent event client
├── Persistence
│   ├── SwiftData or UserDefaults connection profiles
│   └── Future Keychain credential storage
└── Future transport security
    ├── Bearer-token request authorization
    ├── TLS trust policy / pinning
    └── Client certificate support
```

Views must depend on a typed API protocol rather than directly on `URLSession`:

```swift
protocol DockercdAPI {
    func health() async throws -> HealthResponse
    func listApplications() async throws -> [Application]
    func application(named name: String) async throws -> Application
    func applicationDiff(_ name: String) async throws -> DiffResult
    func syncApplication(_ name: String) async throws
    func rollbackApplication(_ name: String, sha: String) async throws
    func serviceLogs(app: String, service: String) async throws -> [String]
}
```

This permits a mock implementation for fast UI development and means the
eventual credential and TLS work happens in one transport layer rather than in
every screen.

## Controller session and polling model

Each connection owns its own monitoring session. One controller must not alter
the refresh behavior of another.

```text
Connection session
├── Disconnected
├── Connecting
├── Live
│   ├── Event stream connected
│   ├── Targeted refresh after a relevant event
│   └── 30-second safety reconciliation
├── Polling every 5 seconds
├── Polling every 10 seconds
├── Manual
└── Degraded
    └── Retry with backoff while retaining last-known data
```

```swift
enum RefreshMode: String, Codable {
    case live
    case everyFiveSeconds
    case everyTenSeconds
    case manual
}

enum ConnectionState {
    case disconnected
    case connecting
    case connected
    case degraded(lastSuccess: Date?, error: String)
}
```

### Recommended modes

| Mode | Behavior | Use case |
|---|---|---|
| Live | Server-sent events, targeted refreshes, 30-second safety refresh | Watching a deployment or rollback |
| 5 seconds | Poll visible summary data every 5 seconds | Active development work |
| 10 seconds | Poll visible summary data every 10 seconds | Default dashboard behavior |
| Manual | Refresh only after a user action | Low-noise or many-controller use |

Default every new profile to **10 seconds**. Live should be event-driven, not
an unrestricted rapid polling loop. A user-triggered sync or rollback can
temporarily promote only that application to Live observation until it reaches
a terminal state, then return to the selected connection mode.

### Refresh rules

- Refresh only data that is visible. The dashboard loads application summaries;
  an application detail tab loads logs, diffs, history, or metrics only while
  that tab is open.
- Do not poll logs, diffs, or service detail from the dashboard timer.
- Poll host statistics every 15–30 seconds, not on every application refresh.
- Permit one in-flight refresh per controller. If a timer fires while work is
  still running, schedule at most one follow-up refresh.
- Suspend periodic work when the app is inactive or a window is hidden; make
  one immediate refresh when the active window returns.
- Preserve last-known data on a failure and show its timestamp.
- Apply retry backoff after failures: 5 seconds, 10 seconds, 30 seconds, then
  60 seconds until the controller is reachable again.
- Reconnect an event stream with the same backoff policy. The 30-second safety
  refresh prevents stale UI if an event is missed.

## API and controller migration

The controller API is the long-lived contract. Preserve `/healthz` and the
versioned `/api/v1` endpoints while the native app is built. Add a small API
capability/version endpoint before supporting multiple controller versions so
the client can gracefully report unsupported features.

The client needs:

- application list, detail, create, update, and delete operations;
- sync, rollback, diff, desired-state, history, event, log, metric, and host
  status operations;
- a server-sent event stream for Live mode;
- consistent structured error responses and action-in-progress state.

Do not remove the embedded web UI until the Swift client covers the essential
owner workflows and can monitor a live deployment. Once it does, remove the
static asset bundle, browser session endpoint, cookie-CSRF handling, and
browser-specific UI code while retaining the API and health endpoints.

## Visual direction — Fleet Command Center

The native client should feel like a focused Mac operations product, not a web
dashboard placed inside a window. Its first question is *what needs my
attention?*, then it makes the next useful detail one click away.

```text
Controller context bar
└── Fleet Command Center
    ├── Health hero: managed-service health, current revision, freshness
    ├── Attention queue: actual degraded or drifted applications only
    ├── Deployment pulse: recent reconciliation outcome, not a fake trend
    └── Fleet roster: app, revision, service count, sync and health state

Application detail
├── Deployment hero: health halo, revision provenance, sync action
├── Overview: project configuration and service cards
├── Deploy: desired state and live diff
├── Services: demand-loaded metrics and logs
└── Timeline: history and events
```

Use adaptive materials, rounded continuous surfaces, and semantic mint, amber,
coral, and indigo accents. Color must communicate a real controller state;
empty manifests are context, not alerts. Do not render sparklines or time
series until the controller retains samples. The initial Command Center
implementation covers the dashboard, application hero/list, and system
snapshot; topology, durable metric history, command palette, and inspector are
subsequent phases.

## Delivery phases

1. **App foundation** — Xcode project, SwiftUI shell, saved connection profiles,
   active-connection selector, mock API, and connection health test.
2. **Network read path** — `URLSession` API implementation, Dashboard,
   Application list, application overview, data-freshness display, and 10-second
   session polling.
3. **Core operations** — diff, history, events, sync, rollback, destructive
   action confirmations, and operation-progress presentation.
4. **Operational views** — service health, logs, metrics, system status, event
   stream support, Live mode, and targeted refreshes.
5. **Multi-controller polish** — independent per-profile sessions, background
   behavior, graceful offline states, reconnect/backoff behavior, and test
   fixtures.
6. **Security hardening** — Keychain token storage, HTTPS defaults, remote TLS
   trust behavior, certificate pinning or mTLS as appropriate, and retirement
   of unauthenticated deployment modes.
7. **Web UI retirement** — remove the embedded UI only after feature parity and
   owner workflow validation.

## Decisions to preserve now

- Network controller profiles are first-class; never hard-code `localhost`.
- Credentials and transport trust belong behind the API client abstraction.
- Session mode is persisted per controller profile.
- Live uses events plus a safety refresh, not high-frequency global polling.
- The dashboard is summary-first; expensive detail data remains demand-driven.
- Plain HTTP/no-auth use is development-only and must be visibly labeled in the
  client until the security phase is complete.
