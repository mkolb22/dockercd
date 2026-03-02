---
name: Refactoring Patterns
description: Safe refactoring patterns with automated detection and transformation guidance
version: 1.0.0
author: Zen Framework
applies_to:
  - implementation-concept
trigger_keywords:
  - refactor
  - clean up
  - code smell
  - technical debt
  - improve code
  - restructure
priority: P2
impact: high
---

# Refactoring Patterns Skill

## Purpose

Guide the Implementation Concept agent in identifying refactoring opportunities and applying safe, incremental transformations to improve code quality.

## Code Smell Detection

### 1. Method-Level Smells

```yaml
long_method:
  detection:
    lines_threshold: 30
    cyclomatic_complexity: 10
    parameters: 5
  refactoring:
    - extract_method
    - replace_temp_with_query
    - decompose_conditional
    
duplicate_code:
  detection:
    min_lines: 5
    similarity_threshold: 0.8
  refactoring:
    - extract_method
    - pull_up_method
    - form_template_method
    
long_parameter_list:
  detection:
    threshold: 4
  refactoring:
    - introduce_parameter_object
    - preserve_whole_object
    - replace_parameter_with_method_call
    
feature_envy:
  detection:
    external_calls_ratio: 0.5  # >50% calls to other classes
  refactoring:
    - move_method
    - extract_method
```

### 2. Class-Level Smells

```yaml
large_class:
  detection:
    lines: 500
    methods: 20
    fields: 15
    responsibilities: 3
  refactoring:
    - extract_class
    - extract_subclass
    - extract_interface
    
data_class:
  detection:
    only_getters_setters: true
    no_behavior: true
  refactoring:
    - move_method  # move behavior to data class
    - encapsulate_field
    
god_class:
  detection:
    dependencies: 10
    coupling: "high"
  refactoring:
    - extract_class
    - move_method
    - introduce_service_layer

primitive_obsession:
  detection:
    primitive_fields: 5
    repeated_validation: true
  refactoring:
    - replace_primitive_with_object
    - introduce_value_object
```

### 3. Relationship Smells

```yaml
inappropriate_intimacy:
  detection:
    bidirectional_calls: true
    private_access: true
  refactoring:
    - move_method
    - move_field
    - hide_delegate
    
message_chains:
  detection:
    chain_length: 3
  refactoring:
    - hide_delegate
    - extract_method
    
middle_man:
  detection:
    delegation_ratio: 0.8  # >80% methods just delegate
  refactoring:
    - remove_middle_man
    - inline_method
```

## Refactoring Catalog

### Extract Method

```yaml
extract_method:
  when_to_use:
    - code block can be grouped
    - code needs comment to explain
    - duplicate code exists
    
  mechanics:
    1. create_new_method:
       name: "intention-revealing"
       parameters: "variables read"
       return: "variables modified"
    2. copy_code: "to new method"
    3. replace_original: "with method call"
    4. compile_and_test: true
    
  example:
    before: |
      function printOwing() {
        printBanner();
        
        // print details
        console.log(`name: ${name}`);
        console.log(`amount: ${getOutstanding()}`);
      }
    after: |
      function printOwing() {
        printBanner();
        printDetails();
      }
      
      function printDetails() {
        console.log(`name: ${name}`);
        console.log(`amount: ${getOutstanding()}`);
      }
```

### Replace Conditional with Polymorphism

```yaml
replace_conditional_with_polymorphism:
  when_to_use:
    - switch on type code
    - repeated type checking
    - behavior varies by type
    
  mechanics:
    1. create_hierarchy:
       base: "abstract class or interface"
       subclasses: "one per condition branch"
    2. move_conditional:
       to: "polymorphic method"
    3. replace_conditional:
       with: "method call"
       
  example:
    before: |
      function getSpeed(vehicle) {
        switch (vehicle.type) {
          case 'car': return vehicle.baseSpeed;
          case 'bike': return vehicle.baseSpeed * 1.5;
          case 'truck': return vehicle.baseSpeed * 0.8;
        }
      }
    after: |
      class Vehicle {
        getSpeed() { return this.baseSpeed; }
      }
      class Bike extends Vehicle {
        getSpeed() { return this.baseSpeed * 1.5; }
      }
      class Truck extends Vehicle {
        getSpeed() { return this.baseSpeed * 0.8; }
      }
```

### Introduce Parameter Object

