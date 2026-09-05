---
name: Acceptance Criteria Generation
description: Generate comprehensive, testable acceptance criteria from user stories
version: 1.0.0
author: Dragonfly Framework
applies_to:
  - story-concept
trigger_keywords:
  - acceptance criteria
  - requirements
  - done definition
  - test cases
  - user story
priority: P3
impact: medium
---

# Acceptance Criteria Generation Skill

## Purpose

Enable the Story Concept agent to generate comprehensive, unambiguous, and testable acceptance criteria from user stories and feature requests.

## Acceptance Criteria Framework

### 1. Criteria Types

```yaml
criteria_types:
  functional:
    description: "What the system must do"
    format: "Given-When-Then"
    examples:
      - "User can submit a form"
      - "System calculates total correctly"
      
  non_functional:
    description: "Quality attributes"
    categories:
      - performance: "Response time < 200ms"
      - security: "Passwords hashed with bcrypt"
      - accessibility: "WCAG 2.1 AA compliant"
      - reliability: "99.9% uptime"
      
  edge_cases:
    description: "Boundary conditions"
    examples:
      - "Empty input handling"
      - "Maximum length exceeded"
      - "Concurrent access"
      
  error_handling:
    description: "How system handles failures"
    examples:
      - "Network timeout shows retry option"
      - "Invalid input displays specific error"
```

### 2. Given-When-Then Template

```gherkin
Feature: {Feature Name}
  As a {user role}
  I want {goal}
  So that {benefit}

  Background:
    Given {common preconditions}

  Scenario: {Happy Path - Primary Flow}
    Given {initial state/context}
      And {additional context if needed}
    When {user action/trigger}
      And {additional actions if needed}
    Then {expected outcome}
      And {additional outcomes}
      And {state change verification}

  Scenario: {Alternate Path}
    Given {different initial state}
    When {same or different action}
    Then {different outcome}

  Scenario: {Error Path}
    Given {state that will cause error}
    When {action that triggers error}
    Then {error handling behavior}
      And {user feedback}

  Scenario Outline: {Parameterized Scenarios}
    Given {context with <variable>}
    When {action with <input>}
    Then {outcome with <expected>}

    Examples:
      | variable | input | expected |
      | value1   | val1  | result1  |
      | value2   | val2  | result2  |
```

### 3. Comprehensive Coverage Checklist

```yaml
coverage_areas:
  user_flows:
    - happy_path: "Primary success scenario"
    - alternate_paths: "Valid alternative flows"
    - error_paths: "Invalid inputs, failures"
    - edge_cases: "Boundary conditions"
    
  state_management:
    - initial_state: "Starting conditions"
    - state_transitions: "Valid state changes"
    - final_state: "End conditions"
    - persistence: "Data saved correctly"
    
  user_interface:
    - visibility: "Correct elements shown"
    - feedback: "User informed of actions"
    - navigation: "Correct routing"
    - responsiveness: "Works on all devices"
    
  data_validation:
    - required_fields: "Mandatory data present"
    - format_validation: "Correct formats"
    - business_rules: "Domain constraints"
    - cross_field: "Related field validation"
    
  security:
    - authentication: "User identity verified"
    - authorization: "Permissions checked"
    - data_protection: "Sensitive data handled"
    - audit: "Actions logged"
    
  integration:
    - external_systems: "Third-party interactions"
    - notifications: "Emails, alerts sent"
    - downstream_effects: "Related systems updated"
```

### 4. Criteria Quality Standards

```yaml
quality_attributes:
  specific:
    bad: "System is fast"
    good: "Page loads in under 2 seconds on 3G connection"
    
  measurable:
    bad: "Most users can complete the task"
    good: "95% of users complete task in under 3 minutes"
    
  achievable:
    check: "Can this be implemented with current resources?"
    
  relevant:
    check: "Does this support the user's goal?"
    
  testable:
    bad: "User finds the interface intuitive"
    good: "User completes checkout without documentation"
    
  unambiguous:
    bad: "System handles large files"
    good: "System accepts files up to 100MB"
```

