# dockercd security and performance review

## Executive summary

The original review found two deployment-blocking security issues: the shipped Compose configurations exposed a Docker-socket-privileged API without authentication, and cluster control accepted unauthenticated TCP role-change messages from any reachable host. It also found plaintext secret exposure through the API and SQLite history, a materially outdated dependency set with reachable advisories, and high-impact scaling defects in the scheduler and metrics UI/API path. The remediation described below resolves those code and deployment controls; the remaining no-fix dependency advisories and operational credential-rotation requirement are recorded explicitly.

The code has several positive controls: JSON and webhook bodies are capped at 1 MiB, webhook signatures use HMAC-SHA-256 with constant-time comparison, Compose files are limited to 10 MiB, Docker clients are cached, event fan-out is bounded per subscriber, and test, vet, and race passes succeed.

## Scope and validation

- Reviewed Go services, embedded browser UI, Docker/Compose deployment files, cluster code, persistence, Git and secret-provider paths.
- Final validation: `go test ./...`, `go vet ./...`, and `go test -race ./...` pass. `bash -n install.sh`, all three Compose render checks, and `git diff --check` also pass.
- Final `govulncheck ./...` reports two reachable advisories in `github.com/docker/docker@v28.5.2+incompatible` (`GO-2026-4887` and `GO-2026-4883`), both with no fix published. It reports four additional required-module advisories that are not reached by this code.
- Final `npm audit --omit=dev --audit-level=low` reports three high-severity findings through `@dragonflymcp/plugin` → `@huggingface/transformers` → `sharp <0.35.0`; npm reports no fix available. This tree is not used by the Go daemon at runtime.

## Remediation progress (2026-09-04)

- **SEC-001 — remediated:** the daemon binds to `127.0.0.1` by default; a
  non-loopback listener requires a 32-character-or-longer API token. Shipped
  Compose files require that token and publish the API only on host loopback;
  the installer uses authenticated API calls. Remote access still belongs
  behind an authenticated TLS-terminating reverse proxy.
- **SEC-002 and PERF-005 — remediated:** enabled cluster control requires TLS
  1.3 mutual authentication, certificate SAN identity and protocol node-ID
  validation, message-size limits, and a 32-connection admission bound. The
  cluster Compose example keeps port 9090 off the host and mounts externally
  managed, read-only node credentials. The legacy plaintext DB replication
  helper remains unused and must not be exposed until it is redesigned over
  authenticated transport. Storage fencing/leases remain a separate
  availability improvement for partition split-brain prevention.
- **SEC-003 — remediated:** manifests reject embedded repository credentials;
  URL userinfo, API display state, diffs, desired state, service details, and
  logs are redacted. New sync records never write Compose snapshots, and
  migration `006_purge_compose_snapshots.sql` clears all existing snapshots.
  Operators must rotate any credential that could have appeared in a pre-upgrade
  database, WAL, or backup; the documentation records this irreversible
  external action.
- **SEC-004 — remediated with accepted residual risk:** patched Go modules now
  include go-git 5.19.2, go-billy 5.9.1, x/crypto 0.56.0, chi 5.3.2, and the
  current OpenTelemetry stack; the build target is Go 1.26. Remaining scanner
  findings are the two no-fix Docker-module advisories and the three no-fix
  plugin/sharp findings described above.
- **SEC-005 — remediated:** Git operations use a required explicit host
  allowlist (`DOCKERCD_GIT_ALLOWED_HOSTS`), apply it to HTTPS and SSH shorthand,
  reject embedded credentials, and reject HTTP redirects to untrusted hosts.
  Internal Git hosts require deliberate allowlist configuration.
- **SEC-006 — remediated:** 32 KiB header limits, browser security headers,
  cookie-CSRF protection, and a four-request concurrency bound protect expensive
  Docker/Git routes. A global write timeout remains intentionally absent so SSE
  streams work; bounded application sync policies and route limits constrain
  non-SSE work.
- **SEC-007 — remediated:** remote Docker TLS verifies certificates by default,
  requires a parseable CA, and uses TLS 1.2 or newer. The verification bypass is
  restricted to acknowledged, loopback-only local development.
- **PERF-001 through PERF-004 — remediated:** the scheduler avoids past-due
  busy loops and boundedly retries a full queue; host stats are cached and
  coalesced; health and registry work use bounded pools, deadlines, and overlap
  skipping; and the dashboard receives recent histories in the application list
  response instead of issuing N history requests and rerendering repeatedly.
- **Verification after remediation:** all commands listed in Scope and
  validation were run after integration. Regression tests cover unauthenticated
  cluster control rejection, peer identity rejection, redirect policy, TLS
  validation, bounded polling, scheduler behavior, history batching, API
  headers/CSRF, and snapshot redaction.

