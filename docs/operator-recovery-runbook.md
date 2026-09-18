# v1.0 operator recovery runbook

This runbook is the supported mutation and recovery path for DockerCD v1.0.
The separate `dockercd-web` service is read-only monitoring; it does not
perform sync, rollback, or configuration mutations.

Use the authenticated CLI for routine work. Use the equivalent bearer-token API
only for automation or when the CLI is unavailable. The controller's legacy
browser UI and browser session endpoint are not part of this workflow.

## Before you begin

Use an HTTPS controller URL for a non-loopback deployment. Obtain the
controller bearer from its host-managed secret; never put it in a repository,
manifest, browser URL, screenshot, or shell history. The examples reference an
already provisioned environment variable and never print its value.

```sh
export DOCKERCD_CONTROLLER_URL='https://controller.example.internal'
# Obtain DOCKERCD_API_TOKEN through the host's approved local-secret workflow.
```

For CLI commands, `--api-token` overrides `DOCKERCD_API_TOKEN`; omit it when
the environment is already configured. Commands below use `--server` so the
target controller is explicit.

## 1. Establish controller and application state

```sh
curl --fail --silent --show-error \
  "$DOCKERCD_CONTROLLER_URL/readyz"

dockercd app list --server "$DOCKERCD_CONTROLLER_URL"
dockercd app get my-app --server "$DOCKERCD_CONTROLLER_URL"
```

`/readyz` verifies controller readiness; it is not proof that an individual
application is healthy. Confirm application status and its last successful
revision before mutating anything. Use the Web presentation to inspect the
same read-only status evidence and controller-authored freshness timestamps.

## 2. Inspect intended state before a sync

The authenticated diff is the v1.0 dry-run evidence. It does not deploy.

```sh
dockercd app desired my-app --server "$DOCKERCD_CONTROLLER_URL"
dockercd app diff my-app --server "$DOCKERCD_CONTROLLER_URL"
```

For automation, request the same retained API resource:

```sh
curl --fail --silent --show-error \
  -H "Authorization: Bearer $DOCKERCD_API_TOKEN" \
  "$DOCKERCD_CONTROLLER_URL/api/v1/applications/my-app/diff"
```

Stop if the diff is unexpected. Correct the Git-managed manifest or source
revision first; do not use a browser action or direct container change to
override desired state.

## 3. Perform and verify an explicit sync

```sh
dockercd app sync my-app --server "$DOCKERCD_CONTROLLER_URL"
dockercd app get my-app --server "$DOCKERCD_CONTROLLER_URL"
dockercd app diff my-app --server "$DOCKERCD_CONTROLLER_URL"
```

The sync command returns its controller result. Treat a network interruption or
lost response as an unknown outcome: do not blindly retry. First query the
application and its history, then decide whether another explicit sync is
needed.

```sh
curl --fail --silent --show-error \
  -H "Authorization: Bearer $DOCKERCD_API_TOKEN" \
  "$DOCKERCD_CONTROLLER_URL/api/v1/applications/my-app/history"
```

## 4. Roll back to a retained successful revision

Select a known-good commit from application history, inspect the current diff,
then invoke an explicit rollback. Replace `COMMIT_SHA` with that revision.

```sh
dockercd app rollback my-app --sha COMMIT_SHA \
  --server "$DOCKERCD_CONTROLLER_URL"
dockercd app get my-app --server "$DOCKERCD_CONTROLLER_URL"
dockercd app diff my-app --server "$DOCKERCD_CONTROLLER_URL"
```

Rollback deploys a retained revision but does **not** change the configured Git
branch or target revision. Before treating it as durable recovery, revert or
pin the Git-managed desired state to the known-good revision, push that change,
and verify the controller has observed it. Otherwise the next automated poll
can reapply the unwanted revision. Do not rely on an undocumented pause or a
browser setting to hold a rollback in place.

Record the cause, selected revision, controller result, and verification result
in the operator's incident record. The controller's bounded event/history data
is operational evidence, not a substitute for incident documentation.

## 5. Controller or Web presentation failure

1. Check controller `/healthz` and `/readyz`.
2. Use the authenticated CLI/API once the controller is ready; do not infer
   recovery from a redirect, cached page, or stale Web session.
3. If `dockercd-web` is unavailable while the controller is ready, use the CLI
   for recovery. Its local login session intentionally expires on restart and
   does not affect controller state.
4. Follow the deployment backup/restore procedure before manipulating SQLite
   data or the controller data directory. Do not delete sync history as a
   troubleshooting step.

## Supported-surface check for release evidence

Before v1.0 release approval, execute this runbook against a disposable
deployment with authenticated and failure-path coverage. Record the tested
revision, controller and Web image digests, selected rollback revision, Web
freshness behavior, and any compatibility migration notice in the release
record.
