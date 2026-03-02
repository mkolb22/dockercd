---
name: Error Classification
description: Classify errors to determine appropriate response strategy (retry, fail, escalate)
version: 1.0.0
trigger_keywords: [error, exception, failure, crash, bug, issue, classify, retry, transient]
author: Zen Architecture
applies_to: [all-concepts]
priority: P0
impact: high
---

# Error Classification - Expert Skill

Classify errors to determine the appropriate response strategy and reduce time to resolution.

## Purpose

Error classification provides:
- **Right response**: Different errors need different handling
- **Faster resolution**: 50% faster error resolution with proper classification
- **Reduced noise**: Don't alert on transient issues
- **Better debugging**: Categorized errors are easier to diagnose

## When to Use

Use error classification when:
- ✅ Any operation fails or throws an exception
- ✅ Deciding whether to retry an operation
- ✅ Choosing escalation path
- ✅ Logging errors with appropriate severity
- ✅ Presenting errors to users

## Error Classification Taxonomy

### Level 1: Retryability

```yaml
retryability:
  transient:
    description: "Temporary failure, retry will likely succeed"
    strategy: "Retry with backoff"
    examples:
      - "Network timeout"
      - "Rate limit exceeded"
      - "Service temporarily unavailable"
      - "Connection reset"
      - "Database lock contention"
      
  permanent:
    description: "Failure will persist, retry won't help"
    strategy: "Fail fast, don't retry"
    examples:
      - "Invalid input"
      - "Resource not found"
      - "Permission denied"
      - "Schema validation failed"
      - "Business rule violation"
      
  indeterminate:
    description: "Unknown if retry will help"
    strategy: "Limited retry, then fail"
    examples:
      - "Internal server error"
      - "Unknown error"
      - "Unexpected response"
```

### Level 2: Source

```yaml
source:
  user_error:
    description: "Error caused by user input or action"
    response: "Return clear error message to user"
    examples:
      - "Invalid email format"
      - "Password too short"
      - "File type not supported"
      - "Missing required field"
      
  system_error:
    description: "Error caused by system failure"
    response: "Log, alert if severe, show generic message to user"
    examples:
      - "Database connection failed"
      - "Out of memory"
      - "Disk full"
      - "Service crashed"
      
  external_error:
    description: "Error from external service"
    response: "Retry if transient, fallback if available"
    examples:
      - "Third-party API down"
      - "Payment gateway timeout"
      - "Email service unavailable"
      
  configuration_error:
    description: "Error due to misconfiguration"
    response: "Alert ops, cannot auto-recover"
    examples:
      - "Invalid database credentials"
      - "Missing environment variable"
      - "SSL certificate expired"
```

### Level 3: Severity

```yaml
severity:
  critical:
    description: "System unusable, immediate action required"
    response: "Alert on-call, stop affected workflows"
    criteria:
      - "Data corruption possible"
      - "Security breach"
      - "Complete service outage"
    sla: "Respond in 5 minutes"
    
  high:
    description: "Major feature broken, urgent fix needed"
    response: "Alert team, prioritize fix"
    criteria:
      - "Core functionality unavailable"
      - "Affecting multiple users"
      - "Revenue impact"
    sla: "Respond in 30 minutes"
    
  medium:
    description: "Feature degraded, fix soon"
    response: "Log, create ticket, fix in current sprint"
    criteria:
      - "Workaround available"
      - "Limited user impact"
      - "Non-critical feature"
    sla: "Fix within 1-2 days"
    
  low:
    description: "Minor issue, fix when convenient"
    response: "Log, backlog for later"
    criteria:
      - "Cosmetic issue"
      - "Edge case"
      - "Single user affected"
    sla: "Fix when convenient"
```

### Level 4: Domain

