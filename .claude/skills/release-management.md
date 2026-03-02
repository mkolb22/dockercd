---
name: Release Management
description: Release planning, coordination, and deployment strategies
version: 1.0.0
author: Zen Framework
applies_to:
  - version-concept
trigger_keywords:
  - release
  - deploy
  - rollout
  - production
  - launch
  - go live
priority: P3
impact: medium
---

# Release Management Skill

## Purpose

Enable the Version Concept agent to plan and coordinate releases with proper versioning, deployment strategies, and rollback procedures.

## Release Planning Framework

### 1. Release Types

```yaml
release_types:
  major_release:
    version_bump: "major"
    characteristics:
      - breaking_changes
      - significant_new_features
      - architecture_changes
    preparation:
      - migration_guide
      - deprecation_notices
      - extended_testing
    communication: "advance notice required"
    
  minor_release:
    version_bump: "minor"
    characteristics:
      - new_features
      - backwards_compatible
      - deprecations_introduced
    preparation:
      - feature_documentation
      - upgrade_guide
    communication: "standard release notes"
    
  patch_release:
    version_bump: "patch"
    characteristics:
      - bug_fixes
      - security_patches
      - no_new_features
    preparation:
      - minimal_testing
      - fix_verification
    communication: "changelog entry"
    
  hotfix:
    version_bump: "patch"
    characteristics:
      - critical_fix
      - minimal_scope
      - expedited_process
    preparation:
      - targeted_testing
      - rollback_ready
    communication: "incident communication"
```

### 2. Release Checklist

```yaml
release_checklist:
  pre_release:
    code_quality:
      - [ ] All tests passing
      - [ ] Code review completed
      - [ ] No critical security vulnerabilities
      - [ ] Performance benchmarks met
      
    documentation:
      - [ ] CHANGELOG updated
      - [ ] API documentation current
      - [ ] Migration guide (if needed)
      - [ ] Release notes drafted
      
    versioning:
      - [ ] Version number updated
      - [ ] Git tag created
      - [ ] Dependencies locked
      
    environment:
      - [ ] Staging deployment successful
      - [ ] Smoke tests passed
      - [ ] Database migrations tested
      
  release:
    deployment:
      - [ ] Production deployment executed
      - [ ] Health checks passing
      - [ ] Monitoring active
      - [ ] Rollback procedure verified
      
    communication:
      - [ ] Team notified
      - [ ] Stakeholders informed
      - [ ] Release notes published
      
  post_release:
    verification:
      - [ ] Production smoke tests
      - [ ] Key metrics stable
      - [ ] No error rate spike
      - [ ] User feedback monitored
```

### 3. Deployment Strategies

```yaml
deployment_strategies:
  rolling_deployment:
    description: "Gradual replacement of instances"
    process:
      1. deploy_to_subset: "Start with % of instances"
      2. verify_health: "Check metrics"
      3. continue_rollout: "Deploy to more instances"
      4. complete: "All instances updated"
    pros: ["No downtime", "Gradual risk"]
    cons: ["Mixed versions temporarily"]
    
  blue_green:
    description: "Two identical environments"
    process:
      1. prepare_green: "Deploy new version to green"
      2. test_green: "Verify green environment"
      3. switch_traffic: "Route all traffic to green"
      4. standby_blue: "Blue becomes standby"
    pros: ["Instant rollback", "No mixed versions"]
    cons: ["Double infrastructure cost"]
    
  canary:
    description: "Small percentage gets new version"
    process:
      1. deploy_canary: "Deploy to 1-5% of users"
      2. monitor: "Watch metrics closely"
      3. expand: "Gradually increase percentage"
      4. complete: "100% on new version"
    pros: ["Minimal risk", "Real user feedback"]
    cons: ["Complex routing", "Slower rollout"]
    
  feature_flags:
    description: "Code deployed, features toggled"
    process:
      1. deploy_code: "Ship with flag off"
      2. enable_percentage: "Enable for subset"
      3. expand: "Increase enabled percentage"
      4. cleanup: "Remove flag when stable"
    pros: ["Decouple deploy from release", "Easy rollback"]
    cons: ["Technical debt if not cleaned up"]
```

### 4. Rollback Procedures

