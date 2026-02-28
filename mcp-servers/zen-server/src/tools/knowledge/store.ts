/**
 * Knowledge Graph Store
 * SQLite-backed storage for entities and relations
 */

import { BaseStore } from "../../core/store.js";
import { cosineSimilarity, numberArrayToBytes, bytesToNumberArray } from "../../utils/vectors.js";
import { bfsTraverse } from "../../utils/graph.js";
import { generateId } from "../../utils/ids.js";
import type {
  Entity,
  EntityType,
  Relation,
  RelationType,
  Community,
  QueryResult,
  TraversalNode,
  QueryOptions,
  KGStats,
} from "./types.js";

export class KnowledgeStore extends BaseStore {
  constructor(dbPath: string) {
    super(dbPath);
    this.initTables();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kg_entities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        description TEXT,
        properties TEXT,
        source_memory_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_kg_entities_name ON kg_entities(name);
      CREATE INDEX IF NOT EXISTS idx_kg_entities_type ON kg_entities(entity_type);

      CREATE TABLE IF NOT EXISTS kg_entity_embeddings (
        entity_id TEXT PRIMARY KEY,
        embedding BLOB NOT NULL,
        dimensions INTEGER NOT NULL,
        FOREIGN KEY (entity_id) REFERENCES kg_entities(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS kg_relations (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 1.0,
        properties TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (source_id) REFERENCES kg_entities(id) ON DELETE CASCADE,
        FOREIGN KEY (target_id) REFERENCES kg_entities(id) ON DELETE CASCADE,
        UNIQUE(source_id, target_id, relation_type)
      );

      CREATE INDEX IF NOT EXISTS idx_kg_relations_source ON kg_relations(source_id);
      CREATE INDEX IF NOT EXISTS idx_kg_relations_target ON kg_relations(target_id);
      CREATE INDEX IF NOT EXISTS idx_kg_relations_type ON kg_relations(relation_type);

      CREATE TABLE IF NOT EXISTS kg_communities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        summary TEXT,
        entity_ids TEXT NOT NULL,
        level INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS kg_entity_memory_links (
        entity_id TEXT NOT NULL,
        memory_id TEXT NOT NULL,
        relationship TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (entity_id, memory_id),
        FOREIGN KEY (entity_id) REFERENCES kg_entities(id) ON DELETE CASCADE
      );
    `);

    // Try to create FTS5 table with sync triggers (may fail on some SQLite builds)
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS kg_entity_fts USING fts5(
          name,
          description,
          content='kg_entities',
          content_rowid='rowid'
        );

        -- Triggers to keep FTS5 in sync with kg_entities
        CREATE TRIGGER IF NOT EXISTS kg_entity_fts_ai AFTER INSERT ON kg_entities BEGIN
          INSERT INTO kg_entity_fts(rowid, name, description)
            VALUES (new.rowid, new.name, new.description);
        END;

        CREATE TRIGGER IF NOT EXISTS kg_entity_fts_ad AFTER DELETE ON kg_entities BEGIN
          INSERT INTO kg_entity_fts(kg_entity_fts, rowid, name, description)
            VALUES ('delete', old.rowid, old.name, old.description);
        END;

        CREATE TRIGGER IF NOT EXISTS kg_entity_fts_au AFTER UPDATE ON kg_entities BEGIN
          INSERT INTO kg_entity_fts(kg_entity_fts, rowid, name, description)
            VALUES ('delete', old.rowid, old.name, old.description);
          INSERT INTO kg_entity_fts(rowid, name, description)
            VALUES (new.rowid, new.name, new.description);
        END;
      `);
    } catch {
      // FTS5 not available, will use LIKE fallback
    }
  }

  /**
   * Rebuild FTS5 index from existing kg_entities data.
   * Call after bulk-loading entities without triggers (e.g., migrating old data).
   */
  rebuildFts(): void {
    try {
      this.db.exec(`INSERT INTO kg_entity_fts(kg_entity_fts) VALUES ('rebuild')`);
    } catch {
      // FTS5 not available
    }
  }

  /**
   * Clear all KG data (entities, relations, embeddings, communities)
   */
  clearAll(): void {
    this.transaction(() => {
      this.clearTable("kg_entity_memory_links");
      this.clearTable("kg_relations");
      this.clearTable("kg_entity_embeddings");
      this.clearTable("kg_communities");
      this.clearTable("kg_entities");
    });
  }

