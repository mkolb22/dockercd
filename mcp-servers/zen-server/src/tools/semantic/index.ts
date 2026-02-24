/**
 * Semantic RAG Tools
 * Provides semantic search and code understanding through embeddings
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { SupportedLanguage } from "../../core/types.js";
import { successResponse, args as a } from "../../utils/responses.js";
import { createDispatcher, createModule } from "../../core/dispatcher.js";
import { config } from "../../core/config.js";
import { createLazyLoader } from "../../utils/lazy.js";
import { getSharedEmbedder } from "../../utils/embedder.js";
import { CodeChunker } from "./chunker.js";
import { VectorStore } from "./store.js";

const getEmbedder = getSharedEmbedder;
const getStore = createLazyLoader(() => new VectorStore(config().memoryDbPath));
const getChunker = createLazyLoader(() => new CodeChunker(config().projectRoot));

export const tools: Tool[] = [
  {
    name: "embed_project",
    description: "Create semantic embeddings for the project codebase",
    inputSchema: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          description: "Specific paths to embed (default: entire project)",
        },
        incremental: {
          type: "boolean",
          description: "Only embed changed files (default: true)",
          default: true,
        },
        languages: {
          type: "array",
          items: { type: "string" },
          description: "Filter by language",
        },
      },
    },
  },
  {
    name: "semantic_search",
    description: "Search for code by semantic meaning",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural language description of what you're looking for",
        },
        limit: {
          type: "number",
          description: "Maximum results (default: 5)",
          default: 5,
        },
        threshold: {
          type: "number",
          description: "Minimum similarity score 0-1 (default: 0.5)",
          default: 0.5,
        },
        filter: {
          type: "object",
          properties: {
            language: { type: "string" },
            path: { type: "string" },
            kind: { type: "string" },
          },
          description: "Filter results by metadata",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "find_similar_code",
    description: "Find code similar to a given snippet",
    inputSchema: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "Code snippet to find similar code for",
        },
        limit: {
          type: "number",
          description: "Maximum results (default: 5)",
          default: 5,
        },
        excludeSelf: {
          type: "boolean",
          description: "Exclude the exact same code (default: true)",
          default: true,
        },
      },
      required: ["code"],
    },
  },
  {
    name: "get_embedding_stats",
    description: "Get statistics about the embedding index",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

const dispatcher = createDispatcher();

dispatcher
  .registerVeryLong("embed_project", async (args) => {
    const chunks = await getChunker().chunkProject({
      paths: a.array<string>(args, "paths"),
      languages: a.array<SupportedLanguage>(args, "languages"),
      incremental: a.boolean(args, "incremental", true),
      previousHashes: getStore().getFileHashes(),
    });

    const embeddings: Array<{
      chunk: (typeof chunks)[0];
      embedding: number[];
    }> = [];
    for (const chunk of chunks) {
      const embedding = await getEmbedder().embed(chunk.content);
      embeddings.push({ chunk, embedding });
    }

    getStore().addEmbeddings(embeddings);

    return successResponse({
      chunksEmbedded: chunks.length,
      totalChunks: getStore().getChunkCount(),
    });
  })
  .register("semantic_search", async (args) => {
    const queryEmbedding = await getEmbedder().embed(a.string(args, "query"));
    const results = getStore().search({
      embedding: queryEmbedding,
      limit: a.number(args, "limit", 5),
      threshold: a.number(args, "threshold", 0.3),
      filter: a.object<Record<string, string>>(args, "filter"),
    });

    return successResponse(results);
  })
  .register("find_similar_code", async (args) => {
    const code = a.string(args, "code");
    const limit = a.number(args, "limit", 5);
    const codeEmbedding = await getEmbedder().embed(code);
    const results = getStore().search({
      embedding: codeEmbedding,
      limit: limit + 1,
      threshold: 0.3,
    });

    let finalResults = results;
    if (a.boolean(args, "excludeSelf", true)) {
      finalResults = results.filter((r) => r.content !== code);
    }

    return successResponse(finalResults.slice(0, limit));
  })
  .registerQuick("get_embedding_stats", async () => {
    const stats = getStore().getVectorStats();
    return successResponse(stats);
  });

export const semanticModule = createModule(tools, dispatcher);
