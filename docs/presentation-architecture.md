# Presentation and control-plane architecture

## Status

**Proposed target architecture — no runtime migration has occurred.**

This document records the intended separation between the privileged dockercd
control plane and the human-facing presentation surfaces. It supersedes the
long-term assumption that the control-plane binary should also own an embedded
browser UI.

The detailed runtime, data-flow, rendering, deployment, and transition design
is in [Web presentation architecture](web-ui-architecture.md).

## Decision

Treat dockercd as the **control plane**. It owns reconciliation and the
authoritative, permission-scoped API. Human interfaces are unprivileged
clients of that API.

```text
                         ┌──────────────────────────────┐
                         │       dockercd control plane  │
                         │ API · reconciliation · state  │
                         │ Docker · Git · event stream   │
                         └──────────────┬───────────────┘
                                        │ versioned, scoped API
              ┌─────────────────────────┼──────────────────────────┐
              │                         │                          │
┌─────────────▼─────────────┐ ┌─────────▼──────────┐ ┌─────────────▼─────────────┐
│ dockercd Web presentation │ │ dockercd Console   │ │ CLI / approved automation  │
│ browser-facing container  │ │ SwiftUI macOS app  │ │                            │
└───────────────────────────┘ └────────────────────┘ └───────────────────────────┘
```

Only the control plane may access the Docker socket, Git credentials, the
controller database, manifest cache, or deployment executors. Neither the web
presentation container nor the macOS app receives those mounts, credentials,
or direct state-store access.

## Presentation technologies

### Primary operator console: Swift and SwiftUI

The macOS Console is the highest-fidelity operator surface. Continue with
**Swift + SwiftUI**, using AppKit only when a macOS-specific capability needs
it. This is the right place for rich inspections, keyboard commands, multiple
windows, local notifications, and a fast operational workspace. Apple’s Mac
design guidance explicitly favors keyboard and pointer input, broad resizable
workspaces, and long-running productivity sessions.

The existing Fleet Command Center direction is recorded in
`../swift-ui.md` and `../macos/DockercdConsole/UX_REDESIGN_PLAN.md`.

### Browser presentation: Go, HTML, CSS, and SVG

Build a separate `dockercd-web` container in **Go**, using:

- `net/http` and `html/template` for server-rendered pages and partials;
- semantic HTML forms, links, and POST/Redirect/GET workflows for commands;
- modern, hand-authored CSS (custom properties, container queries, layers,
  motion preferences, and color-scheme support);
- server-rendered SVG for topology, deployment pulse, and compact charts.

There is no authored JavaScript, TypeScript, Node runtime, SPA framework, or
browser-resident controller token in this plan. Go’s `html/template` is the
standard safe HTML renderer: it contextually escapes untrusted values. Use it
instead of `text/template` for every response that emits HTML.

The no-JavaScript constraint is intentional. Browser pages should remain
useful through normal navigation and forms, including sync, rollback, detail
inspection, and filtered history. Dashboard freshness can use an explicit
refresh control and a conservative HTML refresh policy. If a future feature
cannot meet that bar without client-side code, it needs an explicit architecture
decision instead of silently adding a JavaScript dependency.

## How it becomes better than ArgoCD

The goal is not more panels. It is faster comprehension and calmer control.

1. **One operational story per screen.** The fleet landing page answers what
   needs attention, whether the fleet is safe, and which deployment changed.
   Detail comes after that, not beside it.
2. **State is visual, not tabular noise.** Use a health halo, deployment pulse,
   service topology, semantic color, and revision provenance. Never invent a
   trend when the controller does not retain the samples.
3. **Mac-native depth.** The SwiftUI console uses wide layouts, keyboard
   commands, inspectors, and windows rather than imitating a web dashboard.
4. **A deliberate browser surface.** The web presentation uses the same
   information hierarchy but remains responsive, accessible, quick to load,
   and fully functional without JavaScript.
5. **Progressive disclosure.** Fleet → application → service → event or log.
   Logs, rendered desired state, metrics, and diffs remain demand-loaded.
6. **Operationally honest design.** Freshness, errors, degraded state, and
   permissions stay visible. Color and animation never conceal uncertainty.

## API and authorization boundary

The control-plane API stays versioned (`/api/v1`) and is the only contract
shared by all clients. Authorization must express a capability, not a screen.

| Scope | Capability |
|---|---|
| `fleet:read` | Fleet summary, app summaries, and host status |
| `application:read` | Application detail, desired state, diff, event history |
| `logs:read` | Service logs |
| `application:sync` | Sync and rollback |
| `application:write` | Create and edit application definitions |
| `application:delete` | Remove an application record |
| `controller:admin` | Controller-wide configuration and cluster settings |

The browser container must not translate an authenticated human into one broad
shared administrator credential. In the future security phase it should either
forward a short-lived, user-scoped control-plane token or validate an upstream
identity session and exchange it for one. The control plane remains the final
authorization point and records the human or automation identity in its audit
events.

## Deployment boundary

```text
Host-published:     Web presentation / future identity gateway
Internal network:   Control-plane API
Private volumes:    Docker socket, SQLite state, Git cache, credentials
```

During the migration, the current embedded UI may remain available for
compatibility. Do not remove it until the web presentation and SwiftUI Console
cover the owner workflows and the authorization model is in place.

## Existing and future clustered control plane

The repository already contains optional active/passive cluster code and a
two-node deployment example with mTLS. It remains supported as documented but
is not changed or relied upon by this presentation architecture. In particular,
its existence does not prove fencing, split-brain prevention, or a single
Docker-write authority under every failure mode.

Any future HA hardening or redesign must create a dedicated design that covers
at least:

- a single active reconciliation and Docker-write authority;
- split-brain prevention and explicit fencing;
- durable state replication, backup, and promotion recovery point objectives;
- API endpoint failover and SSE reconnection behavior;
- Git webhook deduplication; and
- auditable promotion and demotion operations.

The presentation surfaces use a stable controller endpoint, must not need to
know which replica is active, and must not automatically retry ambiguous writes
against another replica.

## Adoption sequence

1. Research, mock up, and approve the browser presentation before it is bound
   to controller data. See [Web presentation research and mockup brief](web-ui-research.md).
2. Freeze and document the control-plane API contract and capability model.
3. Implement controller-enforced scopes, delegated short-lived credentials,
   session/CSRF behavior, and audit attribution before any live Web UI adapter.
4. Build the fixture-backed Go Web UI mockup; it has no controller credential
   or network dependency.
5. Create the Go presentation container against the API only after the
   authorization gate passes, beginning with read-only fleet and application
   views.
6. Extract workflow knowledge from the embedded UI behind a presentation
   boundary without reusing its authored JavaScript or changing controller
   behavior.
7. Move mutation workflows one at a time with confirmation, explicit outcome,
   idempotency or an equivalent operation contract, and permission checks.
8. Retire the embedded UI after owner-workflow parity is validated.
9. Design active/passive hardening as a separate, explicit project.

## Sources

- [Apple: Designing for macOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-macos/)
- [Apple: SwiftUI menus and commands](https://developer.apple.com/documentation/swiftui/menus-and-commands)
- [Go: html/template](https://pkg.go.dev/html/template)
