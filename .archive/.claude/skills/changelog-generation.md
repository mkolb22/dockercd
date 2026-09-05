---
name: Changelog Generation
description: Automatically generate structured changelogs from commits and semantic versioning
version: 1.0.0
author: Zen Framework
applies_to:
  - version-concept
trigger_keywords:
  - changelog
  - release notes
  - version history
  - what's new
  - release
priority: P1
impact: high
---

# Changelog Generation Skill

## Purpose

Enable the Version Concept agent to automatically generate well-structured, user-friendly changelogs from git history, following conventional commit standards and semantic versioning.

## Commit Analysis Framework

### 1. Conventional Commit Parsing

```yaml
commit_types:
  feat:
    label: "Features"
    emoji: "✨"
    semver_bump: "minor"
    include_in_changelog: true
    
  fix:
    label: "Bug Fixes"
    emoji: "🐛"
    semver_bump: "patch"
    include_in_changelog: true
    
  docs:
    label: "Documentation"
    emoji: "📚"
    semver_bump: "none"
    include_in_changelog: true
    
  style:
    label: "Styles"
    emoji: "💄"
    semver_bump: "none"
    include_in_changelog: false
    
  refactor:
    label: "Code Refactoring"
    emoji: "♻️"
    semver_bump: "none"
    include_in_changelog: true
    
  perf:
    label: "Performance Improvements"
    emoji: "⚡"
    semver_bump: "patch"
    include_in_changelog: true
    
  test:
    label: "Tests"
    emoji: "✅"
    semver_bump: "none"
    include_in_changelog: false
    
  build:
    label: "Build System"
    emoji: "📦"
    semver_bump: "none"
    include_in_changelog: false
    
  ci:
    label: "CI/CD"
    emoji: "👷"
    semver_bump: "none"
    include_in_changelog: false
    
  chore:
    label: "Chores"
    emoji: "🔧"
    semver_bump: "none"
    include_in_changelog: false
    
  revert:
    label: "Reverts"
    emoji: "⏪"
    semver_bump: "patch"
    include_in_changelog: true

breaking_change:
  indicators:
    - "BREAKING CHANGE:" in body
    - "!" after type (e.g., "feat!:")
  semver_bump: "major"
  label: "⚠️ BREAKING CHANGES"
```

### 2. Commit Parsing Regex

```javascript
const COMMIT_PATTERN = /^(?<type>\w+)(?:\((?<scope>[^)]+)\))?(?<breaking>!)?: (?<subject>.+)$/;

// Examples:
// feat(auth): add OAuth2 support
// fix: resolve memory leak in parser
// feat!: redesign API response format
// docs(readme): update installation instructions
```

### 3. Changelog Entry Structure

```yaml
changelog_entry:
  version: "2.1.0"
  date: "2024-01-15"
  
  sections:
    breaking_changes:
      - scope: "api"
        description: "Response format changed from XML to JSON"
        migration: "Update all API consumers to parse JSON"
        commit: "abc1234"
        
    features:
      - scope: "auth"
        description: "Add OAuth2 authentication support"
        commit: "def5678"
        pr: "#123"
        
    bug_fixes:
      - scope: "parser"
        description: "Fix memory leak when processing large files"
        commit: "ghi9012"
        issue: "#456"
        
    performance:
      - scope: "database"
        description: "Optimize query performance by 40%"
        commit: "jkl3456"
        
    documentation:
      - scope: null
        description: "Add API reference documentation"
        commit: "mno7890"
```

### 4. Changelog Formats

#### Keep a Changelog Format (Recommended)

```markdown
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- New feature description

### Changed
- Change description

### Deprecated
- Deprecation notice

### Removed
- Removal notice

### Fixed
- Bug fix description

### Security
- Security fix description

## [2.1.0] - 2024-01-15

### Added
- OAuth2 authentication support (#123)
- Batch processing for large datasets

### Fixed
- Memory leak in file parser (#456)
- Incorrect date formatting in reports

## [2.0.0] - 2024-01-01

### ⚠️ BREAKING CHANGES
- API response format changed from XML to JSON
  - **Migration**: Update all API consumers to parse JSON responses

### Added
- New REST API v2

[Unreleased]: https://github.com/user/repo/compare/v2.1.0...HEAD
[2.1.0]: https://github.com/user/repo/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/user/repo/releases/tag/v2.0.0
```

