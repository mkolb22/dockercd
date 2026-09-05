---
name: Effort Estimation
description: Estimate implementation effort using multiple estimation techniques
version: 1.0.0
author: Dragonfly Framework
applies_to:
  - story-concept
trigger_keywords:
  - estimate
  - effort
  - time
  - story points
  - how long
  - complexity
priority: P3
impact: medium
---

# Effort Estimation Skill

## Purpose

Enable the Story Concept agent to provide accurate effort estimates using multiple estimation techniques while accounting for uncertainty and risk factors.

## Estimation Framework

### 1. Story Point Scale

```yaml
fibonacci_scale:
  1:
    description: "Trivial"
    characteristics:
      - single_file_change
      - well_understood
      - no_dependencies
      - minutes_to_implement
    examples:
      - "Fix typo in error message"
      - "Update configuration value"
      
  2:
    description: "Simple"
    characteristics:
      - few_files
      - clear_approach
      - minimal_testing
      - hour_or_less
    examples:
      - "Add validation for email field"
      - "Create simple utility function"
      
  3:
    description: "Small"
    characteristics:
      - moderate_complexity
      - some_unknowns
      - standard_testing
      - half_day
    examples:
      - "Add new API endpoint"
      - "Implement form component"
      
  5:
    description: "Medium"
    characteristics:
      - multiple_components
      - integration_required
      - thorough_testing
      - full_day
    examples:
      - "Add authentication flow"
      - "Implement search feature"
      
  8:
    description: "Large"
    characteristics:
      - complex_logic
      - multiple_integrations
      - extensive_testing
      - multiple_days
    examples:
      - "Build payment processing"
      - "Implement real-time notifications"
      
  13:
    description: "Very Large"
    characteristics:
      - high_complexity
      - significant_unknowns
      - should_consider_splitting
      - week_plus
    examples:
      - "Major refactoring"
      - "New feature area"
    recommendation: "Consider breaking down"
    
  21:
    description: "Epic"
    characteristics:
      - too_large_to_estimate
      - must_be_broken_down
    action: "Decompose into smaller stories"
```

### 2. T-Shirt Sizing

```yaml
tshirt_sizes:
  XS:
    story_points: 1
    ideal_hours: "1-2"
    description: "Quick fix, single change"
    
  S:
    story_points: 2-3
    ideal_hours: "2-4"
    description: "Simple feature, well-defined"
    
  M:
    story_points: 5
    ideal_hours: "4-8"
    description: "Standard feature, some complexity"
    
  L:
    story_points: 8
    ideal_hours: "8-16"
    description: "Complex feature, multiple components"
    
  XL:
    story_points: 13
    ideal_hours: "16-32"
    description: "Large feature, consider splitting"
    
  XXL:
    story_points: 21+
    ideal_hours: "32+"
    description: "Too large, must decompose"
```

### 3. Complexity Factors

```yaml
complexity_dimensions:
  technical_complexity:
    low:
      indicators: ["CRUD operations", "simple logic", "no integrations"]
      multiplier: 1.0
    medium:
      indicators: ["some algorithms", "few integrations", "moderate state"]
      multiplier: 1.5
    high:
      indicators: ["complex algorithms", "multiple integrations", "distributed"]
      multiplier: 2.5
      
  domain_complexity:
    low:
      indicators: ["well-understood domain", "clear requirements"]
      multiplier: 1.0
    medium:
      indicators: ["some domain learning", "some ambiguity"]
      multiplier: 1.3
    high:
      indicators: ["new domain", "complex rules", "regulatory"]
      multiplier: 2.0
      
  uncertainty:
    low:
      indicators: ["done before", "clear path", "stable requirements"]
      multiplier: 1.0
    medium:
      indicators: ["some unknowns", "new technology", "evolving requirements"]
      multiplier: 1.5
    high:
      indicators: ["research needed", "new architecture", "fluid requirements"]
      multiplier: 2.5
```

### 4. Three-Point Estimation

