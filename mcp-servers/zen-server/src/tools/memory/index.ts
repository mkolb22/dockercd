/**
 * Memory Tools
 * Episodic, semantic, and procedural memory with evolution
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { successResponse, errorResponse, args as a } from "../../utils/responses.js";
import { createDispatcher, createModule } from "../../core/dispatcher.js";
import { config } from "../../core/config.js";
import { createLazyLoader } from "../../utils/lazy.js";
import { requireMemory } from "../../utils/guards.js";
import { getSharedEmbedder } from "../../utils/embedder.js";
import { MemoryStore } from "./store.js";
import { evolveMemory, autoLink } from "./evolution.js";
import type {
  StoreInput,
  RecallInput,
  EvolveInput,
  LinkInput,
  ForgetInput,
  GraphInput,
  MemoryType,
  RelationshipType,
} from "./types.js";

const dispatcher = createDispatcher();

const getStore = createLazyLoader(() => new MemoryStore(config().memoryDbPath));
const getEmbedder = getSharedEmbedder;

export const tools: Tool[] = [
  {
    name: "memory_store",
    description: "Store a new memory with automatic embedding and linking to similar memories",
    inputSchema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "The memory content to store",
        },
        type: {
          type: "string",
          enum: ["episodic", "semantic", "procedural"],
          description: "Memory type: episodic (events), semantic (facts), procedural (how-to)",
        },
        category: {
          type: "string",
          description: "Category for grouping (e.g., 'architecture', 'patterns')",
        },
        source: {
          type: "string",
          description: "Where this knowledge came from",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags for filtering",
        },
        steps: {
          type: "array",
          items: { type: "string" },
          description: "Steps for procedural memories",
        },
      },
      required: ["content", "type"],
    },
  },
  {
    name: "memory_recall",
    description: "Search memories by semantic similarity with optional graph traversal",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural language query to search for",
        },
        limit: {
          type: "number",
          description: "Maximum results (default: 5)",
        },
        threshold: {
          type: "number",
          description: "Minimum similarity 0-1 (default: 0.4)",
        },
        type: {
          type: "string",
          enum: ["episodic", "semantic", "procedural"],
          description: "Filter by memory type",
        },
        category: {
          type: "string",
          description: "Filter by category",
        },
        traverse_depth: {
          type: "number",
          description: "Graph traversal depth (default: 0, max: 3)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "memory_evolve",
    description: "Evolve a memory with new evidence (supports, contradicts, extends, supersedes)",
    inputSchema: {
      type: "object",
      properties: {
        memory_id: {
          type: "string",
          description: "ID of the memory to evolve",
        },
        new_evidence: {
          type: "string",
          description: "New evidence or information",
        },
        relationship: {
          type: "string",
          enum: ["supports", "contradicts", "extends", "supersedes"],
          description: "How the evidence relates to the memory",
        },
      },
      required: ["memory_id", "new_evidence", "relationship"],
    },
  },
  {
    name: "memory_link",
    description: "Create a manual link between two memories",
    inputSchema: {
      type: "object",
      properties: {
        source_id: {
          type: "string",
          description: "Source memory ID",
        },
        target_id: {
          type: "string",
          description: "Target memory ID",
        },
        relationship: {
          type: "string",
          enum: ["supports", "contradicts", "extends", "supersedes", "related"],
          description: "Type of relationship",
        },
      },
      required: ["source_id", "target_id", "relationship"],
    },
  },
  {
    name: "memory_forget",
    description: "Archive a memory (soft delete, excluded from recall)",
    inputSchema: {
      type: "object",
      properties: {
        memory_id: {
          type: "string",
          description: "ID of the memory to archive",
        },
        reason: {
          type: "string",
          description: "Why this memory is being archived",
        },
      },
      required: ["memory_id", "reason"],
    },
  },
  {
    name: "memory_graph",
    description: "Explore the memory graph from a seed memory or query",
    inputSchema: {
      type: "object",
      properties: {
        memory_id: {
          type: "string",
          description: "Center memory ID (alternative to query)",
        },
        query: {
          type: "string",
          description: "Semantic query to find center (alternative to memory_id)",
        },
        depth: {
          type: "number",
          description: "Traversal depth (default: 2)",
        },
        limit: {
          type: "number",
          description: "Maximum nodes (default: 20)",
        },
      },
    },
  },
  {
    name: "memory_stats",
    description: "Get memory system health metrics and optionally trigger decay",
    inputSchema: {
      type: "object",
      properties: {
        run_decay: {
          type: "boolean",
          description: "Run decay on old low-confidence memories",
        },
      },
    },
  },
];

// Register handlers
dispatcher
  .register("memory_store", requireMemory(async (args) => {
    const content = a.string(args, "content");
    const type = a.string(args, "type") as MemoryType;

    if (!content) {
      return errorResponse("content is required");
    }
    if (!["episodic", "semantic", "procedural"].includes(type)) {
      return errorResponse("type must be episodic, semantic, or procedural");
    }

    // Create memory
    const memoryId = getStore().insertMemory({
      type,
      content,
      confidence: 1.0,
      category: a.stringOptional(args, "category"),
      source: a.stringOptional(args, "source"),
      tags: a.array<string>(args, "tags"),
      steps: type === "procedural" ? a.array<string>(args, "steps") : undefined,
      archived: false,
    });

    // Embed and store
    const embedding = await getEmbedder().embed(content);
    getStore().insertEmbedding(memoryId, embedding);

    // Auto-link to similar memories
    const linksCreated = await autoLink(
      getStore(),
      memoryId,
      embedding,
      config().memoryAutoLinkThreshold
    );

    return successResponse({
      id: memoryId,
      linksCreated,
      message: `Memory stored with ${linksCreated} auto-links`,
    });
  }))
  .registerQuick("memory_recall", requireMemory(async (args) => {
    const query = a.string(args, "query");
    if (!query) {
      return errorResponse("query is required");
    }

    const embedding = await getEmbedder().embed(query);

    const results = getStore().searchByEmbedding(embedding, {
      limit: a.number(args, "limit", 5),
      threshold: a.number(args, "threshold", 0.4),
      type: a.stringOptional(args, "type") as MemoryType | undefined,
      category: a.stringOptional(args, "category"),
      traverseDepth: Math.min(a.number(args, "traverse_depth", 0), 3),
    });

    return successResponse({
      count: results.length,
      results: results.map(r => ({
        id: r.memory.id,
        type: r.memory.type,
        content: r.memory.content,
        similarity: r.similarity,
        confidence: r.memory.confidence,
        category: r.memory.category,
        tags: r.memory.tags,
        graphContext: r.graphContext?.map(n => ({
          id: n.memory.id,
          content: n.memory.content.slice(0, 100),
          depth: n.depth,
          linkCount: n.links.length,
        })),
      })),
    });
  }))
  .register("memory_evolve", requireMemory(async (args) => {
    const memoryId = a.string(args, "memory_id");
    const newEvidence = a.string(args, "new_evidence");
    const relationship = a.string(args, "relationship") as RelationshipType;

    if (!memoryId || !newEvidence || !relationship) {
      return errorResponse("memory_id, new_evidence, and relationship are required");
    }

    const result = await evolveMemory(
      getStore(),
      { memoryId, newEvidence, relationship },
      (text) => getEmbedder().embed(text)
    );

    const change = result.newConfidence - result.oldConfidence;
    let note: string | undefined;
    if (change === 0 && relationship === "supports" && result.oldConfidence >= 1.0) {
      note = "Confidence already at maximum (1.0) — no headroom for 'supports' to increase";
    } else if (change === 0 && relationship === "related") {
      note = "'related' does not affect confidence";
    }

    return successResponse({
      memoryId,
      relationship,
      oldConfidence: result.oldConfidence,
      newConfidence: result.newConfidence,
      confidenceChange: change,
      ...(note ? { note } : {}),
    });
  }))
  .registerQuick("memory_link", requireMemory(async (args) => {
    const sourceId = a.string(args, "source_id");
    const targetId = a.string(args, "target_id");
    const relationship = a.string(args, "relationship") as RelationshipType;

    if (!sourceId || !targetId || !relationship) {
      return errorResponse("source_id, target_id, and relationship are required");
    }

    const linkId = getStore().createLink(sourceId, targetId, relationship, 1.0, false);

    if (!linkId) {
      return errorResponse("Link already exists or memories not found");
    }

    return successResponse({
      linkId,
      sourceId,
      targetId,
      relationship,
    });
  }))
  .registerQuick("memory_forget", requireMemory(async (args) => {
    const memoryId = a.string(args, "memory_id");
    const reason = a.string(args, "reason");

    if (!memoryId || !reason) {
      return errorResponse("memory_id and reason are required");
    }

    getStore().archiveMemory(memoryId, reason);

    return successResponse({
      archived: true,
      memoryId,
      reason,
    });
  }))
  .register("memory_graph", requireMemory(async (args) => {
    const memoryId = a.stringOptional(args, "memory_id");
    const query = a.stringOptional(args, "query");
    const depth = Math.min(a.number(args, "depth", 2), 5);
    const limit = Math.min(a.number(args, "limit", 20), 50);

    let seedIds: string[] = [];

    if (memoryId) {
      seedIds = [memoryId];
    } else if (query) {
      const embedding = await getEmbedder().embed(query);
      const results = getStore().searchByEmbedding(embedding, { limit: 3 });
      seedIds = results.map(r => r.memory.id);
    } else {
      return errorResponse("Either memory_id or query is required");
    }

    const nodes = getStore().traverseGraph(seedIds, depth, limit);

    return successResponse({
      nodeCount: nodes.length,
      nodes: nodes.map(n => ({
        id: n.memory.id,
        type: n.memory.type,
        content: n.memory.content.slice(0, 200),
        confidence: n.memory.confidence,
        depth: n.depth,
        links: n.links.map(l => ({
          targetId: l.sourceId === n.memory.id ? l.targetId : l.sourceId,
          relationship: l.relationship,
          strength: l.strength,
        })),
      })),
    });
  }))
  .registerQuick("memory_stats", requireMemory(async (args) => {
    const cfg = config();
    const runDecay = a.boolean(args, "run_decay", false);

    let decayResult = null;
    if (runDecay) {
      decayResult = getStore().runDecay(
        cfg.memoryDecayGraceDays,
        cfg.memoryDecayBaseRate,
        cfg.memoryDecayThreshold
      );
    }

    const stats = getStore().getMemoryStats();

    return successResponse({
      ...stats,
      decayResult,
    });
  }));

export const memoryModule = createModule(tools, dispatcher);

// Export types and utilities
export * from "./types.js";
export { MemoryStore } from "./store.js";
export { evolveMemory, autoLink, calculateHealthScore } from "./evolution.js";