#### Compact Format

```markdown
## v2.1.0 (2024-01-15)

✨ **Features**
- OAuth2 authentication support
- Batch processing for large datasets

🐛 **Bug Fixes**
- Memory leak in file parser
- Incorrect date formatting in reports
```

#### JSON Format (for automation)

```json
{
  "version": "2.1.0",
  "date": "2024-01-15",
  "changes": {
    "features": [
      {
        "description": "OAuth2 authentication support",
        "scope": "auth",
        "pr": 123
      }
    ],
    "fixes": [
      {
        "description": "Memory leak in file parser",
        "scope": "parser",
        "issue": 456
      }
    ]
  }
}
```

### 5. Version Determination

```yaml
version_bump_rules:
  major:
    triggers:
      - breaking_change_detected
      - "BREAKING CHANGE" in any commit
    example: "1.2.3 → 2.0.0"
    
  minor:
    triggers:
      - feat_commit_present
      - new_functionality_added
    example: "1.2.3 → 1.3.0"
    
  patch:
    triggers:
      - fix_commit_present
      - perf_commit_present
      - no_feat_or_breaking
    example: "1.2.3 → 1.2.4"

pre_release_handling:
  alpha: "1.0.0-alpha.1"
  beta: "1.0.0-beta.1"
  rc: "1.0.0-rc.1"
  increment: "1.0.0-alpha.1 → 1.0.0-alpha.2"
```

### 6. Scope Grouping

```yaml
scope_groups:
  frontend:
    scopes: [ui, components, styles, a11y]
    label: "Frontend"
    
  backend:
    scopes: [api, server, database, auth]
    label: "Backend"
    
  infrastructure:
    scopes: [ci, docker, k8s, terraform]
    label: "Infrastructure"
    
  documentation:
    scopes: [docs, readme, api-docs]
    label: "Documentation"
```

### 7. Generation Commands

```yaml
generation_options:
  range:
    from_tag: "v2.0.0"
    to_ref: "HEAD"
    # or
    from_date: "2024-01-01"
    to_date: "2024-01-31"
    
  filters:
    include_types: [feat, fix, perf, docs]
    exclude_scopes: [internal, wip]
    exclude_authors: [dependabot, renovate]
    
  output:
    format: "markdown|json|html"
    file: "CHANGELOG.md"
    mode: "prepend|replace|stdout"
    
  enrichment:
    link_issues: true
    link_prs: true
    link_commits: true
    include_authors: false
    include_stats: false  # lines changed
```

### 8. Quality Checks

```yaml
changelog_quality:
  required:
    - version_number_present
    - date_present
    - at_least_one_change
    
  recommended:
    - breaking_changes_highlighted
    - migration_guide_for_breaking
    - links_to_issues_prs
    - grouped_by_type
    
  warnings:
    - commit_without_type: "Some commits don't follow conventional format"
    - scope_inconsistency: "Scope 'auth' and 'authentication' both used"
    - missing_description: "Commit abc123 has no meaningful description"
```

## Output Examples

### Command Output

```
$ zen changelog generate --from v2.0.0

Analyzing 47 commits from v2.0.0 to HEAD...

Version bump: 2.0.0 → 2.1.0 (minor)
Reason: New features detected, no breaking changes

Changes detected:
  ✨ Features: 5
  🐛 Bug Fixes: 12
  ⚡ Performance: 2
  📚 Documentation: 3
  
  ⚠️ Warnings:
  - 8 commits don't follow conventional commit format
  - Scope inconsistency: 'auth' vs 'authentication'

Generated CHANGELOG.md entry (prepended to existing file)
```

### Integration with Release Process

```yaml
release_workflow:
  steps:
    1. generate_changelog:
       command: "zen changelog generate --from last-tag"
       
    2. review_changelog:
       action: "human review or automated check"
       
    3. update_version:
       files:
         - package.json
         - version.py
         - Cargo.toml
         
    4. commit_release:
       message: "chore(release): v{version}"
       
    5. create_tag:
       name: "v{version}"
       annotated: true
       message: "Release {version}"
       
    6. create_github_release:
       title: "v{version}"
       body: "{changelog_entry}"
       draft: false
```