```yaml
domain:
  authentication:
    errors:
      - "Invalid credentials"
      - "Session expired"
      - "MFA required"
      - "Account locked"
    handling: "Clear auth state, prompt re-authentication"
    
  authorization:
    errors:
      - "Permission denied"
      - "Role not authorized"
      - "Resource ownership mismatch"
    handling: "Return 403, log access attempt"
    
  validation:
    errors:
      - "Schema validation failed"
      - "Business rule violated"
      - "Constraint violation"
    handling: "Return specific field errors"
    
  resource:
    errors:
      - "Not found"
      - "Already exists"
      - "Conflict"
    handling: "Return appropriate HTTP status"
    
  rate_limiting:
    errors:
      - "Too many requests"
      - "Quota exceeded"
    handling: "Return retry-after header, back off"
    
  dependency:
    errors:
      - "External service unavailable"
      - "Upstream timeout"
      - "Circuit breaker open"
    handling: "Retry or fallback"
```

## Classification Algorithm

```python
def classify_error(error):
    """
    Classify an error into appropriate categories.
    
    Args:
        error: The error/exception to classify
        
    Returns:
        ErrorClassification with retryability, source, severity, domain
    """
    classification = ErrorClassification()
    
    # Step 1: Identify retryability
    classification.retryability = classify_retryability(error)
    
    # Step 2: Identify source
    classification.source = classify_source(error)
    
    # Step 3: Assess severity
    classification.severity = assess_severity(error)
    
    # Step 4: Determine domain
    classification.domain = identify_domain(error)
    
    # Step 5: Determine response strategy
    classification.strategy = determine_strategy(classification)
    
    return classification


def classify_retryability(error):
    """Determine if error is transient or permanent."""
    
    transient_patterns = [
        # Network issues
        r'ECONNRESET',
        r'ETIMEDOUT',
        r'ECONNREFUSED',
        r'socket hang up',
        r'network error',
        
        # Rate limiting
        r'rate limit',
        r'too many requests',
        r'429',
        r'quota exceeded',
        
        # Temporary unavailability
        r'503',
        r'service unavailable',
        r'temporarily unavailable',
        r'try again later',
        
        # Database locks
        r'deadlock',
        r'lock timeout',
        r'lock contention',
    ]
    
    permanent_patterns = [
        # Validation
        r'validation',
        r'invalid',
        r'malformed',
        r'schema',
        
        # Authorization
        r'401',
        r'403',
        r'unauthorized',
        r'forbidden',
        r'permission denied',
        
        # Not found
        r'404',
        r'not found',
        r'does not exist',
        
        # Business rules
        r'business rule',
        r'constraint violation',
        r'already exists',
    ]
    
    error_str = str(error).lower()
    
    for pattern in transient_patterns:
        if re.search(pattern, error_str, re.IGNORECASE):
            return 'transient'
            
    for pattern in permanent_patterns:
        if re.search(pattern, error_str, re.IGNORECASE):
            return 'permanent'
            
    return 'indeterminate'


def classify_source(error):
    """Determine the source of the error."""
    
    user_error_patterns = [
        r'validation',
        r'invalid input',
        r'required field',
        r'format error',
        r'too short',
        r'too long',
    ]
    
    external_error_patterns = [
        r'api\.',
        r'external',
        r'third.party',
        r'upstream',
        r'gateway',
    ]
    
    config_error_patterns = [
        r'configuration',
        r'environment variable',
        r'credential',
        r'certificate',
        r'missing key',
    ]
    
    error_str = str(error).lower()
    
    for pattern in user_error_patterns:
        if re.search(pattern, error_str, re.IGNORECASE):
            return 'user_error'
            
    for pattern in external_error_patterns:
        if re.search(pattern, error_str, re.IGNORECASE):
            return 'external_error'
            
    for pattern in config_error_patterns:
        if re.search(pattern, error_str, re.IGNORECASE):
            return 'configuration_error'
            
    return 'system_error'


def assess_severity(error):
    """Assess the severity of the error."""
    
    critical_patterns = [
        r'data corruption',
        r'security',
        r'breach',
        r'injection',
        r'database down',
        r'fatal',
    ]
    
    high_patterns = [
        r'cannot connect',
        r'service unavailable',
        r'payment failed',
        r'auth.* failed',
    ]
    
    low_patterns = [
        r'warning',
        r'deprecated',
        r'edge case',
    ]
    
    error_str = str(error).lower()
    
    for pattern in critical_patterns:
        if re.search(pattern, error_str, re.IGNORECASE):
            return 'critical'
            
    for pattern in high_patterns:
        if re.search(pattern, error_str, re.IGNORECASE):
            return 'high'
            
    for pattern in low_patterns:
        if re.search(pattern, error_str, re.IGNORECASE):
            return 'low'
            
    return 'medium'
```

