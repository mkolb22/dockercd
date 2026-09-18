# ADR 0006: Ship a minimal two-service v1 deployment

| Field | Value |
| --- | --- |
| Status | Accepted |
| Date | 2026-09-17 |
| Decision owners | dockercd maintainers and v1.0 release owner |
| Related | [v1.0 goal](../../GOAL.md), [ADR 0001](0001-separate-control-plane-and-presentation.md), [ADR 0003](0003-local-password-bootstrap-for-web-presentation.md) |

## Decision

v1 uses two separately configured deployment instances, each with a distinct
purpose. They are configuration-isolated by project, network, state, and
credentials, not security-isolated when they share one Docker daemon.

### Development deployment

The development deployment is one Docker Compose project containing exactly
two services:

```text
loopback browser port -> dockercd-web -> private Compose network -> dockercd
                                                              -> Docker socket/state/Git
```

- `dockercd` is the privileged single-host control plane. It retains the
  Docker socket and persistent controller state, exposes its API only on
  loopback, and mounts only its digest-only presentation credential registry.
- `dockercd-web` is the unprivileged browser presentation. It is read-only,
  uses a separate local-users secret, has no Docker socket, Git credential,
  controller data volume, or presentation registry mount, and reaches the
  controller only over the private Compose network.

It contains no managed personal application. Its purpose is platform
development, contract validation, and Web presentation validation.

### Personal deployment

The personal deployment is a separate two-service Compose project:
`dockercd` plus its paired `dockercd-web`. It has its own Docker network,
state volume, API credential, presentation credential registry, Web-user
registry, and Git manifest source. It starts with one managed application:
`signal`.

Because both control planes mount an unrestricted Docker socket, a shared
Docker daemon gives each controller host-administrator capability over all
containers, networks, and volumes on that daemon. The two Compose projects
therefore provide operational and secret separation, not a hard security
boundary. A true development/personal security boundary requires separate
Docker daemons or hosts; it is a deployment-owner decision outside this
single-host V1 configuration.

Neither checked-in deployment provides bundle/full install modes,
Gitea, PostgreSQL, an image registry, Prometheus, Grafana, cAdvisor,
active/passive cluster examples, bootstrap overlays, or controller
self-management manifests. Those are not v1.0 product dependencies; any
future reintroduction requires a separate ADR and explicit release scope.

The separate My Apps manifest source begins with one Git-managed application:
`signal`. It owns personal application desired state; the control-plane
repository owns only its development platform deployment.

## Consequences

- Operators can reason about two explicit configuration domains and their
  independently provisioned local secret files, rather than a bundled
  platform or accidental shared Compose configuration. They must not mistake
  that separation for a hard boundary on a shared Docker daemon.
- The release surface, container count, port count, update paths, and recovery
  matrix are materially smaller.
- Existing bundle/cluster users require an explicit migration. Before a
  manifest cleanup is published, pin or pause the old controller's manifest
  source so removal of a manifest cannot reconcile and tear down a running
  application. Preserve and verify application data backups before any
  network, volume, or controller cutover. This repository cleanup changes
  files only; it does not itself stop or remove existing containers, networks,
  volumes, Git repositories, or sync history.
- V1 uses an operator-managed TLS reverse proxy when the Web UI is accessed
  over a network. The Compose file intentionally publishes only loopback
  ports. Native Web TLS is explicitly deferred to the V1.1 backlog item and
  must not alter controller API exposure.
