---
name: Incremental Context Loading
description: Load only necessary context using MCP-first approach for 70% additional token savings
version: 1.0.0
trigger_keywords: [incremental, loading, context, mcp, serena, symbols, overview]
author: Dragonfly Architecture
---

# Incremental Context Loading - Expert Skill

Load context progressively using MCP tools to minimize token usage while maintaining full understanding.

## Purpose

Incremental loading provides:
- **70% additional context reduction**: On top of Phase 1's 85% savings
- **Faster concept execution**: Less context to process means faster LLM responses
- **Targeted exploration**: Find exactly what you need without reading everything
- **Cost optimization**: Pay only for context you actually use

## When to Use

Use incremental loading:
- ✅ **Always** when exploring unfamiliar code
- ✅ When surveying codebase structure
- ✅ When finding similar implementations
- ✅ When locating specific symbols to modify
- ✅ Before reading any full files

## Loading Strategy

### Stage 1: Overview (100 tokens)

**Goal**: Understand high-level structure without reading code

**Use MCP Tools**:
```yaml
# Get file structure
mcp__serena__get_symbols_overview:
  relative_path: "src/auth/oauth.ts"
  max_answer_chars: 5000

# Returns: Symbol names, types, signatures
# Cost: ~100 tokens (vs 5000 for full file)
```

**What You Get**:
- Class names and inheritance
- Method signatures (no bodies)
- Import statements
- High-level organization

**When This Is Enough**:
- Architecture: Understanding component structure
- Quality Review: Checking public API consistency
- /sync: Evaluating if file is relevant

### Stage 2: Targeted Symbols (500 tokens)

**Goal**: Load specific symbols you need to understand or modify

**Use MCP Tools**:
```yaml
# Find specific symbol
mcp__serena__find_symbol:
  name_path: "OAuthController/authenticate"
  relative_path: "src/auth/oauth.ts"
  include_body: true
  depth: 0

# Returns: Just the authenticate method
# Cost: ~500 tokens (vs 5000 for full file)
```

**What You Get**:
- Complete implementation of target symbol
- No unrelated code
- Enough context for understanding/modification

**When This Is Enough**:
- Implementation: Modifying specific methods
- Quality Review: Checking specific functions
- Debugging: Understanding failure points

### Stage 3: Full Context (2000+ tokens)

**Goal**: Load complete file when symbol-level access insufficient

**Use Standard Tools**:
```yaml
# Read full file
Read:
  file_path: "src/auth/oauth.ts"

# Cost: 2000-5000 tokens
```

**When Full Context Is Needed**:
- Major refactoring across entire file
- Understanding complex interactions between many symbols
- Creating new files (no existing symbols to target)

## MCP-First Approach

### Always Start With MCP

**Golden Rule**: Never read a full file before checking if MCP tools can answer your question.

**MCP Tool Priority**:
1. **get_symbols_overview** - High-level structure (cheapest)
2. **find_symbol** - Specific code (targeted)
3. **search_for_pattern** - Similar implementations (focused)
4. **find_referencing_symbols** - Dependencies (relationship mapping)
5. **Read** - Full file (last resort, most expensive)

### Example: Architecture Exploration

**❌ Old Way (Expensive)**:
```yaml
# Read 10 full files to understand auth system
Read: src/auth/oauth.ts      # 5000 tokens
Read: src/auth/session.ts    # 4500 tokens
Read: src/auth/providers.ts  # 3000 tokens
...
Total: 50,000 tokens
Cost: $0.15 (Opus)
```

**✅ New Way (MCP-First)**:
```yaml
# Get overview of each file
get_symbols_overview: src/auth/oauth.ts      # 100 tokens
get_symbols_overview: src/auth/session.ts    # 100 tokens
get_symbols_overview: src/auth/providers.ts  # 80 tokens
...
Total: 1,000 tokens
Cost: $0.003 (Opus)

Savings: 98% ($0.147 saved)
```

## Progressive Context Building

### Pattern: Build Context in Layers

**Layer 1: Discovery** (100-200 tokens)
```yaml
1. Use get_symbols_overview for all relevant files
2. Identify key components and their relationships
3. Note which symbols need deeper investigation
```

**Layer 2: Focused Exploration** (500-1000 tokens)
```yaml
4. Use find_symbol for identified key symbols
5. Include bodies only for symbols you'll modify
6. Use depth=1 to see child symbols without bodies
```

**Layer 3: Deep Dive** (2000+ tokens, if needed)
```yaml
7. Read full files only for complex modifications
8. At this point you know exactly what you're looking for
9. Prune earlier context that's no longer relevant
```

### Example: Implementation Task

