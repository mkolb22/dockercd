# Project Structure Skill

Expert knowledge for maintaining clean project organization when Dragonfly is used as a submodule or standalone installation.

## Core Principle: Separation of Concerns

Dragonfly infrastructure and project code must remain cleanly separated. This ensures:
- Dragonfly can be updated without affecting project code
- Project code doesn't pollute Dragonfly state directories
- Clear boundaries make debugging easier
- Submodule updates don't cause merge conflicts

---

## Directory Boundaries

### Protected Dragonfly Directories (NEVER add project code here)

#### `data/` - State Storage Only
```
data/*/
├── stories/          # ONLY story-*.yaml files
├── architecture/     # ONLY arch-*.yaml files
├── implementations/  # ONLY impl-*.yaml files (metadata, NOT code)
├── reviews/          # ONLY review-*.yaml, test-*.yaml files
├── provenance/       # ONLY action tracking YAML
├── session-state/    # ONLY checkpoint YAML files
├── health/           # ONLY status.yaml
├── memory/           # ONLY memory YAML files
└── ...               # ALL subdirs: YAML state files only
```

**Rules for `data/`:**
- ONLY `.yaml` files allowed
- NEVER put source code here
- NEVER put generated code here
- NEVER put test files here
- NEVER create new subdirectories for project code
- This is Dragonfly's "database" - treat it as read-only for project code

#### `.claude/` - Dragonfly Configuration Only
```
.claude/
├── concepts/         # Concept definitions (*.md)
├── agents/           # Agent definitions (*.md)
├── skills/           # Skill definitions (*.md)
├── commands/         # Command definitions (*.md)
├── synchronizations/ # Sync rules (*.yaml)
├── hooks/            # Dragonfly hooks (shell scripts)
├── prompts/          # Prompt templates (*.yaml)
├── schemas/          # JSON schemas (*.json)
├── examples/         # Example architectures (*.yaml)
├── config.yaml       # Dragonfly configuration
└── settings.local.json # Claude Code settings
```

**Rules for `.claude/`:**
- ONLY Dragonfly configuration files
- NEVER put project source code here
- NEVER put project tests here
- NEVER put project documentation here

#### `.dragonfly/` - Submodule (Read-Only)
```
.dragonfly/                 # Git submodule - DO NOT MODIFY
├── install.sh
├── templates/
├── mcp-servers/
└── docs/
```

**Rules for `.dragonfly/`:**
- NEVER modify files in this directory
- NEVER add files to this directory
- Update only via `git submodule update`
- Treat as completely read-only

---

## Project Code Placement

### Detection Strategy

Before creating files, detect the project's existing structure:

```yaml
# Step 1: Check for common root indicators
check_patterns:
  - package.json → Node.js project
  - Cargo.toml → Rust project
  - go.mod → Go project
  - pyproject.toml / setup.py → Python project
  - pom.xml / build.gradle → Java project
  - Gemfile → Ruby project
  - composer.json → PHP project

# Step 2: Identify existing source directories
source_dirs:
  - src/
  - lib/
  - app/
  - pkg/
  - internal/
  - cmd/

# Step 3: Identify existing test directories
test_dirs:
  - tests/
  - test/
  - __tests__/
  - spec/
  - *_test.go (Go convention)
  - *_test.py (Python convention)
```

### Standard Layouts by Project Type

#### Node.js / TypeScript
```
project/
├── src/              # Source code
│   ├── components/
│   ├── services/
│   ├── utils/
│   └── index.ts
├── tests/            # Test files
│   └── *.test.ts
├── dist/             # Build output (gitignored)
├── node_modules/     # Dependencies (gitignored)
├── package.json
├── tsconfig.json
├── data/             # Dragonfly state (YAML only)
├── .claude/          # Dragonfly config
└── .dragonfly/             # Dragonfly submodule
```

#### Python
```
project/
├── src/              # Or package name
│   └── mypackage/
│       ├── __init__.py
│       └── module.py
├── tests/
│   └── test_*.py
├── pyproject.toml
├── data/             # Dragonfly state (YAML only)
├── .claude/          # Dragonfly config
└── .dragonfly/             # Dragonfly submodule
```

#### Go
```
project/
├── cmd/              # Main applications
│   └── myapp/
│       └── main.go
├── internal/         # Private packages
├── pkg/              # Public packages
├── *_test.go         # Tests alongside code
├── go.mod
├── data/             # Dragonfly state (YAML only)
├── .claude/          # Dragonfly config
└── .dragonfly/             # Dragonfly submodule
```

#### Rust
```
project/
├── src/
│   ├── lib.rs
│   └── main.rs
├── tests/            # Integration tests
├── benches/          # Benchmarks
├── Cargo.toml
├── data/             # Dragonfly state (YAML only)
├── .claude/          # Dragonfly config
└── .dragonfly/             # Dragonfly submodule
```

---

## File Placement Decision Tree

When creating a new file, follow this decision tree:

