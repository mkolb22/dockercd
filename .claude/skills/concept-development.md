---
name: Concept Development
description: Guide for creating new concepts, testing them, and integrating them into Zen workflows
version: 1.0.0
trigger_keywords: [concept, create, new, custom, extend, develop]
author: Zen Architecture
---

# Concept Development - Expert Skill

Guide for creating custom concepts to extend Zen workflows.

## When to Create a New Concept

Create a concept when you have:
1. **Distinct responsibility** not covered by existing concepts
2. **Independent state** that needs isolated storage
3. **Reusable actions** across different contexts
4. **Clear boundaries** from other concepts

## Concept Structure

```markdown
---
name: concept-name
type: concept
model: sonnet|sonnet
state_location: "koan/concept-name/"
execution: task-tool
cost_tier: low|high
purpose: "Brief description"
---

# Concept Name

**Model Assignment**: Sonnet (or Opus for architecture)
**Cost per Action**: ~$0.003 (Sonnet) / ~$0.015 (Opus)
**Never Calls**: No other concepts

## Purpose
[What this concept does]

## Actions
### action-name(inputs)
[How it works]

## Model Rationale
[Why this model]

## Integration Points
[How it fits in workflows]

## Anti-Patterns
[What NOT to do]
```

## Creating a Custom Concept

### Example: Deployment Concept

```markdown
---
name: deployment
type: concept
model: sonnet
state_location: "koan/deployments/"
execution: task-tool
cost_tier: low
purpose: "Deploy applications to cloud environments"
---

# Deployment Concept

**Model Assignment**: Sonnet (deployment is routine)
**Cost per Action**: ~$0.000175
**Never Calls**: No other concepts

## Purpose
Deploy implementations to staging/production environments.

## Actions

### deploy(implementation_id, environment)
- Validates deployment prerequisites
- Runs deployment scripts
- Records deployment status

### rollback(deployment_id)
- Reverts to previous version
- Documents rollback reason

### verify(deployment_id)
- Checks deployment health
- Runs smoke tests

## State File Format
```yaml
deployment_id: "deploy-001"
implementation_id: "impl-001"
environment: "staging"
status: "deployed"
timestamp: "2025-11-09T22:30:00Z"
url: "https://staging.example.com"
health_check: "passed"
```

## Model Rationale
Sonnet is sufficient because deployment follows scripts and procedures.
No deep reasoning needed.

## Integration Points
Triggered by: quality-to-deployment sync
Triggers: Nothing (terminal step)
```

## Adding Synchronization Rules

```yaml
# In .claude/synchronizations/feature-development.yaml

- id: "quality-to-deployment"
  when:
    concept: "quality"
    action: "review"
    status: "completed"
  where:
    query: |
      quality.status == 'approved' AND
      environment == 'staging'
  then:
    - concept: "deployment"
      action: "deploy"
      model: "sonnet"
      inputs:
        implementation_id: "${implementation.id}"
        environment: "staging"
  provenance:
    flow_id: "${parent.flow_id}"
    reason: "Quality approved, deploying to staging"
```

## Testing Concepts

1. **Unit Test**: Test concept independently
2. **Integration Test**: Test with synchronizations
3. **Cost Test**: Verify model selection is appropriate
4. **State Test**: Verify state files are correct

## Best Practices

1. **Single Responsibility**: One clear purpose
2. **No Direct Calls**: Never invoke other concepts
3. **Clear State**: Well-defined state file format
4. **Cost Efficient**: Use appropriate model
5. **Good Documentation**: Complete action descriptions

---

**Use this skill when**: Creating new concepts, extending Zen functionality, or customizing workflows for specific domains.