**Task**: Add Google OAuth provider to existing auth system

**Layer 1: Discovery**
```yaml
# What exists?
get_symbols_overview: src/auth/oauth.ts
  → OAuthController class
  → authenticateWithProvider method
  → getCurrentProviders method

get_symbols_overview: src/auth/providers.ts
  → GitHubProvider class
  → BaseProvider interface

Conclusion: Need to add GoogleProvider similar to GitHubProvider
Tokens: 200
```

**Layer 2: Focused Exploration**
```yaml
# How does GitHubProvider work?
find_symbol:
  name_path: "GitHubProvider"
  relative_path: "src/auth/providers.ts"
  include_body: true
  → Complete implementation (150 lines)

# What's the interface?
find_symbol:
  name_path: "BaseProvider"
  relative_path: "src/auth/providers.ts"
  include_body: true
  → Interface definition (20 lines)

Conclusion: Know exactly what to implement for GoogleProvider
Tokens: 500
```

**Layer 3: Implementation** (may not need full context)
```yaml
# Create GoogleProvider using GitHubProvider as template
# Use replace_symbol_body or insert_after_symbol
# No need to read full file!

Tokens: 100 (just for writing)
```

**Total Tokens**: 800 (vs 10,000+ with full-file approach)
**Savings**: 92%

## Context Pruning

### Remove Irrelevant Context

**After each stage, prune context**:
```yaml
Stage 1: Keep only relevant file paths
  - Drop files not related to task
  - Keep list of interesting symbols

Stage 2: Keep only symbols being modified
  - Drop exploration-only symbols
  - Keep dependencies and modification targets

Stage 3: Keep only current work area
  - Drop symbols from completed work
  - Keep immediate context for current modification
```

### Example Pruning

**After Layer 1**:
```yaml
Discovered 20 files in auth system
Relevant: 3 files (oauth.ts, providers.ts, session.ts)
Pruned: 17 files
Savings: 85% of initial discovery cost
```

**After Layer 2**:
```yaml
Explored 8 symbols across 3 files
Relevant: 2 symbols (GitHubProvider, BaseProvider)
Pruned: 6 symbols
Savings: 75% of exploration cost
```

## Integration with Concepts

### Architecture Concept

**Add to architecture.md.template**:
```markdown
## Step 1: Survey Existing Architecture

**Use MCP tools to build understanding**:

1. **Identify relevant directories**
   ```bash
   mcp__serena__list_dir:
     relative_path: "src"
     recursive: false
   ```

2. **Get overview of key files**
   ```bash
   # For each relevant file
   mcp__serena__get_symbols_overview:
     relative_path: "{file}"
   ```

3. **Explore similar implementations**
   ```bash
   mcp__serena__search_for_pattern:
     substring_pattern: "{pattern}"
     relative_path: "src"
   ```

**Do NOT read full files yet!**

Use overviews to understand:
- Component boundaries
- Existing patterns
- Integration points
- Similar features

Only use Read tool if MCP tools insufficient.
```

### Implementation Concept

**Add to implementation.md.template**:
```markdown
## Step 1: Locate Modification Targets

**Use MCP tools for targeted exploration**:

1. **Find symbols to modify**
   ```bash
   mcp__serena__find_symbol:
     name_path: "{symbol}"
     relative_path: "{file}"
     include_body: false  # Start without body
     depth: 1             # See children
   ```

2. **Load only necessary symbol bodies**
   ```bash
   mcp__serena__find_symbol:
     name_path: "{specific_symbol}"
     include_body: true   # Now get the code
   ```

3. **Find references before modifying**
   ```bash
   mcp__serena__find_referencing_symbols:
     name_path: "{symbol}"
     relative_path: "{file}"
   ```

**Progressive loading**:
- Start: Symbol names only
- Then: Signatures and structure
- Finally: Bodies for modification

This approach uses 90% fewer tokens than reading full files.
```

### Quality Review Concept

**Add to quality.md.template (review)**:
```markdown
## Step 1: Identify Changed Symbols

**Use MCP tools to target review**:

1. **Get overview of changed files**
   ```bash
   # For each file in implementation.files_changed
   mcp__serena__get_symbols_overview:
     relative_path: "{file}"
   ```

2. **Load only changed/new symbols**
   ```bash
   mcp__serena__find_symbol:
     name_path: "{changed_symbol}"
     include_body: true
   ```

3. **Check dependencies**
   ```bash
   mcp__serena__find_referencing_symbols:
     name_path: "{changed_symbol}"
     relative_path: "{file}"
   ```

**Review focus**:
- Load only what changed
- Check references to ensure compatibility
- Skip unchanged code

This targets review effort precisely where needed.
```

