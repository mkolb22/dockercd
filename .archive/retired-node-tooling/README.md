# Retired Dragonfly Node tooling

This directory preserves the root Node package, lockfile, launcher, and
migration script retired by ADR 0008. The former launcher is intentionally not
active: it referenced a deleted fresh-checkout `node_modules` tree and pulled
an unresolved tooling-only dependency advisory chain. No DockerCD runtime
image depends on these files.
