# Web presentation research and mockup brief

## Status

**Research complete; fixture-only mockup implemented and under owner review.**

This brief turns the presentation architecture decision into a visual and
navigation direction. The first deliverable is a static, high-fidelity mockup
with believable fixture data. It must not call dockercd or require a running
controller.

## Decision: mock up before connecting data

Build and review the browser experience before binding it to control-plane
endpoints. This is a design-validation step, not a disposable prototype.

The mockup will establish:

- information architecture and navigation labels;
- page hierarchy, empty states, loading states, and error states;
- visual tokens, typography, status semantics, and responsive behavior;
- interaction contracts for safe operations; and
- the view models the eventual Go server will render from API data.

Only after the owner journey is approved should a data adapter be introduced.
That keeps API limitations from becoming accidental design decisions and avoids
building a visually polished shell around the wrong workflow.

## Research synthesis

### Grafana: a dashboard tells one story

Grafana’s guidance is the strongest guardrail: a dashboard should answer a
specific question, progress from general to specific, and reduce cognitive
load. For dockercd, the fleet landing page answers **“what needs attention and
is it safe to deploy?”** It is not a wall of generic CPU, memory, and container
charts.

Adopt:

- one operational question per page;
- semantic, consistent status color;
- direct navigation from attention signals to the relevant application; and
- visualizations only when they answer a real operating question.

Reject:

- a panel-builder experience;
- always-refreshing data that does not change at that rate; and
- aggregates that hide the one degraded application.

### Datadog: health and deployment context belong together

Datadog’s service page makes a useful connection between current health,
recent deployments, errors, and a path to investigation. dockercd should use
the same relationship at its own scale: each application detail starts with
its deploy state, deployed revision, sync status, and latest meaningful event.

Adopt:

- a deployment hero with revision provenance;
- a visible before/after or desired/live relationship;
- an attention callout only when action is needed; and
- a short route from a degraded service to event history and logs.

Reject:

- APM-like charts when dockercd has not retained those samples; and
- error visualizations that suggest causal analysis the controller cannot yet
  support.

### Honeycomb: investigation has a stable context

Honeycomb’s strongest pattern is a focused investigation workspace: context is
not discarded while an operator drills into detail. dockercd should preserve
controller, application, revision, and time/freshness context in its page
header and breadcrumbs.

Adopt:

- a durable context bar;
- a readable chronological event rail; and
- progressive disclosure from fleet to application to service to evidence.

Reject:

- query-builder complexity for ordinary deployment operations; and
- forcing an operator to reconstruct context after opening logs or a diff.

### Argo CD: hierarchy is useful; visual density is not the goal

Argo CD’s application/resource hierarchy is useful because it connects desired
state with live resources. dockercd should retain that mental model, adapted to
Compose: **fleet → application → service → container**. It should not inherit
the crowded, table-first presentation or make every internal resource equally
important.

Adopt:

- a compact Compose service topology on the application overview;
- direct desired-versus-live state cues; and
- honest, actionable sync and health states.

Reject:

- dense status grids as the default landing surface; and
- topology ornamentation that does not reveal health, dependency, or drift.

## Visual north star: Fleet Command Center

The browser surface should feel like a composed operations workspace, not an
infrastructure spreadsheet. It is calm at rest and unmistakable when action is
required.

### Design principles

1. **Attention precedes inventory.** Show actual degraded, drifted, or failed
   work before healthy application counts.
2. **Depth follows intent.** The operator chooses to enter application,
   service, diff, event, or log detail; the interface does not open all data at
   once.
3. **Status is multimodal.** Every state has text, a shape or icon, and color.
   Green alone never means healthy.
4. **Glass is restrained.** Use depth and translucent surfaces only to group
   related information; no decorative card ocean, excessive gradients, or
   animated noise.
5. **Data earns its visualization.** Server-rendered SVG is appropriate for
   topology, event rails, and retained time-series data. Do not fabricate
   sparklines from a single current value.
6. **Operations feel deliberate.** Sync, rollback, edit, and delete always
   identify the controller and application and require appropriate
   confirmation.

### Visual system

Use a dark adaptive base with a light mode that is equally designed, not an
inversion. Build tokens for ink, canvas, elevated surface, hairline, primary
text, muted text, focus ring, and semantic states. Health uses mint, attention
uses amber, failure uses coral, and navigation/action emphasis uses indigo.

Semantic states must also carry a named label and glyph. Body text and controls
must meet WCAG 2.2 AA contrast expectations; the status palette must work in
light, dark, and increased-contrast modes.

## Navigation model

