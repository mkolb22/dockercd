# Zen MCP Server

A unified Model Context Protocol (MCP) server providing 44 tools for code intelligence, semantic search, persistent memory, workflow orchestration, state management, and prompt evolution.

## Overview

The zen-server consolidates 6 modules into a single MCP server:

| Module | Tools | Description |
|--------|-------|-------------|
| **AST Indexing** | 8 | Symbol navigation via tree-sitter parsing |
| **Semantic Search** | 4 | Meaning-based search with embeddings |
| **Memory** | 7 | Episodic, semantic, and procedural memory |
| **Framework/Orchestration** | 11 | Workflow planning, concept serving, session management |
| **State Management** | 10 | Health tracking, events, checkpoints, stories via SQLite |
| **Prompt Evolution** | 4 | Orchestrated genetic prompt optimization |

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
│   │   ├── index.ts      # Tool definitions
│   │   ├── indexer.ts     # Tree-sitter parsing
│   │   └── store.ts      # Index storage
│   ├── semantic/         # Semantic search (4 tools)
│   │   ├── index.ts      # Tool definitions
│   │   ├── chunker.ts    # Code chunking
│   │   └── store.ts      # Vector storage
│   ├── memory/           # Persistent memory (7 tools)
│   │   ├── index.ts      # Tool definitions
│   │   ├── store.ts      # SQLite storage
│   │   ├── evolution.ts  # Confidence updates
│   │   └── types.ts      # Memory types
│   ├── framework/        # Orchestration (11 tools)
│   │   ├── index.ts      # Tool definitions
│   │   ├── content-loader.ts  # Concept/workflow content
│   │   ├── workflow-planner.ts # Workflow planning
│   │   ├── workflow-intelligence.ts # Difficulty classification
│   │   ├── session.ts    # Workflow sessions
│   │   └── sync-evaluator.ts # Sync rule evaluation
│   ├── state/            # State management (10 tools)
│   │   ├── index.ts      # Tool definitions
│   │   ├── store.ts      # SQLite storage
│   │   └── types.ts      # State types
│   └── evolve/           # Prompt evolution (4 tools)
│       ├── index.ts      # Tool definitions
│       ├── store.ts      # SQLite storage
│       ├── algorithm.ts  # Selection & convergence
│       └── types.ts      # Evolution types
└── utils/
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
