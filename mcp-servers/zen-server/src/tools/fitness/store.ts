/**
 * Fitness Store
 * SQLite persistence for fitness state, performance, budget, debates.
 * Uses evolution_* tables in state.db (shared with koan-evolve CLI).
 */

import { BaseStore } from "../../core/store.js";
import { generateId } from "../../utils/ids.js";
import type {
  FitnessState,
  FitnessScore,
  ConceptFitness,
  PerformanceState,
  ConceptActionPerformance,
  ModelPerformanceMetrics,
  Model,
  BudgetLimits,
  BudgetState,
  SpendRecord,
  DebateResult,
  PromptVariant,
  VariantStatus,
} from "./types.js";

// ─── Row types ────────────────────────────────────────────────

interface FitnessRow {
  concept: string;
  variant_id: string;
  runs: number;
  current_fitness: number;
  rolling_avg_10: number;
  trend: string;
  metrics: string;
  history: string;
  updated_at: string;
}

interface PerformanceRow {
  concept: string;
  action: string;
  model: string;
  runs: number;
  successes: number;
  failures: number;
  success_rate: number;
  avg_cost: number;
  avg_duration_ms: number;
  last_20_runs: string;
  updated_at: string;
}

interface BudgetRow {
  id: string;
  daily_limit_usd: number;
  weekly_limit_usd: number;
  monthly_limit_usd: number;
  per_operation_limit_usd: number;
  updated_at: string;
}

interface SpendRow {
  id: string;
  concept: string;
  action: string;
  model: string;
  cost: number;
  created_at: string;
}

interface DebateRow {
  id: string;
  arch_id: string;
  duration_ms: number;
  advocate: string;
  critic: string;
  synthesis: string;
  metadata: string;
  created_at: string;
}

interface VariantRow {
  variant_id: string;
  concept: string;
  parent: string | null;
  content: string;
  mutation_type: string | null;
  mutation_focus: string | null;
  fitness_at_creation: number | null;
  status: string;
  checksum: string;
  created_at: string;
}

