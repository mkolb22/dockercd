---
name: Smart Summarization
description: Intelligent context summarization preserving key information while reducing token usage
version: 1.0.0
author: Dragonfly Framework
applies_to:
  - context-concept
trigger_keywords:
  - summarize
  - compress
  - condense
  - reduce context
  - token limit
  - context overflow
priority: P2
impact: high
---

# Smart Summarization Skill

## Purpose

Enable the Context Concept agent to intelligently summarize and compress context while preserving essential information, decisions, and actionable details.

## Summarization Strategies

### 1. Content-Type Specific Summarization

```yaml
summarization_strategies:
  code:
    method: "structural_extraction"
    preserve:
      - function signatures
      - class definitions
      - type declarations
      - critical logic patterns
    remove:
      - implementation details (when not needed)
      - comments (unless documenting decisions)
      - boilerplate
    output: "signature_summary"
    
  conversation:
    method: "decision_extraction"
    preserve:
      - user requirements
      - agreed decisions
      - constraints identified
      - action items
    remove:
      - greetings/pleasantries
      - repeated clarifications
      - superseded information
    output: "decision_log"
    
  documentation:
    method: "key_point_extraction"
    preserve:
      - main concepts
      - usage examples
      - warnings/gotchas
      - API signatures
    remove:
      - verbose explanations
      - historical context
      - tangential topics
    output: "reference_summary"
    
  error_logs:
    method: "pattern_consolidation"
    preserve:
      - unique error types
      - first occurrence with stack trace
      - count of repetitions
    remove:
      - duplicate entries
      - verbose stack frames
      - timestamps (unless relevant)
    output: "error_digest"
```

### 2. Compression Levels

```yaml
compression_levels:
  minimal:
    ratio: "0.8x"
    preserves: "almost everything"
    removes: "whitespace, comments, redundancy"
    use_when: "slight over budget"
    
  moderate:
    ratio: "0.5x"
    preserves: "structure and key details"
    removes: "implementation details, verbose explanations"
    use_when: "need significant reduction"
    
  aggressive:
    ratio: "0.2x"
    preserves: "decisions and essential facts only"
    removes: "all code details, most context"
    use_when: "severe token pressure"
    
  reference_only:
    ratio: "0.05x"
    preserves: "pointers and identifiers only"
    removes: "all content, keeps references"
    use_when: "archival, can reload if needed"
```

### 3. Code Summarization Templates

```yaml
code_summary_formats:
  class_summary:
    template: |
      class {ClassName}:
        Purpose: {one-line description}
        Inherits: {parent classes}
        Key methods: {method_name(params): return_type}
        Dependencies: {imported modules}
        
  function_summary:
    template: |
      {function_name}({params}) -> {return_type}
        Purpose: {what it does}
        Side effects: {if any}
        Throws: {error types}
        
  file_summary:
    template: |
      File: {path}
      Type: {module|class|utility|config}
      Exports: {public symbols}
      Dependencies: {key imports}
      Summary: {2-3 sentence description}
```

### 4. Conversation Summarization

```yaml
conversation_summary:
  structure:
    context:
      description: "What led to this conversation"
      example: "User is implementing authentication for a Next.js app"
      
    requirements:
      description: "What the user needs"
      items:
        - "OAuth2 login with Google"
        - "Session persistence"
        - "Protected routes"
        
    decisions:
      description: "What was decided"
      items:
        - decision: "Use NextAuth.js library"
          rationale: "Built-in OAuth support, good Next.js integration"
        - decision: "JWT session strategy"
          rationale: "Stateless, scales horizontally"
          
    constraints:
      description: "Limitations identified"
      items:
        - "Must support existing user database"
        - "No server-side state"
        
    action_items:
      description: "What needs to be done"
      items:
        - status: "completed"
          item: "Install NextAuth.js"
        - status: "in_progress"
          item: "Configure Google OAuth provider"
        - status: "pending"
          item: "Add protected route middleware"
          
    open_questions:
      description: "Unresolved items"
      items:
        - "How to handle token refresh?"
```