```text
Global rail
├── Fleet                 “What needs my attention?”
├── Applications          Searchable inventory and saved views
├── Activity              Cross-fleet deployment and error timeline
├── System                Controller and host snapshot
└── Settings              Connections, refresh, and future identity controls

Persistent context bar
├── Controller switcher / environment identity
├── Connection and freshness state
├── Refresh policy
└── Command entry point (future)

Application route
├── Overview              deployment hero, topology, service state
├── Deploy                desired state and live diff
├── Timeline              sync history and controller events
└── Inspect               demand-loaded service metrics and logs
```

Navigation must be stable across pages, keyboard reachable, and visually clear
without relying on hover. Mobile is not the primary operator target, but every
page must reflow coherently to a narrower browser window.

## Static mockup scope

The mockup should be a separate `dockercd-web` workspace, but it remains
unconnected to the controller.

### Pages

1. **Fleet Command Center** — health hero, attention queue, chronological event
   strip,
   fleet roster, and explicit freshness.
2. **Applications** — compact inventory with real fixture-backed GET search
   and filters; a healthy, degraded, and intentionally empty example.
3. **Application overview** — deployment hero, Compose service topology,
   revision provenance, and live service cards.
4. **Deployment comparison** — desired/live diff with action affordance and
   clear no-change state.
5. **Timeline and inspection** — event rail, sync records, log viewer, and
   metrics empty state that explains retained-history requirements.
6. **System** — host snapshot, controller state, and capacity context without
   fake historical charts.
7. **Activity and Settings** — meaningful fixture-backed timeline and
   connection/refresh states, or omitted from navigation until they exist.

### Fixture scenarios

- An entirely healthy fleet with a shared revision.
- A degraded application following a failed deployment.
- One intentionally empty manifest, presented as context rather than an alert.
- A controller connection degradation retaining its last successful data.
- An operator attempting sync, rollback, edit, and delete, each with explicit
  target context and confirmation.

### Acceptance criteria before API integration

- An operator identifies the displayed fleet health, its freshness, and the
  next action within five seconds. The mockup does not claim deployment safety
  from a response that lacks an authoritative observation timestamp.
- A first-time user reaches an application’s revision and last deployment
  outcome in two navigation choices or fewer.
- Every task works as ordinary navigation or an HTML form submission; filters
  use real fixture-backed GET forms, confirmations use real routes, and no
  custom JavaScript behavior is required.
- The app remains intelligible in light mode, dark mode, 200% text zoom, and
  keyboard-only navigation.
- The approved mockup has no Docker socket, Git token, controller API token,
  database, or network dependency.

## Implementation recommendation after approval

Implement the approved mockup as a Go service with `html/template`, CSS, and
server-rendered SVG. Start with a fixture-backed presenter interface; replace
only that implementation with an authenticated control-plane API client after
the experience is accepted. Use Post/Redirect/Get for mutations and preserve
the page’s controller/application context in confirmations and responses.

No React, Vue, Angular, Svelte, TypeScript, Node, HTMX, or browser-resident
controller credentials are part of this recommendation. Any exception requires
an explicit architecture decision.

## Project knowledge assets

This brief is the first project-local knowledge asset for the Web UI. Before
implementation begins, add a compact UI build playbook that turns the approved
mockup into repeatable review rules: semantic token names, component inventory,
fixture conventions, accessibility checks, and screenshot-review workflow.

A reusable Codex skill is possible, but it should be created only after those
rules have proved stable across at least one mockup iteration. Until then, a
repository document is more transparent, reviewable, and easier to evolve.

## Sources

- [Grafana: dashboard best practices](https://grafana.com/docs/grafana-cloud/learn-and-build/visualizations/dashboards/build-dashboards/best-practices/)
- [Grafana: plan your visualization](https://grafana.com/docs/learning-paths/visualization-metrics/plan-visualization/)
- [Datadog: service page](https://docs.datadoghq.com/tracing/services/service_page/)
- [Datadog: deployment tracking](https://docs.datadoghq.com/tracing/services/deployment_tracking/)
- [Honeycomb: Boards](https://docs.honeycomb.io/investigate/observe/boards)
- [Argo CD: ApplicationSet Web UI](https://argo-cd.readthedocs.io/en/latest/user-guide/application-set-ui/)
- [Argo CD: Resource views](https://argo-cd.readthedocs.io/en/latest/user-guide/resources-view/)
- [Apple: Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/)
- [Apple: Color](https://developer.apple.com/design/Human-Interface-Guidelines/color)
- [W3C: WCAG 2.2](https://www.w3.org/TR/WCAG22/)
