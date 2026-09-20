# Disposable authenticated recovery drill design

## Purpose and completion boundary

This drill supplies release evidence for the supported mutation/recovery path:
authenticated application creation, CLI desired/diff/sync/rollback, API
history inspection, failed authentication, failed rollback, and SQLite
restore. It must run wholly outside the development and personal DockerCD
pairs and the Signal workload.

It is deliberately a controller/API exercise. It does **not** validate the
owner's local-Web password journey, Signal backup/restore, or personal
cutover; those are separate v0.1 gates. The matching Web image digest is
recorded with the drill only as release identity evidence, not as an assertion
that Web mutations exist.

## Isolation contract

```text
trusted ephemeral CLI/API client -> temporary controller -> dedicated drill Docker daemon
                                      |                         |
                              temporary SQLite state       temporary smart-HTTP Git
```

Docker network separation alone cannot isolate a controller that can reach a
Docker daemon. The drill therefore requires a **dedicated disposable Docker
daemon/context**, distinct from the daemon running either deployed pair and
Signal. The harness must reject the current development/personal context,
record the selected daemon ID and endpoint fingerprint, and start the
controller with a clean environment (`DOCKER_HOST`, `DOCKER_CONTEXT`, proxy
variables, and Docker-config inheritance removed). It passes only the
generated endpoint and credentials needed for that dedicated daemon.

[`scripts/recovery-drill-preflight.sh`](../scripts/recovery-drill-preflight.sh)
implements the no-side-effect first check. It requires an explicitly selected,
reachable context and an explicit list of every context hosting a deployed
pair. It compares the candidate's bounded daemon identity with each protected
context (and the active context), rather than trusting endpoint strings; it
also suppresses endpoint diagnostics and bounds noninteractive probes. It
emits non-secret context/daemon identity evidence which the runner must
revalidate immediately before creating its first object. Probe timeouts are
restricted to one through sixty seconds and terminate direct helper processes
before the client is hard-killed. Its mocked regression check is
`scripts/recovery-drill-preflight-test.sh`.

Every generated Docker object has both a unique, random `dockercd-drill-`
prefix and a `com.dockercd.drill-run=<run-id>` label. Generated controller,
Git fixture, workload, network, volume, and state objects use no fixed names,
host ports, host-path mounts (apart from the dedicated daemon endpoint needed
by the temporary controller), privileged mode, external network, or external
volume. Cleanup uses the recorded container/network/volume IDs and exact run
label; a prefix search is verification only, never a deletion selector.

Before start and after cleanup, the harness records only IDs and running state
for the development controller/Web pair, personal controller/Web pair, and
Signal. Any changed ID, restart count, or running/health state is a failed
drill. The harness must not attempt a compensating restart.

The temporary controller receives a fresh random admin bearer, new temporary
state/cache/config directories, and a unique Compose project name. It receives
no presentation registry, Web-user registry, production/personal state, or
production secret mount. Bearers are read through protected files or inherited
process descriptors, never command arguments, JSON artifacts, logs, terminal
output, or shell history.

The fixture Git server is reachable only as a unique hostname on the dedicated
daemon's isolated network and is the controller's sole Git allowlist entry.
Its server accepts neither redirects nor credentials. The client disables
redirect following and fails if a redirect response is observed. `file://`,
literal loopback, and private-IP Git-source exceptions remain forbidden.

### Provisioning the execution host

The runner intentionally refuses a drill context that is also the shell's
current context. This protects an operator from accidentally making their
active development or personal daemon the drill target. Therefore execute it
on a dedicated disposable Linux VM or host—not on the Docker Desktop host
running either paired deployment—and use this topology:

```text
runner host
  current context: an independently reachable guard daemon (read-only preflight)
  recovery-drill context: unix:///var/run/docker.sock on this host's disposable daemon
```

The local `recovery-drill` context is necessary because the temporary
controller must mount the dedicated daemon's standard socket. The distinct
current `guard` context is necessary because preflight protects the active
context as well as every context explicitly named in
`DOCKERCD_RECOVERY_PROTECTED_CONTEXTS`. The guard daemon must be a different,
reachable daemon with no drill authority; it is only queried for identity.

