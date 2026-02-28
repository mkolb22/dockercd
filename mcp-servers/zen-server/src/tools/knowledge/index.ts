/**
 * Knowledge Graph Tools
 * Entity and relation management with hybrid search
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { successResponse, errorResponse, args as a } from "../../utils/responses.js";
import { createDispatcher, createModule } from "../../core/dispatcher.js";
import { config } from "../../core/config.js";
import { createLazyLoader } from "../../utils/lazy.js";
import { requireKnowledgeGraph } from "../../utils/guards.js";
import { getSharedEmbedder } from "../../utils/embedder.js";
import { KnowledgeStore } from "./store.js";
import { IndexStore } from "../ast/store.js";
import { hybridSearch, semanticOnlySearch, keywordOnlySearch } from "./retrieval.js";
import { extractFromText } from "./extractor.js";
import { ingestAstToKg } from "./bridge.js";
import type { EntityType, RelationType } from "./types.js";

const dispatcher = createDispatcher();

const getStore = createLazyLoader(() => new KnowledgeStore(config().memoryDbPath));
const getEmbedder = getSharedEmbedder;

export const tools: Tool[] = [
  {
    name: "kg_ingest",
    description: "Extract entities and relations from text using pattern matching",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Text to extract entities from",
        },
        source: {
          type: "string",
          description: "Source memory ID to link extracted entities to",
        },
      },
      required: ["text"],
    },
  },
  {
    name: "kg_entity",
    description: "Get or create a knowledge graph entity (idempotent by name+type)",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Entity name",
        },
        entity_type: {
          type: "string",
          enum: ["function", "type", "package", "file", "concept", "pattern", "tool", "module", "store", "table", "config", "method", "variable", "interface"],
          description: "Type of entity",
        },
        description: {
          type: "string",
          description: "Entity description",
        },
        properties: {
          type: "string",
          description: "JSON object of additional properties",
        },
      },
      required: ["name", "entity_type"],
    },
  },
  {
    name: "kg_relate",
    description: "Create a typed relation between two entities",
    inputSchema: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description: "Source entity name or ID",
        },
        target: {
          type: "string",
          description: "Target entity name or ID",
        },
        relation_type: {
          type: "string",
          enum: ["calls", "imports", "implements", "contains", "depends_on", "related_to", "defined_in", "tested_by", "guards", "stores_in", "configures"],
          description: "Type of relation",
        },
        weight: {
          type: "number",
          description: "Relation weight 0-1 (default: 1.0)",
        },
      },
      required: ["source", "target", "relation_type"],
    },
  },
  {
    name: "kg_query",
    description: "Hybrid search across knowledge graph (semantic + keyword + graph + community)",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural language query",
        },
        limit: {
          type: "number",
          description: "Max results (default: 20)",
        },
        entity_type: {
          type: "string",
          enum: ["function", "type", "package", "file", "concept", "pattern", "tool", "module", "store", "table", "config", "method", "variable", "interface"],
          description: "Filter by entity type",
        },
        mode: {
          type: "string",
          enum: ["semantic", "keyword", "hybrid"],
          description: "Search mode (default: hybrid)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "kg_traverse",
    description: "Graph traversal from an entity through relations",
    inputSchema: {
      type: "object",
      properties: {
        entity_id: {
          type: "string",
          description: "Entity ID to start from",
        },
        name: {
          type: "string",
          description: "Entity name to start from (alternative to entity_id)",
        },
        depth: {
          type: "number",
          description: "Traversal depth (default: 2)",
        },
        limit: {
          type: "number",
          description: "Max nodes (default: 20)",
        },
        relation_types: {
          type: "string",
          description: "Comma-separated relation types to follow",
        },
      },
    },
  },
  {
    name: "kg_community",
    description: "Detect or query entity communities (connected components). Detection excludes universal connector relation types (configures, depends_on, guards) and hierarchical relations (contains, defined_in) by default to prevent cross-cutting patterns from collapsing all entities into one community.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["detect", "list", "get"],
          description: "Action: detect (re-run detection), list (get all), get (by ID)",
        },
        community_id: {
          type: "string",
          description: "Community ID (for get action)",
        },
        include_relation_types: {
          type: "string",
          description: "Comma-separated relation types to INCLUDE (whitelist, overrides exclude). E.g. 'calls,contains,defined_in'",
        },
        exclude_relation_types: {
          type: "string",
          description: "Comma-separated relation types to EXCLUDE (default: 'configures,depends_on,guards,contains,defined_in'). E.g. 'configures,depends_on,guards,stores_in'",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "kg_ingest_ast",
    description: "Bridge AST index data into the knowledge graph. Creates entities for symbols, files, and modules with structural relations (calls, contains, defined_in). Run index_project first.",
    inputSchema: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          description: "Optional path prefix to limit ingestion (e.g. 'src/tools/memory')",
        },
      },
    },
  },
];

// Register handlers
dispatcher
  .register("kg_ingest", requireKnowledgeGraph(async (args) => {
    const text = a.string(args, "text");
    if (!text) {
      return errorResponse("text is required");
    }

    // Extract entities and relations
    const { entities, relations } = extractFromText(text);

    // Store entities
    const entityIds: Record<string, string> = {};
    let entitiesAdded = 0;

    for (const entity of entities) {
      const id = getStore().upsertEntity({
        name: entity.name,
        entityType: entity.entityType,
        description: entity.context,
        properties: {},
        sourceMemoryId: a.stringOptional(args, "source"),
      });
      entityIds[entity.name] = id;
      entitiesAdded++;

      // Embed entity
      const embedding = await getEmbedder().embed(`${entity.name} ${entity.context || ""}`);
      getStore().insertEmbedding(id, embedding);
    }

    // Store relations
    let relationsAdded = 0;
    for (const rel of relations) {
      const sourceId = entityIds[rel.sourceName];
      const targetId = entityIds[rel.targetName];

      if (sourceId && targetId) {
        const relId = getStore().insertRelation({
          sourceId,
          targetId,
          relationType: rel.relationType,
          weight: 1.0,
          properties: {},
        });
        if (relId) relationsAdded++;
      }
    }

    return successResponse({
      entitiesExtracted: entities.length,
      entitiesAdded,
      relationsExtracted: relations.length,
      relationsAdded,
    });
  }))
  .registerQuick("kg_entity", requireKnowledgeGraph(async (args) => {
    const name = a.string(args, "name");
    const entityType = a.string(args, "entity_type") as EntityType;

    if (!name || !entityType) {
      return errorResponse("name and entity_type are required");
    }

    let properties: Record<string, string> = {};
    const propsStr = a.stringOptional(args, "properties");
    if (propsStr) {
      try {
        properties = JSON.parse(propsStr);
      } catch {
        return errorResponse("properties must be valid JSON");
      }
    }

    const id = getStore().upsertEntity({
      name,
      entityType,
      description: a.stringOptional(args, "description"),
      properties,
    });

    // Embed
    const description = a.stringOptional(args, "description") || "";
    const embedding = await getEmbedder().embed(`${name} ${description}`);
    getStore().insertEmbedding(id, embedding);

    const entity = getStore().getEntity(id);

    return successResponse({
      id,
      entity,
    });
  }))
  .registerQuick("kg_relate", requireKnowledgeGraph(async (args) => {
    const source = a.string(args, "source");
    const target = a.string(args, "target");
    const relationType = a.string(args, "relation_type") as RelationType;
    const weight = a.number(args, "weight", 1.0);

    if (!source || !target || !relationType) {
      return errorResponse("source, target, and relation_type are required");
    }

    // Resolve names to IDs
    let sourceId = source;
    let targetId = target;

    if (!source.startsWith("ent-")) {
      const sourceEntity = getStore().getEntityByName(source);
      if (!sourceEntity) {
        return errorResponse(`Source entity not found: ${source}`);
      }
      sourceId = sourceEntity.id;
    }

    if (!target.startsWith("ent-")) {
      const targetEntity = getStore().getEntityByName(target);
      if (!targetEntity) {
        return errorResponse(`Target entity not found: ${target}`);
      }
      targetId = targetEntity.id;
    }

    const relId = getStore().insertRelation({
      sourceId,
      targetId,
      relationType,
      weight,
      properties: {},
    });

    if (!relId) {
      return errorResponse("Relation already exists or entities not found");
    }

    return successResponse({
      id: relId,
      sourceId,
      targetId,
      relationType,
      weight,
    });
  }))
  .register("kg_query", requireKnowledgeGraph(async (args) => {
    const cfg = config();
    const query = a.string(args, "query");
    if (!query) {
      return errorResponse("query is required");
    }

    const mode = a.stringOptional(args, "mode") || "hybrid";
    const limit = a.number(args, "limit", 20);
    const entityType = a.stringOptional(args, "entity_type") as EntityType | undefined;

    const embedding = await getEmbedder().embed(query);

    let results;
    if (mode === "semantic") {
      results = semanticOnlySearch(getStore(), embedding, { limit, entityType });
    } else if (mode === "keyword") {
      results = keywordOnlySearch(getStore(), query, { limit, entityType });
    } else {
      results = hybridSearch(getStore(), query, embedding, {
        limit,
        entityType,
        weights: {
          semantic: cfg.kgSemanticWeight,
          keyword: cfg.kgKeywordWeight,
          graph: cfg.kgGraphWeight,
          community: cfg.kgCommunityWeight,
        },
      });
    }

    return successResponse({
      count: results.length,
      mode,
      results: results.map(r => ({
        id: r.entity.id,
        name: r.entity.name,
        type: r.entity.entityType,
        description: r.entity.description,
        finalScore: r.finalScore,
        scores: {
          semantic: r.semanticScore,
          keyword: r.keywordScore,
          graph: r.graphScore,
          community: r.communityScore,
        },
      })),
    });
  }))
  .register("kg_traverse", requireKnowledgeGraph(async (args) => {
    const entityId = a.stringOptional(args, "entity_id");
    const name = a.stringOptional(args, "name");
    const depth = Math.min(a.number(args, "depth", 2), 5);
    const limit = Math.min(a.number(args, "limit", 20), 50);
    const relationTypesStr = a.stringOptional(args, "relation_types");

    let startId: string | null = null;

    if (entityId) {
      startId = entityId;
    } else if (name) {
      const entity = getStore().getEntityByName(name);
      if (!entity) {
        return errorResponse(`Entity not found: ${name}`);
      }
      startId = entity.id;
    } else {
      return errorResponse("Either entity_id or name is required");
    }

    const relationTypes = relationTypesStr
      ? (relationTypesStr.split(",").map(s => s.trim()) as RelationType[])
      : undefined;

    const nodes = getStore().traverse(startId, depth, limit, relationTypes);

    return successResponse({
      nodeCount: nodes.length,
      nodes: nodes.map(n => ({
        id: n.entity.id,
        name: n.entity.name,
        type: n.entity.entityType,
        description: n.entity.description?.slice(0, 100),
        depth: n.depth,
        relations: n.relations.map(r => ({
          targetId: r.sourceId === n.entity.id ? r.targetId : r.sourceId,
          type: r.relationType,
          weight: r.weight,
        })),
      })),
    });
  }))
  .registerLong("kg_community", requireKnowledgeGraph(async (args) => {
    const action = a.string(args, "action");

    switch (action) {
      case "detect": {
        const includeRaw = a.stringOptional(args, "include_relation_types");
        const excludeRaw = a.stringOptional(args, "exclude_relation_types");
        const includeRelationTypes = includeRaw
          ? includeRaw.split(",").map(s => s.trim()) as RelationType[]
          : undefined;
        const excludeRelationTypes = excludeRaw
          ? excludeRaw.split(",").map(s => s.trim()) as RelationType[]
          : undefined;
        const communities = getStore().detectCommunities({
          includeRelationTypes,
          excludeRelationTypes,
        });
        return successResponse({
          detected: communities.length,
          communities: communities.map(c => ({
            id: c.id,
            name: c.name,
            memberCount: c.entityIds.length,
          })),
        });
      }

      case "list": {
        const communities = getStore().getCommunities();
        return successResponse({
          count: communities.length,
          communities: communities.map(c => ({
            id: c.id,
            name: c.name,
            memberCount: c.entityIds.length,
            summary: c.summary,
          })),
        });
      }

      case "get": {
        const communityId = a.string(args, "community_id");
        if (!communityId) {
          return errorResponse("community_id is required for get action");
        }

        const community = getStore().getCommunity(communityId);
        if (!community) {
          return errorResponse(`Community not found: ${communityId}`);
        }

        // Get member entities
        const members = community.entityIds
          .map(id => getStore().getEntity(id))
          .filter(Boolean);

        return successResponse({
          ...community,
          members: members.map(e => ({
            id: e!.id,
            name: e!.name,
            type: e!.entityType,
          })),
        });
      }

      default:
        return errorResponse("action must be detect, list, or get");
    }
  }))
  .registerLong("kg_ingest_ast", requireKnowledgeGraph(async (args) => {
    const cfg = config();
    const scope = a.stringOptional(args, "scope");

    // Open AST index store (read-only)
    let astStore: IndexStore;
    try {
      astStore = new IndexStore(cfg.indexPath);
    } catch (e) {
      return errorResponse("AST index not found. Run index_project first.");
    }

    const metadata = astStore.getMetadata();
    if (!metadata.totalSymbols) {
      astStore.close();
      return errorResponse("AST index is empty. Run index_project first.");
    }

    try {
      const result = await ingestAstToKg(
        astStore,
        getStore(),
        (text) => getEmbedder().embed(text),
        { scope: scope || undefined },
      );

      // Run community detection after ingestion
      const communities = getStore().detectCommunities();

      return successResponse({
        ...result,
        communitiesDetected: communities.length,
        astIndexStats: {
          totalSymbols: metadata.totalSymbols,
          totalFiles: metadata.totalFiles,
          lastUpdate: metadata.lastUpdate,
        },
      });
    } finally {
      astStore.close();
    }
  }));

export const knowledgeModule = createModule(tools, dispatcher);

// Export types and utilities
export * from "./types.js";
export { KnowledgeStore } from "./store.js";
export { hybridSearch, semanticOnlySearch, keywordOnlySearch } from "./retrieval.js";
export { extractFromText, extractFromCode } from "./extractor.js";
