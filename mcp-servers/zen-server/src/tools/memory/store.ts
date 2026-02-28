/**
 * Memory Store
 * SQLite-backed storage for memories with embeddings and links
 */

import { BaseStore, type FieldMapping, jsonSerialize } from "../../core/store.js";
import { cosineSimilarity, numberArrayToBytes, bytesToNumberArray } from "../../utils/vectors.js";
import { bfsTraverse } from "../../utils/graph.js";
import { generateId } from "../../utils/ids.js";
import type {
  Memory,
  MemoryType,
  Link,
  RelationshipType,
  EvolutionEvent,
  GraphNode,
  RecallResult,
  RecallOptions,
  DecayResult,
  MemoryStats,
} from "./types.js";

export class MemoryStore extends BaseStore {
  constructor(dbPath: string) {
    super(dbPath);
    this.initTables();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        summary TEXT,
        confidence REAL NOT NULL DEFAULT 1.0,
        source TEXT,
        category TEXT,
        tags TEXT,
        steps TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_accessed TEXT NOT NULL,
        access_count INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        archive_reason TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
      CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);
      CREATE INDEX IF NOT EXISTS idx_memories_archived ON memories(archived);
      CREATE INDEX IF NOT EXISTS idx_memories_confidence ON memories(confidence);

      CREATE TABLE IF NOT EXISTS memory_embeddings (
        memory_id TEXT PRIMARY KEY,
        embedding BLOB NOT NULL,
        dimensions INTEGER NOT NULL,
        FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS links (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        relationship TEXT NOT NULL,
        strength REAL NOT NULL DEFAULT 1.0,
        auto_created INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (source_id) REFERENCES memories(id) ON DELETE CASCADE,
        FOREIGN KEY (target_id) REFERENCES memories(id) ON DELETE CASCADE,
        UNIQUE(source_id, target_id, relationship)
      );

      CREATE INDEX IF NOT EXISTS idx_links_source ON links(source_id);
      CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_id);

      CREATE TABLE IF NOT EXISTS evolution_log (
        id TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL,
        action TEXT NOT NULL,
        relationship TEXT,
        old_confidence REAL,
        new_confidence REAL,
        old_content TEXT,
        new_content TEXT,
        evidence TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_evolution_memory ON evolution_log(memory_id);

      CREATE TABLE IF NOT EXISTS memory_metadata (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);
  }

