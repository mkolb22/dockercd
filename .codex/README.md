# Codex repository administration

This directory contains only safe, repository-scoped Codex configuration.

- `config.toml` controls project instruction loading; it contains no credentials
  or user/machine policy overrides.
- `../AGENTS.md` is the active repository instruction file. Codex discovers it
  from the repository root before working in the tree.
- `../GOAL.md` is a ready-to-paste long-running remediation goal.
- Archived Claude configuration lives in `../.archive/` and is retained only as
  historical reference; it is not part of the active Codex setup.

Add subdirectory `AGENTS.md` files only when a directory has genuinely distinct
rules. Keep shared process and security guidance in the root file.