```yaml
three_point_estimation:
  optimistic: "Best case, everything goes perfectly"
  most_likely: "Normal conditions, typical obstacles"
  pessimistic: "Worst case, significant problems"
  
  calculation:
    pert: "(O + 4*M + P) / 6"
    standard_deviation: "(P - O) / 6"
    
  example:
    task: "Implement user registration"
    optimistic: 4  # hours
    most_likely: 8
    pessimistic: 20
    pert_estimate: 9.3  # (4 + 32 + 20) / 6
    std_dev: 2.7  # (20 - 4) / 6
    confidence_range: "7-12 hours (68% confidence)"
```

### 5. Effort Breakdown Template

```yaml
effort_breakdown:
  development:
    coding: "40%"
    unit_testing: "20%"
    integration_testing: "10%"
    
  overhead:
    code_review: "10%"
    documentation: "5%"
    deployment: "5%"
    
  buffer:
    standard: "10%"
    risky: "20%"
    unknown: "30%"

example_calculation:
  raw_coding_estimate: 8  # hours
  with_testing: 12  # 8 * 1.5
  with_overhead: 14.4  # 12 * 1.2
  with_buffer: 15.8  # 14.4 * 1.1
  final_estimate: 16  # rounded
```

### 6. Risk Adjustment Factors

```yaml
risk_factors:
  technology_risk:
    new_framework: 1.3
    new_language: 1.5
    poc_required: 1.8
    
  dependency_risk:
    waiting_on_team: 1.2
    external_api: 1.3
    third_party_unknown: 1.5
    
  requirement_risk:
    clear_requirements: 1.0
    some_ambiguity: 1.2
    significant_uncertainty: 1.5
    
  experience_risk:
    team_experienced: 1.0
    moderate_experience: 1.2
    new_to_domain: 1.5
```

### 7. Historical Calibration

```yaml
calibration_approach:
  track_actual_vs_estimated:
    - story_id: "US-100"
      estimated: 5
      actual: 8
      ratio: 1.6
      
  calculate_velocity:
    sprint_1: 21
    sprint_2: 18
    sprint_3: 24
    average: 21
    
  adjustment_factor:
    if_consistently_underestimating: "multiply by ratio"
    if_consistently_overestimating: "divide by ratio"
    
  confidence_building:
    after_3_sprints: "Low confidence"
    after_6_sprints: "Medium confidence"
    after_10_sprints: "High confidence"
```

### 8. Estimation Anti-Patterns

```yaml
anti_patterns:
  student_syndrome:
    description: "Starting late despite buffer"
    mitigation: "Break into smaller deliverables"
    
  parkinsons_law:
    description: "Work expands to fill time"
    mitigation: "Aggressive but realistic deadlines"
    
  planning_fallacy:
    description: "Optimistic bias"
    mitigation: "Use historical data, add buffer"
    
  anchoring:
    description: "First number influences all"
    mitigation: "Independent estimates, planning poker"
    
  scope_creep:
    description: "Requirements grow mid-sprint"
    mitigation: "Clear scope, change management"
```

## Output Format

```yaml
effort_estimate:
  story: "US-456"
  title: "Implement password reset flow"
  
  estimates:
    story_points: 8
    tshirt_size: "L"
    
    three_point:
      optimistic: 12  # hours
      most_likely: 20
      pessimistic: 40
      pert: 22
      
    confidence: "70%"
    
  breakdown:
    tasks:
      - task: "Design email template"
        estimate: 2
      - task: "Implement reset endpoint"
        estimate: 4
      - task: "Build UI flow"
        estimate: 6
      - task: "Add security measures"
        estimate: 3
      - task: "Write tests"
        estimate: 4
      - task: "Documentation"
        estimate: 1
    subtotal: 20
    
  adjustments:
    risk_multiplier: 1.2
    reason: "First time using email service"
    adjusted_estimate: 24
    
  recommendation:
    sprint_fit: "Fits in single sprint"
    dependencies: ["Email service credentials needed"]
    risks:
      - "Email deliverability testing"
      - "Security review required"
```
