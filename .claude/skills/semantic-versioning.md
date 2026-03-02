---
name: Semantic Versioning
description: Intelligent version bump determination based on change analysis
version: 1.0.0
author: Zen Framework
applies_to:
  - version-concept
trigger_keywords:
  - version
  - semver
  - major
  - minor
  - patch
  - release version
  - bump
priority: P2
impact: high
---

# Semantic Versioning Skill

## Purpose

Enable the Version Concept agent to intelligently determine appropriate version bumps based on change analysis, conventional commits, and API compatibility assessment.

## SemVer Rules

### 1. Version Format

```yaml
format: "MAJOR.MINOR.PATCH[-PRERELEASE][+BUILD]"

components:
  MAJOR:
    description: "Incompatible API changes"
    increment_when:
      - breaking_change_detected
      - api_removed
      - api_signature_changed_incompatibly
      - behavior_changed_unexpectedly
    example: "1.2.3 → 2.0.0"
    
  MINOR:
    description: "Backwards-compatible new features"
    increment_when:
      - new_feature_added
      - new_api_endpoint
      - new_optional_parameter
      - deprecation_added  # still works, but warned
    example: "1.2.3 → 1.3.0"
    resets: "PATCH to 0"
    
  PATCH:
    description: "Backwards-compatible bug fixes"
    increment_when:
      - bug_fixed
      - security_patch
      - documentation_fix
      - performance_improvement
    example: "1.2.3 → 1.2.4"
    
  PRERELEASE:
    description: "Pre-release version identifiers"
    formats:
      alpha: "1.0.0-alpha.1"
      beta: "1.0.0-beta.1"
      rc: "1.0.0-rc.1"
    precedence: "alpha < beta < rc < release"
    
  BUILD:
    description: "Build metadata (ignored in precedence)"
    example: "1.0.0+20240115.sha.abc123"
```

### 2. Breaking Change Detection

```yaml
breaking_changes:
  api_changes:
    removal:
      - public_function_removed
      - public_class_removed
      - public_method_removed
      - api_endpoint_removed
      - required_field_removed
      
    signature_changes:
      - parameter_added_required
      - parameter_removed
      - parameter_type_changed
      - return_type_changed
      - exception_type_changed
      
    behavior_changes:
      - default_value_changed
      - validation_rules_stricter
      - error_conditions_changed
      - side_effects_changed
      
  configuration_changes:
    - config_option_removed
    - config_default_changed
    - config_format_changed
    - environment_variable_renamed
    
  data_changes:
    - database_schema_incompatible
    - serialization_format_changed
    - api_response_structure_changed
```

### 3. Change Analysis Algorithm

```python
def analyze_version_bump(commits, current_version):
    """
    Analyze commits to determine appropriate version bump.
    """
    bump = 'none'
    reasons = []
    
    for commit in commits:
        # Parse conventional commit
        parsed = parse_conventional_commit(commit.message)
        
        # Check for breaking changes
        if parsed.breaking or 'BREAKING CHANGE' in commit.body:
            bump = 'major'
            reasons.append({
                'type': 'breaking',
                'commit': commit.sha,
                'description': parsed.subject
            })
            continue
            
        # Check commit type
        if parsed.type == 'feat':
            if bump != 'major':
                bump = 'minor'
            reasons.append({
                'type': 'feature',
                'commit': commit.sha,
                'description': parsed.subject
            })
            
        elif parsed.type in ['fix', 'perf']:
            if bump == 'none':
                bump = 'patch'
            reasons.append({
                'type': parsed.type,
                'commit': commit.sha,
                'description': parsed.subject
            })
    
    new_version = calculate_new_version(current_version, bump)
    
    return {
        'current': current_version,
        'bump_type': bump,
        'new_version': new_version,
        'reasons': reasons
    }
```

### 4. API Diff Analysis

```yaml
api_diff_detection:
  typescript:
    tools:
      - api-extractor
      - ts-api-utils
    detect:
      - exported_symbols_changed
      - type_signatures_changed
      - interface_members_changed
      
  openapi:
    tools:
      - openapi-diff
      - oasdiff
    detect:
      - endpoint_removed
      - parameter_changed
      - response_schema_changed
      
  database:
    tools:
      - sqldiff
      - prisma-diff
    detect:
      - column_removed
      - type_changed
      - constraint_changed
```