### 5. Incremental Summarization

```yaml
incremental_approach:
  trigger: "context_usage > 70%"
  
  steps:
    1. identify_oldest:
       action: "Find oldest conversation turns"
       criteria: "Not referenced in last 5 turns"
       
    2. extract_decisions:
       action: "Pull out key decisions and requirements"
       preserve: "Action items and constraints"
       
    3. compress_in_place:
       action: "Replace verbose content with summary"
       maintain: "Reference IDs for potential reload"
       
    4. archive_original:
       action: "Store full content in memory"
       retrieval: "On-demand via ID"

  example:
    before:
      turn_count: 50
      tokens: 45000
      
    after:
      turn_count: 50  # logically same
      tokens: 12000
      summary_created: true
      archived_turns: 35
```

### 6. Information Preservation Rules

```yaml
preservation_rules:
  never_lose:
    - user_stated_requirements
    - explicit_constraints
    - agreed_decisions
    - error_messages_being_debugged
    - file_paths_being_edited
    - api_keys_patterns  # redacted but noted
    
  preserve_reference:
    - code_structure_overview
    - dependency_relationships
    - type_definitions
    
  safe_to_compress:
    - explanation_of_concepts
    - alternative_approaches_rejected
    - verbose_code_examples
    
  safe_to_remove:
    - greetings_and_acknowledgments
    - duplicate_information
    - superseded_decisions
    - failed_approaches_details
```

### 7. Quality Validation

```yaml
summarization_validation:
  completeness_check:
    - all_decisions_preserved: true
    - all_requirements_captured: true
    - all_action_items_listed: true
    - no_orphan_references: true  # nothing references removed content
    
  accuracy_check:
    - no_information_distortion: true
    - correct_attribution: true
    - proper_context_preserved: true
    
  usability_check:
    - summary_self_contained: true  # understandable without original
    - can_continue_work: true  # enough info to proceed
    - references_resolvable: true  # can reload if needed
```

### 8. Output Formats

```yaml
summary_output:
  compact_format:
    template: |
      ## Session Summary
      **Goal**: {primary_objective}
      **Status**: {current_status}
      
      ### Decisions
      {bulleted_decision_list}
      
      ### In Progress
      {current_work_description}
      
      ### Next Steps
      {bulleted_next_steps}
      
  structured_format:
    template:
      session:
        id: "{session_id}"
        started: "{timestamp}"
        summarized_at: "{timestamp}"
        
      context:
        project: "{project_name}"
        goal: "{objective}"
        
      decisions: []
      requirements: []
      constraints: []
      action_items: []
      
      working_context:
        current_file: "{path}"
        current_task: "{description}"
        
      archived_references:
        - id: "{ref_id}"
          type: "conversation"
          tokens_saved: 5000
```

## Summarization Algorithm

```python
def smart_summarize(context, target_tokens, level='moderate'):
    """
    Intelligently summarize context to fit within token budget.
    """
    current_tokens = count_tokens(context)
    
    if current_tokens <= target_tokens:
        return context  # No summarization needed
    
    # Phase 1: Remove safe-to-remove content
    context = remove_redundancy(context)
    context = remove_superseded(context)
    
    if count_tokens(context) <= target_tokens:
        return context
    
    # Phase 2: Compress by content type
    for item in context.items:
        if item.type == 'conversation' and item.age > 10:
            item.content = summarize_conversation(item, level)
        elif item.type == 'code' and not item.actively_edited:
            item.content = summarize_code(item, level)
        elif item.type == 'log' and item.has_duplicates:
            item.content = consolidate_logs(item)
    
    if count_tokens(context) <= target_tokens:
        return context
    
    # Phase 3: Aggressive compression
    context = extract_decisions_only(context)
    context = keep_active_work_only(context)
    
    return context
```

## Integration Points

- **Context Prioritization**: Use priority scores to guide what to preserve
- **Semantic Memory**: Archive full content for potential retrieval
- **Incremental Loading**: Reload summarized content on demand