### 5. Generation Algorithm

```yaml
generation_process:
  step_1_analyze_story:
    inputs:
      - user_role
      - goal
      - benefit
    extract:
      - primary_action
      - expected_outcome
      - implicit_requirements
      
  step_2_identify_scenarios:
    happy_path:
      - main_success_flow
    alternate_paths:
      - valid_variations
      - optional_features
    error_paths:
      - invalid_inputs
      - system_failures
      - permission_denied
    edge_cases:
      - boundary_values
      - empty_states
      - concurrent_access
      
  step_3_generate_criteria:
    for_each: scenario
    create:
      - given_clause: "Preconditions"
      - when_clause: "Action"
      - then_clause: "Outcomes"
      - and_clauses: "Additional conditions"
      
  step_4_validate_completeness:
    check:
      - all_inputs_validated
      - all_outputs_specified
      - error_states_covered
      - security_considered
      - performance_specified
```

### 6. Domain-Specific Templates

```yaml
templates:
  authentication:
    scenarios:
      - "Valid credentials → successful login"
      - "Invalid password → error message, no lockout"
      - "Account locked → specific message"
      - "MFA required → redirect to MFA"
      - "Session expired → redirect to login"
      
  form_submission:
    scenarios:
      - "Valid data → success message, data saved"
      - "Missing required → inline validation"
      - "Invalid format → specific error"
      - "Duplicate entry → appropriate message"
      - "Server error → user-friendly message, retry"
      
  data_listing:
    scenarios:
      - "Data exists → displayed in table"
      - "No data → empty state message"
      - "Pagination → correct page displayed"
      - "Filtering → matching results only"
      - "Sorting → correct order"
      
  file_upload:
    scenarios:
      - "Valid file → uploaded, preview shown"
      - "Too large → size limit message"
      - "Invalid type → format error"
      - "Upload fails → retry option"
      - "Progress → indicator shown"
```

### 7. Non-Functional Criteria Templates

```yaml
nfr_templates:
  performance:
    - "Page load time < {X}ms on {network_type}"
    - "API response time < {X}ms at p95"
    - "Database query time < {X}ms"
    - "Concurrent users supported: {N}"
    
  security:
    - "Passwords stored using bcrypt with cost factor {N}"
    - "Session expires after {X} minutes of inactivity"
    - "Failed logins locked after {N} attempts"
    - "All API endpoints require authentication"
    
  accessibility:
    - "WCAG 2.1 Level {AA/AAA} compliance"
    - "Keyboard navigation for all interactive elements"
    - "Screen reader compatible"
    - "Color contrast ratio minimum {X}:1"
    
  reliability:
    - "System availability: {X}%"
    - "Data backup frequency: {X}"
    - "Recovery time objective: {X} hours"
    - "Recovery point objective: {X} hours"
```

## Output Format

```yaml
acceptance_criteria_output:
  story_reference: "US-123"
  story_title: "User can reset password"
  
  functional_criteria:
    - id: "AC-1"
      type: "happy_path"
      scenario: "Successful password reset"
      given: "User has a valid registered email"
      when: "User enters email and clicks reset"
      then:
        - "Reset link sent to email"
        - "Success message displayed"
        - "Link expires in 24 hours"
        
    - id: "AC-2"
      type: "error_path"
      scenario: "Unknown email"
      given: "Email not in system"
      when: "User enters unknown email"
      then:
        - "Same success message (security)"
        - "No email sent"
        - "No error revealed"
        
    - id: "AC-3"
      type: "edge_case"
      scenario: "Expired link used"
      given: "Reset link is older than 24 hours"
      when: "User clicks expired link"
      then:
        - "Error page with explanation"
        - "Option to request new link"
        
  non_functional_criteria:
    - id: "NFR-1"
      type: "security"
      criterion: "Reset tokens are single-use"
      
    - id: "NFR-2"
      type: "performance"
      criterion: "Email sent within 30 seconds"
      
  test_mapping:
    - criterion: "AC-1"
      test_type: "integration"
      automated: true
```
