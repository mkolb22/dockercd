#!/usr/bin/env node

/**
 * Zen MCP Server
 * Unified server providing code intelligence, semantic search, memory, and workflow orchestration
 *
 * Modules:
 * - AST Index (8 tools) - Code intelligence through AST analysis
 * - Semantic RAG (4 tools) - Semantic search with embeddings
 * - Memory (7 tools) - Persistent semantic memory
 * - Framework (11 tools) - Workflow orchestration
 * - State (10 tools) - Health, checkpoints, stories
 * - Evolution (4 tools) - Prompt optimization
 * - Spec (6 tools) - Specification DSL for code generation
 */

import { createServer, runServer } from "./core/server.js";
import type { ToolModule, ToolResponse } from "./core/types.js";

// Import tool modules
import { astModule } from "./tools/ast/index.js";
import { semanticModule } from "./tools/semantic/index.js";
import { memoryModule } from "./tools/memory/index.js";
import { frameworkModule } from "./tools/framework/index.js";
import { stateModule } from "./tools/state/index.js";
import { evolveModule } from "./tools/evolve/index.js";
import { specModule } from "./tools/spec/index.js";

// All modules
const modules: ToolModule[] = [
  astModule,
  semanticModule,
  memoryModule,
  frameworkModule,
  stateModule,
  evolveModule,
  specModule,
];

// Aggregate all tools and build O(1) lookup map
const allTools = modules.flatMap((m) => m.tools);

const toolMap = new Map<string, ToolModule>();
for (const mod of modules) {
  for (const tool of mod.tools) {
    toolMap.set(tool.name, mod);
  }
}

// Create unified tool handler
async function handleToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const mod = toolMap.get(name);
  if (mod) {
    return mod.handleToolCall(name, args);
  }

  return {
    content: [{ type: "text" as const, text: `Error: Unknown tool: ${name}` }],
    isError: true,
  };
}

// Create and run server
const server = createServer({
  name: "zen-server",
  version: "1.0.0",
  tools: allTools,
  handleToolCall,
});

runServer(server)
  .then(() => console.error(`Zen MCP Server running (${allTools.length} tools available)`))
  .catch(console.error);
