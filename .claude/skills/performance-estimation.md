---
name: Performance Estimation
description: Estimate computational complexity and runtime performance of implementations
version: 1.0.0
author: Dragonfly Framework
applies_to:
  - architecture-concept
trigger_keywords:
  - performance
  - complexity
  - big o
  - optimization
  - scalability
  - bottleneck
priority: P3
impact: medium
---

# Performance Estimation Skill

## Purpose

Enable the Architecture Concept agent to estimate computational complexity, identify performance bottlenecks, and recommend optimizations.

## Complexity Analysis Framework

### 1. Big O Classification

```yaml
complexity_classes:
  O(1):
    name: "Constant"
    examples:
      - array_index_access
      - hash_table_lookup
      - stack_push_pop
    characteristics: "Time doesn't grow with input"
    
  O(log n):
    name: "Logarithmic"
    examples:
      - binary_search
      - balanced_tree_operations
      - divide_and_conquer
    characteristics: "Halves problem each step"
    
  O(n):
    name: "Linear"
    examples:
      - array_iteration
      - linear_search
      - single_loop
    characteristics: "Examines each element once"
    
  O(n log n):
    name: "Linearithmic"
    examples:
      - efficient_sorting (merge, quick, heap)
      - divide_and_conquer_with_merge
    characteristics: "Best comparison-based sort"
    
  O(n²):
    name: "Quadratic"
    examples:
      - nested_loops
      - bubble_sort
      - selection_sort
    characteristics: "Pairs of elements compared"
    warning: "Problematic for n > 10,000"
    
  O(n³):
    name: "Cubic"
    examples:
      - matrix_multiplication_naive
      - triple_nested_loops
    characteristics: "Triplets examined"
    warning: "Problematic for n > 1,000"
    
  O(2^n):
    name: "Exponential"
    examples:
      - recursive_fibonacci_naive
      - power_set
      - subset_sum_brute
    characteristics: "Doubles each step"
    warning: "Impractical for n > 30"
    
  O(n!):
    name: "Factorial"
    examples:
      - permutations
      - traveling_salesman_brute
    characteristics: "All orderings"
    warning: "Impractical for n > 12"
```

### 2. Pattern Recognition Rules

```yaml
complexity_patterns:
  loops:
    single_loop_n_iterations:
      pattern: "for i in range(n)"
      complexity: "O(n)"
      
    nested_loops_independent:
      pattern: "for i in n: for j in m"
      complexity: "O(n * m)"
      
    nested_loops_dependent:
      pattern: "for i in n: for j in range(i)"
      complexity: "O(n²/2) = O(n²)"
      
    loop_with_divide:
      pattern: "while n > 0: n = n // 2"
      complexity: "O(log n)"
      
  recursion:
    linear_recursion:
      pattern: "f(n) = f(n-1) + O(1)"
      complexity: "O(n)"
      
    binary_recursion:
      pattern: "f(n) = 2*f(n/2) + O(1)"
      complexity: "O(n)"
      
    divide_and_conquer:
      pattern: "f(n) = 2*f(n/2) + O(n)"
      complexity: "O(n log n)"
      
    exponential_recursion:
      pattern: "f(n) = f(n-1) + f(n-2)"
      complexity: "O(2^n)"
```

### 3. Space Complexity Analysis

```yaml
space_factors:
  input_storage:
    description: "Memory for input data"
    consideration: "Often excluded (auxiliary space)"
    
  auxiliary_space:
    description: "Extra memory used by algorithm"
    examples:
      in_place: "O(1) - modifies input"
      linear_buffer: "O(n) - creates copy"
      recursion_stack: "O(depth) - call stack"
      
  common_patterns:
    hash_set_for_lookup: "O(n)"
    recursion_depth: "O(log n) to O(n)"
    dp_table: "O(n) or O(n²)"
    graph_adjacency_list: "O(V + E)"
```

### 4. Performance Estimation Template

