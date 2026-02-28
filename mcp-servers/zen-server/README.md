# Zen MCP Server

A unified Model Context Protocol (MCP) server providing 76 tools for code intelligence, semantic search, persistent memory, workflow orchestration, test generation, self-repair, knowledge graphs, and more.

## Overview

The zen-server provides 76 tools across 11 modules:

| Module | Tools | Description |
|--------|-------|-------------|
| **AST Indexing** | 8 | Symbol navigation via tree-sitter parsing |
| **Semantic Search** | 4 | Meaning-based search with embeddings |
| **Memory** | 7 | Episodic, semantic, and procedural memory |
| **Framework/Orchestration** | 11 | Workflow planning, concept serving, session management |
| **State Management** | 10 | Health tracking, events, checkpoints, stories via SQLite |
| **Prompt Evolution** | 4 | Orchestrated genetic prompt optimization |
| **Spec** | 6 | Type-safe specification DSL |
| **Compete** | 6 | Statistical A/B testing and ablation |
| **Testing** | 7 | Test generation, execution, coverage analysis |
| **Repair** | 6 | Self-repair and iterative code refinement |
| **Knowledge Graph** | 7 | Entity/relation graphs with hybrid search |

## Quick Start

```bash
# Install dependencies
npm install

# Build
npm run build

# Run (via Claude Code MCP)
node dist/index.js
```

## Tools

### AST Indexing (8 tools)

| Tool | Description |
|------|-------------|
| `index_project` | Build/rebuild AST index |
| `find_symbol` | Search symbols by name |
| `get_symbol_info` | Get symbol details |
| `find_references` | Find all references |
| `get_call_graph` | Trace call relationships |
| `find_implementations` | Find interface implementations |
| `get_file_symbols` | List file symbols |
| `search_by_signature` | Search by type signature |

### Semantic Search (4 tools)

| Tool | Description |
|------|-------------|
| `embed_project` | Create code embeddings |
| `semantic_search` | Search by meaning |
| `find_similar_code` | Find similar patterns |
| `get_embedding_stats` | Index statistics |

### Memory (7 tools)

| Tool | Description |
|------|-------------|
| `memory_store` | Store with auto-embedding and auto-linking |
| `memory_recall` | Semantic search with optional graph traversal |
| `memory_evolve` | Update confidence (supports/contradicts/extends/supersedes) |
| `memory_link` | Manual relationship creation |
| `memory_forget` | Archive memory (soft delete) |
| `memory_graph` | BFS subgraph exploration |
| `memory_stats` | Health metrics and decay trigger |

### Framework/Orchestration (11 tools)

| Tool | Description |
|------|-------------|
| `zen_get_concept` | Get concept definition |
| `zen_get_workflow` | Get command workflow instructions |
| `zen_get_agent_prompt` | Get enriched agent prompt with skills |
| `zen_get_skills` | Find skills by name/agent/task |
| `zen_plan_workflow` | Plan workflow with cost estimates |
| `zen_start_workflow` | Start tracked workflow session |
| `zen_advance_workflow` | Record step and advance workflow |
| `zen_evaluate_sync` | Evaluate synchronization rules |
| `zen_get_workflow_state` | Get workflow session state |
| `zen_framework_status` | Framework content status |
| `zen_reload_framework` | Reload content from disk |

### State Management (10 tools)

| Tool | Description |
|------|-------------|
| `zen_health_update` | Update context health status |
| `zen_health_get` | Get context health |
| `zen_event_log` | Log operational event |
| `zen_checkpoint_save` | Save session checkpoint |
| `zen_checkpoint_list` | List checkpoints |
| `zen_checkpoint_get` | Get checkpoint by ID |
| `zen_checkpoint_restore` | Restore with progressive layers |
| `zen_story_save` | Save story requirements |
| `zen_story_get` | Get story by ID |
| `zen_story_list` | List stories |

### Prompt Evolution (4 tools)

| Tool | Description |
|------|-------------|
| `evolve_start` | Create evolution session |
| `evolve_submit` | Submit evaluated variants |
| `evolve_status` | Check session progress |
| `evolve_best` | Get winning variant |

### Spec (6 tools)

| Tool | Description |
|------|-------------|
| `zen_spec_save` | Save/update a specification |
| `zen_spec_get` | Get spec by ID or name |
| `zen_spec_list` | List specs with filters |
| `zen_spec_generate` | Generate code prompt from spec |
| `zen_spec_export` | Export specs to JSON |
| `zen_spec_import` | Import specs from JSON |

### Competitive Evaluation (6 tools)

| Tool | Description |
|------|-------------|
| `compete_start` | Start A/B evaluation session |
| `compete_submit` | Submit arm scores |
| `compete_status` | Get competition status |
| `compete_results` | Get statistical results |
| `compete_ablate_start` | Start ablation testing |
| `compete_ablate_submit` | Submit ablation scores |

### Testing (7 tools)

| Tool | Description |
|------|-------------|
| `generate_unit_tests` | Generate test templates from code |
| `generate_integration_tests` | Generate integration tests |
| `run_tests` | Execute tests with structured results |
| `analyze_coverage` | Analyze coverage gaps |
| `find_untested_files` | Find files without tests |
| `suggest_tests` | Suggest test types for code |
| `get_test_command` | Get framework-appropriate test command |