export class FitnessStore extends BaseStore {
  constructor(dbPath: string) {
    super(dbPath);
    this.initTables();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS evolution_fitness (
        concept TEXT NOT NULL,
        variant_id TEXT NOT NULL,
        runs INTEGER NOT NULL DEFAULT 0,
        current_fitness REAL NOT NULL DEFAULT 0,
        rolling_avg_10 REAL NOT NULL DEFAULT 0,
        trend TEXT NOT NULL DEFAULT 'stable',
        metrics TEXT NOT NULL DEFAULT '{}',
        history TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (concept, variant_id)
      );

      CREATE TABLE IF NOT EXISTS evolution_performance (
        concept TEXT NOT NULL,
        action TEXT NOT NULL,
        model TEXT NOT NULL,
        runs INTEGER NOT NULL DEFAULT 0,
        successes INTEGER NOT NULL DEFAULT 0,
        failures INTEGER NOT NULL DEFAULT 0,
        success_rate REAL NOT NULL DEFAULT 0,
        avg_cost REAL NOT NULL DEFAULT 0,
        avg_duration_ms REAL NOT NULL DEFAULT 0,
        last_20_runs TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (concept, action, model)
      );

      CREATE TABLE IF NOT EXISTS evolution_budget (
        id TEXT PRIMARY KEY DEFAULT 'default',
        daily_limit_usd REAL NOT NULL DEFAULT 10.0,
        weekly_limit_usd REAL NOT NULL DEFAULT 50.0,
        monthly_limit_usd REAL NOT NULL DEFAULT 200.0,
        per_operation_limit_usd REAL NOT NULL DEFAULT 1.0,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS evolution_spend_records (
        id TEXT PRIMARY KEY,
        concept TEXT NOT NULL,
        action TEXT NOT NULL,
        model TEXT NOT NULL,
        cost REAL NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_spend_created ON evolution_spend_records (created_at);

      CREATE TABLE IF NOT EXISTS evolution_debates (
        id TEXT PRIMARY KEY,
        arch_id TEXT NOT NULL,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        advocate TEXT NOT NULL DEFAULT '{}',
        critic TEXT NOT NULL DEFAULT '{}',
        synthesis TEXT NOT NULL DEFAULT '{}',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS evolution_variants (
        variant_id TEXT NOT NULL,
        concept TEXT NOT NULL,
        parent TEXT,
        content TEXT NOT NULL,
        mutation_type TEXT,
        mutation_focus TEXT,
        fitness_at_creation REAL,
        status TEXT NOT NULL DEFAULT 'active',
        checksum TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (concept, variant_id)
      );

      CREATE INDEX IF NOT EXISTS idx_variants_status ON evolution_variants (status);

      CREATE TABLE IF NOT EXISTS evolution_quarantine (
        variant_id TEXT PRIMARY KEY,
        concept TEXT NOT NULL,
        reason TEXT NOT NULL,
        findings TEXT NOT NULL DEFAULT '[]',
        quarantined_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  // ─── Fitness ────────────────────────────────────────────────

  saveFitnessScore(concept: string, score: FitnessScore): void {
    this.execute(
      `INSERT INTO evolution_fitness (concept, variant_id, runs, current_fitness, rolling_avg_10, trend, metrics, history, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(concept, variant_id) DO UPDATE SET
         runs = excluded.runs, current_fitness = excluded.current_fitness,
         rolling_avg_10 = excluded.rolling_avg_10, trend = excluded.trend,
         metrics = excluded.metrics, history = excluded.history, updated_at = excluded.updated_at`,
      [
        concept, score.variant_id, score.runs,
        score.fitness.current, score.fitness.rolling_avg_10, score.fitness.trend,
        JSON.stringify(score.metrics), JSON.stringify(score.history),
        new Date().toISOString(),
      ],
    );
  }

  loadFitnessState(concept: string): FitnessState | null {
    const rows = this.query<FitnessRow>(
      "SELECT * FROM evolution_fitness WHERE concept = ? ORDER BY current_fitness DESC",
      [concept],
    );
    if (rows.length === 0) return null;

    const variants: FitnessScore[] = rows.map((r) => ({
      variant_id: r.variant_id,
      runs: r.runs,
      fitness: { current: r.current_fitness, rolling_avg_10: r.rolling_avg_10, trend: r.trend as FitnessScore["fitness"]["trend"] },
      metrics: safeJson(r.metrics),
      history: safeJsonArray(r.history),
    }));

    return {
      concept,
      current_variant: variants[0].variant_id,
      variants,
      promotion_threshold: 0.8,
      minimum_runs: 10,
    };
  }

  listConceptFitness(): ConceptFitness[] {
    const rows = this.query<FitnessRow>(
      `SELECT concept, variant_id, current_fitness, runs, trend FROM evolution_fitness
       WHERE (concept, current_fitness) IN (
         SELECT concept, MAX(current_fitness) FROM evolution_fitness GROUP BY concept
       )`,
    );

    const conceptCounts = this.query<{ concept: string; cnt: number }>(
      "SELECT concept, COUNT(*) as cnt FROM evolution_fitness GROUP BY concept",
    );
    const countMap = new Map(conceptCounts.map((r) => [r.concept, r.cnt]));

    return rows.map((r) => ({
      concept: r.concept,
      current_variant: r.variant_id,
      current_fitness: r.current_fitness,
      runs: r.runs,
      trend: r.trend as ConceptFitness["trend"],
      variant_count: countMap.get(r.concept) || 1,
    }));
  }

  // ─── Performance ────────────────────────────────────────────

  loadPerformanceState(): PerformanceState {
    const rows = this.query<PerformanceRow>(
      "SELECT * FROM evolution_performance ORDER BY concept, action, model",
    );

    const caMap = new Map<string, ConceptActionPerformance>();
    for (const r of rows) {
      const key = `${r.concept}:${r.action}`;
      let ca = caMap.get(key);
      if (!ca) {
        ca = { concept: r.concept, action: r.action, models: {} };
        caMap.set(key, ca);
      }
      ca.models[r.model as Model] = {
        runs: r.runs,
        successes: r.successes,
        failures: r.failures,
        success_rate: r.success_rate,
        avg_cost: r.avg_cost,
        avg_duration_ms: r.avg_duration_ms,
        last_20_runs: safeJsonArray(r.last_20_runs),
      };
    }

    return { concept_actions: Array.from(caMap.values()) };
  }

  savePerformanceMetrics(
    concept: string, action: string, model: Model, metrics: ModelPerformanceMetrics,
  ): void {
    this.execute(
      `INSERT INTO evolution_performance (concept, action, model, runs, successes, failures, success_rate, avg_cost, avg_duration_ms, last_20_runs, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(concept, action, model) DO UPDATE SET
         runs = excluded.runs, successes = excluded.successes, failures = excluded.failures,
         success_rate = excluded.success_rate, avg_cost = excluded.avg_cost,
         avg_duration_ms = excluded.avg_duration_ms, last_20_runs = excluded.last_20_runs,
         updated_at = excluded.updated_at`,
      [
        concept, action, model, metrics.runs, metrics.successes, metrics.failures,
        metrics.success_rate, metrics.avg_cost, metrics.avg_duration_ms,
        JSON.stringify(metrics.last_20_runs), new Date().toISOString(),
      ],
    );
  }

  // ─── Budget ─────────────────────────────────────────────────

  loadBudgetLimits(): BudgetLimits {
    const row = this.queryOne<BudgetRow>(
      "SELECT * FROM evolution_budget WHERE id = 'default'",
    );
    if (!row) {
      return { daily_limit_usd: 10, weekly_limit_usd: 50, monthly_limit_usd: 200, per_operation_limit_usd: 1 };
    }
    return {
      daily_limit_usd: row.daily_limit_usd,
      weekly_limit_usd: row.weekly_limit_usd,
      monthly_limit_usd: row.monthly_limit_usd,
      per_operation_limit_usd: row.per_operation_limit_usd,
    };
  }

  saveBudgetLimits(limits: BudgetLimits): void {
    this.execute(
      `INSERT INTO evolution_budget (id, daily_limit_usd, weekly_limit_usd, monthly_limit_usd, per_operation_limit_usd, updated_at)
       VALUES ('default', ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         daily_limit_usd = excluded.daily_limit_usd, weekly_limit_usd = excluded.weekly_limit_usd,
         monthly_limit_usd = excluded.monthly_limit_usd, per_operation_limit_usd = excluded.per_operation_limit_usd,
         updated_at = excluded.updated_at`,
      [limits.daily_limit_usd, limits.weekly_limit_usd, limits.monthly_limit_usd, limits.per_operation_limit_usd, new Date().toISOString()],
    );
  }

  loadSpendRecords(since?: Date): SpendRecord[] {
    const rows = since
      ? this.query<SpendRow>("SELECT * FROM evolution_spend_records WHERE created_at >= ? ORDER BY created_at DESC", [since.toISOString()])
      : this.query<SpendRow>("SELECT * FROM evolution_spend_records ORDER BY created_at DESC LIMIT 1000");

    return rows.map((r) => ({
      timestamp: r.created_at,
      concept: r.concept,
      action: r.action,
      model: r.model as Model,
      cost: r.cost,
    }));
  }

  recordSpend(concept: string, action: string, model: Model, cost: number): void {
    this.execute(
      "INSERT INTO evolution_spend_records (id, concept, action, model, cost, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [generateId("spend"), concept, action, model, cost, new Date().toISOString()],
    );
  }

  // ─── Debates ────────────────────────────────────────────────

  saveDebate(result: DebateResult): void {
    this.execute(
      `INSERT INTO evolution_debates (id, arch_id, duration_ms, advocate, critic, synthesis, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        result.debate_id, result.arch_id, result.duration_ms,
        JSON.stringify(result.advocate), JSON.stringify(result.critic),
        JSON.stringify(result.synthesis), JSON.stringify(result.metadata),
        new Date().toISOString(),
      ],
    );
  }

  loadDebates(archId?: string, limit = 20): DebateResult[] {
    const rows = archId
      ? this.query<DebateRow>("SELECT * FROM evolution_debates WHERE arch_id = ? ORDER BY created_at DESC LIMIT ?", [archId, limit])
      : this.query<DebateRow>("SELECT * FROM evolution_debates ORDER BY created_at DESC LIMIT ?", [limit]);

    return rows.map((r) => ({
      debate_id: r.id,
      arch_id: r.arch_id,
      duration_ms: r.duration_ms,
      advocate: safeJson(r.advocate),
      critic: safeJson(r.critic),
      synthesis: safeJson(r.synthesis),
      metadata: safeJson(r.metadata),
    }));
  }

  // ─── Variants ───────────────────────────────────────────────

  saveVariant(concept: string, variant: PromptVariant): void {
    this.execute(
      `INSERT INTO evolution_variants (variant_id, concept, parent, content, mutation_type, mutation_focus, fitness_at_creation, status, checksum, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(concept, variant_id) DO UPDATE SET
         content = excluded.content, status = excluded.status, checksum = excluded.checksum`,
      [
        variant.variant_id, concept, variant.parent || null,
        variant.content, variant.mutation_type || null, variant.mutation_focus || null,
        variant.fitness_at_creation, variant.status, variant.checksum,
        variant.created_at,
      ],
    );
  }

  loadVariants(concept: string, status?: VariantStatus): PromptVariant[] {
    const rows = status
      ? this.query<VariantRow>("SELECT * FROM evolution_variants WHERE concept = ? AND status = ? ORDER BY created_at DESC", [concept, status])
      : this.query<VariantRow>("SELECT * FROM evolution_variants WHERE concept = ? ORDER BY created_at DESC", [concept]);

    return rows.map(rowToVariant);
  }

  getVariant(concept: string, variantId: string): PromptVariant | null {
    const row = this.queryOne<VariantRow>(
      "SELECT * FROM evolution_variants WHERE concept = ? AND variant_id = ?",
      [concept, variantId],
    );
    return row ? rowToVariant(row) : null;
  }

  updateVariantStatus(concept: string, variantId: string, status: VariantStatus): void {
    this.execute(
      "UPDATE evolution_variants SET status = ? WHERE concept = ? AND variant_id = ?",
      [status, concept, variantId],
    );
  }
}

function rowToVariant(r: VariantRow): PromptVariant {
  return {
    variant_id: r.variant_id,
    parent: r.parent || undefined,
    created_at: r.created_at,
    mutation_type: r.mutation_type || undefined,
    mutation_focus: r.mutation_focus || undefined,
    fitness_at_creation: r.fitness_at_creation,
    status: r.status as VariantStatus,
    checksum: r.checksum,
    content: r.content,
  };
}

function safeJson(str: string): any {
  try { return JSON.parse(str); } catch { return {}; }
}

function safeJsonArray(str: string): any[] {
  try {
    const parsed = JSON.parse(str);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
