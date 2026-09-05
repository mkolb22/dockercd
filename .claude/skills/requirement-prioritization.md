---
name: Requirement Prioritization
description: Prioritize requirements using MoSCoW, RICE, and value/effort matrices
version: 1.0.0
author: Dragonfly Framework
applies_to:
  - story-concept
trigger_keywords:
  - priority
  - prioritize
  - important
  - urgent
  - backlog
  - roadmap
priority: P3
impact: medium
---

# Requirement Prioritization Skill

## Purpose

Enable the Story Concept agent to systematically prioritize requirements using proven frameworks to maximize value delivery.

## Prioritization Frameworks

### 1. MoSCoW Method

```yaml
moscow_categories:
  must_have:
    code: "M"
    criteria:
      - critical_for_launch
      - legal_regulatory_requirement
      - security_essential
      - core_functionality
    percentage_of_scope: "~60%"
    failure_impact: "Release cannot proceed"
    
  should_have:
    code: "S"
    criteria:
      - important_but_not_critical
      - significant_value
      - workarounds_exist
    percentage_of_scope: "~20%"
    failure_impact: "Painful but deliverable"
    
  could_have:
    code: "C"
    criteria:
      - nice_to_have
      - enhances_experience
      - first_to_cut
    percentage_of_scope: "~20%"
    failure_impact: "Minor disappointment"
    
  wont_have:
    code: "W"
    criteria:
      - not_this_release
      - explicitly_excluded
      - future_consideration
    percentage_of_scope: "N/A"
    note: "Documented for clarity"
```

### 2. RICE Scoring

```yaml
rice_framework:
  reach:
    description: "How many users impacted per time period"
    scale: "number of users/quarter"
    examples:
      high: 10000  # users
      medium: 1000
      low: 100
      
  impact:
    description: "How much does it improve user experience"
    scale:
      massive: 3
      high: 2
      medium: 1
      low: 0.5
      minimal: 0.25
      
  confidence:
    description: "How sure are you about estimates"
    scale:
      high: 1.0  # data-backed
      medium: 0.8  # some evidence
      low: 0.5  # gut feeling
      
  effort:
    description: "Person-months to complete"
    scale: "person-months"
    note: "Higher effort = lower priority"
    
  formula: "(Reach * Impact * Confidence) / Effort"
  
  example:
    feature: "One-click checkout"
    reach: 5000  # users/quarter
    impact: 2  # high
    confidence: 0.8  # medium
    effort: 2  # person-months
    score: 4000  # (5000 * 2 * 0.8) / 2
```

### 3. Value vs Effort Matrix

```yaml
value_effort_quadrants:
  quick_wins:
    quadrant: "High Value, Low Effort"
    action: "Do first"
    priority: 1
    characteristics:
      - immediate_roi
      - easy_implementation
      - low_risk
      
  big_bets:
    quadrant: "High Value, High Effort"
    action: "Plan carefully"
    priority: 2
    characteristics:
      - strategic_importance
      - requires_investment
      - break_into_phases
      
  fill_ins:
    quadrant: "Low Value, Low Effort"
    action: "Do if time permits"
    priority: 3
    characteristics:
      - minor_improvements
      - low_opportunity_cost
      
  money_pits:
    quadrant: "Low Value, High Effort"
    action: "Avoid"
    priority: 4
    characteristics:
      - poor_roi
      - resource_drain
      - opportunity_cost
```

### 4. Weighted Scoring Model

```yaml
weighted_scoring:
  criteria:
    business_value:
      weight: 30
      scale: 1-5
      considerations:
        - revenue_impact
        - cost_savings
        - strategic_alignment
        
    user_impact:
      weight: 25
      scale: 1-5
      considerations:
        - user_satisfaction
        - adoption_likelihood
        - retention_impact
        
    technical_fit:
      weight: 20
      scale: 1-5
      considerations:
        - architecture_alignment
        - technical_debt_reduction
        - platform_capability
        
    feasibility:
      weight: 15
      scale: 1-5
      considerations:
        - skill_availability
        - dependency_risk
        - timeline_fit
        
    risk:
      weight: 10
      scale: 1-5  # inverse: 5 = low risk
      considerations:
        - implementation_risk
        - market_risk
        - compliance_risk
        
  calculation: "Sum(criterion_score * weight) / 100"
```