  /**
   * Insert a new memory
   */
  insertMemory(memory: Omit<Memory, "id" | "createdAt" | "updatedAt" | "lastAccessed" | "accessCount">): string {
    const id = generateId("mem");
    const now = new Date().toISOString();

    this.execute(
      `INSERT INTO memories
       (id, type, content, summary, confidence, source, category, tags, steps,
        created_at, updated_at, last_accessed, access_count, archived, archive_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        memory.type,
        memory.content,
        memory.summary || null,
        memory.confidence,
        memory.source || null,
        memory.category || null,
        JSON.stringify(memory.tags || []),
        memory.steps ? JSON.stringify(memory.steps) : null,
        now,
        now,
        now,
        0,
        memory.archived ? 1 : 0,
        memory.archiveReason || null,
      ]
    );

    // Log creation event
    this.logEvolution({
      memoryId: id,
      action: "created",
      oldConfidence: 0,
      newConfidence: memory.confidence,
      newContent: memory.content,
    });

    return id;
  }

  /**
   * Insert embedding for a memory
   */
  insertEmbedding(memoryId: string, embedding: number[]): void {
    const buffer = numberArrayToBytes(embedding);
    this.execute(
      `INSERT OR REPLACE INTO memory_embeddings (memory_id, embedding, dimensions)
       VALUES (?, ?, ?)`,
      [memoryId, buffer, embedding.length]
    );
  }

  /**
   * Get a memory by ID
   */
  getMemory(id: string): Memory | null {
    const row = this.queryOne<Record<string, unknown>>(
      `SELECT * FROM memories WHERE id = ?`,
      [id]
    );

    if (!row) return null;
    return this.rowToMemory(row);
  }

  private static readonly memoryFields: FieldMapping[] = [
    { key: "content", column: "content" },
    { key: "summary", column: "summary" },
    { key: "confidence", column: "confidence" },
    { key: "category", column: "category" },
    { key: "tags", column: "tags", serialize: jsonSerialize },
  ];

  /**
   * Update memory fields
   */
  updateMemory(id: string, updates: Partial<Pick<Memory, "content" | "summary" | "confidence" | "category" | "tags">>): void {
    this.partialUpdate("memories", "id = ?", [id], updates, MemoryStore.memoryFields);
  }

  /**
   * Touch access time and counter
   */
  touchMemory(id: string): void {
    this.execute(
      `UPDATE memories SET last_accessed = ?, access_count = access_count + 1 WHERE id = ?`,
      [new Date().toISOString(), id]
    );
  }

  /**
   * Archive a memory (soft delete)
   */
  archiveMemory(id: string, reason: string): void {
    const memory = this.getMemory(id);
    if (!memory) return;

    this.execute(
      `UPDATE memories SET archived = 1, archive_reason = ?, updated_at = ? WHERE id = ?`,
      [reason, new Date().toISOString(), id]
    );

    this.logEvolution({
      memoryId: id,
      action: "archived",
      oldConfidence: memory.confidence,
      newConfidence: memory.confidence,
      evidence: reason,
    });
  }

  /**
   * Search memories by embedding similarity
   */
  searchByEmbedding(queryEmbedding: number[], options: RecallOptions = {}): RecallResult[] {
    const { limit = 5, threshold = 0.4, type, category, tags } = options;

    // Build query
    let sql = `
      SELECT m.*, e.embedding
      FROM memories m
      JOIN memory_embeddings e ON m.id = e.memory_id
      WHERE m.archived = 0
    `;
    const params: unknown[] = [];

    if (type) {
      sql += ` AND m.type = ?`;
      params.push(type);
    }
    if (category) {
      sql += ` AND m.category = ?`;
      params.push(category);
    }

    const rows = this.query<Record<string, unknown>>(sql, params);
    const results: RecallResult[] = [];

    for (const row of rows) {
      const embedding = bytesToNumberArray(row.embedding as Buffer);
      const similarity = cosineSimilarity(queryEmbedding, embedding);

      if (similarity >= threshold) {
        const memory = this.rowToMemory(row);

        // Filter by tags if specified
        if (tags && tags.length > 0) {
          const memoryTags = memory.tags || [];
          const hasAllTags = tags.every(t => memoryTags.includes(t));
          if (!hasAllTags) continue;
        }

        results.push({ memory, similarity });

        // Touch access
        this.touchMemory(memory.id);
      }
    }

    // Sort by similarity
    results.sort((a, b) => b.similarity - a.similarity);

    // Add graph context if requested
    if (options.traverseDepth && options.traverseDepth > 0) {
      const topIds = results.slice(0, limit).map(r => r.memory.id);
      const graphNodes = this.traverseGraph(topIds, options.traverseDepth, limit * 3);

      for (const result of results.slice(0, limit)) {
        result.graphContext = graphNodes.filter(n =>
          n.links.some(l => l.sourceId === result.memory.id || l.targetId === result.memory.id)
        );
      }
    }

    return results.slice(0, limit);
  }

  /**
   * Create a link between memories
   */
  createLink(sourceId: string, targetId: string, relationship: RelationshipType, strength = 1.0, autoCreated = false): string | null {
    const id = generateId("link");

    try {
      this.execute(
        `INSERT OR IGNORE INTO links (id, source_id, target_id, relationship, strength, auto_created, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, sourceId, targetId, relationship, strength, autoCreated ? 1 : 0, new Date().toISOString()]
      );
      return id;
    } catch {
      return null; // Duplicate
    }
  }

  /**
   * Get links for a memory
   */
  getLinks(memoryId: string): Link[] {
    const rows = this.query<Record<string, unknown>>(
      `SELECT * FROM links WHERE source_id = ? OR target_id = ?`,
      [memoryId, memoryId]
    );

    return rows.map(row => ({
      id: row.id as string,
      sourceId: row.source_id as string,
      targetId: row.target_id as string,
      relationship: row.relationship as RelationshipType,
      strength: row.strength as number,
      autoCreated: (row.auto_created as number) === 1,
      createdAt: row.created_at as string,
    }));
  }

  /**
   * BFS graph traversal from seed memories
   */
  traverseGraph(seedIds: string[], maxDepth: number, maxNodes: number): GraphNode[] {
    const results = bfsTraverse<Memory, Link>(seedIds, {
      getNode: (id) => {
        const memory = this.getMemory(id);
        return memory && !memory.archived ? memory : null;
      },
      getEdges: (id) => this.getLinks(id).sort((a, b) => b.strength - a.strength),
      getNeighborId: (link, currentId) =>
        link.sourceId === currentId ? link.targetId : link.sourceId,
      maxDepth,
      maxNodes,
    });

    return results.map(r => ({ memory: r.node, depth: r.depth, links: r.edges }));
  }

  /**
   * Log an evolution event
   */
  logEvolution(event: Omit<EvolutionEvent, "id" | "createdAt">): void {
    const id = generateId("evt");
    this.execute(
      `INSERT INTO evolution_log
       (id, memory_id, action, relationship, old_confidence, new_confidence, old_content, new_content, evidence, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        event.memoryId,
        event.action,
        event.relationship || null,
        event.oldConfidence,
        event.newConfidence,
        event.oldContent || null,
        event.newContent || null,
        event.evidence || null,
        new Date().toISOString(),
      ]
    );
  }

  /**
   * Run decay on memories
   */
  runDecay(graceDays: number, baseRate: number, threshold: number): DecayResult {
    const now = new Date();
    const graceDate = new Date(now.getTime() - graceDays * 24 * 60 * 60 * 1000).toISOString();

    // Get candidates: not archived, created before grace period
    const candidates = this.query<Record<string, unknown>>(
      `SELECT * FROM memories WHERE archived = 0 AND created_at < ?`,
      [graceDate]
    );

    let processed = 0;
    let decayed = 0;
    let archived = 0;

    for (const row of candidates) {
      const memory = this.rowToMemory(row);
      processed++;

      // Calculate effective decay rate (access count slows decay)
      const reinforcement = Math.min(memory.accessCount / 10, 1.0) * 0.5;
      const effectiveRate = baseRate * (1 - reinforcement);

      // Apply decay
      const newConfidence = Math.max(0, memory.confidence - effectiveRate);

      if (newConfidence < memory.confidence) {
        decayed++;
        this.updateMemory(memory.id, { confidence: newConfidence });
        this.logEvolution({
          memoryId: memory.id,
          action: "decayed",
          oldConfidence: memory.confidence,
          newConfidence,
        });
      }

      // Auto-archive if below threshold and no incoming links
      if (newConfidence < threshold) {
        const incomingLinks = this.query<{ count: number }>(
          `SELECT COUNT(*) as count FROM links WHERE target_id = ?`,
          [memory.id]
        );

        if (incomingLinks[0]?.count === 0) {
          this.archiveMemory(memory.id, "confidence below threshold, no dependencies");
          archived++;
        }
      }
    }

    // Update last decay run
    this.execute(
      `INSERT OR REPLACE INTO memory_metadata (key, value) VALUES ('last_decay_run', ?)`,
      [now.toISOString()]
    );

    return { processed, decayed, archived };
  }

  /**
   * Get memory statistics
   */
  getMemoryStats(): MemoryStats {
    const totalRow = this.queryOne<{ count: number }>(`SELECT COUNT(*) as count FROM memories`);
    const activeRow = this.queryOne<{ count: number }>(`SELECT COUNT(*) as count FROM memories WHERE archived = 0`);
    const archivedRow = this.queryOne<{ count: number }>(`SELECT COUNT(*) as count FROM memories WHERE archived = 1`);

    const byType: Record<MemoryType, number> = { episodic: 0, semantic: 0, procedural: 0 };
    const typeRows = this.query<{ type: string; count: number }>(
      `SELECT type, COUNT(*) as count FROM memories WHERE archived = 0 GROUP BY type`
    );
    for (const row of typeRows) {
      byType[row.type as MemoryType] = row.count;
    }

    const byCategory: Record<string, number> = {};
    const catRows = this.query<{ category: string | null; count: number }>(
      `SELECT category, COUNT(*) as count FROM memories WHERE archived = 0 GROUP BY category`
    );
    for (const row of catRows) {
      byCategory[row.category || "uncategorized"] = row.count;
    }

    const avgRow = this.queryOne<{ avg: number | null }>(
      `SELECT AVG(confidence) as avg FROM memories WHERE archived = 0`
    );

    const linkRow = this.queryOne<{ count: number }>(`SELECT COUNT(*) as count FROM links`);

    const decayRow = this.queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM memories
       WHERE archived = 0 AND confidence < 0.5
       AND created_at < datetime('now', '-7 days')`
    );

    const lastDecay = this.queryOne<{ value: string | null }>(
      `SELECT value FROM memory_metadata WHERE key = 'last_decay_run'`
    );

    return {
      totalMemories: totalRow?.count ?? 0,
      activeMemories: activeRow?.count ?? 0,
      archivedMemories: archivedRow?.count ?? 0,
      byType,
      byCategory,
      avgConfidence: avgRow?.avg ?? 0,
      totalLinks: linkRow?.count ?? 0,
      decayCandidates: decayRow?.count ?? 0,
      lastDecayRun: lastDecay?.value ?? undefined,
    };
  }

  /**
   * Get all embeddings, optionally excluding a specific memory
   */
  getAllEmbeddings(excludeId?: string): Array<{ memory_id: string; embedding: Buffer }> {
    if (excludeId) {
      return this.query<{ memory_id: string; embedding: Buffer }>(
        `SELECT memory_id, embedding FROM memory_embeddings WHERE memory_id != ?`,
        [excludeId]
      );
    }
    return this.query<{ memory_id: string; embedding: Buffer }>(
      `SELECT memory_id, embedding FROM memory_embeddings`
    );
  }

  /**
   * Convert database row to Memory object
   */
  private rowToMemory(row: Record<string, unknown>): Memory {
    return {
      id: row.id as string,
      type: row.type as MemoryType,
      content: row.content as string,
      summary: row.summary as string | undefined,
      confidence: row.confidence as number,
      source: row.source as string | undefined,
      category: row.category as string | undefined,
      tags: JSON.parse((row.tags as string) || "[]"),
      steps: row.steps ? JSON.parse(row.steps as string) : undefined,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      lastAccessed: row.last_accessed as string,
      accessCount: row.access_count as number,
      archived: (row.archived as number) === 1,
      archiveReason: row.archive_reason as string | undefined,
    };
  }
}
