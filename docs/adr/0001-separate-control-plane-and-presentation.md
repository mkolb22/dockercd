# ADR 0001: Separate the control plane from presentation clients

| Field | Value |
|---|---|
| Status | Accepted — target architecture, implementation in progress |
| Date | 2026-09-15 |
| Decision owners | dockercd maintainers |
| Related | [Presentation architecture](../presentation-architecture.md), [Web UI architecture](../web-ui-architecture.md), [Web UI research](../web-ui-research.md), [Swift UI plan](../../swift-ui.md) |

## Context

dockercd currently combines privileged control-plane responsibilities with an
embedded browser UI. The same service owns reconciliation, the Docker socket,
Git credentials, controller state, API endpoints, server-sent events, and
browser assets.

That is convenient for a single-container deployment, but it couples a
browser-facing presentation layer to the highest-privilege process in the
system. It also prevents independent evolution of a high-quality browser
experience and the macOS operator console.

The product needs a visually excellent, intuitive human experience without
duplicating reconciliation logic or introducing an authored JavaScript/Node
application. The repository already includes an optional active/passive
deployment and cluster code; this ADR does not treat it as a proven HA design
or alter it. Further HA, fencing, replication, and failover design remain
separate work.

## Decision

1. **dockercd is the control plane.** It is the sole authority for
   reconciliation, Docker mutations, Git access, controller persistence,
   events, and the versioned API.
2. **Browser and macOS experiences are presentation clients.** They use the
   control-plane API and do not receive the Docker socket, Git credentials,
   controller database, manifest cache, or deployment executor access.
3. **The macOS Console uses Swift and SwiftUI.** It is the premium
   keyboard-first operator workspace.
4. **The browser presentation is a separate Go container.** It uses
   `net/http`, `html/template`, semantic HTML, hand-authored CSS, and
   server-rendered SVG. It has no authored JavaScript, TypeScript, Node
   runtime, SPA framework, or browser-held control-plane token.
5. **A fixture-backed visual mockup comes before API integration.** It proves
   navigation, visual hierarchy, responsive behavior, and safe-operation
   affordances without requiring a controller or changing its API.
6. **Authorization is capability-scoped at the control plane before any live
   Web UI integration.** The Web UI must not convert every authenticated
   person into one shared administrator identity. A controller-enforced scoped
   credential, its subject/audience/lifetime, CSRF/session behavior, and audit
   attribution are a gate for all live reads and writes. Selecting an external
   identity-provider vendor may remain deferred.
7. **Further active/passive clustering work is deferred.** Presentation
   clients use a stable controller endpoint and do not select or retry writes
   across replicas. Existing cluster support remains untouched and outside this
   ADR's HA assurances.

## Consequences

### Positive

- A browser-facing defect cannot directly access Docker, state, or Git
  credentials.
- Web and macOS experiences can evolve independently of reconciliation.
- One versioned API contract serves humans, the CLI, and approved automation.
- The browser stack remains small, reviewable, and free from a separate
  JavaScript supply chain.
- The fixture-first mockup enables fast UX review before backend constraints
  shape the interface.
- The control-plane boundary is compatible with a future active/passive design.

### Costs and constraints

- The browser service introduces another container and a presentation-to-API
  client boundary.
- A no-authored-JavaScript browser UI uses navigation and forms for interaction
  rather than SPA-style client updates. Live updates require an explicit future
  design decision; the initial experience uses deliberate refresh behavior.
- The embedded UI remains temporarily for compatibility and must be retired
  only after feature, workflow, and authorization parity are proven.
- Controller-enforced capability scopes, identity propagation, and audit
  attribution must be implemented before the Web UI gets live credentials.
  This ADR does not weaken current controls.

## Alternatives considered

### Continue embedding the browser UI in dockercd

Rejected as the target architecture. It preserves the smallest deployment but
keeps browser rendering coupled to privileged control-plane code and makes
independent UI delivery difficult.

### Build a JavaScript/TypeScript single-page application

Rejected. It conflicts with the explicit no-JavaScript direction and adds a
second runtime, build chain, dependency ecosystem, and browser token risk.

### Use a generic dashboard product as the primary UI

Rejected. Grafana, Datadog, Honeycomb, and Argo CD provide useful interaction
patterns, but dockercd needs a focused Compose GitOps workflow rather than a
general observability or Kubernetes console.

### Make the macOS app the only presentation client

Rejected. SwiftUI is the best premium operator surface, but a browser client
remains valuable for broad, platform-neutral access.

### Redesign active/active or active/passive control-plane clustering now

Deferred. Existing optional active/passive support remains untouched. Any
claim of robust HA additionally needs fencing, split-brain prevention, durable
state replication, webhook deduplication, and auditable failover; it must be
designed separately before implementation.

## Migration plan

1. Build and review the fixture-backed Web UI mockup with no controller
   integration.
2. Freeze the rendering view models and define API capability gaps.
3. Define and implement controller-enforced capability scopes, short-lived
   credential semantics, session/CSRF behavior, and audit attribution.
4. Create the unprivileged Go presentation container with live API use only
   after the authorization gate passes.
5. Migrate write workflows with explicit confirmation, idempotency or an
   equivalent operation contract, and authorization checks.
6. Retire embedded UI assets after owner-workflow parity is validated.
7. Schedule the active/passive control-plane ADR separately when required.

## Guardrails

- Do not move Docker socket, Git token, SQLite, or manifest-cache mounts into
  the presentation container.
- Do not expose controller credentials to the browser.
- Do not create fake telemetry or trend visualizations without retained source
  data.
- Do not remove the embedded UI or change deployment exposure as part of the
  mockup phase.
- Do not use color as the only state indicator.
