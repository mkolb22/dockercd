---
name: Dependency Impact Analysis
description: Analyze dependency changes for risk assessment and upgrade planning
version: 1.0.0
author: Dragonfly Framework
applies_to:
  - architecture-concept
trigger_keywords:
  - dependency
  - upgrade
  - package
  - npm update
  - security advisory
  - breaking dependency
priority: P3
impact: medium
---

# Dependency Impact Analysis Skill

## Purpose

Enable the Architecture Concept agent to analyze dependency changes, assess upgrade risks, and plan safe migration paths.

## Dependency Analysis Framework

### 1. Dependency Classification

```yaml
dependency_types:
  direct:
    description: "Explicitly declared in package manifest"
    risk_multiplier: 1.0
    
  transitive:
    description: "Pulled in by direct dependencies"
    risk_multiplier: 0.5
    note: "Lower control, but often lower exposure"
    
  peer:
    description: "Expected to be provided by consumer"
    risk_multiplier: 1.2
    note: "Version conflicts more likely"
    
  dev:
    description: "Development and build time only"
    risk_multiplier: 0.3
    note: "Doesn't affect runtime"
    
  optional:
    description: "Enhanced functionality if present"
    risk_multiplier: 0.4
```

### 2. Risk Assessment Matrix

```yaml
risk_factors:
  version_jump:
    patch: { risk: "low", score: 1 }
    minor: { risk: "medium", score: 3 }
    major: { risk: "high", score: 8 }
    
  dependency_criticality:
    core_framework: { examples: ["react", "express"], score: 10 }
    data_layer: { examples: ["prisma", "mongoose"], score: 8 }
    authentication: { examples: ["passport", "jose"], score: 9 }
    utilities: { examples: ["lodash", "date-fns"], score: 3 }
    dev_tools: { examples: ["eslint", "prettier"], score: 1 }
    
  api_surface:
    large: { description: ">20 imports", score: 5 }
    medium: { description: "5-20 imports", score: 3 }
    small: { description: "<5 imports", score: 1 }
    
  changelog_indicators:
    breaking_changes_listed: { score: 5 }
    migration_guide_exists: { score: -2 }  # reduces risk
    security_fixes: { score: 3, action: "prioritize" }
```

### 3. Impact Analysis Process

```yaml
analysis_steps:
  1_identify_changes:
    action: "Compare current vs target versions"
    output: "List of changed packages with version diff"
    
  2_analyze_changelog:
    action: "Parse CHANGELOG/release notes"
    extract:
      - breaking_changes
      - deprecations
      - new_features
      - security_fixes
      
  3_map_usage:
    action: "Find all imports/usages in codebase"
    output: "Files and functions using each dependency"
    
  4_assess_compatibility:
    action: "Check for breaking changes affecting usage"
    output: "Required code changes"
    
  5_calculate_risk:
    action: "Score based on risk matrix"
    output: "Risk score and recommendation"
```

### 4. Upgrade Strategy Templates

```yaml
upgrade_strategies:
  safe_upgrade:
    criteria:
      - patch_version_only: true
      - no_breaking_changes: true
      - security_score: "green"
    process:
      1. update_lockfile: "npm update <package>"
      2. run_tests: "npm test"
      3. commit: "chore(deps): update <package>"
      
  careful_upgrade:
    criteria:
      - minor_version: true
      - breaking_changes: false
      - deprecations: "possible"
    process:
      1. review_changelog: "Check for deprecations"
      2. update_package: "npm install <package>@latest"
      3. run_tests: "Full test suite"
      4. check_deprecation_warnings: "Review console output"
      5. address_deprecations: "Update deprecated usage"
      6. commit: "chore(deps): upgrade <package> to <version>"
      
  major_upgrade:
    criteria:
      - major_version: true
    process:
      1. create_branch: "deps/upgrade-<package>-v<version>"
      2. review_migration_guide: "Read official docs"
      3. update_package: "npm install <package>@<version>"
      4. fix_breaking_changes: "Systematic updates"
      5. update_tests: "Adapt to new API"
      6. run_full_suite: "All tests + manual testing"
      7. pr_review: "Code review required"
```

### 5. Security Analysis

```yaml
security_assessment:
  vulnerability_sources:
    - npm_audit
    - snyk
    - github_advisories
    - nvd
    
  severity_mapping:
    critical:
      action: "Immediate update required"
      sla: "24 hours"
    high:
      action: "Update this sprint"
      sla: "1 week"
    medium:
      action: "Plan update"
      sla: "1 month"
    low:
      action: "Address opportunistically"
      sla: "next major update"
      
  mitigation_options:
    patch_available:
      preference: 1
      action: "Update to patched version"
    workaround_available:
      preference: 2
      action: "Apply workaround, plan update"
    no_fix:
      preference: 3
      options:
        - "Replace dependency"
        - "Accept risk with documentation"
        - "Implement protective measures"
```

### 6. Dependency Health Metrics

```yaml
health_indicators:
  maintenance:
    last_release: { healthy: "<6 months", warning: "6-12 months", stale: ">12 months" }
    open_issues_ratio: { healthy: "<20%", warning: "20-40%", concerning: ">40%" }
    pr_response_time: { healthy: "<7 days", warning: "7-30 days", slow: ">30 days" }
    
  popularity:
    weekly_downloads: { metric: "npm downloads" }
    github_stars: { metric: "community interest" }
    dependent_packages: { metric: "ecosystem adoption" }
    
  quality:
    test_coverage: { if_available: true }
    type_definitions: { typescript: true }
    documentation: { readme: true, api_docs: true }
    
  security:
    known_vulnerabilities: { count: 0 }
    security_policy: { exists: true }
    audit_history: { clean: true }
```

## Output Format

```yaml
dependency_impact_report:
  summary:
    packages_analyzed: 15
    upgrades_recommended: 8
    breaking_changes: 2
    security_fixes: 3
    
  upgrades:
    safe:
      - package: "lodash"
        current: "4.17.20"
        target: "4.17.21"
        risk: "low"
        action: "Auto-update"
        
    careful:
      - package: "axios"
        current: "0.21.0"
        target: "0.27.0"
        risk: "medium"
        changes:
          - "New request cancellation API"
          - "Deprecated: CancelToken"
        affected_files: 5
        action: "Review deprecation warnings"
        
    major:
      - package: "react"
        current: "17.0.0"
        target: "18.0.0"
        risk: "high"
        breaking_changes:
          - "Automatic batching"
          - "Strict mode changes"
          - "New root API"
        migration_guide: "https://react.dev/blog/2022/03/08/react-18-upgrade-guide"
        estimated_effort: "2-3 days"
        affected_files: 45
        
  security:
    - package: "json5"
      vulnerability: "CVE-2022-46175"
      severity: "high"
      fixed_in: "2.2.2"
      action: "Update immediately"
```
