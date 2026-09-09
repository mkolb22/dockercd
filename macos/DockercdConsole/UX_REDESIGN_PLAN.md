# dockercd Console — Command Center redesign

## Intent

Turn the current functional-but-generic SwiftUI admin surface into a calm,
macOS-native operations console. The product should answer *what needs my
attention?* before exposing detailed telemetry.

The visual direction is **Command Center**: deep adaptive surfaces, restrained
electric color, dense-but-readable application state, and deliberate motion.
It is not a Grafana clone and must not simulate data the controller does not
have.

## Research decisions

- A dashboard tells one story and reduces cognitive load; drill-downs follow
  the service hierarchy rather than treating every panel as equally important.
  [Grafana dashboard best practices](https://grafana.com/docs/grafana/latest/visualizations/dashboards/build-dashboards/best-practices/)
- Fleet health, deployment context, and attention signals belong together in a
  service overview. [Datadog service-page pattern](https://docs.datadoghq.com/tracing/services/service_page/)
- Use the Mac canvas, keyboard, inspectability, and system materials rather
  than copying a browser dashboard. [Apple macOS design guidance](https://developer.apple.com/design/human-interface-guidelines/designing-for-macos/)
- Adopt standard adaptive materials for navigation and controls; use custom
  visual surfaces only where they clarify state. [Apple Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/liquid-glass?changes=l_1)

## Experience architecture

```text
Controller context bar
└── Fleet Command Center
    ├── Health hero: healthy count, current revision, freshness
    ├── Attention queue: errors, drift, intentionally empty apps
    ├── Deployment pulse: recent success/failure activity
    └── Fleet roster: dense health, revision, services, latest operation

Application detail
├── Deployment hero: health halo, revision provenance, sync action
├── Overview: service cards and current resource snapshot
├── Deploy: desired state and live diff
├── Services: metrics and logs on demand
└── Timeline: events and history, newest first
```

## Implementation phases

### 1. Command Center foundation — in progress

- [x] Create shared visual tokens and semantic colors.
- [x] Replace flat dashboard metric cards with a health hero, attention queue,
  deployment pulse, and high-signal fleet roster.
- [x] Make application rows compact, revision-aware, and status-first.
- [x] Upgrade the application hero with health context and deployment actions.

### 2. Operational visualizations

- [ ] Add service topology when dependency data is available from Compose.
- [ ] Add resource snapshot cards for CPU, memory, and network on the service
  detail surface.
- [ ] Make the timeline a visual event rail rather than a raw log list.

### 3. Honest history

- [ ] Persist sampled host/container metrics server-side before displaying
  sparklines or time-series charts.
- [ ] Add deployment-duration and health-transition series.
- [ ] Use Swift Charts with subtle axes and accessible annotations.

### 4. Mac power-user polish

- [ ] Add `⌘K` command palette and keyboard navigation.
- [ ] Add a contextual inspector for service detail, logs, and metrics.
- [ ] Respect reduce-motion, increase-contrast, Dynamic Type, and window size.

## Data integrity rules

- A live health state uses semantic color; decorative color never implies
  health.
- Trends appear only when they are based on retained samples.
- Empty manifests are described as intentionally empty, not unhealthy.
- A stale refresh remains visible as stale; prior successful data stays on
  screen during a connection error.

## Validation journey

`Select My Apps → identify fleet state and any attention item in under five
seconds → open a service → understand deployed revision and live status without
reading raw events.`