### 5. Kano Model

```yaml
kano_categories:
  must_be:
    description: "Expected features, dissatisfaction if missing"
    satisfaction_curve: "flat at top"
    examples:
      - "Login functionality"
      - "Data security"
      - "Basic search"
    priority: "Foundation - must include"
    
  one_dimensional:
    description: "More is better, linear satisfaction"
    satisfaction_curve: "diagonal"
    examples:
      - "Performance speed"
      - "Storage capacity"
      - "Feature quantity"
    priority: "Differentiate on these"
    
  attractive:
    description: "Delighters, not expected"
    satisfaction_curve: "exponential"
    examples:
      - "Surprise features"
      - "Exceptional UX"
      - "Personalization"
    priority: "Add if resources allow"
    
  indifferent:
    description: "No impact on satisfaction"
    satisfaction_curve: "flat in middle"
    examples:
      - "Internal refactoring"
      - "Unnecessary features"
    priority: "Deprioritize"
    
  reverse:
    description: "Can cause dissatisfaction"
    satisfaction_curve: "negative slope"
    examples:
      - "Unwanted complexity"
      - "Feature bloat"
    priority: "Avoid"
```

### 6. Priority Assignment Algorithm

```yaml
priority_assignment:
  step_1_categorize:
    method: "MoSCoW classification"
    output: "initial_tier"
    
  step_2_score:
    method: "RICE or weighted scoring"
    output: "numeric_score"
    
  step_3_rank:
    within_each_tier: "by score descending"
    
  step_4_validate:
    checks:
      - dependencies_respected
      - resource_constraints_feasible
      - stakeholder_alignment
      
  step_5_sequence:
    considerations:
      - technical_dependencies
      - team_availability
      - risk_distribution
```

### 7. Stakeholder Alignment

```yaml
stakeholder_considerations:
  perspectives:
    business:
      focus: ["revenue", "market share", "competitive advantage"]
      weight: "high for strategic features"
      
    users:
      focus: ["usability", "performance", "features"]
      weight: "high for UX features"
      
    engineering:
      focus: ["maintainability", "scalability", "tech debt"]
      weight: "high for infrastructure"
      
    operations:
      focus: ["reliability", "supportability", "monitoring"]
      weight: "high for stability features"
      
  alignment_process:
    1. gather_input: "Each stakeholder scores features"
    2. identify_conflicts: "Where priorities differ"
    3. facilitate_discussion: "Understand perspectives"
    4. reach_consensus: "Agreed priority order"
```

## Output Format

```yaml
prioritization_result:
  analysis_date: "2024-01-15"
  items_prioritized: 25
  
  priority_tiers:
    must_have:
      items:
        - id: "US-101"
          title: "User authentication"
          rice_score: 8500
          rationale: "Security requirement"
          
        - id: "US-102"
          title: "Basic search"
          rice_score: 7200
          rationale: "Core functionality"
          
    should_have:
      items:
        - id: "US-201"
          title: "Advanced filtering"
          rice_score: 4000
          rationale: "High user demand"
          
    could_have:
      items:
        - id: "US-301"
          title: "Dark mode"
          rice_score: 1500
          rationale: "Nice to have UX"
          
    wont_have:
      items:
        - id: "US-401"
          title: "AI recommendations"
          rationale: "Future roadmap item"
          
  recommendations:
    sprint_1:
      focus: "Must-haves"
      items: ["US-101", "US-102", "US-103"]
      
    sprint_2:
      focus: "Must-haves + Should-haves"
      items: ["US-104", "US-201", "US-202"]
      
  risks:
    - "US-104 has external dependency"
    - "US-201 requires design review"
```
