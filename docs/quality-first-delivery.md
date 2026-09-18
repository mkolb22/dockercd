# Quality-first delivery plan

## Purpose

DockerCD manages privileged deployment work. Quality therefore means evidence
that a change is correct, understandable, bounded, recoverable, and pleasant
to operate—not simply that it compiles. There is no credible claim of perfect
software; this plan makes quality repeatable and visible before a change earns
production responsibility.

This document records the quality capabilities that are relevant to DockerCD,
including the OpenAI and Codex capabilities that can improve delivery quality.
They are recommendations, not a decision to send controller data to an AI
service or to automate deployments.

## Delivery gates

Every implementation tranche should pass these gates in order:

1. **Design and risk boundary.** Record the behavior, failure mode, rollback
   story, exposure policy, and API compatibility effect in an ADR or design
   note before coding.
2. **Deterministic checks.** Run focused tests while iterating and the relevant
   repository-wide checks before handoff: Go test, vet, race detection, and
   vulnerability/dependency checks where dependencies change.
3. **Contract and failure checks.** Exercise invalid input, stale data,
   timeouts, unavailable dependencies, duplicate requests, and unknown
   operation outcomes. Add a regression test for each corrected behavior.
4. **Operator experience review.** Inspect the rendered UI with fixture states
   for healthy, degraded, stale, empty, and failed cases. Verify keyboard
   navigation, readable status language, direct routes, and narrow layouts.
5. **Independent high-reasoning review.** A high-capability model reviews the
   actual diff and tests after each completed feature tranche. Findings are
   resolved or explicitly recorded before the next tranche.
6. **Owner acceptance.** For material UX, deployment, or exposure changes,
   retain the human decision and the evidence used to make it.

No model, reviewer, or passing test can approve a broader network exposure,
weaken TLS, bypass authentication, or execute a live sync without the
appropriate human authority.

## Immediate engineering investments

| Investment | Quality effect | Earliest appropriate point |
| --- | --- | --- |
| Fixture scenarios with stable timestamps | Makes normal, degraded, empty, and stale UI states reviewable without a controller | Now |
| Route and form regression tests | Keeps the no-authored-JavaScript prototype navigable and protects confirmation semantics | Now |
| Go fuzz tests for manifest, path, and request parsers | Finds surprising input handling and panic paths | Before new control-plane inputs |
| Versioned API schema plus contract fixtures | Prevents presentation and controller drift | Before live presentation integration |
| Idempotent operation/outcome contract tests | Makes a lost browser response visible instead of silently replaying a deploy | Before a live mutation route |
| Benchmarks with bounded fixture sizes | Detects fleet-list, diff, and history regressions | Before fleet-scale UI/API work |
| SBOM, image scan, signed image/provenance policy | Gives supply-chain evidence for the control and presentation images | Before container release automation |
| Reproducible visual acceptance captures | Preserves intended hierarchy and state treatment across CSS changes | When the mockup visual language stabilizes |

## Codex capabilities to use deliberately

### Already in the workflow

- **Repository instructions and ADRs** preserve non-negotiable security,
  validation, and architecture decisions in the source tree.
- **Parallel, scoped agents** can review independent bounded concerns without
  overlapping edits. The high-reasoning review gate above is required after
  each feature tranche.
- **Native browser/computer-use validation** gives visual and accessibility
  evidence for owner-facing routes instead of relying only on HTML templates.
- **Focused tools and test execution** keep review grounded in source,
  executable checks, and the actual worktree.

### Add after the pattern is stable

- A **project-local Codex quality-gate skill** should encode the settled
  fixture states, command matrix, visual-review checklist, and API safety
  questions. It should be created only after this pattern has been repeated;
  premature automation would freeze an immature workflow.
- A **scheduled quality review** can periodically run non-mutating dependency,
  vulnerability, documentation-link, and test-health checks, then create a
  human-readable report. Enable a schedule only after its command set and
  repository credentials have been reviewed. ChatGPT scheduled tasks can use
  supported tools and skills, but schedule ownership and availability must be
  confirmed in the chosen workspace before relying on it.
- A **release evidence template** should collect test/race/vulnerability
  outputs, container digest, SBOM, API compatibility notes, visual checks, and
  reviewer disposition in one release record.

## OpenAI capabilities: high-value, advisory only

The following capabilities are useful when DockerCD later adds AI-assisted
operator help. They must remain advisory, typed, redacted, and independently
validated; none belongs in the control path for Docker operations.