## Response Strategies

### Strategy: Retry with Backoff

```yaml
strategy: retry_with_backoff
applies_to:
  retryability: transient
  
configuration:
  max_attempts: 3
  initial_delay_ms: 1000
  multiplier: 2.0
  max_delay_ms: 30000
  jitter: true
  
implementation: |
  async function retryWithBackoff(operation, config) {
    let attempt = 0;
    let delay = config.initial_delay_ms;
    
    while (attempt < config.max_attempts) {
      try {
        return await operation();
      } catch (error) {
        attempt++;
        
        if (attempt >= config.max_attempts) {
          throw error;
        }
        
        if (classify_retryability(error) !== 'transient') {
          throw error;  // Don't retry non-transient
        }
        
        const jitter = config.jitter ? Math.random() * 0.5 + 0.5 : 1;
        await sleep(delay * jitter);
        delay = Math.min(delay * config.multiplier, config.max_delay_ms);
      }
    }
  }
```

### Strategy: Fail Fast

```yaml
strategy: fail_fast
applies_to:
  retryability: permanent
  
configuration:
  log_level: "warn"
  include_details: true
  
implementation: |
  function failFast(error, context) {
    // Log with details
    logger.warn('Operation failed (permanent)', {
      error: error.message,
      code: error.code,
      context: context,
      classification: classify_error(error)
    });
    
    // Return user-friendly error
    return {
      success: false,
      error: {
        code: error.code,
        message: sanitize_for_user(error.message),
        field: error.field  // For validation errors
      }
    };
  }
```

### Strategy: Escalate

```yaml
strategy: escalate
applies_to:
  severity: critical
  
configuration:
  alert_channels:
    - pagerduty
    - slack_oncall
  include_diagnostics: true
  
implementation: |
  async function escalate(error, context) {
    // Gather diagnostics
    const diagnostics = {
      error: error,
      stack: error.stack,
      context: context,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV,
      memory: process.memoryUsage(),
      uptime: process.uptime()
    };
    
    // Alert immediately
    await pagerduty.trigger({
      severity: 'critical',
      summary: `Critical error: ${error.message}`,
      details: diagnostics
    });
    
    // Log for debugging
    logger.error('Critical error escalated', diagnostics);
    
    // Stop affected workflows
    await workflow.halt(context.flow_id);
  }
```

### Strategy: Fallback

```yaml
strategy: fallback
applies_to:
  source: external_error
  
configuration:
  fallback_options:
    - cached_result
    - default_value
    - alternative_service
    
implementation: |
  async function withFallback(operation, fallback) {
    try {
      return await operation();
    } catch (error) {
      const classification = classify_error(error);
      
      if (classification.source === 'external_error') {
        logger.warn('External service failed, using fallback', {
          error: error.message,
          fallback: fallback.name
        });
        
        return await fallback();
      }
      
      throw error;  // Don't fallback for other error types
    }
  }
```

## Integration with Concepts

### In Any Concept Action

