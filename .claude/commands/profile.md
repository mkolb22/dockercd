# /profile Command

Generate or view project profile with auto-detected characteristics.

## Usage

```
/profile                    # Generate/refresh project profile
/profile recommend <task>   # Get recommendations for a task
/profile view               # View current profile
```

## Purpose

This command invokes the project-profile concept to:
- Auto-detect languages and frameworks
- Identify architectural patterns
- Measure codebase metrics
- Enable technology-specific skills
- Optimize workflow behavior

## Process

When you run `/profile`:

1. **Scan File Extensions**
   - Count files by extension
   - Determine primary/secondary languages

2. **Analyze Package Files**
   - Read package.json, requirements.txt, Cargo.toml, etc.
   - Detect frameworks and their versions

3. **Use AST Index**
   - Get code metrics (files, lines, symbols)
   - Detect patterns (repository, DI, MVC, etc.)

4. **Identify Conventions**
   - Linting/formatting configuration
   - Naming conventions
   - Directory structure style

5. **Generate Optimizations**
   - Enable relevant skills
   - Suggest workflow adjustments
   - Override sync rules for this project

## Output Format

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Project Profile
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Languages:
  Primary:   TypeScript (65%)
  Secondary: Python (25%), YAML (10%)

Frameworks:
  Frontend:  React 18.2, TailwindCSS
  Backend:   Express 4.18
  Database:  PostgreSQL + Prisma 5.0
  Testing:   Jest 29.0

Architecture:
  Style:     Layered (feature-based directories)
  Patterns:  repository-pattern, dependency-injection

Metrics:
  Files:     234 total (189 source, 45 test)
  Lines:     45,000
  Coverage:  24% (by file count)

Quality:
  Linting:   ESLint (strict)
  Formatter: Prettier
  Types:     TypeScript (strict mode)

Enabled Skills:
  ✓ typescript-patterns
  ✓ react-best-practices
  ✓ prisma-patterns

Workflow Optimizations:
  • Skip architecture for low-complexity tasks (established patterns)
  • Enable React-specific quality checks for .tsx files

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Profile saved to: data/profile.yaml
```

## Recommendations

With `/profile recommend <task>`:

```
/profile recommend "Add user authentication"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Recommendations for: Add user authentication
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Skills to Enable:
  • typescript-patterns (project uses strict TypeScript)
  • prisma-patterns (user model likely uses Prisma)

Relevant Patterns:
  • repository-pattern
    Example: src/repositories/user.repository.ts
    Apply to: AuthRepository

Files to Reference:
  • src/features/users/user.service.ts
  • src/shared/errors/app-error.ts
  • prisma/schema.prisma

Workflow Suggestions:
  1. Use existing UserRepository pattern for AuthRepository
  2. Follow established error handling in src/shared/errors
  3. Add Prisma migration for auth tables

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Storage

Profile stored at: `data/profile.yaml`

## Integration

Profile auto-triggers on first Dragonfly install if not exists.
Profile informs:
- Task classification weights
- Architecture phase behavior
- Quality review focus areas

## WYSIWID Principle

All detection rules and optimizations are visible in:
- `.claude/concepts/project-profile.md`
- `data/profile.yaml` (actual detected values)
