# DockerCD repository guidance

## Scope

DockerCD is a Go service for GitOps-style Docker Compose deployment. The
service source and its Go module are in `src/`; deployment examples are in
`deploy/`; documentation is in `docs/`. The v0.1 repository has no active
root-level Node dependency surface; retired tooling is archive-only.

Read `GOAL.md` before beginning the security-and-performance remediation work.
Use `security_best_practices_report.md` as the source of the findings and their
acceptance criteria.

## Working agreements

- Preserve unrelated working-tree changes. Do not reset, discard, or reformat
  files outside the requested scope.
- Keep production changes narrowly scoped and add or update regression tests
  with behavior changes.
- Treat the Docker socket, API authentication, cluster control traffic, Git
  credentials, and secret values as security-sensitive. Never log, persist, or
  return plaintext credentials or secret material.
- Do not weaken TLS verification, widen network exposure, add approval bypasses,
  or introduce an insecure compatibility fallback without explicit approval.
- Keep deployment manifests, configuration defaults, API behavior, and user
  documentation consistent when a behavior or default changes.
- Stop for direction before a change would delete sync-history data, rotate a
  production secret, alter an existing deployment's network exposure, or break
  client compatibility.

## Validation

Run Go commands from `src/` after Go changes:

```sh
go test ./...
go vet ./...
go test -race ./...
```

Run targeted tests while iterating; run the full commands before handoff. For
dependency remediation, also run `govulncheck ./...` from `src/`. Run
`npm audit --omit=dev` only when the repository has an active tracked Node
dependency surface, then report residual findings instead of suppressing them.

## Code review rules

- Flag any route that can reach Docker or mutate application state without
  authentication and an explicit exposure policy.
- Flag plaintext secrets in manifests, URLs, persistence, logs, event payloads,
  or API responses.
- Flag unbounded network work, goroutines, request bodies, queues, polling, or
  Docker inspections on hot paths. Require deadlines, limits, and caching or
  coalescing where appropriate.
- Do not treat passing unit tests as proof that deployment defaults are safe;
  review Compose files and documentation as part of the deployable product.