```python
async def execute_action(action, inputs):
    """Execute action with error classification."""
    try:
        result = await action(inputs)
        return {'success': True, 'result': result}
        
    except Exception as error:
        classification = classify_error(error)
        
        # Log with classification
        log_error(error, classification)
        
        # Apply strategy
        if classification.retryability == 'transient':
            return await retry_with_backoff(
                lambda: action(inputs),
                get_retry_config(classification)
            )
            
        elif classification.severity == 'critical':
            await escalate(error, {'action': action.__name__, 'inputs': inputs})
            raise
            
        else:
            return fail_fast(error, {'action': action.__name__})
```

### Error Classification in Provenance

```yaml
# koan/provenance/actions/act-{id}.yaml

action_id: "act-003"
concept: "implementation"
action: "generate"
status: "failed"

error:
  message: "Rate limit exceeded for LLM API"
  code: "RATE_LIMIT"
  
  classification:
    retryability: "transient"
    source: "external_error"
    severity: "medium"
    domain: "rate_limiting"
    
  strategy_applied: "retry_with_backoff"
  retry_attempts: 3
  final_outcome: "succeeded_on_retry"
  
  resolution:
    time_to_resolve_ms: 4500
    method: "automatic_retry"
```

## Error Response Templates

### User-Facing Errors

```yaml
user_error_templates:
  validation:
    format: |
      {
        "error": {
          "code": "VALIDATION_ERROR",
          "message": "The provided data is invalid",
          "details": [
            {"field": "email", "message": "Invalid email format"},
            {"field": "password", "message": "Must be at least 8 characters"}
          ]
        }
      }
      
  not_found:
    format: |
      {
        "error": {
          "code": "NOT_FOUND",
          "message": "The requested resource was not found"
        }
      }
      
  rate_limit:
    format: |
      {
        "error": {
          "code": "RATE_LIMIT_EXCEEDED",
          "message": "Too many requests. Please try again later.",
          "retry_after": 60
        }
      }
      
  internal:
    format: |
      {
        "error": {
          "code": "INTERNAL_ERROR",
          "message": "An unexpected error occurred. Please try again."
        }
      }
    note: "Never expose internal details to users"
```

### Internal Logging

```yaml
internal_log_format:
  template: |
    {
      "timestamp": "{timestamp}",
      "level": "{level}",
      "message": "{error.message}",
      "error": {
        "type": "{error.name}",
        "message": "{error.message}",
        "stack": "{error.stack}",
        "code": "{error.code}"
      },
      "classification": {
        "retryability": "{classification.retryability}",
        "source": "{classification.source}",
        "severity": "{classification.severity}",
        "domain": "{classification.domain}"
      },
      "context": {
        "action": "{context.action}",
        "flow_id": "{context.flow_id}",
        "user_id": "{context.user_id}"
      },
      "strategy": "{strategy_applied}",
      "outcome": "{outcome}"
    }
```

## Best Practices

1. ✅ **Classify early** - Classify errors as soon as they occur
2. ✅ **Log with classification** - Include classification in all logs
3. ✅ **Match strategy to classification** - Don't retry permanent errors
4. ✅ **Sanitize user-facing errors** - Never expose internal details
5. ✅ **Include context** - Error without context is hard to debug
6. ✅ **Track metrics** - Error rates by classification
7. ✅ **Update patterns** - Add new error patterns as discovered

## Metrics to Track

```yaml
error_metrics:
  - name: "error_rate_by_classification"
    dimensions: [retryability, source, severity, domain]
    
  - name: "retry_success_rate"
    description: "Percentage of transient errors that succeed on retry"
    target: "> 80%"
    
  - name: "time_to_resolution"
    description: "Time from error to resolution"
    by_severity:
      critical: "< 5 minutes"
      high: "< 30 minutes"
      medium: "< 4 hours"
      
  - name: "false_classification_rate"
    description: "Errors misclassified (e.g., retried permanent errors)"
    target: "< 5%"
```

---

**Use this skill when**: Any operation fails or throws an exception. Proper classification ensures the right response strategy and faster resolution.
