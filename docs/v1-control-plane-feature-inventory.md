# v1.0 control-plane feature inventory

## Purpose

This is the evidence-backed inventory used to keep the v1.0 release scope in
[GOAL.md](../GOAL.md) smaller than the current codebase. A feature being
implemented today does not make it a supported v1.0 promise.

## Locked v1.0 control-plane core

| Capability | Current evidence | v1.0 disposition |
| --- | --- | --- |
| Git-managed application manifests and desired state | `reconciler/configsync.go`, `gitsync`, parser | Keep and harden as the application source of truth. |
| Standard Compose reconciliation | reconciler worker, deployer, scheduler | Keep as the only supported deployment strategy. |
| Manual sync, dry-run/diff, known-revision rollback | authenticated application API and reconciler | Keep as documented CLI/API recovery controls. |
| Health observation and stored status evidence | `health`, store observations, presentation read DTOs | Keep; preserve separate desired/sync/observed timestamps. |
| Bounded history and redacted events | store, API, presentation activity | Keep with explicit redaction and limits. |
| Authenticated controller and scoped presentation API | API auth, presentation registry/authenticator | Keep; no anonymous or broad browser credential path. |
| Probes, migrations, backup/recovery documentation | `/healthz`, `/readyz`, migrations, deploy docs | Keep as release-operability requirements. |

## Supported v1.0 surfaces

- **Controller CLI/API:** authenticated administration and recovery only.
- **`dockercd-web`:** scoped, server-rendered, read-only monitoring.
- **Git webhook:** optional acceleration only; polling/reconciliation remains
  the correctness mechanism.

The release documentation must describe these surfaces as distinct. The Web
service is not an administrator proxy and must not acquire controller, Docker,
Git, or database privileges.

## Present code that is not a v1.0 feature commitment

| Existing capability | Release disposition | Cleanup decision required |
| --- | --- | --- |
| Embedded SPA, `/`, `/ui/*`, browser login/session routes | Remove before v1.0 completion under the GOAL migration gate. | Inventory `api/static`, redirects, cookie-only auth, tests, docs, and image contents. |
| Cluster package: promotion, replication, peer heartbeat/update | Backlog. No active/passive guarantee in v1.0. | Disable/remove v1-facing configuration and documentation after compatibility review; do not claim HA. |
| Blue-green reconciliation path | Backlog. | Remove or isolate from v1 configuration and tests; standard Compose is the release path. |
| `adopt` existing deployment endpoint | Backlog. | Keep out of release docs and Web; decide whether to remove after an explicit migration plan. |
| SSE event stream | Backlog. | Retain bounded persisted event reads; remove the stream from v1 exposure if no supported client needs it. |
| Per-service detail, metrics, and logs | Backlog. | Do not expose through the v1 Web contract; evaluate removal or CLI-only treatment during cleanup. |
| Deep desired topology and field-level diff presentation | Backlog. | Keep only authenticated CLI/API dry-run/diff evidence required for recovery. |
| Direct application create/update/delete API editing | Not a primary GitOps workflow. | Decide one bootstrap path—Git manifest repository or documented CLI/API bootstrap—then deprecate/remove the duplicate path with migration evidence. |
| Global poll-interval mutation endpoint | Administrative tuning, not product workflow. | Keep only if documented and bounded; otherwise move to startup configuration. |

## Release cleanup sequence

1. Prove the locked core with controller, Web, migration, and recovery tests.
2. Publish a compatibility inventory for every client, route, configuration
   key, image asset, and deployment manifest affected by removal.
3. Remove the legacy embedded UI first, because its replacement boundary is
   defined and already has a dedicated v1.0 completion gate.
4. Remove or isolate deferred code in small compatibility-reviewed tranches;
   every deletion must update routes, configs, tests, images, docs, and the
   release evidence together.
5. Reject any cleanup that changes a deployed network boundary, deletes sync
   history, rotates a secret, or breaks an identified client without explicit
   release-owner approval.

## v1.0 release quality questions

- Can a new operator recover a known revision through documented CLI/API steps
  without relying on the removed embedded UI?
- Does every status statement identify whether it is desired, synced,
  controller-generated, or Docker-observed?
- Can the controller and Web images be inspected to prove their privilege and
  asset boundaries?
- Are unsupported advanced paths absent from release documentation and from
  normal configuration, rather than merely undiscovered?
