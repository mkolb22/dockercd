# Getting started with DockerCD V1

DockerCD V1 reconciles Git-managed Docker Compose applications on one Docker
host. Its supported human experience is the separate, read-only
`dockercd-web` service; privileged recovery and mutations use the authenticated
CLI or API.

## Deployment topology

Each instance is a paired Compose deployment:

```text
operator browser -> TLS reverse proxy -> dockercd-web -> dockercd -> Docker socket
```

The controller API and Web service publish loopback ports only. Do not expose
the controller API to an untrusted network. The repository's
[`deploy/`](../deploy/README.md) configuration is the development pair. A
personal pair must use distinct Compose project name, network, state volume,
API token, presentation registry, Web-user registry, and manifest repository.

Those configuration boundaries do not isolate two controllers that share one
Docker daemon: either controller's Docker socket access remains host-admin
equivalent. Use separate Docker hosts or daemons for a true security boundary.

## Prepare the controller and Web secrets

1. Build or obtain the `dockercd` and `dockercd-web` images.
2. Copy `deploy/.env.example` to `deploy/.env`; set a unique controller API
   token of at least 32 characters and, if the manifest source is private, a
   minimally scoped Git read token.
3. Create two separate local files outside the repository: a digest-only
   controller presentation-credential registry and a Web-user registry with
   Argon2id password verifiers plus dedicated scoped presentation bearers.
4. Set the two absolute secret-file paths and external HTTPS Web origin in
   `deploy/.env`.

Never place plaintext controller, Git, or Web credentials in a manifest, Git
remote URL, repository file, shell history, or browser page.

## Validate and start the development pair

```sh
docker compose --env-file deploy/.env -f deploy/docker-compose.yml config --quiet
./install.sh
```

The script starts only the development controller and its paired Web service.
It does not build images, bootstrap a Git host, register or sync applications,
or modify a personal deployment.

## Register Git-managed applications

An application manifest points the controller at a Git repository, revision,
and Compose path. See the [V1 manifest reference](application-manifest.md).
Register it through the authenticated API or CLI, then inspect desired-vs-live
state before requesting a sync:

```sh
dockercd app list --server http://127.0.0.1:18080
dockercd app diff my-app --server http://127.0.0.1:18080
dockercd app sync my-app --server http://127.0.0.1:18080
```

See the [operator recovery runbook](operator-recovery-runbook.md) for failure
and rollback semantics.

## V1 boundaries

V1 does not include a bundled Git host, registry, monitoring stack, cluster,
remote Docker fleet, browser mutation interface, blue-green deployment, or
controller self-management. Historic material is preserved only in the
inactive `.archive/legacy-v1-deployment/` tree. The scope lock and future work
are recorded in [GOAL.md](../GOAL.md) and [BACKLOG.md](BACKLOG.md).
