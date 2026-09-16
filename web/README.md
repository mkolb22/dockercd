# dockercd Web UI mockup

This is the first presentation-layer tranche from ADR 0001. It is a separate,
fixture-backed Go `html/template` server with no authored JavaScript.

The fixture runtime deliberately has no controller connection, Docker access,
credentials, or outbound network behavior. It binds to `127.0.0.1:8092` by
default for local visual review.

Run it from this directory:

```sh
go run ./cmd/dockercd-web
```

Then open `http://127.0.0.1:8092/fleet`. The fixture confirmation screens are
safe to exercise: they record no state and send no controller operation.

The executable is fixture-only unless `DOCKERCD_WEB_AUTH_USERS_FILE` is set.
With that explicit local secret configuration, it requires an HTTPS public
origin and a controller URL, verifies an Argon2id local password, then creates
an opaque in-memory session to make read-only capability-scoped controller
requests. See [ADR 0003](../docs/adr/0003-local-password-bootstrap-for-web-presentation.md)
and [the deployment example](../deploy/docker-compose.web-local-auth.example.yml).

The Web workspace includes a typed, bounded client, a redacted live-view
mapper, and a per-request source-provider seam. A provider creates a live
source only after the server-side local session validates and supplies its
scoped token source. Fixture mode remains the default and the Web layer never
calls legacy administrator routes or accepts a controller credential from a
browser page.

## Local user provisioning helper

To create the `passwordHash` value for the local Web users secret, run this
interactive helper from `web/`:

```sh
go run ./cmd/dockercd-web-password-hash
```

It requires a terminal, reads and confirms the password without echoing it,
and prints only an Argon2id PHC verifier. Do not place a password in a command
argument, environment variable, Compose file, or Git-tracked file. Copy the
verifier directly into the host-managed Web users secret with its corresponding
dedicated scoped controller bearer. The controller's separate digest-only
registry must be updated at the same time; see ADR 0003.

For the owner acceptance journey, use
[`../docs/web-ui-owner-review.md`](../docs/web-ui-owner-review.md). It covers
Fleet-to-evidence navigation, safe fixture confirmations, honest
healthy/stale/error states, and narrow/accessible layouts.

## Unprivileged container image

Build the fixture image from the repository root:

```sh
docker build --file web/Dockerfile --tag dockercd-web:local web
```

The final image is a scratch image running as numeric non-root user `65532`.
It has no shell, Docker client/socket, Git client, SQLite state, controller
credential, package manager, or writable application filesystem. The default
still binds loopback. A deployment may set
`DOCKERCD_WEB_LISTEN_ADDR=0.0.0.0:8092` only inside the Web container so a
separately configured reverse proxy can reach it; that setting does not publish
a host port or create controller connectivity. For opt-in local login, mount
only the dedicated `/run/secrets/dockercd_web_users` registry shown in the
deployment example; do not mount controller data, Docker, Git, or controller
registry volumes into this image.