| Capability | Recommended use | Guardrail |
| --- | --- | --- |
| High-reasoning coding models | Architecture critique, code review, test design, and incident-writeup critique | Review source/diffs only; no credentials or raw secrets in prompts |
| [Structured Outputs](https://developers.openai.com/api/docs/guides/latest-model) | Typed incident explanations, risk summaries, and change-plan suggestions | Validate against a local schema; display as suggestions, never commands |
| [Evals](https://developers.openai.com/api/reference/resources/evals/methods/create) | Score proposed incident summaries, diff explanations, and remediation advice against a curated corpus | Establish a human-reviewed gold set before trusting scores |
| Function/tool calling | Read-only retrieval of explicitly redacted status, history, and docs for an operator assistant | Capability-scoped, allowlisted tools; a model must not receive a direct Docker or sync capability |
| Prompt caching | Reduce cost and latency for repeated static architecture, API-schema, and runbook context | Cache only non-secret, stable context |
| Model quality/cost comparison | Select a less expensive model for routine classification while keeping high reasoning for reviews | Measure against project evals, not intuition |
| Traceable review artifacts | Preserve prompt version, model, inputs, schema result, human decision, and redaction status | Store metadata and summaries, never plaintext credentials or sensitive logs |

The current API documentation describes model support for structured outputs,
tool calling, multi-agent orchestration, streaming, and prompt caching; select
the exact model only after evaluating it on DockerCD's own evidence set.
See [latest model capabilities](https://developers.openai.com/api/docs/guides/latest-model).

## Data and safety boundary for any future AI integration

Before an OpenAI API integration is proposed, complete a separate ADR and
threat model covering data classification, redaction, retention, region,
access, audit, and failure behavior. Never send Git tokens, controller tokens,
Docker socket data, plaintext environment variables, private manifests, or
unredacted logs. The OpenAI API data guidance states that API data is not used
for training by default, while default abuse-monitoring retention may apply;
eligible organizations can use Modified Abuse Monitoring or Zero Data
Retention. Confirm the current contract and eligibility rather than assuming
it. See [API data controls](https://developers.openai.com/api/docs/guides/your-data).

An AI service failure must degrade to the ordinary, fully functional product.
It must not delay reconciliation, determine health, choose a deployment,
authorize a caller, or retry a mutation.

## Explicit non-goals for now

- Autonomous deployment or rollback decisions.
- A model that can call Docker, obtain controller credentials, or bypass the
  presentation/control-plane permission boundary.
- Sending secrets, raw configuration, or full event logs to an AI provider.
- Adding a JavaScript application framework merely for dashboards or AI UI.
- Treating an AI review as a replacement for tests, code ownership, or operator
  judgment.

## Measurable standard

For each release, record: the tested revision and image digest; deterministic
test/vet/race/vulnerability result; API/schema compatibility; performance
budget evidence; visual/accessibility review states; high-reasoning review
findings and disposition; and owner approval where the release changes a live
boundary. A release without that evidence is incomplete, not merely delayed.

## Authenticated CLI recovery correctness (2026-09-17)

- The CLI now rejects every non-2xx controller response before decoding it as
  a successful resource, surfaces only the controller's bounded standard error
  message, and refuses redirects as non-outcomes.
- Sync and rollback now return a nonzero exit when the controller reports an
  operation failure. A repeated sync returns success only for the explicit
  `skipped`/in-sync no-op evidence; circuit-breaker and unevidenced skips still
  fail.
- Successful controller payloads are bounded to 1 MiB before JSON decoding;
  error payloads are bounded to 64 KiB and arbitrary bodies are not echoed.
- Regression coverage exercises all application commands on `401`, redirect
  refusal, controller-reported sync/rollback failure, safe no-op sync,
  successful rollback, and oversized successful payloads.
- `go test ./...`, `go vet ./...`, and `go test -race ./...` passed in both
  `src/` and `web/`. A high-reasoning independent re-review found no remaining
  P0/P1/P2 issue after the no-op and bounded-response corrections.

## Current presentation-tranche evidence (2026-09-15)

- The control-plane and Web API boundary is exercised end to end with a
  server-side, per-request session resolver test. It proves that the renderer
  uses only the versioned capabilities, fleet, and bounded-activity routes;
  a scoped bearer stays server side and no fixture evidence appears in a live
  response.
- A high-reasoning independent review found and the implementation corrected
  a concurrent-fixture backing-array race. The regression runs fixture
  scenarios concurrently under Go race detection.
- Frozen, redacted presentation-v1 JSON fixtures are validated by both Go
  modules: controller response DTOs must serialize the exact schema and the
  Web typed client must decode every supported read route. The fixture lookup
  is `-trimpath` safe and the Web assertions cover all frozen fields while the
  production decoder remains forward-compatible with additive fields.
- `go test ./...`, `go vet ./...`, and `go test -race ./...` pass in both
  `src/` and `web/`. `dockercd-web:review` was rebuilt from the current source
  and inspected as a scratch image with user `65532:65532`, entrypoint
  `/dockercd-web`, and only container port `8092/tcp` declared. Its current
  local manifest digest is
  `sha256:abaf518ac9edaf7fc578bbd191b109410256aa2100770996c20ab68ad0101ef9`.
- A local SBOM scanner was not installed. Docker Scout is available, but an
  external scan is deferred until release authorization confirms its metadata
  handling is acceptable; no image content or controller data was uploaded
  during this tranche.
- The owner approved the fixture visual journey. The loopback fixture and
  embedded UI are retained during live-read configuration and parity checks;
  no controller endpoint, container deployment, or network exposure was
  changed.

## Local-auth live-read tranche evidence (2026-09-16)

- ADR 0003 records the first local identity boundary: a Compose-mounted,
  strict JSON user registry with Argon2id verifiers, per-user scoped controller
  bearers, opaque memory-only browser sessions, signed double-submit login
  CSRF, and session-bound logout CSRF. The controller registry remains a
  separate digest-only secret.
- `web` passed `go test ./...`, `go vet ./...`, and `go test -race ./...`.
  Regression coverage includes malformed registries, duplicate bearers, mixed
  Argon2 cost profiles, bounded verifier admission, stateless challenge
  expiry/tampering, CSRF, opaque cookies, controller-subject mismatch, and
  HTML credential non-disclosure.
- A high-reasoning independent review found no P0/P1/P2 issues after the
  final remediation. It specifically reviewed bounded Argon2 work, fixed
  HMAC-selected throttle buckets, dummy verification, uniform registry costs,
  stateless challenge behavior, controller `/permissions` subject binding, and
  Compose secret separation.
- The reference Compose file validates with `docker compose config` without
  starting containers. Its Web service is read-only, non-root, capability-free,
  has `no-new-privileges`, publishes only loopback `8092`, and uses one Web-only
  secret mount. The controller remains on the private Compose network.
- `dockercd-web:local-auth-review` built successfully as a scratch image with
  numeric user `65532:65532` and only `8092/tcp` exposed. Its local image ID is
  `sha256:7570b48eef179b89b679fada5f01fd41ef1171f621c4048e759318581062dda6`.
- No live container was replaced or started, no existing network exposure was
  changed, and no production secret was created or rotated.

## Local-password provisioning helper evidence (2026-09-16)

- `dockercd-web-password-hash` reads and confirms a password only from an
  interactive terminal, uses a fresh 128-bit salt with the approved Argon2id
  profile, and prints only the PHC verifier.
- Its terminal mode is entered synchronously; `INT`, `HUP`, and `TERM` restore
  the captured state before the process exits. Raw entry handles UTF-8
  backspace safely, rejects invalid/overlong input, and clears buffers on all
  normal error paths.
- Unit tests cover interruption restoration, noninteractive refusal, UTF-8
  editing, invalid and overlong input, buffer clearing, verifier round-trip,
  unique salts, and caller-buffer preservation. A high-reasoning independent
  review found no P0/P1/P2 findings after remediation.

## Presentation freshness-metadata tranche evidence (2026-09-16)

- ADR 0004 records the additive read-contract refinement: controller-authored
  `responseGeneratedAt` plus `complete`/`unavailable` paired observation
  metadata. Desired revision, successful-sync time, and Docker-observation
  time remain distinct facts; no raw diagnostics or additional privilege enter
  the presentation surface.
- Frozen fixtures are decoded strictly by both Go modules. Controller tests
  prove response times are RFC 3339, a health observation cannot be complete
  without both its status and timestamp, and the scoped feature is advertised
  only to a principal that can read status.
- Web tests prove a current client rejects a controller lacking
  `presentation.status-metadata`, displays the primary fleet response time
  even when activity has a different time, and never displays an observation
  age beside unavailable, incomplete, malformed, or zero-time health data.
- `go test ./...`, `go vet ./...`, and `go test -race ./...` passed in both
  `src/` and `web/`. The controller and Web images built locally as
  `dockercd:freshness-review` and `dockercd-web:freshness-review`; no
  container was started, stopped, replaced, or deployed.
- An independent high-reasoning review initially found a fleet/activity
  freshness mix-up and two observation-consistency edges. All were corrected,
  regression-tested, and re-reviewed with no remaining P0/P1/P2 findings.

## Minimal paired-deployment tranche evidence (2026-09-17)

- ADR 0006 defines one development control-plane/Web pair and a separately
  configured personal Signal-only pair. The active deployment material is
  reduced to those paired services; retired manifests, overlays, controller UI
  assets, installers, and historic guides are preserved as inactive archive
  material rather than discarded.
- Both Compose files render with temporary non-secret placeholder files using
  `docker compose config --quiet`; neither validation starts, stops, syncs, or
  replaces a container. Both installers pass shell syntax validation.
- Independent high-reasoning review found that two controllers sharing an
  unrestricted Docker daemon are not a hard security boundary, that publishing
  removed personal manifests to the existing `main` source could tear down
  running applications, and that a new Signal volume could hide its ledger.
  The ADR and active documentation now state the shared-daemon limit; the
  personal state is fenced on a dedicated migration branch; and Signal retains
  its existing external ledger volume. A fresh volume requires separate backup,
  restore evidence, and owner approval.
- The review also found archive and documentation hygiene issues. Original
  historical installer/README material is retained in archive locations,
  archive notices are separate files, and the personal `.env.example` is
  explicitly tracked while real environment files remain ignored.
- A re-review found and corrected one final branch-wiring error: Signal's
  application manifest now follows the same `v1/personal-paired-signal`
  migration branch as its new controller. The final high-reasoning re-review
  reported no remaining P0/P1/P2 findings.
- `go test ./...`, `go vet ./...`, and `go test -race ./...` passed in both
  `src/` and `web/`. Existing `dockercd`, `dockercd-my-apps`, and `signal`
  containers were observed healthy and were not modified.

## Local paired-deployment execution evidence (2026-09-17)

- Committed controller/Web source revision `0a1489c` was built locally as
  `dockercd:v1-personal-paired` and `dockercd-web:v1-personal-paired`.
  The personal migration source revision is `ccdff54` on
  `v1/personal-paired-signal`; it is not merged into legacy `main`.
- Separate local controller tokens, digest-only presentation registries, and
  Web-user registries were provisioned with restricted filesystem permissions
  outside either repository. The browser receives no controller bearer.
- The new development pair (`18080` / `18092`) and personal pair (`19080` /
  `19092`) started on distinct Compose networks and state volumes. Health and
  readiness endpoints, authenticated scoped-fleet reads, and unauthenticated
  Web sign-in redirects returned successful expected responses for both.
- The personal controller registered Signal from the migration branch and
  observed its network/revision drift in manual mode. It did not sync, prune,
  self-heal, restart, or alter Signal. Signal remained running with restart
  count zero and its existing `lrp-investments_lrp-config` volume mounted at
  `/app/config`.
- The legacy `dockercd`, `dockercd-my-apps`, Signal, and other legacy
  application containers remain running for deliberate later retirement.

## Live presentation integrity correction (2026-09-17)

- Reviewed source revision `fd12e0f` removes fixture-only System navigation
  and fixture-detail calls from a live scoped session. A bookmarked live
  System route now explains its scope boundary without requesting host data or
  returning fixture-specific copy.
- Empty authorized activity and an unavailable activity capability render as
  distinct evidence states. The Web UI does not claim an empty controller
  response when the session was not permitted to request activity.
- `go test ./...`, `go vet ./...`, `go test -race ./...`, and a Web binary
  build passed in `web/`. An independent high-reasoning review found one P2
  capability-state wording issue; it was corrected and the re-review reported
  no remaining P0/P1/P2 findings.
- The Web image was rebuilt as `dockercd-web:fd12e0f` (manifest-list digest
  `sha256:583c456c363e76ea304a6e642b649b6e50f327d18b1672667dd771c9425dd072`)
  and retagged for the local paired deployment. Only the development and
  personal `dockercd-web` containers were recreated; both login routes returned
  `200`, an unauthenticated personal System request redirected to sign-in, and
  neither controller nor Signal was recreated.
