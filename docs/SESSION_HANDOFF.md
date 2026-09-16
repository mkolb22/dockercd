# Session handoff

## Current state

The controller and the separate `dockercd-web` presentation service now share
a capability-scoped, read-only contract. The Web service has local-password
bootstrap support, but no existing deployment was changed while preparing it.
No container was started, stopped, replaced, or deployed in this session.

The latest completed tranche is controller-authored presentation freshness:

- controller responses identify when they were generated;
- observed health is explicitly `complete` or `unavailable`, never inferred;
- the Web UI displays controller response time rather than local browser time;
- frozen controller/Web contract fixtures protect the wire format; and
- the tranche has passed an independent high-reasoning review.

See [ADR 0004](adr/0004-presentation-read-freshness-metadata.md), the
[presentation contract](presentation-integration-contract.md), and
[quality evidence](quality-first-delivery.md).

## Safe takeover checklist

1. Start from the pushed `main` revision and review `git status --short`.
2. Do not place passwords, controller bearers, Git tokens, or secret files in
   Git, shell arguments, environment variables, logs, or screenshots.
3. Keep the controller private and the Web container unprivileged. Do not add
   Docker, Git, SQLite, source-cache, or broad administrator-token mounts to
   `dockercd-web`.
4. Before another presentation feature, update the contract/ADR first, add
   controller and Web fixture coverage, run both module validation matrices,
   and obtain the required independent review.

## Next designed capability

The next useful read-only capability is a resource-scoped desired-topology and
diff *summary* for the live “Compare desired state” page. It must use separate
capabilities, authorization before Git or Docker work, strict deadlines and
concurrency limits, purpose-built redacted DTOs, and no raw Compose fields,
logs, errors, secret values, or automatic mutation path.

Run validation from each module after a Go change:

```sh
cd src && go test ./... && go vet ./... && go test -race ./...
cd web && go test ./... && go vet ./... && go test -race ./...
```