## Critical findings

### SEC-001 — The shipped deployment exposes an unauthenticated Docker-admin API

- **Severity:** Critical
- **Location:** `deploy/docker-compose.yml:7-17`, `deploy/docker-compose.bundle.yml:109-119`, `src/internal/config/defaults.go:28`, `src/internal/api/server.go:80-121`, `src/internal/cli/serve.go:276-287`
- **Evidence:** The deployment publishes `8080:8080` and mounts `/var/run/docker.sock`, but does not set `DOCKERCD_API_TOKEN`. The default token is empty. Authentication middleware is installed only when `APIToken != ""`; otherwise all application-management, sync, rollback, desired-state, service-log, and host-information routes are public.
- **Impact:** Any host that can reach port 8080 can create or modify an Application and invoke sync. A Compose deployment can mount host files, the Docker socket, or run privileged containers, so this is effectively host-level code execution. It also exposes manifests and Docker metadata.
- **Fix:** Make API authentication mandatory for non-loopback listeners, fail startup when the API token is absent, and bind to `127.0.0.1` by default unless an explicit public-listener setting is enabled. Set a strong token in every example deployment. Put externally reachable instances behind an authenticated reverse proxy/TLS terminator.
- **Mitigation:** Until fixed, do not deploy the provided Compose files on a routable interface; restrict port 8080 with host firewall rules and set `DOCKERCD_API_TOKEN` from a secret store.

### SEC-002 — Cluster role control is unauthenticated and publicly published

- **Severity:** Critical
- **Location:** `deploy/docker-compose.cluster.yml:6-8,25-27`, `src/internal/cluster/heartbeat.go:92-165`
- **Evidence:** Cluster port 9090 is published as host ports 9190/9191. The TCP listener accepts plaintext `PROMOTE` and `DEMOTE` messages from any connection and calls `n.promote()` or `n.demote()` without authenticating the peer or validating `msg.NodeID`.
- **Impact:** A network attacker can force the active node to demote (availability loss) or promote the passive node while the original remains active (split brain). Both nodes can then reconcile and issue destructive Docker operations independently.
- **Fix:** Do not publish the cluster listener. Use mutually authenticated TLS with an identity bound to each node, validate the peer identity/node ID, and reject control messages from any other principal. Add fencing/lease semantics; deterministic two-node preference alone cannot prevent split brain during partitions.
- **Mitigation:** Keep 9090 on a private, isolated network and filter it at the host firewall. Treat the current cluster mode as unsafe for production.

## High findings

### SEC-003 — Resolved secrets and Git credentials are stored and returned in plaintext

- **Severity:** High
- **Location:** `docs/getting-started.md:272-289`, `src/internal/api/handlers.go:199-243,358-375,492-529`, `src/internal/parser/parser.go:90-108`, `src/internal/reconciler/reconciler.go:502-506,747-764`, `src/internal/store/queries.go:208-220,228-265`, `src/internal/inspector/inspector.go:382-387`
- **Evidence:** The documented repository URL embeds `user:password`. Application responses return `AppSpec`, including `repoURL`. Inline Vault/AWS references are replaced with their resolved values in `ComposeSpec.Environment`; that spec is marshalled into `sync_history.compose_spec_json`, returned by the history API, and desired state is returned by `/desired`. Service-detail responses also include the complete runtime container environment.
- **Impact:** Git passwords, database credentials, and other deployment secrets persist in SQLite/WAL backups and are returned to API users. With the default deployment this is public; with a token, it still widens secrets exposure to every bearer-token holder and to anyone with access to the data volume or database backup.
- **Fix:** Never store or return secret values. Keep a redacted display/snapshot type (for example, preserve a reference and a `redacted: true` marker), redact URL userinfo before persistence/logging/API serialization, and remove environment values from the service-detail endpoint or protect them behind a separate, audited secret-read permission. Purge existing `compose_spec_json` records and rotate credentials after deployment of the fix.
- **Mitigation:** Use credential-free repository URLs plus a dedicated Git credential mechanism, set `DOCKERCD_API_TOKEN`, restrict the state volume, and disable the desired/history/environment views where possible.

### SEC-004 — Reachable dependencies contain known security vulnerabilities

