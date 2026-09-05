---
name: Context Prioritization
description: Intelligently prioritize and select context based on task relevance and token budget
version: 1.0.0
author: Dragonfly Framework
applies_to:
  - context-concept
trigger_keywords:
  - context
  - priority
  - relevance
  - token budget
  - context window
  - memory management
priority: P1
impact: high
---

# Context Prioritization Skill

## Purpose

Enable the Context Concept agent to intelligently select, prioritize, and manage context within token budgets while maximizing task relevance and minimizing information loss.

## Prioritization Framework

### 1. Context Classification

```yaml
context_tiers:
  tier_1_critical:
    description: "Essential for task completion"
    retention: "always_include"
    examples:
      - current task definition
      - active file content being edited
      - error messages being debugged
      - user's explicit requirements
    token_budget: "40%"
    
  tier_2_important:
    description: "Highly relevant supporting context"
    retention: "include_if_space"
    examples:
      - related file imports/dependencies
      - type definitions used by current code
      - recent conversation history
      - test files for code being modified
    token_budget: "30%"
    
  tier_3_supporting:
    description: "Useful but not essential"
    retention: "summarize_or_drop"
    examples:
      - project structure overview
      - similar code examples
      - documentation snippets
      - historical decisions
    token_budget: "20%"
    
  tier_4_background:
    description: "General knowledge, rarely needed"
    retention: "drop_first"
    examples:
      - full file contents of unchanged files
      - verbose logs
      - configuration files not being modified
      - older conversation turns
    token_budget: "10%"
```

### 2. Relevance Scoring Algorithm

```python
def calculate_relevance_score(context_item, task):
    """
    Score context items from 0.0 to 1.0 based on task relevance.
    """
    score = 0.0
    
    # Recency factor (0.0 - 0.25)
    recency = calculate_recency(context_item.timestamp)
    score += recency * 0.25
    
    # Semantic similarity (0.0 - 0.35)
    similarity = calculate_semantic_similarity(
        context_item.content, 
        task.description
    )
    score += similarity * 0.35
    
    # Explicit reference (0.0 - 0.20)
    if context_item.id in task.referenced_items:
        score += 0.20
    
    # Dependency relationship (0.0 - 0.15)
    if is_dependency(context_item, task.target_files):
        score += 0.15
    
    # User emphasis (0.0 - 0.05)
    if context_item.user_emphasized:
        score += 0.05
    
    return min(score, 1.0)
```

### 3. Token Budget Management

```yaml
budget_allocation:
  total_context_window: 200000  # tokens
  
  reserved_allocations:
    system_prompt: 5000
    tools_schema: 3000
    response_buffer: 10000
    safety_margin: 2000
    
  available_for_context: 180000
  
  dynamic_allocation:
    method: "proportional_with_floor"
    tier_minimums:
      tier_1: 20000  # Always reserve this much
      tier_2: 10000
      tier_3: 5000
      tier_4: 0
```

### 4. Context Selection Strategy

```yaml
selection_algorithm:
  step_1_classify:
    action: "Assign each context item to a tier"
    criteria: "Based on context_tiers definitions"
    
  step_2_score:
    action: "Calculate relevance score for each item"
    method: "calculate_relevance_score()"
    
  step_3_rank:
    action: "Sort items within each tier by score"
    order: "descending"
    
  step_4_allocate:
    action: "Fill budget starting from tier_1"
    method: |
      for tier in [tier_1, tier_2, tier_3, tier_4]:
        budget = tier.token_budget
        for item in tier.items_sorted_by_score:
          if item.tokens <= remaining_budget:
            include(item)
            remaining_budget -= item.tokens
            
  step_5_compress:
    action: "Apply compression to included items if needed"
    methods:
      - truncation: "Remove less relevant sections"
      - summarization: "Replace verbose content with summaries"
      - reference: "Replace content with pointers/IDs"
```

### 5. Compression Strategies

```yaml
compression_techniques:
  code_compression:
    strategy: "signature_only"
    description: "Keep function signatures, remove bodies"
    compression_ratio: "~70%"
    example:
      before: |
        function processOrder(order: Order): Result {
          // 50 lines of implementation
        }
      after: |
        function processOrder(order: Order): Result { /* ... */ }
        
  conversation_compression:
    strategy: "key_points_extraction"
    description: "Extract decisions and requirements"
    compression_ratio: "~80%"
    template: |
      Previous discussion established:
      - Requirement: [key requirement]
      - Decision: [key decision]
      - Constraint: [key constraint]
      
  file_compression:
    strategy: "relevant_sections"
    description: "Include only referenced functions/classes"
    compression_ratio: "~60%"
    method: "AST-based extraction"
```

### 6. Context Refresh Triggers

```yaml
refresh_triggers:
  immediate_refresh:
    - task_change: "New task started"
    - error_encountered: "Debugging context needed"
    - user_request: "Explicit context update request"
    
  periodic_refresh:
    interval: "every 5 turns"
    action: "Re-score and rebalance context"
    
  threshold_refresh:
    trigger: "budget_utilization > 90%"
    action: "Aggressive compression and pruning"
```

### 7. Context Tracking Metadata

```yaml
context_item:
  id: "ctx_123"
  type: "file|conversation|memory|tool_result"
  content: "..."
  tokens: 1500
  
  metadata:
    added_at: "2024-01-15T10:30:00Z"
    last_accessed: "2024-01-15T10:35:00Z"
    access_count: 3
    tier: "tier_2"
    relevance_score: 0.75
    
  relationships:
    depends_on: ["ctx_100", "ctx_101"]
    referenced_by: ["ctx_150"]
    
  compression_state:
    original_tokens: 3000
    current_tokens: 1500
    method: "signature_only"
    reversible: true
```

### 8. Priority Override Rules

```yaml
priority_overrides:
  always_include:
    - current_error_message
    - user_last_message
    - active_file_path
    - explicit_user_pins
    
  never_compress:
    - code_being_edited
    - test_assertions
    - api_contracts
    
  always_drop_first:
    - verbose_logs
    - duplicate_content
    - stale_tool_results  # older than 10 turns
```

## Output Format

Context prioritization decisions should include:

```yaml
prioritization_result:
  task_id: "task_123"
  budget_used: 145000
  budget_available: 180000
  
  included_context:
    tier_1:
      items: 5
      tokens: 72000
    tier_2:
      items: 8
      tokens: 54000
    tier_3:
      items: 3
      tokens: 19000
    tier_4:
      items: 0
      tokens: 0
      
  compression_applied:
    - item: "ctx_105"
      method: "signature_only"
      savings: 2500
      
  excluded_items:
    - item: "ctx_50"
      reason: "low_relevance_score"
      score: 0.15
      
  recommendations:
    - "Consider archiving conversation turns older than 20 messages"
    - "File src/utils.ts has low access frequency, candidate for exclusion"
```

## Integration Points

- **Semantic Memory**: Query for relevant past context
- **Incremental Loading**: Load only high-priority sections first
- **Provenance Analysis**: Track which context informed decisions
