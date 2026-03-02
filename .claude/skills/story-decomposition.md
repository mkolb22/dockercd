---
name: Story Decomposition
description: Break down user stories into atomic, estimable tasks with clear acceptance criteria
version: 1.0.0
author: Zen Framework
applies_to:
  - story-concept
trigger_keywords:
  - story
  - epic
  - feature
  - breakdown
  - decompose
  - tasks
  - requirements
priority: P1
impact: high
---

# Story Decomposition Skill

## Purpose

Enable the Story Concept agent to systematically break down high-level user stories and epics into atomic, implementable tasks with clear acceptance criteria and dependencies.

## Decomposition Framework

### 1. Story Analysis Template

```yaml
story_analysis:
  original_story: "[As a... I want... So that...]"
  
  stakeholder_analysis:
    primary_user: ""
    secondary_users: []
    business_sponsor: ""
    
  value_assessment:
    user_value: "high|medium|low"
    business_value: "high|medium|low"
    technical_value: "high|medium|low"
    
  scope_boundaries:
    in_scope: []
    out_of_scope: []
    assumptions: []
    
  risk_factors:
    technical: []
    business: []
    dependencies: []
```

### 2. INVEST Criteria Validation

Each decomposed story must satisfy:

| Criterion | Definition | Validation Question |
|-----------|------------|---------------------|
| **I**ndependent | Can be developed separately | Can this be built without waiting for other stories? |
| **N**egotiable | Details can be discussed | Are there implementation options? |
| **V**aluable | Delivers user/business value | Would a user notice if this was missing? |
| **E**stimable | Can be sized | Do we understand it enough to estimate? |
| **S**mall | Fits in one sprint | Can it be completed in 1-3 days? |
| **T**estable | Has clear acceptance criteria | Can we write tests for this? |

### 3. Decomposition Strategies

#### Workflow Steps
Break by sequential user actions:
```
Epic: User checkout process
├── Story: Add items to cart
├── Story: Enter shipping information
├── Story: Select payment method
├── Story: Review and confirm order
└── Story: Receive confirmation
```

#### Business Rules
Break by validation/logic rules:
```
Epic: Order validation
├── Story: Validate inventory availability
├── Story: Validate shipping address
├── Story: Apply promotional discounts
├── Story: Calculate tax
└── Story: Validate payment method
```

#### Data Variations
Break by data types/scenarios:
```
Epic: User authentication
├── Story: Email/password login
├── Story: Social login (Google)
├── Story: Social login (GitHub)
├── Story: Two-factor authentication
└── Story: Password reset flow
```

#### User Roles
Break by persona:
```
Epic: Dashboard access
├── Story: Admin dashboard view
├── Story: Manager dashboard view
├── Story: User dashboard view
└── Story: Guest limited view
```

#### CRUD Operations
Break by operation type:
```
Epic: Product management
├── Story: Create new product
├── Story: View product details
├── Story: Update product information
├── Story: Delete/archive product
└── Story: List/search products
```

### 4. Task Breakdown Template

```yaml
task:
  id: "TASK-001"
  title: "Implement [specific functionality]"
  parent_story: "STORY-001"
  
  description: |
    Clear description of what needs to be done
    
  acceptance_criteria:
    - Given [context], when [action], then [outcome]
    - Given [context], when [action], then [outcome]
    
  technical_notes:
    approach: "Brief technical approach"
    files_affected:
      - path/to/file1.ts
      - path/to/file2.ts
    dependencies:
      - "TASK-000 must be complete"
      
  estimation:
    complexity: "XS|S|M|L|XL"
    story_points: 1-13
    ideal_hours: "1-8"
    
  testing_requirements:
    unit_tests: true
    integration_tests: false
    manual_testing: "Description if needed"
```

### 5. Acceptance Criteria Patterns

#### Given-When-Then (Gherkin)
```gherkin
Scenario: [Scenario name]
  Given [initial context/state]
    And [additional context]
  When [action/trigger]
    And [additional action]
  Then [expected outcome]
    And [additional outcome]
    But [exception/negative outcome]
```

#### Checklist Format
```markdown
## Acceptance Criteria
- [ ] User can [action]
- [ ] System displays [feedback]
- [ ] Data is [persisted/validated]
- [ ] Error message shows when [condition]
- [ ] Performance: [metric] under [threshold]
```

#### Rule-Based Format
```yaml
acceptance_rules:
  must:
    - "Save user preferences to database"
    - "Display success message within 2 seconds"
  must_not:
    - "Allow duplicate email addresses"
    - "Expose sensitive data in URL"
  should:
    - "Pre-fill form with last used values"
  could:
    - "Remember user's preferred theme"
```

### 6. Dependency Mapping

```yaml
dependency_types:
  hard_dependency:
    description: "Cannot start until predecessor completes"
    example: "API endpoint must exist before UI can call it"
    
  soft_dependency:
    description: "Can proceed with mocks/stubs"
    example: "Can build UI with mock data while API is developed"
    
  external_dependency:
    description: "Requires external team/service"
    example: "Needs design assets from design team"
    
dependency_visualization:
  format: "mermaid gantt or flowchart"
  include:
    - task_id
    - task_name
    - dependencies
    - estimated_duration
```

### 7. Size Estimation Guidelines

| Size | Story Points | Ideal Hours | Characteristics |
|------|-------------|-------------|-----------------|
| XS | 1 | 1-2 | Single file change, well understood |
| S | 2 | 2-4 | Few files, clear approach |
| M | 3-5 | 4-8 | Multiple components, some unknowns |
| L | 8 | 8-16 | Complex logic, multiple integrations |
| XL | 13+ | 16+ | **Should be decomposed further** |

### 8. Output Format

When decomposing a story, produce:

```yaml
decomposition_result:
  original_story:
    id: "EPIC-001"
    title: "Original epic/story title"
    
  decomposed_stories:
    - id: "STORY-001"
      title: "First sub-story"
      acceptance_criteria: [...]
      tasks:
        - id: "TASK-001"
          title: "First task"
          estimation: "S"
        - id: "TASK-002"
          title: "Second task"
          estimation: "M"
          depends_on: ["TASK-001"]
          
  dependency_graph: |
    ```mermaid
    graph LR
      TASK-001 --> TASK-002
      TASK-001 --> TASK-003
      TASK-002 --> TASK-004
    ```
    
  summary:
    total_stories: 5
    total_tasks: 12
    total_points: 21
    critical_path: ["TASK-001", "TASK-002", "TASK-004"]
    parallel_tracks: 2
```

## Anti-Patterns to Avoid

1. **Technical-only stories** - "Refactor database" (no user value stated)
2. **Solution in story** - "Add Redis caching" (prescribes solution)
3. **Vague acceptance criteria** - "Works correctly" (not testable)
4. **Giant stories** - More than 13 points (not estimable)
5. **Dependent stories** - Can't demo independently (not independent)
6. **Gold plating** - Nice-to-haves mixed with must-haves