- **Severity:** High
- **Location:** `src/go.mod:5-50`, `src/internal/gitsync/gitsync.go:156,192,212,275,299,357`, `src/internal/api/server.go:63`, `package.json:1-10`
- **Evidence:** `govulncheck` found 27 reachable advisories. High-priority examples include `go-git/v5@5.16.5` path traversal/symlink and malformed-object issues (fixed in `v5.19.2`), `go-billy/v5@5.6.2` traversal issues (fixed in `v5.9.0`), `golang.org/x/crypto@0.47.0` SSH deadlock DoS issues (fixed in `v0.56.0`), and `chi/v5@5.2.5` RealIP spoofing issues (fixed in `v5.3.0`). The scanner traced these into the Git sync and API paths. It also flagged OpenTelemetry and Docker-module advisories; the latter has no fixed version reported by the scanner.
- **Impact:** A malicious or compromised Git remote can exercise vulnerable parsing/worktree code in the deployment controller. Unpatched request-IP behavior becomes especially risky if rate limits or IP allowlists are added around `middleware.RealIP`.
- **Fix:** Upgrade the direct modules together, regenerate `go.sum`, rerun tests and `govulncheck`, and add `govulncheck` to CI. Do not use `RealIP` unless a trusted proxy boundary strips inbound forwarding headers; otherwise remove it. Update the root JavaScript/plugin dependency tree as a separate lockfile change (`npm audit` reported 15 issues, including critical `protobufjs` and `tar`).
- **Mitigation:** Restrict Git sources to protected repositories and avoid SSH Git access until `x/crypto` is updated.

### SEC-005 — Repository URL validation does not enforce its SSRF policy

- **Severity:** High
- **Location:** `src/internal/app/validation.go:94-129`, `src/internal/gitsync/gitsync.go:275-281`
- **Evidence:** `validateRepoURL` blocks only literal private IPs. Hostnames are not resolved and rechecked, so a controlled DNS name can resolve to loopback, link-local, or private addresses. The `git@...` SSH shorthand is accepted immediately with the comment “no SSRF risk,” although it still directs an SSH connection to its host.
- **Impact:** Anyone who can submit an application manifest (or compromise the manifest repo) can cause the privileged controller to connect to internal HTTP/SSH services. This can reach metadata endpoints or internal Git/Docker infrastructure and is particularly harmful because the controller has long-lived credentials.
- **Fix:** Prefer an explicit Git-host allowlist. If arbitrary hosts are required, resolve all A/AAAA records immediately before connection and reject loopback, private, link-local, multicast, and unspecified ranges; use a transport that prevents DNS rebinding after validation. Apply the same policy to SSH shorthand. Consider whether internal Git hosts are an intended exception and make that an explicit allowlist.
- **False-positive note:** If only trusted operators can create manifests and all Git repositories are deliberately allowed to reach private hosts, this is a trust-model decision; document it rather than describing it as SSRF protection.

## Medium findings

### SEC-006 — HTTP hardening is incomplete for an expensive privileged service

- **Severity:** Medium
- **Location:** `src/internal/api/server.go:60-149`, `src/internal/api/handlers.go:249-308,394-445,492-529`
- **Evidence:** The server has read and idle timeouts, but no `MaxHeaderBytes`, no write-timeout strategy for non-SSE routes, no concurrency/rate limits, and no application security headers. Several unauthenticated-by-default routes trigger Git sync, Docker inspection, logs, or all-container statistics.
- **Impact:** Even after authentication is enabled, a valid token or a network-level flood can consume worker, Docker-daemon, and memory resources. Absent edge controls, browser framing and MIME-sniffing protections are also not visible in application code.
- **Fix:** Set `MaxHeaderBytes`, use route-specific contexts/timeouts (with a separate SSE server or handler policy), enforce an in-process concurrency limit for expensive routes, and add a rate limiter. Add `X-Content-Type-Options: nosniff` and a restrictive CSP/frame policy after validating reverse-proxy behavior.
- **False-positive note:** TLS, rate limits, and headers may be applied at a reverse proxy; no such configuration is present in this repository.

### SEC-007 — TLS certificate verification can be disabled without a production guardrail

- **Severity:** Medium
- **Location:** `src/internal/inspector/inspector.go:39-65`, `src/internal/config/config.go:15-20`
- **Evidence:** A remote Docker host configuration can set `verify: false`, which enables `InsecureSkipVerify`. There is no warning/fail-closed production mode or allowlist for configured remote Docker hosts.
- **Impact:** A man-in-the-middle attacker can impersonate a remote Docker daemon and receive or alter privileged Docker API traffic.
- **Fix:** Default remote hosts to verified mTLS and reject `verify: false` except through an explicit development-only acknowledgement. Validate that the supplied CA parsed successfully; `AppendCertsFromPEM` currently ignores a false return.

## Performance and resilience findings

### PERF-001 — Due work remains due while executing, causing a scheduler busy loop