### Repair (6 tools)

| Tool | Description |
|------|-------------|
| `run_with_verification` | Execute and repair on failure |
| `self_debug` | Diagnose failing code |
| `iterative_refine` | Multi-pass code improvement |
| `run_tests_with_repair` | Run tests, repair failures |
| `get_repair_history` | Past repairs for similar errors |
| `list_repair_strategies` | Available repair strategies |

### Knowledge Graph (7 tools)

| Tool | Description |
|------|-------------|
| `kg_ingest` | Extract entities from text |
| `kg_ingest_ast` | Bridge AST index into KG |
| `kg_entity` | Get/create entity (idempotent) |
| `kg_relate` | Create typed relation |
| `kg_query` | Hybrid search (semantic+keyword+graph) |
| `kg_traverse` | Graph traversal from entity |
| `kg_community` | Detect/query communities |

## Configuration

### Claude Code Settings

Add to `.claude/settings.local.json`:

```json
{
  "mcpServers": {
    "zen-server": {
      "command": "node",
      "args": ["mcp-servers/zen-server/dist/index.js"],
      "cwd": "${PROJECT_ROOT}"
    }
  }
}
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PROJECT_ROOT` | `cwd` | Project root directory |
| `ZEN_INDEX_PATH` | `koan/index` | AST index location |
| `ZEN_EMBEDDING_MODEL` | `all-MiniLM-L6-v2` | Embedding model |
| `ZEN_MEMORY_ENABLED` | `true` | Enable memory system |
| `ZEN_MEMORY_DB_PATH` | `koan/memory/memory.db` | Memory database path |
| `ZEN_MEMORY_DECAY_GRACE_DAYS` | `7` | Days before decay applies |
| `ZEN_MEMORY_AUTO_LINK_THRESHOLD` | `0.4` | Similarity for auto-linking |
| `ZEN_FRAMEWORK_ENABLED` | `true` | Enable framework module |
| `ZEN_STATE_ENABLED` | `true` | Enable state store |
| `ZEN_STATE_DB_PATH` | `koan/state/state.db` | State database path |
| `ZEN_EVOLVE_ENABLED` | `true` | Enable prompt evolution |

## Architecture

```
src/
├── index.ts              # Entry point
├── core/
│   ├── server.ts         # MCP server setup
│   ├── store.ts          # BaseStore (SQLite)
│   ├── types.ts          # Shared types
│   ├── config.ts         # Centralized configuration
│   ├── dispatcher.ts     # Tool routing with timeouts
│   └── annotations.ts    # Tool safety annotations
├── tools/
│   ├── ast/              # AST indexing (8 tools)
│   ├── semantic/         # Semantic search (4 tools)
│   ├── memory/           # Persistent memory (7 tools)
│   ├── framework/        # Orchestration (11 tools)
│   ├── state/            # State management (10 tools)
│   ├── evolve/           # Prompt evolution (4 tools)
│   ├── spec/             # Spec DSL (6 tools)
│   ├── compete/          # Competitive eval (6 tools)
│   ├── testing/          # Testing (7 tools)
│   ├── repair/           # Repair (6 tools)
│   └── knowledge/        # Knowledge graph (7 tools)
└── utils/
    ├── execution.ts      # Process execution, test running
    ├── embedder.ts       # Shared embedding model
    ├── vectors.ts        # Vector math
    ├── graph.ts          # BFS traversal
    ├── responses.ts      # Response helpers
    ├── guards.ts         # Config guards
    ├── lazy.ts           # Lazy loader utilities
    ├── ids.ts            # ID generation
    ├── project.ts        # File utilities
    └── languages.ts      # Language config
```

## Dependencies

- **@modelcontextprotocol/sdk** - MCP protocol implementation
- **better-sqlite3** - SQLite for indexes
- **web-tree-sitter** - AST parsing
- **@huggingface/transformers** - Local embeddings
- **fast-glob** - File discovery

## Supported Languages

| Language | AST | Embedding |
|----------|-----|-----------|
| TypeScript | Yes | Yes |
| JavaScript | Yes | Yes |
| Python | Yes | Yes |
| Go | Yes | Yes |
| Rust | Yes | Yes |
| Java | Yes | Yes |
| C | Yes | Yes |

## Development

```bash
# Type check
npx tsc --noEmit

# Run tests
npx vitest run

# Build
npm run build

# Test with tsx (development)
npx tsx src/index.ts
```

## Theoretical Foundations

### Memory System

The 3-tiered memory architecture is based on:

- **Tulving (1972)** - "Episodic and Semantic Memory" (Organization of Memory)
  - Distinction between event-based (episodic) and fact-based (semantic) memory
  - Procedural memory for workflow/how-to knowledge

- **Anderson (1983)** - "The Architecture of Cognition" (Harvard University Press)
  - Activation-based memory retrieval
  - Confidence decay with access-based reinforcement

### Tool Safety Annotations

The annotation system follows principles from:

- **Sandhu et al. (1996)** - "Role-Based Access Control Models" (IEEE Computer)
  - Safety classification enables intelligent tool routing
  - ReadOnly/Mutating/Destructive tiers mirror permission levels

## License

MIT