## Performance Impact

### Token Reduction Examples

**Architecture Exploration**:
- Full-file approach: 50,000 tokens
- MCP-first approach: 1,000 tokens
- **Savings: 98% (49,000 tokens)**

**Implementation Task**:
- Full-file approach: 10,000 tokens
- Incremental loading: 800 tokens
- **Savings: 92% (9,200 tokens)**

**Quality Review**:
- Full-file approach: 15,000 tokens
- Targeted symbols: 2,000 tokens
- **Savings: 87% (13,000 tokens)**

### Cost Savings

**Per-Architecture**:
- Before: $0.15 (50K tokens @ Opus)
- After: $0.003 (1K tokens @ Opus)
- **Savings: $0.147 (98%)**

**Per-Feature Workflow**:
- Before: $0.25 (architecture + implementation + review)
- After: $0.01 (incremental loading throughout)
- **Savings: $0.24 (96%)**

**Annual** (100 features):
- Before: $25
- After: $1
- **Savings: $24**

### Speed Improvements

**Faster LLM Responses**:
- Less context → faster processing
- Typical improvement: 30-40% faster
- Architecture: 8min → 5min
- Implementation: 5min → 3min

**Reduced Latency**:
- Fewer tokens to transmit
- Faster first token
- Better user experience

## Best Practices

### 1. Always Start with Overview

```yaml
# Before any full file read
get_symbols_overview: {file}

# Understand structure first
# Then decide if you need more
```

### 2. Use Depth Parameter Wisely

```yaml
# See class with method signatures (no bodies)
find_symbol:
  name_path: "MyClass"
  include_body: false
  depth: 1  # Shows methods but not their code

# Then load specific method
find_symbol:
  name_path: "MyClass/myMethod"
  include_body: true
```

### 3. Search Before Reading

```yaml
# Find similar patterns first
search_for_pattern:
  substring_pattern: "class.*Provider"
  relative_path: "src/auth"

# Then read only the relevant ones
```

### 4. Prune Aggressively

```yaml
# After each stage, ask:
# - Do I still need this context?
# - Is this relevant to current task?
# - Can I drop this to save tokens?
```

### 5. Track Your Savings

```yaml
# Before: Estimate full-file token cost
# After: Calculate actual tokens used
# Report: Show savings achieved

Example:
"Used incremental loading: 1,200 tokens (vs 15,000 traditional)"
"Savings: 92% ($0.042 saved)"
```

## Common Patterns

### Pattern 1: File Discovery

```yaml
# List directory
list_dir:
  relative_path: "src/auth"
  recursive: true

# Get overview of each file
for file in files:
  get_symbols_overview: file

# Total: 500-1000 tokens (vs 50,000 full read)
```

### Pattern 2: Symbol Modification

```yaml
# Find symbol without body
find_symbol:
  name_path: "MyClass/myMethod"
  include_body: false

# Check if this is the right one
# Then load body
find_symbol:
  name_path: "MyClass/myMethod"
  include_body: true

# Modify using replace_symbol_body
```

### Pattern 3: Dependency Analysis

```yaml
# Find symbol
find_symbol:
  name_path: "MyClass/myMethod"
  include_body: true

# Find what depends on it
find_referencing_symbols:
  name_path: "MyClass/myMethod"
  relative_path: "{file}"

# Load only references that matter
```

## Troubleshooting

### Issue: MCP Tool Returns Too Much

**Problem**: get_symbols_overview returns huge output
**Solution**: Use max_answer_chars parameter
```yaml
get_symbols_overview:
  relative_path: "{file}"
  max_answer_chars: 5000  # Limit output
```

### Issue: Can't Find Symbol

**Problem**: find_symbol doesn't match expected symbol
**Solution**: Use search_for_pattern first
```yaml
search_for_pattern:
  substring_pattern: "{approximate_name}"
  relative_path: "{file}"
```

### Issue: Need Full Context After All

**Problem**: Incremental loading insufficient for complex refactoring
**Solution**: That's okay! Read full file when needed
```yaml
# You tried MCP first (good!)
# Now read full context (justified!)
Read:
  file_path: "{file}"
```

## Related Documents

- **MCP Integration** (Phase 1 Day 1-2) - MCP tools documentation
- **architecture.md.template** - Updated with incremental loading
- **implementation.md.template** - Updated with targeted symbol loading
- **DRAGONFLY_PHASE2_PROGRESS.md** - Week 1 Day 1-3 tracking

---

**Use this skill when**: Exploring codebases, implementing features, reviewing code, or any task that requires understanding existing code. Always start with MCP tools before reading full files.
