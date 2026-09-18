# ADR 0005: Retire the legacy embedded controller UI for v0.1

| Field | Value |
| --- | --- |
| Status | Implemented — pending final image, migration, and release validation |
| Date | 2026-09-17 |
| Decision owners | dockercd maintainers and v0.1 release owner |
| Related | [ADR 0001](0001-separate-control-plane-and-presentation.md), [ADR 0002](0002-scoped-presentation-api.md), [v0.1 readiness](../v0.1-release-readiness.md), [operator recovery runbook](../operator-recovery-runbook.md), [legacy UI inventory](../legacy-embedded-ui-inventory.md) |

## Context

The controller currently embeds a JavaScript SPA and accepts the administrator
API token through an HTTP-only browser cookie. That arrangement gives a
browser-facing application access to the same credential that can mutate
Docker-managed applications. `dockercd-web` now provides the supported
read-only human monitoring path through a separate, scoped presentation API.

v0.1 promises one browser presentation surface and authenticated CLI/API
recovery controls. Keeping the embedded UI would leave two human interfaces,
two session models, and a browser-held administrator credential path.

## Decision

For v0.1, DockerCD will remove the controller's embedded SPA and every
controller browser-session feature used exclusively by that SPA. The supported
surfaces after removal are:

| Need | Supported v0.1 surface | Authority |
| --- | --- | --- |
| Read deployment and health status | `dockercd-web` | scoped presentation API, read-only |
| Sync, dry-run/diff, rollback, and recovery | authenticated CLI or bearer-token API | control plane |
| Liveness and readiness | `/healthz`, `/readyz` | control plane |
| Event stream for supported native/API clients | authenticated `/api/v1/events/stream` | control plane |
| Git webhook delivery | webhook route | control plane |

The controller will not redirect `/` to a UI and will not expose `/ui` or
`/ui/*`. Those routes must return the router's normal not-found response. The
controller will also remove `POST` and `DELETE /api/v1/auth/session`, the
`dockercd_token` cookie fallback, and cookie-only CSRF middleware. Bearer-token
authentication remains the only v0.1 control-plane API authentication method.

The existing API resource routes retain their version and bearer-token behavior.
Removal of the legacy session endpoint is an explicit compatibility migration,
not an accidental side effect: release notes and the getting-started/install
flow must direct people to `dockercd-web` for monitoring and the CLI/API for
mutating operations.

## Architecture after removal

```text
operator browser -- local Web session --> dockercd-web
                                           |
                                  scoped, read-only API credential
                                           v
operator CLI / automation -- bearer token --> dockercd control plane --> Docker/Git/state
```

`dockercd-web` never receives a Docker socket, Git credential, SQLite data,
source cache, or broad administrator bearer. A browser never receives either
controller credential.

## Removal sequence and gates

1. **Parity evidence.** Validate the Web monitoring journey and document
   CLI/API sync, dry-run/diff, rollback, and recovery commands. Exercise both
   authorization failures and controller/Web restart behavior.
2. **Compatibility notice.** Inventory repository and release documentation,
   change the install/getting-started destination, and publish a migration note
   naming `/`, `/ui/*`, and `/api/v1/auth/session` as removed legacy surfaces.
   The release owner approves this only if no supported client depends on them.
3. **Controller deletion.** **Implemented.** The focused source change deletes the embedded
   filesystem, SPA/router helpers, UI redirects, session handlers, cookie
   fallback, cookie-CSRF middleware, and the handler's UI-only stored API
   token. Preserve generic security headers, `ServerDeps.APIToken`, and
   bearer-token authentication.
4. **Asset and test deletion.** **Implemented.** `internal/api/static/`, UI/session tests,
   and obsolete package imports. Add regression tests that prove legacy routes
   are absent and bearer authentication still gates control-plane mutations.
5. **Packaging proof.** Build the controller image and inspect its one-binary
   filesystem, its compiled binary, and HTTP routes. A file list alone cannot
   prove a Go `embed.FS` was removed. Prove the static source directory and
   embed declaration are absent, the binary does not contain the retired
   asset-path/name sentinels, and the image does not respond from `/`, `/ui`,
   `/ui/`, `/ui/*`, or `/api/v1/auth/session`.
6. **Release validation.** Run full controller and Web test, vet, and race
   suites; re-run relevant security checks; obtain independent code review and
   release-owner sign-off.

## Guardrails

- Do not delete a resource API, CLI command, health probe, webhook route, or
  authenticated event stream in this tranche. In particular, controller SSE is
  used by the native macOS client; deferring Web live updates does not remove
  that separately supported API capability.
- Do not replace removed UI routes with a redirect to the Web service; doing so
  would couple control-plane deployment to Web-service topology and obscure a
  compatibility break.
- Do not expose a controller API token to make the browser migration easier.
- Do not claim parity for deferred browser mutation, SSE, log, metrics, or
  topology features. CLI/API recovery is the v0.1 mutation path.
- Keep removal atomic enough that a release image cannot contain a route whose
  assets or session mechanism were deleted.
- The regression suite must prove all of the following:
  - cookie-only JSON reads, mutations, and the separately mounted SSE route
    return `401` with control-plane authentication enabled;
  - a malformed or wrong bearer credential never falls back to a previously
    valid legacy cookie;
  - a valid bearer can use retained JSON mutations and SSE without the retired
    CSRF header;
  - legacy administrator bearer/cookie credentials cannot access presentation
    routes, and scoped presentation credentials cannot access administrator
    routes; and
  - `POST` and `DELETE /api/v1/auth/session` issue no cookie and do not
    authenticate, even if a request carries a valid bearer.

## Consequences

The controller has a smaller browser attack surface and a cleaner privilege
boundary. Users of the old SPA must migrate to the separate Web service or to
the documented CLI/API workflows. The migration is intentionally a v0.1
release gate, not a silent patch-level behavior change.