```yaml
rollback_triggers:
  automatic:
    - error_rate_spike: ">5% increase"
    - response_time_degradation: ">50% slower"
    - health_check_failure: "consecutive failures"
    
  manual:
    - user_reported_issues: "Critical bugs"
    - business_decision: "Stakeholder request"
    - security_vulnerability: "Discovered post-deploy"

rollback_procedures:
  immediate:
    action: "Revert to previous version"
    commands:
      kubernetes: "kubectl rollout undo deployment/app"
      docker: "docker-compose up -d --force-recreate app:previous"
      heroku: "heroku releases:rollback"
    time_target: "<5 minutes"
    
  database_considerations:
    backward_compatible:
      action: "Rollback application only"
    backward_incompatible:
      action: "Rollback migrations first"
      warning: "Data loss possible"
```

### 5. Release Communication

```yaml
communication_templates:
  internal_announcement:
    template: |
      ## Release {version} - {date}
      
      ### Summary
      {brief_description}
      
      ### Key Changes
      {bulleted_list_of_changes}
      
      ### Impact
      {who_is_affected}
      
      ### Action Required
      {any_required_actions}
      
  external_release_notes:
    template: |
      # {Product} {version}
      
      ## What's New
      {new_features}
      
      ## Improvements
      {enhancements}
      
      ## Bug Fixes
      {fixes}
      
      ## Breaking Changes
      {if_any}
      
      ## Upgrade Guide
      {migration_steps}
      
  incident_communication:
    template: |
      ## Incident: {title}
      
      **Status**: {investigating|identified|resolved}
      **Impact**: {description_of_impact}
      **Start Time**: {timestamp}
      
      ### Updates
      {chronological_updates}
      
      ### Resolution
      {how_it_was_fixed}
      
      ### Next Steps
      {preventive_measures}
```

### 6. Release Automation

```yaml
ci_cd_integration:
  release_workflow:
    trigger: "tag push matching v*"
    steps:
      1. build:
         action: "Build production artifacts"
         
      2. test:
         action: "Run full test suite"
         
      3. security_scan:
         action: "Run security checks"
         
      4. deploy_staging:
         action: "Deploy to staging"
         
      5. smoke_tests:
         action: "Run smoke tests"
         
      6. approval_gate:
         action: "Manual approval for production"
         
      7. deploy_production:
         action: "Deploy to production"
         strategy: "canary"
         
      8. notify:
         action: "Send release notifications"

github_release_action:
  script: |
    - name: Create Release
      uses: actions/create-release@v1
      with:
        tag_name: ${{ github.ref }}
        release_name: Release ${{ github.ref }}
        body: |
          ${{ steps.changelog.outputs.content }}
        draft: false
        prerelease: false
```

### 7. Release Metrics

```yaml
release_metrics:
  deployment_frequency:
    description: "How often releases happen"
    elite: "Multiple times per day"
    high: "Weekly"
    medium: "Monthly"
    low: "Less than monthly"
    
  lead_time:
    description: "Commit to production"
    elite: "<1 hour"
    high: "<1 day"
    medium: "<1 week"
    low: ">1 month"
    
  change_failure_rate:
    description: "% of deployments causing failures"
    elite: "<5%"
    high: "<10%"
    medium: "<15%"
    low: ">15%"
    
  mean_time_to_recovery:
    description: "Time to recover from failure"
    elite: "<1 hour"
    high: "<1 day"
    medium: "<1 week"
    low: ">1 week"
```

## Output Format

```yaml
release_plan:
  version: "2.1.0"
  type: "minor"
  scheduled_date: "2024-01-20"
  
  scope:
    features:
      - "US-100: User dashboard redesign"
      - "US-101: Export functionality"
    fixes:
      - "BUG-200: Login timeout issue"
      
  deployment:
    strategy: "canary"
    stages:
      - percentage: 5
        duration: "30 minutes"
        metrics_to_watch: ["error_rate", "response_time"]
      - percentage: 25
        duration: "2 hours"
      - percentage: 100
        
  rollback:
    trigger_conditions:
      - "Error rate > 2%"
      - "P95 latency > 500ms"
    procedure: "kubectl rollout undo"
    
  communication:
    internal: "Slack #releases"
    external: "Blog post + email"
    
  checklist_status:
    pre_release: "8/8 complete"
    ready_for_deployment: true
```
