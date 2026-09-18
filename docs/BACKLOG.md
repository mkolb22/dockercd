# DockerCD product backlog

Items here are deliberately **outside** the locked v1.0 release. They may not
be implemented as opportunistic additions to a v1.0 tranche.

| Item | Why it is deferred | Admission requirement |
| --- | --- | --- |
| Active/passive control plane | Needs leader fencing, replicated durable state, promotion safety, and recovery proof. | Dedicated HA ADR, threat model, failure drills, and owner approval. |
| Multi-host Docker fleet | Adds transport, identity, scheduling, and failure domains. | Host trust model, scoped authorization, and operational evidence design. |
| Federated Web workspace (many controllers to one Web service) | Introduces controller identity, per-controller credentials, partial-failure UX, and cross-controller resource limits. | ADR covering controller registry/rotation, session-to-controller isolation, audit provenance, bounded aggregation, and owner validation. |
| Blue-green deployments | Changes deployment and rollback semantics. | Revision-safe strategy design and rollback/health evidence. |
| Adoption/import of existing deployments | Can create ambiguous desired/live ownership. | Explicit ownership-transfer and recovery design. |
| Browser mutations | A browser response loss must not cause duplicate deployment work. | Durable idempotent operation resource, approval/CSRF design, and outcome UX. |
| OIDC and multi-instance Web sessions | Local password bootstrap is the current single-instance solution. | Identity, token exchange, revocation, session-store, and availability ADR. |
| Live browser updates and SSE | Requires resource filtering, replay, backpressure, and reconnect policy. | Versioned event-feed contract and load/failure tests. |
| Metrics, log streaming, deep diff, service inspection | Need retention, redaction, authorization, and resource budgets. | Page-specific read contracts and performance limits. |
| Swift macOS client | Depends on a stable control-plane and operation contract. | Owner-reviewed SwiftUI design and authenticated network-session plan. |
| AI operator assistance | Must never hold control-plane authority or receive secrets. | Separate data-governance ADR, redaction boundary, evals, and advisory-only tools. |

## Promoting an item

To move an item into a later release, add a dated ADR with the operator
problem, trust boundaries, failure behavior, migration impact, required tests,
and target release. Update that release goal only after explicit approval.
