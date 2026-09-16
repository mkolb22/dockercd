# dockercd presentation API v1 fixtures

These fixtures freeze the additive, capability-scoped read contract consumed
by `dockercd-web`. They contain only representative redacted data and are
validated by tests in both Go modules:

- `src/internal/api` proves its response DTOs serialize the fixture shape.
- `web/internal/controlplane` proves its typed client decodes the same routes.

They are a compatibility floor, not an unrestricted API specification. New
optional fields must be additive; removing or changing a field requires a new
contract version and a matching controller/Web compatibility decision. No
fixture may contain a token, Git URL, manifest, environment value, raw error,
service topology, log line, or unbounded history payload.

`responseGeneratedAt` is controller response-generation time, never a Docker
observation or deployment time. A status summary declares
`observationCompleteness: "complete"` only when its observed health and
observation timestamp are one persisted pair; otherwise it declares
`"unavailable"`. Clients must not replace either fact with their local clock.

The routes represented here are read-only:

| Fixture | Route |
| --- | --- |
| `capabilities.json` | `GET /api/v1/presentation/capabilities` |
| `fleet.json` | `GET /api/v1/presentation/fleet` |
| `application.json` | `GET /api/v1/presentation/applications/{name}` |
| `activity.json` | `GET /api/v1/presentation/activity?limit={1..100}` |
