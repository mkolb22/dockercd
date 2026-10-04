# DockerCD project workflow contract

## Purpose and authority

DockerCD adopts Bodhi's advisory development-tranche practice for meaningful
project work. The practice records evidence; it does not grant acceptance,
publication, Docker access, deployment authority, or permission to replace
repository instructions. `AGENTS.md`, the locked v0.1 goal, and explicit owner
scope remain controlling.

## Project-local tranche record

Before meaningful code or behavior changes, create one versioned packet under
`docs/tranche-packets/<tranche>.json`. The packet is owned by DockerCD and
must identify the exact allowed paths, base/candidate identity, test evidence,
independent review, documentation disposition, recommendations, and learning
disposition. Its research provenance must reference regular files within this
repository and pin their SHA-256 content revisions; do not claim a source is
current when it is missing, stale, outside the repository, or only remembered
from another project.

The current validator is supplied by the adjacent Bodhi repository. From the
DockerCD repository root, run it with the project root and packet path made
explicit:

```sh
node ../bodhi-ai/scripts/development-practice.mjs \
  --repo-root "$PWD" \
  --packet docs/tranche-packets/<tranche>.json \
  --stage startup
```

Run `--stage resume` before using earlier research or continuing a session.
Run `--stage acceptance` only after the exact final candidate has passed its
planned checks, an independent reviewer has reviewed it, any findings have
been repaired and rechecked, and the packet records outcome and learning.
A declaration-complete result remains evidence for Codex review, never an
automatic acceptance or publish decision.

## Research, safety, and delivery boundaries

- Record `no_gap`, `curated`, or `blocked` knowledge disposition honestly; a
  blocked disposition stops dependent code rather than being worked around.
- The disposable recovery drill stays blocked until its purpose-built daemon,
  guard context, and every protected deployment context are explicitly
  available and preflight succeeds. Use deterministic local fixtures only;
  never target personal, Signal, development, protected, or ambiguous Docker
  daemons.
- Do not broaden Docker authority, provision infrastructure, alter contexts,
  or inspect/change live workloads merely to satisfy a development gate.
- Preserve owner edits and active branch protections. After the required tests,
  independent review, and acceptance record are complete, normal user-approved
  commit/merge/push work remains permitted; publication is separate from any
  Docker deployment.

## Lightweight documentation changes

Documentation-only changes with no behavioral or operational effect may use a
small packet that states why design, runtime validation, or owner-journey work
is not applicable. They still require exact diff validation and independent
review before acceptance and publication.
