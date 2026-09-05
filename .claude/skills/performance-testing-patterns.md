---
name: Performance Testing Patterns
description: Load testing, stress testing, and performance benchmarking strategies
version: 1.0.0
author: Dragonfly Framework
applies_to:
  - quality-concept
trigger_keywords:
  - performance test
  - load test
  - stress test
  - benchmark
  - scalability
  - throughput
priority: P3
impact: medium
---

# Performance Testing Patterns Skill

## Purpose

Enable the Quality Concept agent to design and execute comprehensive performance testing strategies.

## Performance Testing Framework

### 1. Test Types

```yaml
performance_test_types:
  load_testing:
    purpose: "Verify system under expected load"
    approach: "Gradually increase load to expected levels"
    metrics: ["response_time", "throughput", "error_rate"]
    duration: "15-60 minutes"
    
  stress_testing:
    purpose: "Find breaking point"
    approach: "Increase load until failure"
    metrics: ["failure_point", "recovery_behavior", "degradation_pattern"]
    duration: "Until failure + recovery"
    
  spike_testing:
    purpose: "Test sudden traffic bursts"
    approach: "Sudden extreme load increase"
    metrics: ["response_time_spike", "recovery_time", "error_handling"]
    duration: "Short bursts (5-10 min)"
    
  endurance_testing:
    purpose: "Detect memory leaks, resource exhaustion"
    approach: "Sustained load over extended period"
    metrics: ["memory_usage", "connection_pools", "disk_usage"]
    duration: "4-24+ hours"
    
  scalability_testing:
    purpose: "Verify horizontal/vertical scaling"
    approach: "Add resources, measure improvement"
    metrics: ["linear_scalability", "scaling_efficiency"]
    duration: "Varies by scaling approach"
```

### 2. Key Performance Indicators

```yaml
performance_metrics:
  response_time:
    percentiles:
      p50: "Median response time"
      p90: "90th percentile"
      p95: "95th percentile"
      p99: "99th percentile"
    thresholds:
      excellent: "<100ms"
      good: "<300ms"
      acceptable: "<1s"
      poor: ">1s"
      
  throughput:
    measures:
      requests_per_second: "Total RPS"
      transactions_per_second: "Business TPS"
      concurrent_users: "Active users"
    baseline: "Compare to requirements"
    
  error_rate:
    calculation: "errors / total_requests * 100"
    acceptable: "<1%"
    concerning: "1-5%"
    critical: ">5%"
    
  resource_utilization:
    cpu: "Target <70% under load"
    memory: "Target <80% under load"
    network: "Bandwidth utilization"
    disk_io: "IOPS and latency"
```

### 3. Test Scenario Design

```yaml
scenario_template:
  name: "User Login Flow"
  description: "Simulate user authentication"
  
  think_time:
    min: 1000  # ms
    max: 5000
    distribution: "gaussian"
    
  steps:
    - action: "Load login page"
      expected_response: "<200ms"
      
    - action: "Submit credentials"
      expected_response: "<500ms"
      data_source: "users.csv"
      
    - action: "Navigate to dashboard"
      expected_response: "<300ms"
      
  assertions:
    - "response_time < 1000ms"
    - "status_code == 200"
    - "body contains 'Welcome'"
```

### 4. Load Profile Patterns

```yaml
load_profiles:
  ramp_up:
    description: "Gradual increase"
    pattern: |
      Users
      ^
      |    ___________
      |   /
      |  /
      | /
      +---------------> Time
    use_case: "Standard load test"
    
  step_ladder:
    description: "Incremental steps"
    pattern: |
      Users
      ^
      |       _____
      |    __|
      | __|
      +---------------> Time
    use_case: "Finding capacity limits"
    
  spike:
    description: "Sudden burst"
    pattern: |
      Users
      ^
      |    __
      |   |  |
      |___|  |___
      +---------------> Time
    use_case: "Flash sale simulation"
    
  soak:
    description: "Sustained load"
    pattern: |
      Users
      ^
      |_______________
      |
      +---------------> Time
    use_case: "Memory leak detection"
```

### 5. Tool Configuration Templates

```yaml
k6_config:
  script: |
    import http from 'k6/http';
    import { check, sleep } from 'k6';
    
    export const options = {
      stages: [
        { duration: '2m', target: 100 },   // Ramp up
        { duration: '5m', target: 100 },   // Stay at 100
        { duration: '2m', target: 200 },   // Ramp up more
        { duration: '5m', target: 200 },   // Stay at 200
        { duration: '2m', target: 0 },     // Ramp down
      ],
      thresholds: {
        http_req_duration: ['p(95)<500'],
        http_req_failed: ['rate<0.01'],
      },
    };
    
    export default function() {
      const res = http.get('https://api.example.com/endpoint');
      check(res, {
        'status is 200': (r) => r.status === 200,
        'response time < 500ms': (r) => r.timings.duration < 500,
      });
      sleep(1);
    }

jmeter_config:
  thread_group:
    users: 100
    ramp_up: 60  # seconds
    duration: 300
    
  http_sampler:
    protocol: "https"
    server: "api.example.com"
    path: "/endpoint"
    method: "GET"
    
  assertions:
    - response_time: 500
    - response_code: 200
```

### 6. Environment Considerations

```yaml
environment_setup:
  production_like:
    importance: "Critical for valid results"
    aspects:
      - same_hardware_specs
      - same_network_topology
      - same_database_size
      - same_configuration
      
  data_preparation:
    realistic_data_volume: true
    anonymized_production_data: "preferred"
    synthetic_data: "if needed"
    
  isolation:
    dedicated_environment: true
    no_other_traffic: true
    monitoring_overhead: "minimal"
    
  baseline_establishment:
    measure_without_load: true
    document_resource_usage: true
```

### 7. Results Analysis

```yaml
analysis_template:
  summary:
    test_name: "API Load Test"
    date: "2024-01-15"
    duration: "30 minutes"
    peak_users: 500
    
  results:
    throughput:
      average_rps: 850
      peak_rps: 1200
      
    response_times:
      p50: 120  # ms
      p90: 280
      p95: 450
      p99: 890
      
    errors:
      total: 45
      rate: 0.3%
      types:
        timeout: 30
        server_error: 15
        
    resources:
      cpu_max: 72%
      memory_max: 68%
      db_connections_max: 85
      
  bottlenecks:
    - component: "Database"
      evidence: "Query time increased at 400 users"
      recommendation: "Add read replica"
      
  pass_fail:
    status: "PASS"
    criteria_met:
      - "p95 < 500ms ✓"
      - "Error rate < 1% ✓"
      - "Throughput > 500 RPS ✓"
```

### 8. Continuous Performance Testing

```yaml
ci_integration:
  trigger: "On merge to main"
  
  quick_test:
    duration: "5 minutes"
    users: 50
    purpose: "Catch regressions"
    
  comparison:
    baseline: "Previous release"
    threshold: "10% degradation = fail"
    
  reporting:
    store_results: true
    trend_analysis: true
    alert_on_regression: true
```

## Output Format

```yaml
performance_test_report:
  test_summary:
    name: "Checkout Flow Load Test"
    status: "PASSED with warnings"
    
  key_findings:
    - finding: "Response time degradation above 300 users"
      severity: "warning"
      recommendation: "Scale horizontally before launch"
      
  detailed_metrics:
    # Full metrics breakdown
    
  recommendations:
    immediate:
      - "Add database connection pooling"
    before_launch:
      - "Implement caching for product catalog"
    future:
      - "Consider CDN for static assets"
```
