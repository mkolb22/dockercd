# ADR 0008: Remove deferred cluster mode and unused Node tooling from v0.1

| Field | Value |
| --- | --- |
| Status | Proposed |
| Date | 2026-09-18 |
| Decision owners | dockercd maintainers and v0.1 release owner |
| Related | [GOAL](../../GOAL.md), [backlog](../BACKLOG.md), [ADR 0006](0006-minimal-v1-deployment.md) |

## Context

v0.1 is intentionally a single-host, single-controller release. Active/passive
control-plane design, leader fencing, state replication, and failover remain
backlog work because their failure model is not validated. The repository still
contains a dormant two-node cluster implementation, related configuration
defaults, validation, and daemon startup branches. Although disabled by
default, that code is shipped and can be enabled, contradicting the release
scope and expanding the Docker-client attack surface.

The tracked root Node package has no scripts or product consumer, but the
tracked `.mcp.json` Dragonfly launcher invokes its installed plugin. Its
`@dragonflymcp/plugin` dependency pulls a high-severity, tooling-only `sharp`
advisory chain into `npm audit --omit=dev`. It is not included in either Go
runtime image, but unneeded tracked tooling is not an acceptable v0.1 release
dependency.

## Decision

1. Move `src/internal/cluster` outside active Go modules into the clearly
   marked archive, and remove all active cluster-specific daemon startup,
   configuration fields, defaults, validation, tests, documentation, and
   compatibility claims.
2. Reject an explicit legacy `cluster` configuration key (including empty,
   null, scalar, nested, dotted, or mixed-case forms) or
   `DOCKERCD_CLUSTER_` environment variable (including an empty value) at load
   time with an actionable error. Detect environment input by scanning
   `os.Environ` directly and detect file input before unmarshal; do not rely on
   Viper enumeration of removed keys. Do not silently ignore an operator's
   former HA intent. A later HA design must introduce a new, reviewed
   configuration namespace through its own ADR.
3. Keep the existing single-node startup sequence as the only production path;
   do not alter controller ports, API authentication, presentation scopes,
   Docker access, state volumes, or paired deployment topology.
4. Retire the tracked Dragonfly launcher (`.mcp.json`), root `package.json`,
   lockfile, and old Node migration script together by moving them into a
   clearly marked inactive archive. Do not remove `.codex`, Dragonfly data, or
   other external tooling; fresh checkouts must not retain a launcher that
   points into a deleted `node_modules` tree.
5. Record the Moby AuthZ-plugin advisories reported by `govulncheck` as an
   upstream-unfixed residual risk. DockerCD must continue to bound its own
   request bodies and retain the Docker socket inside the controller boundary;
   this ADR does not weaken those controls or suppress the finding.

## Verification

- Source searches find no active cluster package, startup/config wiring, or
  tracked Node tooling dependency outside archive material.
- Configuration tests prove legacy cluster file/env inputs fail closed.
- Existing single-node configuration and startup tests pass.
- Full controller/Web test, vet, and race suites pass. `govulncheck` is
  re-run and the upstream-unfixed Moby advisory disposition is recorded. The
  pre-removal production-only npm audit is retained as evidence; after root
  Node tooling is retired, that audit is explicitly inapplicable rather than
  represented as a passing check.
- A high-reasoning independent review finds no P0/P1; any P2 is resolved or
  explicitly dispositioned before deployment.

## Consequences

This ADR supersedes ADR 0001's temporary instruction to leave existing cluster
support untouched and the corresponding current-architecture claims. Historical
ADRs retain their original rationale. Existing cluster configuration is
intentionally incompatible with v0.1 and must not be used for an
upgrade-in-place. Operators needing HA retain their
deployment unchanged until a separately reviewed future migration exists.
The minimal paired development and personal deployments are unaffected because
neither configures cluster mode.
