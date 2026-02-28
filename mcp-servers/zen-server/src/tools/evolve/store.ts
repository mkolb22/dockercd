/**
 * Evolution Store
 * SQLite-backed storage for evolution sessions and variants.
 * Uses the existing state.db via shared stateDbPath config.
 */

import { BaseStore, type FieldMapping } from "../../core/store.js";
import { generateId } from "../../utils/ids.js";
import type {
  EvolutionSession,
  EvolutionVariant,
  EvolutionConfig,
  EvolutionStatus,
  TestCase,
} from "./types.js";

interface SessionRow {
  id: string;
  concept_name: string;
  initial_prompt: string;
  test_cases: string;
  config: string;
  current_generation: number;
  status: string;
  best_fitness: number;
  best_variant_id: string | null;
  created_at: string;
  updated_at: string;
}

interface VariantRow {
  id: string;
  session_id: string;
  generation: number;
  prompt: string;
  fitness_score: number | null;
  notes: string | null;
  parent_id: string | null;
  created_at: string;
}

export class EvolveStore extends BaseStore {
  constructor(dbPath: string) {
    super(dbPath);
    this.initTables();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS evolution_sessions (
        id TEXT PRIMARY KEY,
        concept_name TEXT NOT NULL,
        initial_prompt TEXT NOT NULL,
        test_cases TEXT NOT NULL,
        config TEXT NOT NULL,
        current_generation INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active',
        best_fitness REAL DEFAULT 0,
        best_variant_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS evolution_variants (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        generation INTEGER NOT NULL,
        prompt TEXT NOT NULL,
        fitness_score REAL,
        notes TEXT,
        parent_id TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_ev_variants_session
        ON evolution_variants (session_id);
      CREATE INDEX IF NOT EXISTS idx_ev_variants_gen
        ON evolution_variants (session_id, generation);
    `);
  }

  // ─── Sessions ──────────────────────────────────────────

  createSession(
    conceptName: string,
    initialPrompt: string,
    testCases: TestCase[],
    config: EvolutionConfig,
  ): EvolutionSession {
    const id = generateId("evo");
    const now = new Date().toISOString();

    this.execute(
      `INSERT INTO evolution_sessions
        (id, concept_name, initial_prompt, test_cases, config, current_generation, status, best_fitness, best_variant_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, 'active', 0, NULL, ?, ?)`,
      [id, conceptName, initialPrompt, JSON.stringify(testCases), JSON.stringify(config), now, now],
    );

    return {
      id,
      conceptName,
      initialPrompt,
      testCases,
      config,
      currentGeneration: 0,
      status: "active",
      bestFitness: 0,
      bestVariantId: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  getSession(id: string): EvolutionSession | null {
    const row = this.queryOne<SessionRow>(
      "SELECT * FROM evolution_sessions WHERE id = ?",
      [id],
    );
    return row ? this.rowToSession(row) : null;
  }

  private static readonly sessionFields: FieldMapping[] = [
    { key: "currentGeneration", column: "current_generation" },
    { key: "status", column: "status" },
    { key: "bestFitness", column: "best_fitness" },
    { key: "bestVariantId", column: "best_variant_id" },
  ];

  updateSession(
    id: string,
    updates: Partial<Pick<EvolutionSession, "currentGeneration" | "status" | "bestFitness" | "bestVariantId">>,
  ): void {
    this.partialUpdate("evolution_sessions", "id = ?", [id], updates, EvolveStore.sessionFields);
  }

  // ─── Variants ──────────────────────────────────────────

  insertVariants(
    sessionId: string,
    generation: number,
    variants: Array<{ prompt: string; fitnessScore: number; notes?: string; parentId?: string }>,
  ): EvolutionVariant[] {
    const now = new Date().toISOString();
    const results: EvolutionVariant[] = [];

    this.transaction(() => {
      for (const v of variants) {
        const id = generateId("var");
        this.execute(
          `INSERT INTO evolution_variants
            (id, session_id, generation, prompt, fitness_score, notes, parent_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, sessionId, generation, v.prompt, v.fitnessScore, v.notes ?? null, v.parentId ?? null, now],
        );
        results.push({
          id,
          sessionId,
          generation,
          prompt: v.prompt,
          fitnessScore: v.fitnessScore,
          notes: v.notes ?? null,
          parentId: v.parentId ?? null,
          createdAt: now,
        });
      }
    });

    return results;
  }

  getVariants(sessionId: string, generation?: number): EvolutionVariant[] {
    if (generation !== undefined) {
      return this.query<VariantRow>(
        "SELECT * FROM evolution_variants WHERE session_id = ? AND generation = ? ORDER BY fitness_score DESC",
        [sessionId, generation],
      ).map((r) => this.rowToVariant(r));
    }
    return this.query<VariantRow>(
      "SELECT * FROM evolution_variants WHERE session_id = ? ORDER BY generation ASC, fitness_score DESC",
      [sessionId],
    ).map((r) => this.rowToVariant(r));
  }

  getBestVariant(sessionId: string): EvolutionVariant | null {
    const row = this.queryOne<VariantRow>(
      "SELECT * FROM evolution_variants WHERE session_id = ? ORDER BY fitness_score DESC LIMIT 1",
      [sessionId],
    );
    return row ? this.rowToVariant(row) : null;
  }

  getVariantCount(sessionId: string): number {
    const result = this.queryOne<{ count: number }>(
      "SELECT COUNT(*) as count FROM evolution_variants WHERE session_id = ?",
      [sessionId],
    );
    return result?.count ?? 0;
  }

  // ─── Row converters ────────────────────────────────────

  private rowToSession(row: SessionRow): EvolutionSession {
    return {
      id: row.id,
      conceptName: row.concept_name,
      initialPrompt: row.initial_prompt,
      testCases: JSON.parse(row.test_cases),
      config: JSON.parse(row.config),
      currentGeneration: row.current_generation,
      status: row.status as EvolutionStatus,
      bestFitness: row.best_fitness,
      bestVariantId: row.best_variant_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private rowToVariant(row: VariantRow): EvolutionVariant {
    return {
      id: row.id,
      sessionId: row.session_id,
      generation: row.generation,
      prompt: row.prompt,
      fitnessScore: row.fitness_score,
      notes: row.notes,
      parentId: row.parent_id,
      createdAt: row.created_at,
    };
  }
}
