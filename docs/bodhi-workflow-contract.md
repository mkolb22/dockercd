# DockerCD adoption of the Bodhi tranche validator

## Scope

This is DockerCD's project-local record of the bounded workflow contract used
for future meaningful tranches. It does not copy, modify, or promote Bodhi's
shared knowledge. It records the behavior inspected on 2026-10-04 in
`../bodhi-ai/scripts/development-practice.mjs` and Bodhi's
`docs/quality-first-development-practice.md`.

The validator accepts a JSON packet under an explicitly supplied repository
root. It checks declaration shape plus SHA-256 freshness of the packet's local
research sources. It reports only advisory readiness: it does not verify the
semantic quality of the work, run tests, inspect Git authority, grant
acceptance, publish code, deploy Docker resources, or write Bodhi state.

## DockerCD use

Each meaningful DockerCD tranche owns one packet in
`docs/tranche-packets/`. The packet must be started in `research` or `design`,
then rechecked at `resume`; acceptance requires the completed workflow stage,
candidate-bound validation, an independent reviewer, outcome, documentation,
recommendation, and learning dispositions.

DockerCD uses its own regular files as research evidence. Cross-project
instructions, remembered results, external paths, and unavailable sources are
not substitutes for local hash-pinned references. A failed lookup or changed
hash is a research-refresh blocker, not a pass.

The first adoption packet covers only an operational-documentation correction:
the recovery drill needs explicit purpose-specific Docker contexts and cannot
infer disposal from the implicit `default` context. It makes no Docker call,
does not provision a daemon, and leaves the actual disposable-drill execution
gate blocked.

## Local practice sources

DockerCD owns a concise, versioned adaptation of the eight source paths the
validator discovers:

- `docs/quality-first-development-practice.md`
- `docs/quality-first-feature-tranche-template.md`
- `knowledge/computer-science/evidence-driven-tranche-workflow.md`
- `knowledge/computer-science/ontology.yaml`
- `knowledge/epistemics/quality-first-ai-development-workflow.md`
- `knowledge/technology/devops-gitops-quality-first-development.md`
- `docs/development-token-economics.md`
- `knowledge/technology/development-token-economics.md`

They are tailored workflow and retrieval guidance, not copied Bodhi histories,
runtime features, or claims about measured savings. The validator can now
discover the local source set. It still only reports advisory declaration and
hash freshness: a packet becomes acceptable only after its candidate-bound
tests, independent review, repairs, documentation, outcome, and learning are
complete.

## Limits and recovery

The project can remove this adoption by reverting its own `CLAUDE.md`, this
document, and the relevant packet. That Git recovery does not undo Docker
operations, data migrations, or published commits. Existing DockerCD release
and safety requirements continue to apply independently.
