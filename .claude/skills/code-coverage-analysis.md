---
name: Code Coverage Analysis
description: Intelligent coverage analysis with gap identification and prioritized test recommendations
version: 1.0.0
author: Dragonfly Framework
applies_to:
  - quality-concept
trigger_keywords:
  - coverage
  - test coverage
  - untested
  - coverage gap
  - coverage report
priority: P2
impact: high
---

# Code Coverage Analysis Skill

## Purpose

Enable the Quality Concept agent to analyze code coverage reports, identify critical gaps, and recommend prioritized testing strategies.

## Coverage Metrics Framework

### 1. Coverage Types

```yaml
coverage_types:
  line_coverage:
    description: "Percentage of lines executed"
    calculation: "executed_lines / total_lines * 100"
    minimum_threshold: 80%
    ideal_threshold: 90%
    
  branch_coverage:
    description: "Percentage of decision branches taken"
    calculation: "taken_branches / total_branches * 100"
    minimum_threshold: 75%
    ideal_threshold: 85%
    
  function_coverage:
    description: "Percentage of functions called"
    calculation: "called_functions / total_functions * 100"
    minimum_threshold: 90%
    ideal_threshold: 95%
    
  statement_coverage:
    description: "Percentage of statements executed"
    calculation: "executed_statements / total_statements * 100"
    minimum_threshold: 80%
    ideal_threshold: 90%
    
  condition_coverage:
    description: "Each boolean sub-expression evaluated both ways"
    calculation: "conditions_evaluated_both_ways / total_conditions * 100"
    minimum_threshold: 70%
    ideal_threshold: 80%
    
  path_coverage:
    description: "Percentage of possible execution paths"
    calculation: "exercised_paths / total_paths * 100"
    note: "Often impractical for complex code"
```

### 2. Coverage Analysis Matrix

```yaml
analysis_matrix:
  by_component_type:
    api_endpoints:
      priority: "critical"
      minimum: 90%
      focus: "branch + error paths"
      
    business_logic:
      priority: "critical"
      minimum: 85%
      focus: "branch + edge cases"
      
    data_access:
      priority: "high"
      minimum: 80%
      focus: "query variations + error handling"
      
    utilities:
      priority: "medium"
      minimum: 75%
      focus: "line coverage sufficient"
      
    ui_components:
      priority: "medium"
      minimum: 70%
      focus: "interaction + state changes"
      
    configuration:
      priority: "low"
      minimum: 60%
      focus: "validation paths"
```

### 3. Gap Detection Algorithm

```python
def analyze_coverage_gaps(coverage_report, source_files):
    """
    Identify and prioritize coverage gaps.
    """
    gaps = []
    
    for file in coverage_report.files:
        # Get uncovered lines
        uncovered = file.uncovered_lines
        
        # Classify each gap
        for line_range in group_consecutive(uncovered):
            gap = {
                'file': file.path,
                'lines': line_range,
                'type': classify_code_type(file, line_range),
                'complexity': calculate_complexity(file, line_range),
                'risk': assess_risk(file, line_range),
                'priority': calculate_priority(file, line_range),
            }
            gaps.append(gap)
    
    return sorted(gaps, key=lambda g: g['priority'], reverse=True)

def classify_code_type(file, lines):
    """Classify what kind of code is uncovered."""
    code = extract_lines(file, lines)
    
    if contains_error_handling(code):
        return 'error_handling'
    elif contains_validation(code):
        return 'validation'
    elif contains_conditional(code):
        return 'conditional_logic'
    elif contains_loop(code):
        return 'iteration'
    elif contains_external_call(code):
        return 'external_integration'
    else:
        return 'general'
```

### 4. Risk Assessment

```yaml
risk_factors:
  high_risk:
    indicators:
      - error_handling_code: "Untested error paths"
      - authentication_logic: "Security-critical code"
      - payment_processing: "Financial transactions"
      - data_validation: "Input sanitization"
      - concurrency_code: "Race conditions possible"
    weight: 3.0
    
  medium_risk:
    indicators:
      - business_rules: "Core domain logic"
      - state_transitions: "Complex state management"
      - external_api_calls: "Integration points"
      - data_transformations: "Data mapping/conversion"
    weight: 2.0
    
  low_risk:
    indicators:
      - logging_statements: "Observability code"
      - simple_getters: "Accessor methods"
      - configuration_loading: "Setup code"
      - debug_code: "Development aids"
    weight: 1.0

complexity_multiplier:
  cyclomatic_1_5: 1.0
  cyclomatic_6_10: 1.5
  cyclomatic_11_20: 2.0
  cyclomatic_21_plus: 3.0
```