```yaml
introduce_parameter_object:
  when_to_use:
    - parameters often travel together
    - multiple methods share same parameters
    - parameter count > 3
    
  mechanics:
    1. create_class:
       fields: "parameters to group"
       immutable: "preferred"
    2. add_parameter:
       type: "new class"
    3. remove_old_parameters: "one by one"
    4. move_behavior: "if appropriate"
    
  example:
    before: |
      function amountInvoiced(startDate, endDate) {}
      function amountReceived(startDate, endDate) {}
      function amountOverdue(startDate, endDate) {}
    after: |
      class DateRange {
        constructor(start, end) {
          this.start = start;
          this.end = end;
        }
      }
      function amountInvoiced(dateRange) {}
      function amountReceived(dateRange) {}
      function amountOverdue(dateRange) {}
```

### Extract Class

```yaml
extract_class:
  when_to_use:
    - class has multiple responsibilities
    - subset of fields/methods cohesive
    - class too large
    
  mechanics:
    1. identify_responsibility: "subset to extract"
    2. create_new_class: "for extracted responsibility"
    3. link_classes:
       from: "old class"
       to: "new class"
    4. move_fields: "one by one"
    5. move_methods: "one by one"
    6. reduce_interface: "of both classes"
    
  example:
    before: |
      class Person {
        name: string;
        officeAreaCode: string;
        officeNumber: string;
        
        getTelephoneNumber() {
          return `(${this.officeAreaCode}) ${this.officeNumber}`;
        }
      }
    after: |
      class Person {
        name: string;
        officeTelephone: TelephoneNumber;
        
        getTelephoneNumber() {
          return this.officeTelephone.toString();
        }
      }
      
      class TelephoneNumber {
        areaCode: string;
        number: string;
        
        toString() {
          return `(${this.areaCode}) ${this.number}`;
        }
      }
```

## Safe Refactoring Process

```yaml
refactoring_workflow:
  phase_1_prepare:
    - ensure_tests_pass: "Green baseline"
    - commit_current_state: "Safety checkpoint"
    - identify_scope: "What will change"
    
  phase_2_execute:
    - small_steps: "One refactoring at a time"
    - compile_after_each: "Catch errors early"
    - test_after_each: "Verify behavior"
    - commit_frequently: "Atomic changes"
    
  phase_3_verify:
    - run_full_suite: "All tests pass"
    - check_coverage: "No decrease"
    - review_changes: "Diff inspection"
    
  rollback_triggers:
    - tests_fail: "Revert immediately"
    - behavior_change: "Unintended modification"
    - complexity_increase: "Refactoring made it worse"
```

## Automated Detection Rules

```yaml
detection_rules:
  complexity_metrics:
    cyclomatic:
      warning: 10
      error: 20
    cognitive:
      warning: 15
      error: 30
    nesting_depth:
      warning: 4
      error: 6
      
  duplication_detection:
    algorithm: "token-based"
    min_tokens: 50
    min_lines: 5
    ignore:
      - imports
      - comments
      - test_setup
      
  coupling_metrics:
    afferent: 10  # classes depending on this
    efferent: 10  # classes this depends on
    instability: 0.8  # efferent / (afferent + efferent)
```

## Refactoring Prioritization

```yaml
priority_matrix:
  critical:
    impact: "Blocks development or causes bugs"
    examples:
      - security vulnerabilities
      - data corruption risks
      - blocking dependencies
    action: "Refactor immediately"
    
  high:
    impact: "Significantly slows development"
    examples:
      - god classes
      - circular dependencies
      - untestable code
    action: "Schedule for next sprint"
    
  medium:
    impact: "Causes friction but manageable"
    examples:
      - long methods
      - duplicate code
      - magic numbers
    action: "Address when touching code"
    
  low:
    impact: "Minor improvement"
    examples:
      - naming improvements
      - comment cleanup
      - formatting
    action: "Address opportunistically"
```

## Output Format

When recommending refactorings, produce:

```yaml
refactoring_report:
  file: "path/to/file.ts"
  
  detected_smells:
    - smell: "Long Method"
      location: "UserService.processOrder"
      severity: "high"
      metrics:
        lines: 85
        complexity: 15
        
  recommended_refactorings:
    - pattern: "Extract Method"
      target: "UserService.processOrder"
      description: "Extract validation logic to validateOrder()"
      effort: "30 minutes"
      risk: "low"
      steps:
        1. "Create validateOrder() method"
        2. "Move lines 15-35 to new method"
        3. "Replace with method call"
        4. "Run tests"
        
  estimated_impact:
    complexity_reduction: "40%"
    testability_improvement: "high"
    maintainability_improvement: "medium"
```