```
Is it a Dragonfly state file (story, arch, impl metadata, review)?
  YES → data/{appropriate-subdir}/*.yaml
  NO  ↓

Is it Dragonfly configuration (concept, agent, skill, sync)?
  YES → .claude/{appropriate-subdir}/*
  NO  ↓

Is it source code?
  YES → Follow project's existing src/ pattern
        If no pattern exists, create src/
  NO  ↓

Is it a test file?
  YES → Follow project's existing test/ pattern
        Keep tests near code they test
  NO  ↓

Is it documentation?
  YES → docs/ (project docs) or README.md
        NEVER .claude/ or data/
  NO  ↓

Is it configuration?
  YES → Project root (package.json, tsconfig, etc.)
        NEVER data/ or .claude/
  NO  ↓

Is it a build artifact?
  YES → dist/, build/, target/ (should be gitignored)
        NEVER data/ or .claude/
```

---

## Anti-Patterns to Avoid

### 1. Code in data/
```yaml
# WRONG - Never do this
data/*/
├── implementations/
│   └── auth.ts          # NO! This is source code

# CORRECT
data/*/
├── implementations/
│   └── impl-001.yaml    # Metadata about implementation

src/
└── auth.ts              # Actual source code here
```

### 2. Project Files in .claude/
```yaml
# WRONG - Never do this
.claude/
├── components/
│   └── Button.tsx       # NO! This is project code

# CORRECT
src/
└── components/
    └── Button.tsx       # Project code in project directories
```

### 3. Generated Code in Wrong Location
```yaml
# WRONG - Generating code inside Dragonfly directories
Write file: data/implementations/oauth-controller.ts

# CORRECT - Generate in project source directory
Write file: src/controllers/oauth-controller.ts
# Then record metadata in:
Write file: data/implementations/impl-001.yaml
```

### 4. Modifying .dragonfly/ Submodule
```yaml
# WRONG - Never modify the submodule
Edit: templates/agents/story-concept.md

# CORRECT - Override in project's .claude/
Edit: .claude/agents/story-concept.md
```

### 5. Creating New Directories in data/
```yaml
# WRONG - Don't create arbitrary directories
mkdir: data/my-feature-code/

# CORRECT - Only use predefined data/ subdirectories
# If new state type needed, it should be YAML files only
```

---

## Validation Checklist

Before completing any file operation, verify:

- [ ] Source code is NOT in `data/`, `.claude/`, or `.dragonfly/`
- [ ] Test files are NOT in `data/`, `.claude/`, or `.dragonfly/`
- [ ] Only `.yaml` files are being written to `data/`
- [ ] `.dragonfly/` directory is not being modified
- [ ] New files follow project's existing structure patterns
- [ ] Generated code goes to appropriate `src/` or equivalent directory

---

## Recovery Procedures

### If Code Was Added to data/

```bash
# 1. Identify misplaced files
find data/ -type f ! -name "*.yaml" ! -name "*.md"

# 2. Move to correct location
mv data/implementations/auth.ts src/auth.ts

# 3. Update any references
# 4. Commit the fix
```

### If Code Was Added to .claude/

```bash
# 1. Identify misplaced files
find .claude/ -type f -name "*.ts" -o -name "*.py" -o -name "*.go"

# 2. Move to correct location
mv .claude/my-code.ts src/my-code.ts

# 3. Update any references
# 4. Commit the fix
```

---

## Integration with Concepts

### Architecture Concept
When designing file structure:
- Recommend directories that follow project conventions
- Never suggest placing code in Dragonfly directories
- Document intended file locations in arch-*.yaml

### Implementation Concept
When generating code:
- ALWAYS check project structure first
- Place source files in detected/standard src/ directories
- Place tests in detected/standard test/ directories
- Record metadata (not code) in data/implementations/

### Quality Concept
When reviewing:
- Verify files are in correct locations
- Flag any code in data/, .claude/, or .dragonfly/
- Check for structure anti-patterns

---

## Quick Reference Card

| File Type | Correct Location | NEVER Here |
|-----------|-----------------|------------|
| Source code | `src/`, `lib/`, `app/` | `data/`, `.claude/`, `.dragonfly/` |
| Tests | `tests/`, `test/`, `__tests__/` | `data/`, `.claude/`, `.dragonfly/` |
| Dragonfly state | `data/*/**/*.yaml` | anywhere else |
| Dragonfly config | `.claude/` | `data/`, `.dragonfly/`, `src/` |
| Documentation | `docs/`, `README.md` | `data/`, `.claude/` |
| Build artifacts | `dist/`, `build/` | `data/`, `.claude/`, `.dragonfly/` |

---

## Summary

**Golden Rule**: Dragonfly directories (`data/`, `.claude/`, `.dragonfly/`) are for Dragonfly. Project code belongs in project directories (`src/`, `tests/`, `docs/`, etc.).

When in doubt:
1. Check existing project structure
2. Follow established conventions
3. Keep Dragonfly and project code completely separate
4. Only YAML state files go in `data/`
