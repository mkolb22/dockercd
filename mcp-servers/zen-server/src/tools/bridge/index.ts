/**
 * Bridge Module
 * 4 MCP tools for cross-project memory export, import, search, and listing.
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { successResponse, errorResponse, args as a } from "../../utils/responses.js";
import { createDispatcher, createModule } from "../../core/dispatcher.js";
import { createLazyLoader } from "../../utils/lazy.js";
import { requireBridge } from "../../utils/guards.js";
import { config } from "../../core/config.js";
import { BridgeStore } from "./store.js";

const dispatcher = createDispatcher();
const getStore = createLazyLoader(() => new BridgeStore(config().bridgeGlobalMemoryPath));

export const tools: Tool[] = [
  {
    name: "zen_bridge_export",
    description: "Export project memories to the global memory store (~/.zen/global-memory/). Deduplicates by memory ID.",
    inputSchema: {
      type: "object",
      properties: {
        project_name: { type: "string", description: "Project name for grouping (e.g., 'bodhi', 'zen')" },
      },
      required: ["project_name"],
    },
  },
  {
    name: "zen_bridge_import",
    description: "Import relevant memories from the global store into the current project. Filters by query and/or source project.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query to filter memories" },
        project: { type: "string", description: "Import only from this project" },
      },
    },
  },
  {
    name: "zen_bridge_search",
    description: "Search the global memory store by keyword, matching content and tags.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        project: { type: "string", description: "Filter to a specific project" },
        limit: { type: "number", description: "Maximum results (default: 20)" },
      },
      required: ["query"],
    },
  },
  {
    name: "zen_bridge_list",
    description: "List available memories in the global store, grouped by category.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Filter to a specific project" },
      },
    },
  },
];

// ─── Handlers ────────────────────────────────────────────────

dispatcher
  .register(
    "zen_bridge_export",
    requireBridge(async (args) => {
      const projectName = a.string(args, "project_name", "");
      if (!projectName) return errorResponse("project_name is required");

      const store = getStore();
      const memoryDbPath = config().memoryDbPath;
      const result = store.exportMemories(memoryDbPath, projectName);

      if (result.exported === 0 && result.skipped === 0) {
        return successResponse({ message: "No local memories to export" });
      }
      if (result.exported === 0) {
        return successResponse({ message: `All ${result.skipped} memories already exported`, skipped: result.skipped });
      }

      return successResponse({
        message: `${result.exported} memories exported from ${projectName}`,
        ...result,
      });
    }),
  )
  .register(
    "zen_bridge_import",
    requireBridge(async (args) => {
      const query = a.stringOptional(args, "query");
      const project = a.stringOptional(args, "project");

      const store = getStore();
      const global = store.loadGlobalMemories();

      // Collect matching memories
      let totalFound = 0;
      const categories: string[] = [];
      const matches: Array<{ category: string; content: string; confidence: string }> = [];

      for (const [category, memories] of global) {
        let candidates = project ? memories.filter((m) => m.project === project) : memories;

        if (query) {
          const q = query.toLowerCase();
          candidates = candidates.filter((m) =>
            m.content.toLowerCase().includes(q) || m.tags.some((t) => t.toLowerCase().includes(q)),
          );
        }

        if (candidates.length > 0) {
          totalFound += candidates.length;
          categories.push(category);
          for (const c of candidates.slice(0, 5)) {
            matches.push({ category, content: c.content, confidence: c.confidence });
          }
        }
      }

      return successResponse({
        found: totalFound,
        categories,
        preview: matches,
        message: totalFound > 0
          ? `Found ${totalFound} memories across ${categories.length} categories`
          : "No matching memories found in global store",
      });
    }),
  )
  .register(
    "zen_bridge_search",
    requireBridge(async (args) => {
      const query = a.string(args, "query", "");
      if (!query) return errorResponse("query is required");

      const project = a.stringOptional(args, "project");
      const limit = a.number(args, "limit", 20);

      const store = getStore();
      const results = store.searchMemories(query, project || undefined);
      const limited = results.slice(0, limit);

      return successResponse({
        query,
        total: results.length,
        results: limited.map((r) => ({
          category: r.category,
          match_type: r.matchType,
          confidence: r.memory.confidence,
          content: r.memory.content,
          tags: r.memory.tags,
          project: r.memory.project,
        })),
      });
    }),
  )
  .registerQuick(
    "zen_bridge_list",
    requireBridge(async (args) => {
      const project = a.stringOptional(args, "project");

      const store = getStore();
      const categories = store.listMemories(project || undefined);

      if (categories.length === 0) {
        return successResponse({ message: "No global memories found", categories: [] });
      }

      const totalMemories = categories.reduce((s, c) => s + c.count, 0);

      return successResponse({
        total: totalMemories,
        category_count: categories.length,
        categories: categories.map((c) => ({
          category: c.category,
          count: c.count,
          preview: c.memories.slice(0, 3).map((m) =>
            m.content.length > 70 ? m.content.slice(0, 70) + "..." : m.content,
          ),
        })),
      });
    }),
  );

export const bridgeModule = createModule(tools, dispatcher);