- **Severity:** High
- **Location:** `src/internal/reconciler/scheduler.go:20-55,73-98,100-107`; `src/internal/reconciler/worker.go:23-35`
- **Evidence:** A due app stays at a past `schedule[appName]` value until the worker finishes and calls `reschedule`. `nextWakeTime` consequently returns a past time; the scheduler resets its timer to zero, repeatedly runs `syncConfigManifests`, and tries to enqueue the same app. Workers that receive duplicates skip them due to `TryLock`, but the loop resumes immediately.
- **Impact:** Any reconciliation lasting more than the scheduler iteration can create CPU churn, repeated SQLite scans, queue pressure, and high-volume debug logs. A slow Git or Docker operation can therefore degrade the entire controller.
- **Fix:** Advance or mark the schedule as in-flight before enqueueing; maintain a `queued/inFlight` set and only enqueue each app once. On a full queue, set a bounded retry time instead of keeping the app overdue. Add a regression test that holds a reconciliation open and asserts the scheduler does not spin or duplicate enqueue.

### PERF-002 — Each open dashboard invokes all-container metrics and disk usage every three seconds

- **Severity:** High
- **Location:** `src/internal/api/static/js/app.js:26,92-107,572-610`; `src/internal/api/handlers.go:394-407`; `src/internal/inspector/inspector.go:752-970`
- **Evidence:** Each dashboard browser polls `/system/stats` every 3 seconds. Every request lists every container, creates up to ten concurrent `ContainerStatsOneShot` calls, then calls Docker `DiskUsage`; the result is not cached or single-flight deduplicated.
- **Impact:** With `C` running containers and `U` open dashboards, this produces roughly `U × C / 3s` stats calls plus repeated daemon-wide disk scans. This can overload the Docker daemon and make deployment operations slow or unreliable.
- **Fix:** Collect host stats once in a background collector at a configurable interval (for example 10–30 seconds), cache the snapshot with timestamp/staleness metadata, and serve it to all clients. Use singleflight for cache misses and expose disk usage less frequently or on demand. Add API concurrency/rate limits as defense in depth.

### PERF-003 — Health sweeps and image polling are serial and can stall the whole fleet

- **Severity:** Medium
- **Location:** `src/internal/health/health.go:394-410,229-275`; `src/internal/registry/poller.go:125-162,176-260`
- **Evidence:** The health sweep checks applications one at a time; each check lists and then inspects every container. The image poller likewise processes every app, compose file, and registry request serially. Both use the service lifetime context rather than a per-item timeout for their normal sweeps.
- **Impact:** One slow/unreachable Docker host, repository, or registry delays every later application. Total sweep latency grows linearly with application/container count and may exceed the configured interval.
- **Fix:** Use a bounded worker pool with per-app/per-host deadlines and skip overlap when a prior sweep is still running. Reuse one project/container snapshot where possible, and instrument duration, queue depth, cache hit rate, and timeout counts.

### PERF-004 — Dashboard startup makes N history requests and re-renders the full dashboard for each completion

- **Severity:** Medium
- **Location:** `src/internal/api/static/js/app.js:114-137`; `src/internal/api/handlers.go:358-375`
- **Evidence:** `fetchCardHistories` issues one request per application. Each completed request calls `renderDashboard`, recreating the full card grid and scheduling sparkline injection.
- **Impact:** Initial dashboard work approaches O(N²) DOM work, causes N API/SQLite queries, and gets progressively more expensive with the number of applications.
- **Fix:** Add a compact batched-history endpoint (or include five recent results in the list response) and render once after all data arrive. If progressive rendering is desired, update only the affected card and batch DOM updates in an animation frame.

### PERF-005 — Cluster listener permits unbounded connection goroutines

- **Severity:** Medium
- **Location:** `src/internal/cluster/heartbeat.go:109-119,122-165`
- **Evidence:** Every accepted TCP connection immediately starts a goroutine. The 3-second deadline limits each connection’s duration, but there is no semaphore, accept-level admission control, or network authentication.
- **Impact:** A connection flood can allocate an unbounded number of goroutines and file descriptors, causing a control-plane DoS. This compounds SEC-002.
- **Fix:** Keep the listener private, use authenticated TLS, set a bounded connection semaphore and socket-level limits, and reject excess connections before starting handler goroutines.

## Suggested remediation order

1. Before any internet-facing deployment: fix SEC-001 and remove/disable cluster mode until SEC-002 is fixed.
2. Remove/redact persisted and returned secrets (SEC-003), purge existing snapshots, and rotate affected credentials.
3. Upgrade Go and JavaScript dependencies (SEC-004) and add vulnerability scanning to CI.
4. Fix the scheduler busy loop and cache host stats (PERF-001 and PERF-002); these are the largest immediate reliability wins.
5. Harden URL/TLS boundaries and bound sweep/cluster work (SEC-005 through PERF-005).
