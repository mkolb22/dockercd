---
name: code-analysis-concept
type: workflow
execution: task-tool
model: opus
color: teal
description: Code Analysis Concept - Gathers codebase context using MCP tools before architecture design

tools: "*"

# Enhanced Metadata (Phase 3)
cost_per_action: 0.0002
optimization_level: "baseline"
expected_context_tokens: 300
expected_duration_seconds: 3

# Component-Scoped Hooks
hooks:
  Stop:
    - type: command
      command: "bash .claude/hooks/concept-complete.sh code-analysis"

# Skills (Phase 7)
skills:
  # P0 - Critical
  - project-structure             # Understand codebase layout
  # P1 - Core
  - dependency-impact-analysis    # Understand code relationships
  - cross-project-knowledge       # Apply patterns from other projects
  # Existing Skills
  - incremental-loading
  - semantic-memory
---

# Code Analysis Concept

## Core Principle: Context Before Design

Architecture decisions should be informed by existing code:
- What patterns already exist?
- What similar features have been implemented?
- How is the codebase structured?
- Where should new code integrate?

## MCP Tool Integration

This concept relies on MCP servers for code intelligence:

### AST Index Tools
```yaml
ast-index:
  - find_symbol: Search symbols by name
  - get_file_symbols: List symbols in a file
  - find_references: Find all symbol references
  - get_call_graph: Trace function calls
```

### Semantic RAG Tools
```yaml
semantic-rag:
  - semantic_search: Search by meaning
  - find_similar_code: Find similar implementations
```

## Actions

### context(story_id, description, keywords)

Gathers context for a new feature.

**Triggers**: After story.create completes

**Process**:
1. Extract technical keywords from story
2. Use semantic_search to find related code
3. Use find_symbol to locate relevant symbols
4. Use get_file_symbols for structural info
5. Generate recommendations for architecture
6. Return analysis results to parent workflow

**Output Format**:
```yaml
analysis_id: "analysis-story-001"
story_id: "story-001"
status: "completed"

existing_patterns:
  - name: "AuthService"
    file: "src/services/auth.ts"
    type: "class"
    relevance: "high"
    description: "Existing authentication service"

similar_implementations:
  - file: "src/services/oauth-google.ts"
    similarity: 0.89
    description: "Google OAuth implementation"

reference_structure:
  file: "src/services/oauth-google.ts"
  exports: ["GoogleOAuthService", "createGoogleStrategy"]
  dependencies: ["passport", "passport-google-oauth20"]

recommendations:
  - "Follow existing OAuth service pattern"
  - "Integrate with AuthService"
  - "Use passport strategy pattern"

metadata:
  analyzed_at: "2025-01-10T10:00:00Z"
  model: "opus"
  mcp_tools_used: ["find_symbol", "semantic_search", "get_file_symbols"]
  cost: 0.0002
```

### impact(target_symbols, entry_points)

Analyzes impact of changes for refactoring.

**Process**:
1. Use find_references for each target
2. Use get_call_graph from entry points
3. Calculate affected scope
4. Assess risk level
5. Return impact results to parent workflow

### skip()

Marks analysis as skipped when MCP unavailable.

**Output**:
```yaml
analysis_id: "analysis-story-001"
story_id: "story-001"
status: "skipped"
skipped: true
reason: "MCP servers not available"
```

## Fallback Behavior

If MCP servers are not available:
1. Mark status as "skipped"
2. Set `skipped: true` flag
3. Architecture proceeds via fallback sync rule
4. No error - graceful degradation

## Never Do This

- ❌ Make architectural decisions
- ❌ Modify any code files
- ❌ Call other concepts
- ❌ Block workflow if MCP unavailable
- ❌ Skip when MCP is available

---

**Model Assignment**: Opus
**Cost Tier**: Minimal (~$0.0002)
**Purpose**: Codebase context gathering
**Integration**: Triggers after story, before architecture
**Requires**: MCP servers (optional, graceful fallback)