  /**
   * Insert or update an entity
   */
  upsertEntity(entity: Omit<Entity, "id" | "createdAt" | "updatedAt">): string {
    // Check if entity with same name and type exists
    const existing = this.queryOne<{ id: string }>(
      `SELECT id FROM kg_entities WHERE name = ? AND entity_type = ?`,
      [entity.name, entity.entityType]
    );

    const now = new Date().toISOString();

    if (existing) {
      // Update
      this.execute(
        `UPDATE kg_entities SET description = ?, properties = ?, updated_at = ? WHERE id = ?`,
        [
          entity.description || null,
          JSON.stringify(entity.properties || {}),
          now,
          existing.id,
        ]
      );
      return existing.id;
    }

    // Insert
    const id = generateId("ent");
    this.execute(
      `INSERT INTO kg_entities (id, name, entity_type, description, properties, source_memory_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        entity.name,
        entity.entityType,
        entity.description || null,
        JSON.stringify(entity.properties || {}),
        entity.sourceMemoryId || null,
        now,
        now,
      ]
    );

    return id;
  }

  /**
   * Get entity by ID
   */
  getEntity(id: string): Entity | null {
    const row = this.queryOne<Record<string, unknown>>(
      `SELECT * FROM kg_entities WHERE id = ?`,
      [id]
    );
    return row ? this.rowToEntity(row) : null;
  }

  /**
   * Get entity by name
   */
  getEntityByName(name: string, entityType?: EntityType): Entity | null {
    let sql = `SELECT * FROM kg_entities WHERE name = ?`;
    const params: unknown[] = [name];

    if (entityType) {
      sql += ` AND entity_type = ?`;
      params.push(entityType);
    }

    const row = this.queryOne<Record<string, unknown>>(sql, params);
    return row ? this.rowToEntity(row) : null;
  }

  /**
   * Insert embedding for entity
   */
  insertEmbedding(entityId: string, embedding: number[]): void {
    const buffer = numberArrayToBytes(embedding);
    this.execute(
      `INSERT OR REPLACE INTO kg_entity_embeddings (entity_id, embedding, dimensions)
       VALUES (?, ?, ?)`,
      [entityId, buffer, embedding.length]
    );
  }

  /**
   * Insert a relation
   */
  insertRelation(relation: Omit<Relation, "id" | "createdAt">): string | null {
    const id = generateId("rel");
    try {
      this.execute(
        `INSERT OR IGNORE INTO kg_relations (id, source_id, target_id, relation_type, weight, properties, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          relation.sourceId,
          relation.targetId,
          relation.relationType,
          relation.weight,
          JSON.stringify(relation.properties || {}),
          new Date().toISOString(),
        ]
      );
      return id;
    } catch {
      return null;
    }
  }

  /**
   * Get relations for an entity
   */
  getRelations(entityId: string, relationTypes?: RelationType[]): Relation[] {
    let sql = `SELECT * FROM kg_relations WHERE source_id = ? OR target_id = ?`;
    const params: unknown[] = [entityId, entityId];

    if (relationTypes && relationTypes.length > 0) {
      const placeholders = relationTypes.map(() => "?").join(", ");
      sql += ` AND relation_type IN (${placeholders})`;
      params.push(...relationTypes);
    }

    const rows = this.query<Record<string, unknown>>(sql, params);
    return rows.map(row => this.rowToRelation(row));
  }

  /**
   * Semantic search for entities
   */
  searchSemantic(queryEmbedding: number[], options: QueryOptions = {}): QueryResult[] {
    const { limit = 20, entityType } = options;

    let sql = `
      SELECT e.*, emb.embedding
      FROM kg_entities e
      JOIN kg_entity_embeddings emb ON e.id = emb.entity_id
    `;
    const params: unknown[] = [];

    if (entityType) {
      sql += ` WHERE e.entity_type = ?`;
      params.push(entityType);
    }

    const rows = this.query<Record<string, unknown>>(sql, params);
    const results: QueryResult[] = [];

    for (const row of rows) {
      const embedding = bytesToNumberArray(row.embedding as Buffer);
      const similarity = cosineSimilarity(queryEmbedding, embedding);

      if (similarity > 0.3) {
        results.push({
          entity: this.rowToEntity(row),
          finalScore: similarity,
          semanticScore: similarity,
          keywordScore: 0,
          graphScore: 0,
          communityScore: 0,
        });
      }
    }

    results.sort((a, b) => b.finalScore - a.finalScore);
    return results.slice(0, limit);
  }

  /**
   * Keyword search using FTS or LIKE fallback
   */
  searchKeyword(query: string, options: QueryOptions = {}): QueryResult[] {
    const { limit = 20, entityType } = options;
    const results: QueryResult[] = [];

    // Try FTS5 first
    try {
      let sql = `
        SELECT e.*, bm25(kg_entity_fts) as score
        FROM kg_entity_fts fts
        JOIN kg_entities e ON fts.rowid = e.rowid
        WHERE kg_entity_fts MATCH ?
      `;
      const params: unknown[] = [query];

      if (entityType) {
        sql += ` AND e.entity_type = ?`;
        params.push(entityType);
      }

      sql += ` ORDER BY score LIMIT ?`;
      params.push(limit);

      const rows = this.query<Record<string, unknown>>(sql, params);
      for (const row of rows) {
        results.push({
          entity: this.rowToEntity(row),
          finalScore: Math.abs(row.score as number) / 10, // Normalize BM25
          semanticScore: 0,
          keywordScore: Math.abs(row.score as number) / 10,
          graphScore: 0,
          communityScore: 0,
        });
      }
    } catch {
      // FTS5 failed, use LIKE fallback
      const searchTerm = `%${query}%`;
      let sql = `
        SELECT * FROM kg_entities
        WHERE (name LIKE ? OR description LIKE ?)
      `;
      const params: unknown[] = [searchTerm, searchTerm];

      if (entityType) {
        sql += ` AND entity_type = ?`;
        params.push(entityType);
      }

      sql += ` LIMIT ?`;
      params.push(limit);

      const rows = this.query<Record<string, unknown>>(sql, params);
      for (const row of rows) {
        results.push({
          entity: this.rowToEntity(row),
          finalScore: 0.5,
          semanticScore: 0,
          keywordScore: 0.5,
          graphScore: 0,
          communityScore: 0,
        });
      }
    }

    return results;
  }

  /**
   * BFS traversal from entity
   */
  traverse(entityId: string, maxDepth: number, maxNodes: number, relationTypes?: RelationType[]): TraversalNode[] {
    const results = bfsTraverse<Entity, Relation>([entityId], {
      getNode: (id) => this.getEntity(id),
      getEdges: (id) => this.getRelations(id, relationTypes),
      getNeighborId: (rel, currentId) =>
        rel.sourceId === currentId ? rel.targetId : rel.sourceId,
      maxDepth,
      maxNodes,
    });

    return results.map(r => ({ entity: r.node, depth: r.depth, relations: r.edges }));
  }

  /**
   * Detect communities using connected components.
   *
   * By default, excludes "universal connector" relation types (configures, depends_on, guards)
   * that link cross-cutting patterns to every module, collapsing the graph into one component.
   * Override with includeRelationTypes to use only specific types, or excludeRelationTypes
   * to exclude specific types.
   */
  detectCommunities(options: {
    includeRelationTypes?: RelationType[];
    excludeRelationTypes?: RelationType[];
  } = {}): Community[] {
    // Default: exclude universal connectors and hierarchical relations that collapse communities.
    // configures/depends_on/guards = cross-cutting patterns connecting all modules
    // contains/defined_in = structural hierarchy (module→file→symbol) forming one tree
    const defaultExclude: RelationType[] = ["configures", "depends_on", "guards", "contains", "defined_in"];

    let sql = `SELECT source_id, target_id FROM kg_relations`;
    const params: unknown[] = [];

    if (options.includeRelationTypes && options.includeRelationTypes.length > 0) {
      // Whitelist: only use these relation types
      const placeholders = options.includeRelationTypes.map(() => "?").join(", ");
      sql += ` WHERE relation_type IN (${placeholders})`;
      params.push(...options.includeRelationTypes);
    } else {
      // Blacklist: exclude universal connectors
      const exclude = options.excludeRelationTypes ?? defaultExclude;
      if (exclude.length > 0) {
        const placeholders = exclude.map(() => "?").join(", ");
        sql += ` WHERE relation_type NOT IN (${placeholders})`;
        params.push(...exclude);
      }
    }

    // Build adjacency list (read-only, outside transaction)
    const relations = this.query<{ source_id: string; target_id: string }>(sql, params);

    const adj = new Map<string, Set<string>>();
    for (const rel of relations) {
      if (!adj.has(rel.source_id)) adj.set(rel.source_id, new Set());
      if (!adj.has(rel.target_id)) adj.set(rel.target_id, new Set());
      adj.get(rel.source_id)!.add(rel.target_id);
      adj.get(rel.target_id)!.add(rel.source_id);
    }

    // Find connected components via BFS (in-memory)
    const visited = new Set<string>();
    const components: { entityIds: string[]; centerName: string }[] = [];

    for (const [startId] of adj) {
      if (visited.has(startId)) continue;

      const component: string[] = [];
      const queue = [startId];

      while (queue.length > 0) {
        const id = queue.shift()!;
        if (visited.has(id)) continue;
        visited.add(id);
        component.push(id);

        const neighbors = adj.get(id) || new Set();
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            queue.push(neighbor);
          }
        }
      }

      // Skip singletons
      if (component.length < 2) continue;

      // Name by highest-degree entity
      let maxDegree = 0;
      let centerName = "";
      for (const id of component) {
        const degree = adj.get(id)?.size || 0;
        if (degree > maxDegree) {
          maxDegree = degree;
          const entity = this.getEntity(id);
          if (entity) centerName = entity.name;
        }
      }

      components.push({ entityIds: component, centerName: centerName || "Unnamed" });
    }

    // Atomic clear + insert in a single transaction to prevent duplicates
    // from concurrent processes or interleaved calls
    return this.transaction(() => {
      this.clearTable("kg_communities");

      const communities: Community[] = [];
      const now = new Date().toISOString();

      for (const comp of components) {
        const community: Community = {
          id: generateId("com"),
          name: comp.centerName,
          summary: `${comp.entityIds.length} entities`,
          entityIds: comp.entityIds,
          level: 0,
          createdAt: now,
          updatedAt: now,
        };

        this.execute(
          `INSERT INTO kg_communities (id, name, summary, entity_ids, level, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [community.id, community.name, community.summary, JSON.stringify(community.entityIds), community.level, community.createdAt, community.updatedAt]
        );

        communities.push(community);
      }

      return communities;
    });
  }

  /**
   * Get all communities
   */
  getCommunities(): Community[] {
    const rows = this.query<Record<string, unknown>>(`SELECT * FROM kg_communities`);
    return rows.map(row => this.rowToCommunity(row));
  }

  /**
   * Get community by ID
   */
  getCommunity(id: string): Community | null {
    const row = this.queryOne<Record<string, unknown>>(
      `SELECT * FROM kg_communities WHERE id = ?`,
      [id]
    );
    if (!row) return null;
    return this.rowToCommunity(row);
  }

  /**
   * Find community for entity
   */
  findCommunityForEntity(entityId: string): Community | null {
    const rows = this.query<Record<string, unknown>>(`SELECT * FROM kg_communities`);
    for (const row of rows) {
      const community = this.rowToCommunity(row);
      if (community.entityIds.includes(entityId)) {
        return community;
      }
    }
    return null;
  }

  /**
   * Convert database row to Community object
   */
  private rowToCommunity(row: Record<string, unknown>): Community {
    return {
      id: row.id as string,
      name: row.name as string,
      summary: row.summary as string,
      entityIds: JSON.parse(row.entity_ids as string),
      level: row.level as number,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  /**
   * Get knowledge graph statistics
   */
  getKGStats(): KGStats {
    const totalEntities = this.queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM kg_entities`
    )?.count ?? 0;

    const totalRelations = this.queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM kg_relations`
    )?.count ?? 0;

    const totalCommunities = this.queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM kg_communities`
    )?.count ?? 0;

    const byEntityType: Record<EntityType, number> = {
      function: 0,
      type: 0,
      package: 0,
      file: 0,
      concept: 0,
      pattern: 0,
      tool: 0,
      module: 0,
      store: 0,
      table: 0,
      config: 0,
      method: 0,
      variable: 0,
      interface: 0,
    };
    const typeRows = this.query<{ entity_type: string; count: number }>(
      `SELECT entity_type, COUNT(*) as count FROM kg_entities GROUP BY entity_type`
    );
    for (const row of typeRows) {
      byEntityType[row.entity_type as EntityType] = row.count;
    }

    const byRelationType: Record<RelationType, number> = {
      calls: 0,
      imports: 0,
      implements: 0,
      contains: 0,
      depends_on: 0,
      related_to: 0,
      defined_in: 0,
      tested_by: 0,
      guards: 0,
      stores_in: 0,
      configures: 0,
    };
    const relRows = this.query<{ relation_type: string; count: number }>(
      `SELECT relation_type, COUNT(*) as count FROM kg_relations GROUP BY relation_type`
    );
    for (const row of relRows) {
      byRelationType[row.relation_type as RelationType] = row.count;
    }

    return {
      totalEntities,
      totalRelations,
      totalCommunities,
      byEntityType,
      byRelationType,
      avgRelationsPerEntity: totalEntities > 0 ? totalRelations / totalEntities : 0,
    };
  }

  /**
   * Convert row to Entity
   */
  private rowToEntity(row: Record<string, unknown>): Entity {
    return {
      id: row.id as string,
      name: row.name as string,
      entityType: row.entity_type as EntityType,
      description: row.description as string | undefined,
      properties: JSON.parse((row.properties as string) || "{}"),
      sourceMemoryId: row.source_memory_id as string | undefined,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  /**
   * Convert row to Relation
   */
  private rowToRelation(row: Record<string, unknown>): Relation {
    return {
      id: row.id as string,
      sourceId: row.source_id as string,
      targetId: row.target_id as string,
      relationType: row.relation_type as RelationType,
      weight: row.weight as number,
      properties: JSON.parse((row.properties as string) || "{}"),
      createdAt: row.created_at as string,
    };
  }
}