```yaml
estimation_template:
  operation: "{operation_name}"
  
  time_complexity:
    best_case: "O(?)"
    average_case: "O(?)"
    worst_case: "O(?)"
    amortized: "O(?) if applicable"
    
  space_complexity:
    auxiliary: "O(?)"
    total: "O(?)"
    
  scalability_analysis:
    n_100: "~{time}ms"
    n_1000: "~{time}ms"
    n_10000: "~{time}ms"
    n_100000: "~{time}ms"
    
  bottleneck_identification:
    - location: "line X"
      issue: "nested loop"
      impact: "O(n²)"
      
  optimization_opportunities:
    - technique: "Use hash map"
      before: "O(n²)"
      after: "O(n)"
      tradeoff: "+O(n) space"
```

### 5. Real-World Performance Factors

```yaml
practical_considerations:
  constant_factors:
    description: "Big O hides constant multipliers"
    example: "O(n) with 100x constant vs O(n²) for small n"
    guidance: "Profile for actual workloads"
    
  cache_effects:
    description: "Memory access patterns matter"
    examples:
      cache_friendly: "Sequential array access"
      cache_hostile: "Random memory jumps, linked lists"
    impact: "10-100x performance difference"
    
  io_bound_vs_cpu_bound:
    io_bound:
      bottleneck: "Disk, network, database"
      optimization: "Async, batching, caching"
    cpu_bound:
      bottleneck: "Computation"
      optimization: "Algorithm improvement, parallelization"
      
  jit_effects:
    description: "Runtime compilation impacts"
    cold_start: "First execution slower"
    warm: "Optimized code paths"
```

### 6. Database Query Complexity

```yaml
query_complexity:
  table_scan:
    complexity: "O(n)"
    when: "No index, WHERE on non-indexed column"
    
  index_lookup:
    complexity: "O(log n)"
    when: "B-tree index on filtered column"
    
  hash_index:
    complexity: "O(1)"
    when: "Hash index, equality check"
    
  join_operations:
    nested_loop: "O(n * m)"
    hash_join: "O(n + m)"
    merge_join: "O(n log n + m log m)"
    
  common_issues:
    n_plus_1:
      pattern: "Query in loop"
      complexity: "O(n) queries"
      fix: "Eager loading, JOIN"
      
    missing_index:
      symptom: "Slow WHERE clause"
      fix: "Add appropriate index"
```

### 7. Optimization Recommendations

```yaml
optimization_catalog:
  algorithm_level:
    - pattern: "O(n²) nested search"
      optimization: "Use hash set for O(1) lookup"
      result: "O(n)"
      
    - pattern: "Repeated subproblem computation"
      optimization: "Memoization / Dynamic Programming"
      result: "Polynomial instead of exponential"
      
    - pattern: "Full sort for top-k"
      optimization: "Use heap / quickselect"
      result: "O(n log k) instead of O(n log n)"
      
  data_structure_level:
    - pattern: "Frequent membership checks in list"
      optimization: "Convert to set"
      result: "O(1) instead of O(n)"
      
    - pattern: "Frequent insertions in sorted list"
      optimization: "Use balanced tree"
      result: "O(log n) instead of O(n)"
      
  system_level:
    - pattern: "Sequential API calls"
      optimization: "Parallelize / batch"
      result: "Wall time reduced"
      
    - pattern: "Repeated expensive computation"
      optimization: "Cache results"
      result: "Amortized O(1)"
```

## Output Format

```yaml
performance_analysis:
  function: "processOrders"
  file: "src/services/order.ts"
  
  complexity:
    time:
      overall: "O(n * m)"
      breakdown:
        - operation: "outer loop"
          complexity: "O(n)"
        - operation: "inner lookup"
          complexity: "O(m)"
          note: "Could be O(1) with index"
    space: "O(n)"
    
  estimated_performance:
    current:
      n_1000: "~150ms"
      n_10000: "~15s"
      n_100000: "~25min"
    optimized:
      n_1000: "~5ms"
      n_10000: "~50ms"
      n_100000: "~500ms"
      
  recommendations:
    - priority: "high"
      issue: "Linear search in inner loop"
      location: "line 45"
      optimization: "Pre-build lookup map"
      impact: "O(n * m) → O(n + m)"
      effort: "1 hour"
```
