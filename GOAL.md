# Security and Performance Remediation

## Ready-to-paste goal

```text
/goal Remediate the security and performance issues documented in
security_best_practices_report.md without changing the documented public API
unless a security fix requires it. Work in priority order and keep every
change narrowly scoped, tested, and reversible.

Definition of done:
1. The API is secure by default: production/non-loopback listeners require an
   API token, deployment examples provide a safe configuration, and control
   endpoints cannot be reached anonymously.
2. Cluster promotion/demotion traffic is authenticated and protected in
   transit, or cluster control is disabled/not host-published until that is
   true. Include a test that rejects unauthenticated control messages.
3. Secrets and Git credentials are not persisted in sync history, logs, or API
   responses. Add redaction and regression tests; document any required secret
   rotation or migration.
4. Git source validation resists SSRF via hostnames, redirects, and resolved
   addresses, using an explicit allowlist or equivalent policy.
5. Reachable vulnerable dependencies are upgraded to fixed versions where
   available. Re-run govulncheck and npm audit, record any accepted residual
   risk, and do not silently suppress findings.
6. HTTP endpoints have appropriate limits and timeouts without breaking SSE;
   expensive operations are rate/concurrency bounded.
7. The reconciliation scheduler cannot busy-loop when work is queued or in
   progress, host statistics are cached/coalesced, and health/registry polling
   uses bounded concurrency and per-operation deadlines. Add regression tests
   or benchmarks for these paths.
8. `go test ./...`, `go vet ./...`, and `go test -race ./...` pass. Update
   security_best_practices_report.md with the final remediation status and
   validation results.

Stop and request direction before any migration that would delete existing
sync-history data, rotate production secrets, change default network exposure
for an installed deployment, or require incompatible client configuration.
```

## Source

This goal is derived from `security_best_practices_report.md`. It intentionally
starts with remotely exploitable issues and pairs each behavior change with a
verifiable acceptance criterion.

## Completion status (2026-09-04)

All eight implementation criteria are complete. The destructive snapshot-value
purge was applied as migration `006_purge_compose_snapshots.sql` under the
user's explicit authorization to complete this goal without prompting. The
final review records the remaining no-fix dependency advisories and the
operator action to rotate any credential that appeared in pre-upgrade state or
backups.
