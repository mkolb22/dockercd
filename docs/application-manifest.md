# DockerCD V1 application manifest reference

An `Application` is Git-managed desired state for one Docker Compose project
on the controller's local Docker host. A manifest identifies a Git source and
Compose files to reconcile; it never carries credentials.

## V1 schema

```yaml
apiVersion: dockercd/v1
kind: Application
metadata:
  name: my-app
spec:
  source:
    repoURL: https://github.com/example/my-app.git
    targetRevision: main
    path: deploy
    composeFiles:
      - docker-compose.yml
  destination:
    dockerHost: unix:///var/run/docker.sock
    projectName: my-app
  syncPolicy:
    automated: true
    prune: true
    selfHeal: true
    pollInterval: 180s
    syncTimeout: 300s
    healthTimeout: 120s
```

## Required and source fields

| Field | Requirement |
| --- | --- |
| `apiVersion` | Must be `dockercd/v1`. |
| `kind` | Must be `Application`. |
| `metadata.name` | Unique DNS-label application name. |
| `spec.source.repoURL` | HTTPS or SSH Git remote without embedded credentials; its host must be allowed by `DOCKERCD_GIT_ALLOWED_HOSTS`. |
| `targetRevision` | Optional; defaults to `main`. A commit SHA pins a revision. |
| `path` | Optional; defaults to `.`, and cannot escape the checkout. |
| `composeFiles` | Optional; defaults to `docker-compose.yml`; files merge in order. |

Use `DOCKERCD_GIT_TOKEN` as the separately provisioned Git read credential
when required. Never embed a username, password, personal access token, or
SSH private key in `repoURL`.

## Destination and sync policy

V1 supports the controller's local Docker socket only. `projectName` defaults
to `metadata.name` and must be unique on the host.

| Field | Default | Meaning |
| --- | --- | --- |
| `automated` | `false` | Reconcile desired/live drift automatically. |
| `prune` | `false` | Remove orphaned services during reconciliation. |
| `selfHeal` | `false` | Reconcile when an application container is stopped externally. |
| `pollInterval` | `180s` | Git polling period; minimum 30 seconds. |
| `syncTimeout` | `300s` | Maximum time for one sync. |
| `healthTimeout` | `120s` | Maximum healthy-observation wait after deploy. |

Start with `automated: false`, inspect the authenticated CLI/API diff, then
enable automation after desired state is established. An explicit rollback
deploys an older retained revision but does not change Git desired state; fix
or pin Git as well, or the next poll can reapply the unwanted revision.

V1 intentionally excludes blue-green strategies, advanced adoption/import,
image-policy mutation, and browser mutation controls. Proposed future work
belongs in the [backlog](BACKLOG.md).