### 5. Coverage Report Template

```yaml
coverage_report:
  summary:
    total_lines: 10000
    covered_lines: 8500
    line_coverage: 85.0%
    
    total_branches: 2000
    covered_branches: 1600
    branch_coverage: 80.0%
    
    total_functions: 500
    covered_functions: 475
    function_coverage: 95.0%
    
  by_directory:
    src/api:
      lines: 92%
      branches: 88%
      status: "✅ Meets threshold"
      
    src/services:
      lines: 78%
      branches: 72%
      status: "⚠️ Below threshold"
      
    src/utils:
      lines: 95%
      branches: 90%
      status: "✅ Excellent"

  critical_gaps:
    - file: "src/services/PaymentService.ts"
      uncovered_lines: [45-67, 89-95]
      risk: "high"
      reason: "Error handling in payment processing"
      recommended_tests:
        - "Test payment timeout scenario"
        - "Test invalid card response"
        - "Test network failure recovery"
        
  test_recommendations:
    immediate:
      - gap: "PaymentService error handling"
        effort: "2 hours"
        impact: "+5% coverage, -1 critical gap"
        
    short_term:
      - gap: "UserService validation"
        effort: "4 hours"
        impact: "+3% coverage"
```

### 6. Branch Coverage Deep Dive

```yaml
branch_analysis:
  uncovered_branches:
    - location: "src/auth/login.ts:45"
      type: "if-else"
      covered: "true branch"
      missing: "false branch"
      condition: "user.isVerified"
      test_needed: "Test with unverified user"
      
    - location: "src/orders/validate.ts:78"
      type: "switch"
      covered: ["PENDING", "CONFIRMED"]
      missing: ["CANCELLED", "default"]
      test_needed: "Test cancelled order and unknown status"
      
    - location: "src/utils/retry.ts:23"
      type: "try-catch"
      covered: "try block"
      missing: "catch block"
      test_needed: "Test with failing operation"
```

### 7. Coverage Trend Analysis

```yaml
trend_analysis:
  time_period: "last 30 days"
  
  metrics:
    line_coverage:
      current: 85.0%
      previous: 82.0%
      trend: "+3.0%"
      status: "improving"
      
    branch_coverage:
      current: 80.0%
      previous: 81.5%
      trend: "-1.5%"
      status: "declining"
      alert: "Branch coverage decreased"
      
  new_code_coverage:
    period: "this sprint"
    lines_added: 500
    lines_covered: 450
    coverage: 90.0%
    status: "✅ New code well tested"
    
  regressions:
    - file: "src/services/OrderService.ts"
      previous: 88%
      current: 75%
      cause: "Refactoring without test updates"
```

### 8. Actionable Recommendations

```yaml
recommendations:
  priority_1_critical:
    description: "Address immediately"
    items:
      - file: "PaymentService.ts"
        action: "Add error handling tests"
        estimated_time: "2h"
        coverage_gain: "+5%"
        
  priority_2_high:
    description: "Address this sprint"
    items:
      - file: "AuthService.ts"
        action: "Test edge cases for token refresh"
        estimated_time: "3h"
        coverage_gain: "+3%"
        
  priority_3_medium:
    description: "Address when touching code"
    items:
      - file: "StringUtils.ts"
        action: "Add boundary tests"
        estimated_time: "1h"
        coverage_gain: "+1%"

test_generation_hints:
  PaymentService:
    - scenario: "Network timeout during payment"
      mock: "HTTP client throws timeout"
      assert: "Transaction rolled back"
      
    - scenario: "Card declined by processor"
      mock: "Payment API returns declined"
      assert: "User notified, no charge"
```

## Integration Commands

```yaml
coverage_commands:
  generate_report:
    jest: "jest --coverage --coverageReporters=json"
    nyc: "nyc --reporter=json report"
    
  analyze_gaps:
    command: "dragonfly coverage analyze"
    output: "coverage-gaps.json"
    
  check_threshold:
    command: "dragonfly coverage check --threshold 80"
    ci_integration: true
    fail_on_decrease: true
```

## Output Format

When analyzing coverage, produce:

1. **Summary metrics** with trend indicators
2. **Critical gaps** sorted by risk and impact
3. **Specific test recommendations** with effort estimates
4. **Branch analysis** for complex conditionals
5. **Coverage improvement roadmap** with priorities
