# ADR 0007: Scoped capacity and controller-health presentation

- Status: Accepted
- Date: 2026-09-17
- Target: v0.1

## Context

The first live Web presentation correctly removed fixture-only host and
configuration views, but it left an operator unable to answer two essential
questions from the normal monitoring surface:

1. Is the control plane itself responding and is its state database ready?
2. Is the Docker host under enough current resource pressure that a proposed
   deployment needs capacity review?

The legacy embedded UI answered part of these questions by using a broad
controller credential. That is incompatible with the separated control-plane
and unprivileged presentation-service architecture. Exposing raw Docker
inspect output, Compose files, container command lines, mounts, environment
values, image inventory, or a shared administrator token would not be an
acceptable replacement.

## Decision

Add two independent, read-only presentation API capabilities and represent
them in a compact environment control-path view.

| Capability | Endpoint | Bounded response |
| --- | --- | --- |
| `controller:status` | `GET /api/v1/presentation/controller` | controller response and **state-database-ready** evidence with controller-authored timestamp; no Docker inspection or application enumeration |
| `capacity:read` | `GET /api/v1/presentation/capacity` | cached aggregate Docker CPU/memory sample, bounded container counts, sample timestamps, and explicit completeness evidence |

Both endpoints require an explicit presentation credential capability and are
separate from `fleet:read` and `application:read`. `capacity:read` is
**host-global aggregate authority**: it reveals aggregate resource pressure
and container counts for the Docker daemon, including workloads outside the
credential's application grants. It must therefore be granted deliberately.
A credential that cannot read either endpoint receives a normal capability
omission; the Web UI must render that as unavailable, never as healthy or
empty.

The capacity endpoint uses a dedicated five-second, coalescing capacity-sample
cache. It is not permitted to reuse the broad host-stats collector because
that path includes disk/image work and has an unbounded goroutine/body budget.
One sample reads a bounded Docker Info response and lists at most 64 running
containers with a Docker-side list limit; it never lists everything and
truncates afterward. Docker Info and ContainerList JSON bodies each have a 1
MiB transport limit, and every container-stat body has the same 1 MiB limit.
The collector reports `truncated` when Docker's reported running count exceeds
the bounded running-list result. It collects at most eight container-stat
requests concurrently and has a four-second total deadline and one-second
per-stat deadline. The sample reports truncation and partial collection rather
than spawning work for remaining containers. A failed sample is cached briefly
with a stable, redacted failure code to prevent sequential retry storms.

The response allowlists aggregate numbers only: no application or project
names, container IDs, images, mounts, environment values, disk usage, raw
errors, or per-container values. It exposes a current usage sample only. It
does **not** assert that a future deployment is safe: that claim requires
declared resource reservations and a separate, reviewed deployment-impact
contract.

## Presentation behavior

The Web Fleet page is the environment overview. It contains a persistent,
two-node control-path panel:

```text
       Controller                                      Presentation
┌──────────────────────┐  scoped, server-side API  ┌──────────────────────┐
│ dockercd             │ ─────────────────────────> │ dockercd-web         │
│ reachable / ready    │    response time + time     │ serving this session │
│ capacity sample      │                             │ scoped session       │
└──────────────────────┘                             └──────────────────────┘
```

- Each node uses a named textual state, icon, and color; color alone never
  carries meaning.
- The edge states whether the Web service obtained a scoped controller
  response and when the controller authored it. It does not imply a network
  guarantee outside that request.
- The controller node links to a controller evidence page. The Web node links
  to presentation settings/session context. A degraded node or edge links
  directly to the relevant evidence, preserving the selected environment and
  freshness context.
- Capacity appears beside the controller node as normalized CPU utilization,
  observed container memory compared with Docker engine memory, bounded
  container counts, completeness, and timestamps. It shows no “headroom” or
  “safe to deploy” value in v0.1.
- The fleet overview has a dedicated attention queue above normal roster data.
  Only actionable degraded, stale, unavailable, or incomplete evidence enters
  it. A healthy environment remains visually quiet.

## Consequences

- Operators regain real capacity and readiness evidence without restoring a
  broad browser-to-controller trust path.
- The controller has a small, versioned contract suitable for a future Swift
  Console as well as the Web service.
- Raw configuration/diff/history/service inspection remain outside this
  decision. Their later read contracts must redact secret-adjacent data and
  define bounded-work limits independently.
- Existing presentation credentials must be deliberately updated to include
  the two new capabilities. No privilege is inferred from an existing scope.
- `controller:status` means the process answered this scoped request and its
  state database passed a bounded readiness check. It does not imply Docker,
  Git, scheduler, or reconciliation health; those remain separate evidence.
- A capacity response carries `sampleStartedAt`, `sampleCompletedAt`,
  `responseGeneratedAt`, eligible/observed container counts, and one of
  `complete`, `partial`, `truncated`, or `unavailable`. The Web UI treats a
  sample older than 15 seconds as stale. It calculates age only as the
  controller-authored `responseGeneratedAt - sampleCompletedAt`; future or
  inconsistent timestamps are unavailable evidence. Controller response time
  never resets the age of an older sample.

## Required verification

1. Controller route tests prove scope denial, response redaction, bounded
   cache reuse, timestamp validity, and unavailable behavior.
2. Cross-module strict JSON fixtures cover both new DTOs.
3. Web client, mapper, and template tests distinguish available, unavailable,
   stale, incomplete, and failed evidence without fixture fallback.
4. Full test, vet, and race suites pass in `src/` and `web/`.
5. An independent high-reasoning review has no unresolved P0/P1 and records
   any P2 disposition before deployment.
