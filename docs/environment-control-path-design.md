# Environment control-path design

## Purpose

Give an operator an accurate answer in one glance: **is this environment
available, is the control path intact, is capacity currently under pressure,
and what deserves attention?** The design is for one Docker host, one
`dockercd` control plane, and one `dockercd-web` presentation service.

This is intentionally not a miniature Grafana, Argo CD clone, or animated
network map. Two principal nodes do not need a topology canvas; they need an
obvious relationship, evidence freshness, and a short path to the failing
fact.

## Research distilled into design rules

- Datadog's host/container maps use hierarchy, color, grouping, and direct
  drill-down to make infrastructure state scannable. For DockerCD's two-node
  environment, retain the relationship and direct drill-down but use two
  named cards instead of a dense map.
  ([Host Map](https://docs.datadoghq.com/infrastructure/hostmap/))
- Elastic drill-downs preserve the originating context while moving from an
  overview to a focused detail. DockerCD links an unhealthy node, edge, or
  application directly to its relevant evidence rather than opening a generic
  dashboard.
  ([Elastic drill-downs](https://www.elastic.co/docs/explore-analyze/dashboards/drilldowns))
- Apple recommends using color consistently for status and ensuring it works
  in light, dark, and increased-contrast appearances. DockerCD pairs color
  with text, iconography, and timestamps; green is never used as decoration.
  ([Apple HIG: Color](https://developer.apple.com/design/human-interface-guidelines/color))

## Information hierarchy

```text
Environment / freshness / refresh
│
├── Attention strip (only when evidence needs action)
│     └── exact issue → relevant node, capacity, or application evidence
│
├── Control path: [dockercd] ── scoped API ──> [dockercd-web]
│     ├── controller: liveness, readiness, API response, last evidence time
│     └── presentation: serving this session, scoped-session state
│
├── Current capacity: normalized CPU / observed memory / container counts /
│   sample completeness
│
└── Application fleet: health summary → roster → application overview
```

The first viewport contains the environment status, attention, control path,
and capacity. The application roster follows it. A normal, healthy view is
quiet; severity earns visual prominence instead of every card competing for
attention.

## Node grammar

Every node and connection uses the same evidence grammar:

| State | Text and icon | Color role | Interaction |
| --- | --- | --- | --- |
| Healthy / ready | `✓ Ready` | mint | Opens current evidence, not an empty success page |
| Degraded | `! Needs review` | coral | Opens the exact failed/late datum |
| Stale | `~ Last sample …` | amber | Opens freshness explanation and refresh action |
| Unavailable | `? Not available to this session` | slate | Explains scope versus controller failure |
| Incomplete | `? Partial sample` | slate | States what could not be observed; makes no capacity claim |

The controller node does not say “container healthy” unless Docker Compose
has actually supplied that state. It reports the narrower facts it owns:
process response, **state-database readiness**, and current scoped API
evidence. It never labels that state “ready to reconcile,” because Docker,
Git, scheduler, and reconciliation health require independent evidence.

The Web node does not pretend to monitor itself from outside. It says “serving
this session” only after this server rendered the page; its connection edge
reports the controller response result separately.

## Capacity panel

The panel is a decision aid, not an admission controller.

```text
CURRENT CONTAINER SAMPLE                sampled 14:32:09Z
CPU    18.4% normalized across 10 cores current load, not a reservation
MEM    2.1 GiB observed / 7.8 GiB engine current container sample only
WORK   13 observed running / 17 listed  complete sample

Capacity conclusion: Review deployment requirements; no admission conclusion.
```

The conclusion is conservative by design. Aggregate CPU is the sum of valid
container core-equivalent percentages divided by the reported CPU-core count;
missing or invalid CPU counters make it partial rather than zero. Memory is
observed container usage, not a reservation or free-memory claim. Without
declared CPU/memory reservations in the candidate Compose configuration,
DockerCD cannot prove that another deployment fits. Future application detail
can add a separate “deployment impact” card only after its manifest-derived
inputs and redaction rules are specified.

Capacity has host-global aggregate scope. It may reflect unrelated daemon
workloads, but never identifies them. A partial, truncated, unavailable, or
older-than-15-second sample is visibly labelled and does not render a meter
that implies a complete current reading.

The controller emits both the sample-completed time and response-generated
time. The UI derives freshness only from those two controller-authored values,
rejecting a future or inconsistent pair instead of comparing either one to the
browser clock. This prevents browser/controller clock skew from making an old
sample appear current.

## Drill-down contract

| Click target | Destination | Context retained |
| --- | --- | --- |
| Controller node | Controller evidence | environment, response timestamp |
| Scoped API edge | Controller evidence | source request freshness |
| Capacity card | Capacity section in the current page | exact sample timestamp/completeness |
| Attention item | named app or controller/capacity evidence | selected issue |
| Application row | Application overview | application name and fleet context |

No click should lead to a fixture, generic 404, or “not implemented” page.
If a capability is absent, the overview shows an explicit unavailable state
and offers the safe nearest destination.

A capacity click is an in-page drill-down in v0.1, so it retains the exact
sample already rendered. A future separate capacity detail page must either
serve a retained snapshot keyed by its timestamp or clearly label the result
as a newly requested observation; it must never make a new sample appear to
be the original one.

## Visual direction

- Use a wide, softly elevated control-path surface with two strong, named
  cards and a restrained connecting line. The connection is an evidence
  relationship, not a decorative animated flow.
- Use large status words and compact metadata below them. Avoid gauge-heavy
  decoration; concise horizontal meters with numerical labels work better for
  CPU and memory samples.
- Reserve the mint brand accent for confirmed healthy/ready evidence. Use
  coral only for action-needed state, amber only for freshness/review state,
  and slate for unknown/unavailable/incomplete state.
- Respect `prefers-reduced-motion`; no motion conveys status. Keyboard focus,
  semantic headings, visible text, and sufficient contrast are required.

## Deferred depth

Detailed Compose configuration, diffs, logs, image inventory, container
commands, mounts, and environment data do not appear in this overview. They
need separate capability-scoped, redacted, bounded contracts before they can
be rendered.
