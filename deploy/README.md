# Minimal V1 development deployment

This Compose project deploys exactly one separately configured pair:

```text
browser -> TLS reverse proxy (operator-managed) -> dockercd-web -> dockercd
                                                              -> Docker socket
```

`dockercd` is the privileged control plane. `dockercd-web` is an
unprivileged, read-only presentation service. The controller API and Web
service publish loopback host ports only; a network-accessible Web UI requires
an explicitly configured TLS reverse proxy. Never expose the controller API
directly to an untrusted network.

## Prepare the development pair

1. Build or obtain matching `dockercd` and `dockercd-web` images.
2. Copy `.env.example` to `.env`, set a unique 32+ character controller API
   token, and restrict the file to the deployment owner.
3. Provision two different local secret files outside this repository:
   - a controller presentation-credential registry (digest and grants only);
   - a Web user registry (Argon2id verifiers and dedicated scoped controller
     bearers).
4. Set the two absolute secret-file paths and the intended HTTPS public Web
   origin in `.env`.
5. From the repository root, validate with
   `docker compose --env-file deploy/.env -f deploy/docker-compose.yml config --quiet`,
   then run `./install.sh`.

The Compose project intentionally has no bootstrap overlay, application
manifest mount, Gitea, registry, monitoring, cluster services, or personal
application. It must not share a network, volume, controller token, Web-user
registry, presentation registry, or manifest repository with the personal
pair. See [ADR 0006](../docs/adr/0006-minimal-v1-deployment.md).

If the development and personal pairs share one Docker daemon, their distinct
Compose networks and secrets do not create a security boundary: each privileged
controller can administer the shared daemon. Use separate daemons or hosts for
strong isolation.
