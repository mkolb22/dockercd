---
name: Branch Strategy
description: Git branching strategies and workflow patterns
version: 1.0.0
author: Dragonfly Framework
applies_to:
  - version-concept
trigger_keywords:
  - branch
  - branching
  - git flow
  - trunk based
  - merge strategy
  - feature branch
priority: P3
impact: medium
---

# Branch Strategy Skill

## Purpose

Enable the Version Concept agent to recommend and implement appropriate git branching strategies based on team size and release cadence.

## Branching Strategy Framework

### 1. Strategy Comparison

```yaml
strategies_comparison:
  trunk_based:
    best_for:
      - small_teams: "1-10 developers"
      - high_deployment_frequency: "daily or more"
      - mature_ci_cd: "automated testing"
    characteristics:
      - single_main_branch
      - short_lived_feature_branches
      - feature_flags_for_incomplete_work
      
  github_flow:
    best_for:
      - medium_teams: "5-20 developers"
      - regular_deployments: "weekly"
      - web_applications: "continuous delivery"
    characteristics:
      - main_always_deployable
      - feature_branches_for_work
      - pull_request_reviews
      
  git_flow:
    best_for:
      - larger_teams: "10+ developers"
      - scheduled_releases: "monthly/quarterly"
      - multiple_versions_supported: "enterprise"
    characteristics:
      - develop_and_main_branches
      - feature_release_hotfix_branches
      - version_tags
```

### 2. Trunk-Based Development

```yaml
trunk_based:
  branch_structure:
    main:
      purpose: "Production-ready code"
      protection: "CI must pass, code review"
      
    feature/*:
      purpose: "Short-lived work branches"
      lifetime: "<2 days recommended"
      merge_to: "main"
      
  workflow:
    1_create_branch:
       from: "main"
       name: "feature/short-description"
       
    2_develop:
       commits: "Small, frequent"
       push: "Daily minimum"
       
    3_integrate:
       rebase: "Frequently from main"
       conflicts: "Resolve immediately"
       
    4_merge:
       via: "Pull request"
       method: "Squash or rebase"
       
  feature_flags:
    usage: "Hide incomplete features"
    cleanup: "Remove when feature complete"
    
  commands:
    create: |
      git checkout main
      git pull
      git checkout -b feature/add-login
      
    integrate: |
      git fetch origin
      git rebase origin/main
      
    merge: |
      # Via PR, then
      git checkout main
      git pull
      git branch -d feature/add-login
```

### 3. GitHub Flow

```yaml
github_flow:
  branch_structure:
    main:
      purpose: "Production-ready code"
      protection: "PR required, CI must pass"
      deploys_to: "production"
      
    feature/*:
      purpose: "All development work"
      naming: "feature/issue-123-description"
      merge_to: "main via PR"
      
  workflow:
    1_branch:
       action: "Create branch from main"
       command: "git checkout -b feature/issue-123-add-search"
       
    2_commit:
       action: "Add commits with clear messages"
       frequency: "As work progresses"
       
    3_push:
       action: "Push to remote"
       frequency: "At least daily"
       
    4_pull_request:
       action: "Open PR when ready for review"
       include: "Description, screenshots, tests"
       
    5_review:
       action: "Team reviews code"
       requirements: "Approval required"
       
    6_deploy:
       action: "Deploy from branch for final testing"
       environment: "Staging or preview"
       
    7_merge:
       action: "Merge to main"
       triggers: "Production deployment"
```

### 4. Git Flow