Do not use Docker-in-Docker, a privileged helper, a custom/rootless socket, or
a context sharing the Docker Desktop daemon to satisfy this requirement. Those
arrangements either weaken the isolation boundary or are rejected by the
runner. Provision the VM/host and its daemons outside DockerCD; this release
workflow never creates them.

On the dedicated execution host, after the disposable daemon and separate
guard context already exist, create the local drill context and execute only
the reviewed commands below. Replace the illustrative context names with the
actual non-secret names. Every protected context must be reachable from this
host because preflight compares daemon identities.

```sh
docker context create recovery-drill \
  --docker 'host=unix:///var/run/docker.sock'
docker context use recovery-guard

env -u DOCKER_HOST -u DOCKER_CONTEXT \
  DOCKERCD_RECOVERY_DRILL_CONTEXT=recovery-drill \
  DOCKERCD_RECOVERY_PROTECTED_CONTEXTS=development,personal \
  ./scripts/recovery-drill-preflight.sh

env -u DOCKER_HOST -u DOCKER_CONTEXT \
  DOCKERCD_RECOVERY_DRILL_CONTEXT=recovery-drill \
  DOCKERCD_RECOVERY_PROTECTED_CONTEXTS=development,personal \
  ./scripts/recovery-drill.sh
```

The two commands must both succeed. Copy the redacted evidence directory
reported by the runner to durable release storage, verify that the copied
directory contains the expected result and verification records, and retain
only that copy. A pathname in the disposable host's checkout is not release
evidence after the host is destroyed. Once the copy and cleanup proof are
complete, return to the guard context and remove the disposable host/VM and
its local context through the host's approved lifecycle procedure. Do not
remove, restart, or reconfigure development, personal, or Signal resources as
part of this drill.

## Deterministic fixture

1. Create a private bare repository with a `release` ref initially pointing to
   commit **A**. Commit A contains a single bounded sentinel service with a
   unique label `com.dockercd.drill.revision=A`, no ports, no volumes, bounded
   CPU/memory, and a command that remains running through every assertion.
2. Create commit **B** with only the label value changed to
   `com.dockercd.drill.revision=B`. Do not advance `release` until after the
   successful commit-A sync is proven.
3. Use a digest-pinned fixture image and set Compose `pull_policy: never`.
   Before registering the application, verify on the dedicated daemon that
   `docker compose pull` succeeds with that exact fixture; this is mandatory
   because rollback currently invokes `Pull: true`. A missing image or a
   Compose-version policy mismatch fails the drill rather than silently using
   a local-only image or external registry access.
4. Register an application whose `targetRevision` is `release`, with
   `automated: false`, `selfHeal: false`, `prune: false`, and explicit bounded
   sync/health timeouts. The harness waits only for the controller readiness
   probe before explicit operations; it never uses scheduler timing as proof.

The reviewed fixture sources live in
[`scripts/testdata/recovery-drill`](../scripts/testdata/recovery-drill). The
runner builds its internal Git-server image from the reviewed controller image
and a copied bare repository, rather than a host bind mount. Its pinned image
identities are tracked separately in
[`scripts/recovery-drill-images.env`](../scripts/recovery-drill-images.env),
which deliberately contains no operator-configurable tag or credential. The
runner must prove each local tag resolves to its recorded immutable image ID
before it builds or starts a temporary container.

Keeping automation and self-heal off is essential: a rollback does not change
the configured target revision, and a later poll must not race the retained
revision assertions.

## Authenticated exercise and assertions

The CLI's mutation output is human-readable and abbreviates SHAs. The harness
therefore requires a zero CLI exit code, then performs one non-mutating,
authenticated application/history API read to assert the JSON `result`,
`operation`, full commit SHA, retained history, and live sentinel label. HTTP
success alone is insufficient. The release record may retain only abbreviated
SHAs; full SHA comparisons occur in memory or protected temporary files. It
never replays a mutation merely to obtain a machine-readable result.

1. Call the authenticated create API and require `201`. Confirm unauthenticated
   and wrong-bearer calls return `401` before any mutation; record status codes
   only.
2. Invoke the authenticated CLI `app desired` and `app diff` against commit A.
   Require that desired resolves to A and diff reports the expected initial
   creation without mutating the workload.
