# Legacy embedded controller UI inventory

This inventory is the evidence baseline for [ADR 0005](adr/0005-retire-legacy-embedded-controller-ui.md).
It was produced from the repository at the start of the v1.0 retirement
tranche. It distinguishes controller UI-only behavior from retained API/CLI
behavior so removal does not affect reconciliation or recovery.

## Controller code and image contents

| Surface | Location | v1.0 disposition |
| --- | --- | --- |
| Go embedded filesystem | `src/internal/api/server.go` (`staticFS`) | Delete. It exists only for the SPA. |
| SPA router, fallback, and index helper | `server.go` (`spaHandler`, `serveIndex`) | Delete. `/`, `/ui`, `/ui/`, and `/ui/*` become absent. |
| Static SPA assets | `src/internal/api/static/index.html`, `css/style.css`, `js/api.js`, `js/app.js`, `js/components.js`, `favicon.svg` | Delete directory. It is compiled into the controller image today. |
| Browser login and stored handler token | `src/internal/api/handlers.go` (`Login`), `Handler.apiToken`, and `POST /api/v1/auth/session` | Delete. They exist to write the administrator token into a browser cookie. |
| Browser logout | `handlers.go` (`Logout`) and `DELETE /api/v1/auth/session` | Delete with the login route. |
| Cookie credential fallback | `server.go` (`authCookieName`, `bearerAuth`) | Delete. Retain only `Authorization: Bearer`. |
| Cookie-specific CSRF middleware | `server.go` (`authMethodContextKey`, `cookieAuthMethod`, `cookieCSRF`) | Delete. It protects only the removed cookie-auth mode. |
| Generic browser security headers | `server.go` (`securityHeaders`) | Retain and simplify only if a later review identifies browser-only policy. These headers also safely protect any HTTP error/probe response. |

## Tests and configuration

| Surface | Location | v1.0 disposition |
| --- | --- | --- |
| Cookie authentication and CSRF tests | `src/internal/api/handlers_test.go` (`TestAPIToken_BearerAndCookieAuth`) | Replace with bearer-only authorization regression tests. |
| Root/UI/SPA tests | `handlers_test.go` (`TestRootRedirectsToUI`, `TestUIServesHTML`, `TestUISPAFallback`) | Replace with route-absence regression tests. |
| Controller API token | controller configuration and `ServerDeps.APIToken` | Retain. It continues to protect authenticated API/CLI access and gates activation of the separately authenticated presentation routes; it is not a browser cookie after removal. The digest-only presentation registry performs scoped-credential validation. |
| Web local-login session and CSRF | `web/internal/httpui/` | Retain. This is a separate opaque Web-service session and does not carry a controller bearer to the browser. |
| Authenticated event stream | `/api/v1/events/stream`, `src/internal/eventbus/` | Retain. The native macOS client uses this API. Its removal is not implied by deferring browser live updates. |
| Resource, system, and service APIs | `/api/v1/applications/*`, `/api/v1/system*`, settings routes | Retain. Existing CLI and native-client workflows use these bearer-authenticated routes. |

## Documentation and installation references

| Reference | Location | Required change before release |
| --- | --- | --- |
| Quick-start UI URL | `README.md` | Replace `/ui/` instruction with separate Web-service connection/deployment guidance. |
| Verification workflow | `docs/getting-started.md` | Replace browser-admin verification with Web monitoring plus CLI/API sync verification. |
| Installer completion UI URL | `install.sh` | Change output and optional launcher destination only after a supported Web endpoint is available in the chosen install mode. |
| Historical design references | `docs/design.md`, ADRs, presentation docs | Mark historic embedded-UI descriptions as retired; preserve decision history without implying a supported route. |
| Presentation migration wording | `docs/web-ui-architecture.md`, `docs/presentation-architecture.md`, `docs/quality-first-delivery.md` | Update “retained during migration” language after release evidence is complete. |

## Compatibility classification

| Surface | Classification | Migration treatment |
| --- | --- | --- |
| `/`, `/ui`, `/ui/*` | Legacy browser presentation only | Remove; do not redirect. Document the separate Web URL. |
| `/api/v1/auth/session` | Legacy browser-session API | Explicitly list as removed; no bearer/API client should use it. |
| `/api/v1/*` resource API with `Authorization: Bearer` | Supported control-plane API | Preserve behavior and add regression coverage. |
| `/api/v1/events/stream` with `Authorization: Bearer` | Supported API/native-client interface | Preserve; the v1 Web polling decision does not deprecate it. |
| CLI commands | Supported recovery interface | Preserve and validate sync/diff/rollback workflow. |
| `/healthz`, `/readyz`, Git webhook routes | Deployment/integration interface | Preserve unchanged. |

## Completion evidence checklist

- [ ] Separate Web deployment and local-login monitoring journeys are owner-validated.
- [ ] CLI/API sync, dry-run/diff, rollback, and recovery runbook is current and exercised.
- [ ] Release notes identify the removed UI routes and session endpoint.
- [ ] Migration notes tell legacy-browser users that their existing 30-day
      `dockercd_token` cookie becomes ineffective at the release and may be
      cleared locally; do not rotate the controller API token merely to retire
      cookie authentication.
- [ ] Release owner approves the compatibility migration.
- [x] Controller source contains no embedded static filesystem, SPA handler, cookie token fallback, or legacy session route.
- [ ] Controller image has one-binary filesystem contents; source and binary
      inspection prove no embedded UI asset sentinel remains.
- [x] Regression tests prove absence of the retired routes, rejection of
      cookie-only JSON and SSE requests, no fallback from malformed bearer to
      cookie, valid bearer JSON/SSE behavior without the old CSRF header, and
      administrator/presentation credential isolation.
- [ ] Full controller and Web validation plus independent review are recorded.