### 5. Version Bump Decision Matrix

```yaml
decision_matrix:
  inputs:
    - commit_types: [feat, fix, docs, etc.]
    - breaking_changes: boolean
    - api_diff_result: {added, modified, removed}
    - deprecations: boolean
    
  rules:
    - condition: "breaking_changes OR api_removed"
      bump: "major"
      confidence: "high"
      
    - condition: "feat commits AND NOT breaking"
      bump: "minor"
      confidence: "high"
      
    - condition: "only fix/perf commits"
      bump: "patch"
      confidence: "high"
      
    - condition: "only docs/chore/ci commits"
      bump: "none"
      confidence: "high"
      
    - condition: "unclear from commits, api_modified"
      bump: "review_required"
      confidence: "low"
      suggestion: "Manual review of API changes needed"
```

### 6. Pre-release Management

```yaml
prerelease_workflow:
  stages:
    alpha:
      description: "Early testing, unstable"
      audience: "internal testers"
      npm_tag: "alpha"
      
    beta:
      description: "Feature complete, may have bugs"
      audience: "early adopters"
      npm_tag: "beta"
      
    rc:
      description: "Release candidate, final testing"
      audience: "broader testing"
      npm_tag: "rc"

  increment_rules:
    same_stage: "1.0.0-alpha.1 → 1.0.0-alpha.2"
    next_stage: "1.0.0-alpha.5 → 1.0.0-beta.1"
    to_release: "1.0.0-rc.3 → 1.0.0"
    
  graduation_criteria:
    alpha_to_beta:
      - core_features_complete
      - critical_bugs_fixed
      - internal_testing_passed
      
    beta_to_rc:
      - all_features_complete
      - no_known_major_bugs
      - documentation_complete
      
    rc_to_release:
      - no_blocking_issues
      - stakeholder_approval
      - deployment_tested
```

### 7. Version Constraints

```yaml
version_constraints:
  0.x.y:
    description: "Initial development"
    rules:
      - "Anything may change"
      - "Minor = breaking changes allowed"
      - "Patch = all other changes"
    example: "0.1.0 → 0.2.0 (breaking OK)"
    
  1.0.0_plus:
    description: "Public API declared"
    rules:
      - "Must follow strict semver"
      - "Breaking changes = major bump"
    example: "1.0.0 → 2.0.0 (breaking)"
    
  range_specifications:
    caret: "^1.2.3 → >=1.2.3 <2.0.0"
    tilde: "~1.2.3 → >=1.2.3 <1.3.0"
    exact: "1.2.3 → exactly 1.2.3"
```

### 8. Multi-Package Versioning

```yaml
monorepo_strategies:
  independent:
    description: "Each package versioned separately"
    pros: "Fine-grained control"
    cons: "Complex dependency management"
    tools: ["lerna independent", "changesets"]
    
  fixed:
    description: "All packages share same version"
    pros: "Simple, clear compatibility"
    cons: "Bumps all for any change"
    tools: ["lerna fixed"]
    
  synchronized:
    description: "Related packages bump together"
    pros: "Balance of control and simplicity"
    implementation:
      groups:
        core: ["@org/core", "@org/types"]
        plugins: ["@org/plugin-*"]
      rules:
        - "Core group bumps together"
        - "Plugins version independently"
```

## Output Format

When determining version bump:

```yaml
version_analysis:
  current_version: "1.2.3"
  
  analysis:
    commits_analyzed: 15
    date_range: "2024-01-01 to 2024-01-15"
    
    changes_detected:
      features: 3
      fixes: 8
      breaking: 0
      documentation: 4
      
    api_compatibility:
      status: "compatible"
      additions: ["newEndpoint", "newParameter"]
      modifications: []
      removals: []
      
  recommendation:
    bump_type: "minor"
    new_version: "1.3.0"
    confidence: "high"
    
    rationale:
      - "3 new features detected (feat commits)"
      - "No breaking changes"
      - "API additions are backwards-compatible"
      
  affected_files:
    - package.json
    - version.py
    - CHANGELOG.md
    
  command: "npm version minor"
```

## Integration Points

- **Changelog Generation**: Use version bump to structure changelog
- **Conventional Commits**: Parse commits for change classification
- **CI/CD**: Automated version bumping in pipelines