3. Invoke the CLI `app sync` and require a zero exit status. Query the
   application and authenticated history API; require `operation=manual`,
   `result=success`, commit A, last synced SHA A, a retained successful manual
   record for A, and one live sentinel with revision label A.
4. Advance only the served `release` ref to B. Run CLI desired/diff again,
   then CLI sync and require a zero exit status. Make the subsequent
   non-mutating API assertions for B, preserved A history, and exactly one
   live sentinel with label B.
5. Invoke CLI rollback with full SHA A and require a zero exit status. Make
   the subsequent non-mutating API assertions for `operation=rollback`,
   `result=success`, SHA A, retained A/B history, and exactly one live
   sentinel with label A. Do not perform another sync after rollback.
6. Attempt rollback to a generated unknown SHA exactly once. Require the HTTP
   response body to contain `operation=rollback` and `result=failure` even if
   the endpoint returns `200`; require an added failure-history record and
   unchanged live sentinel label A. The unknown SHA is never reused.

Any lost response, redirect, malformed body, ambiguous operation result, extra
sentinel, or unexpected live revision is a failed drill and must not trigger a
blind retry.

## Consistent SQLite backup and restore

The state store uses SQLite WAL mode. Copying `dockercd.db` alone while a
process may still write is not an acceptable backup.

1. After the rollback assertions, request clean controller shutdown and wait
   for verified process termination. Preserve the original state directory;
   do not reuse it for a restored process.
2. Produce the snapshot using a SQLite-consistent backup/checkpoint mechanism
   that is compatible with the deployed SQLite driver. If the selected method
   requires WAL/SHM companions, preserve and restore the complete verified
   set. Record the backup method and source/backup file digests, not contents.
3. Run `PRAGMA integrity_check` on the snapshot. Require `ok`, expected schema
   migration version, the application record, full A/B/rollback/failed-rollback
   history counts, and last successful revision A. The runner uses
   [`recovery-drill-verify`](../src/cmd/recovery-drill-verify), which opens
   only the stopped `dockercd.db` snapshot in immutable readonly mode. It
   rejects WAL/SHM sidecars, nonregular or oversized files, invalid or
   collapsed full revisions, and an incomplete migration ledger; it emits
   boolean structural evidence rather than state contents, full SHAs, or error
   text. It writes a private, mode-0600, digest-only restore baseline in the
   temporary drill directory. That baseline contains only application and
   per-record fingerprints, never manifest, diff, error, secret, or revision
   plaintext, and is deleted during cleanup.
4. Confirm the original temporary controller remains stopped. Start a new
   temporary controller with a **fresh** state directory restored from the
   verified snapshot and the same isolated fixture dependencies. Require
   readiness, preservation of every snapshot application/history record, and
   live sentinel A. Because startup schedules stored applications, it may add
   only new `poll` records with `result=skipped`; the harness distinguishes
   those permitted observations from the preserved snapshot records. Observe
   for one bounded poll interval plus a safety margin; automation/self-heal
   remain false and no explicit mutation occurs. A transition to B, a second
   workload, a lost original record, or any non-skipped post-restore operation
   is failure. Stop the restored controller before copying its database and
   compare that stopped copy to the private baseline. Configuration and every
   retained history record must match exactly; only newly-added `poll` /
   `skipped` records are allowed. This comparison emits only a boolean result
   into release evidence.
5. Stop the restored controller before cleanup. Preserve only redacted
   assertion evidence; delete the temporary state and snapshot through the
   recorded run scope.

## Evidence, failure, and cleanup

The harness writes a redacted, non-secret result record containing the tested
controller and Web image digests, source revision, daemon fingerprint,
abbreviated A/B SHAs, status/result assertions, backup-integrity result,
recorded object IDs, and before/after non-impact checks. It explicitly records
that no redirect occurred and that no browser mutation was used.

A trap stops only recorded temporary containers, removes only recorded
temporary resources, and verifies no exact run-label object remains on the
dedicated daemon. It leaves deployed pairs and Signal running regardless of
success or failure. Failure retains no bearer or state copy; it returns a
non-zero status and points only to the redacted evidence record.
