---
name: Cross-Project Knowledge
description: Apply learnings and patterns from other projects
version: 1.0.0
author: Dragonfly Framework
applies_to:
  - all-concepts
trigger_keywords:
  - previous project
  - learned
  - best practice
  - pattern
  - similar project
  - experience
priority: P3
impact: medium
---

# Cross-Project Knowledge Skill

## Purpose

Enable all concept agents to leverage knowledge and patterns learned from previous projects to improve decision-making and avoid repeated mistakes.

## Knowledge Categories

### 1. Architectural Patterns

```yaml
architectural_learnings:
  pattern_catalog:
    microservices:
      when_successful:
        - "Independent team ownership"
        - "Clear bounded contexts"
        - "Mature DevOps practices"
      common_pitfalls:
        - "Distributed monolith"
        - "Inconsistent data"
        - "Network complexity"
      lessons:
        - "Start with monolith, extract services"
        - "Define clear service boundaries upfront"
        - "Invest in observability early"
        
    event_driven:
      when_successful:
        - "Loose coupling needed"
        - "Async processing acceptable"
        - "Scalability requirements"
      common_pitfalls:
        - "Event ordering issues"
        - "Eventual consistency confusion"
        - "Debugging complexity"
      lessons:
        - "Design for idempotency"
        - "Implement event versioning"
        - "Build robust error handling"
        
    monolith:
      when_successful:
        - "Small team"
        - "Rapid development needed"
        - "Simple deployment"
      common_pitfalls:
        - "Tight coupling over time"
        - "Scaling limitations"
        - "Long build times"
      lessons:
        - "Maintain internal modularity"
        - "Plan extraction points"
        - "Keep dependencies explicit"
```

### 2. Technology Stack Learnings

```yaml
technology_learnings:
  frameworks:
    react:
      best_practices:
        - "Component composition over inheritance"
        - "Custom hooks for shared logic"
        - "Server components for static content"
      gotchas:
        - "Prop drilling in large apps"
        - "Effect cleanup issues"
        - "Re-render performance"
      recommendations:
        - "Use React Query for server state"
        - "Zustand/Jotai for client state"
        - "TypeScript for type safety"
        
    nextjs:
      best_practices:
        - "Use App Router for new projects"
        - "Server components by default"
        - "API routes for backend logic"
      gotchas:
        - "Hydration mismatches"
        - "Build time vs runtime data"
        - "Edge runtime limitations"
      recommendations:
        - "Plan data fetching strategy"
        - "Consider deployment platform"
        
  databases:
    postgresql:
      best_practices:
        - "Use migrations for schema changes"
        - "Index query patterns"
        - "Connection pooling"
      gotchas:
        - "N+1 queries"
        - "Lock contention"
        - "Vacuum maintenance"
      recommendations:
        - "PgBouncer for pooling"
        - "Query explain analysis"
```

### 3. Process Learnings

```yaml
process_learnings:
  estimation:
    patterns:
      - lesson: "Tasks always take longer than expected"
        adjustment: "Add 30-50% buffer"
        
      - lesson: "Integration work is underestimated"
        adjustment: "Double integration estimates"
        
      - lesson: "Testing is often forgotten"
        adjustment: "Include explicit testing time"
        
  code_review:
    patterns:
      - lesson: "Large PRs get superficial reviews"
        practice: "Keep PRs under 400 lines"
        
      - lesson: "Missing context slows reviews"
        practice: "Include PR description template"
        
      - lesson: "Review fatigue is real"
        practice: "Limit reviews per person per day"
        
  deployment:
    patterns:
      - lesson: "Friday deployments cause weekend issues"
        practice: "No deploys after Thursday"
        
      - lesson: "Big bang releases are risky"
        practice: "Feature flags for gradual rollout"
        
      - lesson: "Rollback must be tested"
        practice: "Practice rollback in staging"
```

### 4. Error Pattern Database

```yaml
error_patterns:
  common_bugs:
    off_by_one:
      description: "Array index or loop boundary errors"
      frequency: "Very common"
      prevention:
        - "Use forEach/map instead of manual indexing"
        - "Prefer inclusive ranges"
        - "Write boundary tests"
        
    null_reference:
      description: "Accessing properties of null/undefined"
      frequency: "Very common"
      prevention:
        - "Use TypeScript strict mode"
        - "Optional chaining (?.)"
        - "Nullish coalescing (??)"
        
    race_condition:
      description: "Timing-dependent bugs"
      frequency: "Common in async code"
      prevention:
        - "Use proper synchronization"
        - "Implement idempotency"
        - "Test with artificial delays"
        
    memory_leak:
      description: "Growing memory over time"
      frequency: "Common in long-running apps"
      prevention:
        - "Cleanup event listeners"
        - "Cancel subscriptions"
        - "Weak references where appropriate"
```

### 5. Performance Learnings

```yaml
performance_learnings:
  database:
    lessons:
      - problem: "Slow queries"
        solution: "Add appropriate indexes"
        impact: "10-100x improvement"
        
      - problem: "High connection count"
        solution: "Connection pooling"
        impact: "Reduced DB load"
        
      - problem: "Large data transfers"
        solution: "Pagination and field selection"
        impact: "Faster responses"
        
  frontend:
    lessons:
      - problem: "Slow initial load"
        solution: "Code splitting"
        impact: "50%+ bundle reduction"
        
      - problem: "Janky scrolling"
        solution: "Virtual lists"
        impact: "Smooth performance"
        
      - problem: "Memory growth"
        solution: "Proper cleanup in useEffect"
        impact: "Stable memory"
```

### 6. Security Learnings

```yaml
security_learnings:
  vulnerabilities_encountered:
    sql_injection:
      frequency: "Still common"
      prevention: "Parameterized queries always"
      
    xss:
      frequency: "Very common"
      prevention: "Framework escaping, CSP headers"
      
    auth_bypass:
      frequency: "Moderate"
      prevention: "Centralized auth middleware"
      
    secrets_exposure:
      frequency: "Common"
      prevention: "Environment variables, secret management"
      
  security_practices:
    - "Security review for all auth changes"
    - "Dependency scanning in CI"
    - "Regular penetration testing"
    - "Incident response plan"
```

### 7. Knowledge Application Process

```yaml
application_process:
  before_implementation:
    1. identify_similar_patterns:
       question: "Have we solved this before?"
       action: "Search knowledge base"
       
    2. check_known_pitfalls:
       question: "What typically goes wrong?"
       action: "Review error patterns"
       
    3. apply_best_practices:
       question: "What's the proven approach?"
       action: "Follow documented patterns"
       
  during_implementation:
    4. verify_against_learnings:
       question: "Are we avoiding known issues?"
       action: "Cross-check with lessons"
       
  after_implementation:
    5. document_new_learnings:
       question: "What did we learn?"
       action: "Add to knowledge base"
```

## Output Format

```yaml
knowledge_application:
  current_task: "Implement caching layer"
  
  relevant_learnings:
    from_previous_projects:
      - project: "E-commerce Platform"
        learning: "Redis connection pooling essential"
        application: "Configure pool size based on load"
        
      - project: "API Gateway"
        learning: "Cache invalidation is hard"
        application: "Use time-based expiry, not event-based"
        
    known_pitfalls:
      - "Cache stampede on expiry"
      - "Stale data in distributed cache"
      - "Memory growth with unbounded cache"
      
    recommended_approach:
      pattern: "Write-through cache with TTL"
      rationale: "Simple, predictable behavior"
      
  warnings:
    - "Don't cache user-specific data without partitioning"
    - "Monitor cache hit rates"
    - "Plan for cache failure scenarios"
```