```yaml
git_flow:
  branch_structure:
    main:
      purpose: "Production releases"
      contains: "Only release-ready code"
      tagged: "Every merge is a release"
      
    develop:
      purpose: "Integration branch"
      contains: "Latest development changes"
      base_for: "feature branches"
      
    feature/*:
      purpose: "New features"
      from: "develop"
      merge_to: "develop"
      naming: "feature/feature-name"
      
    release/*:
      purpose: "Release preparation"
      from: "develop"
      merge_to: "main and develop"
      naming: "release/v1.2.0"
      
    hotfix/*:
      purpose: "Production fixes"
      from: "main"
      merge_to: "main and develop"
      naming: "hotfix/critical-fix"
      
  workflow:
    new_feature:
      commands: |
        git checkout develop
        git checkout -b feature/user-auth
        # ... work ...
        git checkout develop
        git merge --no-ff feature/user-auth
        git branch -d feature/user-auth
        
    create_release:
      commands: |
        git checkout develop
        git checkout -b release/v1.2.0
        # ... bump version, final fixes ...
        git checkout main
        git merge --no-ff release/v1.2.0
        git tag -a v1.2.0
        git checkout develop
        git merge --no-ff release/v1.2.0
        git branch -d release/v1.2.0
        
    hotfix:
      commands: |
        git checkout main
        git checkout -b hotfix/security-fix
        # ... fix ...
        git checkout main
        git merge --no-ff hotfix/security-fix
        git tag -a v1.2.1
        git checkout develop
        git merge --no-ff hotfix/security-fix
        git branch -d hotfix/security-fix
```

### 5. Branch Naming Conventions

```yaml
naming_conventions:
  prefixes:
    feature/: "New feature development"
    bugfix/: "Bug fix"
    hotfix/: "Urgent production fix"
    release/: "Release preparation"
    docs/: "Documentation only"
    refactor/: "Code refactoring"
    test/: "Test additions/fixes"
    chore/: "Build/config changes"
    
  format_options:
    with_issue:
      pattern: "{prefix}/{issue-number}-{short-description}"
      example: "feature/123-add-user-auth"
      
    without_issue:
      pattern: "{prefix}/{short-description}"
      example: "feature/add-user-auth"
      
    with_date:
      pattern: "{prefix}/{date}-{description}"
      example: "release/2024-01-15-v1.2.0"
      
  rules:
    - lowercase_only: true
    - use_hyphens: true
    - max_length: 50
    - descriptive: true
```

### 6. Merge Strategies

```yaml
merge_strategies:
  merge_commit:
    command: "git merge --no-ff"
    creates: "Merge commit preserving history"
    best_for: "Feature branches, releases"
    history: "Shows branch structure"
    
  squash:
    command: "git merge --squash"
    creates: "Single commit with all changes"
    best_for: "Small features, cleanup"
    history: "Linear, clean"
    
  rebase:
    command: "git rebase main"
    creates: "Replayed commits on top"
    best_for: "Keeping feature branch current"
    history: "Linear, preserves commits"
    
  rebase_and_merge:
    command: "git rebase main && git merge --ff"
    creates: "Fast-forward merge after rebase"
    best_for: "Clean linear history"
    
recommendation_matrix:
  trunk_based:
    preferred: "squash or rebase"
    reason: "Clean linear history"
    
  github_flow:
    preferred: "squash or merge commit"
    reason: "PR visibility in history"
    
  git_flow:
    preferred: "merge commit (--no-ff)"
    reason: "Branch structure visible"
```

### 7. Branch Protection Rules

```yaml
protection_rules:
  main:
    require_pull_request: true
    required_reviewers: 1
    require_status_checks:
      - "ci/tests"
      - "ci/lint"
      - "security/scan"
    require_up_to_date: true
    restrict_push: true
    allow_force_push: false
    
  develop:
    require_pull_request: true
    required_reviewers: 1
    require_status_checks:
      - "ci/tests"
    require_up_to_date: false
    
  release/*:
    require_pull_request: true
    required_reviewers: 2
    restrict_push: true
```

## Output Format

```yaml
branch_strategy_recommendation:
  team_context:
    size: 8
    deployment_frequency: "weekly"
    product_type: "web application"
    
  recommended_strategy: "github_flow"
  
  rationale:
    - "Team size suits simpler branching"
    - "Weekly deploys don't need release branches"
    - "Web app benefits from continuous delivery"
    
  implementation:
    branches:
      main:
        protection: "PR + CI + 1 reviewer"
        deploys: "production"
        
    feature/*:
      naming: "feature/{issue}-{description}"
      lifetime: "<1 week"
        
    merge_strategy: "squash"
    
  workflow_diagram: |
    main ─────●─────●─────●─────●─────
              ↑     ↑     ↑     ↑
    feature  ─┘    ─┘    ─┘    ─┘
```
