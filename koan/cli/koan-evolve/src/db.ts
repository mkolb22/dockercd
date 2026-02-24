/**
 * Central SQLite store for koan-evolve state.
 * All evolution tables (evolution_* prefix) live in the shared state.db.
 */

import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { getStateDbPath, getDatabase, type Concept } from '@zen/koan-core';
import type { FitnessState, FitnessHistoryEntry, DebateResult, SanitizationEntry } from './types.js';
import type { PerformanceState, ConceptActionPerformance, Model, ModelPerformanceMetrics } from './routing/performance.js';
import type { BudgetState, SpendRecord } from './security/budget-enforcer.js';
import type { QuarantineRecord, Finding } from './security/variant-validator.js';
import { createDefaultBudgetState } from './security/budget-enforcer.js';

// ============================================================================
// SQLite Row Types — eliminates `as any` casts from query results
// ============================================================================

interface FitnessRow {
  concept: string;
  variant_id: string;
  current_variant: number;
  runs: number;
  fitness_current: number;
  fitness_rolling_avg: number;
  fitness_trend: string;
  test_pass_rate: number;
  quality_score: number;
  user_acceptance: number;
  history_json: string;
  promotion_threshold: number;
  minimum_runs: number;
  last_updated: string;
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
  last_20_runs_json: string;
  last_updated: string;
}

interface BudgetRow {
  daily_limit_usd: number;
  weekly_limit_usd: number;
  monthly_limit_usd: number;
  per_operation_limit_usd: number;
  last_updated: string;
}

interface SpendRow {
  timestamp: string;
  concept: string;
  action: string;
  model: string;
  cost: number;
}

interface DebateRow {
  debate_json: string;
}

interface QuarantineRow {
  variant_id: string;
  quarantined_at: string;
  reason: string;
  findings_json: string;
  content: string;
}

interface SanitizationRow {
  type: string;
  subtype: string;
  count: number;
  timestamp: string;
  context_hash: string | null;
}

const INIT_SQL = `
  CREATE TABLE IF NOT EXISTS evolution_fitness (
    concept TEXT NOT NULL,
    variant_id TEXT NOT NULL,
    current_variant INTEGER NOT NULL DEFAULT 0,
    runs INTEGER NOT NULL DEFAULT 0,
    fitness_current REAL NOT NULL DEFAULT 0,
    fitness_rolling_avg REAL NOT NULL DEFAULT 0,
    fitness_trend TEXT NOT NULL DEFAULT 'stable',
    test_pass_rate REAL NOT NULL DEFAULT 0,
    quality_score REAL NOT NULL DEFAULT 0,
    user_acceptance REAL NOT NULL DEFAULT 0,
    history_json TEXT NOT NULL DEFAULT '[]',
    promotion_threshold REAL NOT NULL DEFAULT 0.1,
    minimum_runs INTEGER NOT NULL DEFAULT 10,
    last_updated TEXT NOT NULL,
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
    last_20_runs_json TEXT NOT NULL DEFAULT '[]',
    last_updated TEXT NOT NULL,
    PRIMARY KEY (concept, action, model)
  );

  CREATE TABLE IF NOT EXISTS evolution_budget (
    id TEXT PRIMARY KEY DEFAULT 'global',
    daily_limit_usd REAL NOT NULL DEFAULT 10.0,
    weekly_limit_usd REAL NOT NULL DEFAULT 50.0,
    monthly_limit_usd REAL NOT NULL DEFAULT 200.0,
    per_operation_limit_usd REAL NOT NULL DEFAULT 5.0,
    last_updated TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS evolution_spend_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    concept TEXT NOT NULL,
    action TEXT NOT NULL,
    model TEXT NOT NULL,
    cost REAL NOT NULL
  );

  CREATE TABLE IF NOT EXISTS evolution_debates (
    arch_id TEXT PRIMARY KEY,
    debate_json TEXT NOT NULL,
    last_updated TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS evolution_quarantine (
    variant_id TEXT PRIMARY KEY,
    quarantined_at TEXT NOT NULL,
    reason TEXT NOT NULL,
    findings_json TEXT NOT NULL,
    content TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS evolution_sanitization_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    subtype TEXT NOT NULL,
    count INTEGER NOT NULL,
    timestamp TEXT NOT NULL,
    context_hash TEXT
  );
`;

export function getEvolutionDbPath(projectRoot: string): string {
  return getStateDbPath(projectRoot);
}

function openDb(projectRoot: string, readonly = false): any {
  const dbPath = getEvolutionDbPath(projectRoot);
  if (readonly && !existsSync(dbPath)) return null;
  if (!readonly) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  const db = getDatabase(dbPath, readonly);
  if (db && !readonly) db.exec(INIT_SQL);
  return db;
}

// ============================================================================
// FITNESS
// ============================================================================

export function loadFitnessStateFromDb(projectRoot: string, concept: Concept): FitnessState | null {
  const db = openDb(projectRoot, true);
  if (!db) return null;

  try {
    const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='evolution_fitness'").get();
    if (!tableCheck) return null;

    const rows = db.prepare('SELECT * FROM evolution_fitness WHERE concept = ? ORDER BY current_variant DESC, variant_id').all(concept) as FitnessRow[];
    if (rows.length === 0) return null;

    const currentRow = rows.find(r => r.current_variant === 1) || rows[0];

    return {
      concept,
      current_variant: currentRow.variant_id,
      variants: rows.map(r => ({
        variant_id: r.variant_id,
        runs: r.runs,
        fitness: {
          current: r.fitness_current,
          rolling_avg_10: r.fitness_rolling_avg,
          trend: r.fitness_trend as 'improving' | 'stable' | 'degrading',
        },
        metrics: {
          test_pass_rate: r.test_pass_rate,
          quality_score: r.quality_score,
          user_acceptance: r.user_acceptance,
        },
        history: safeJsonParse(r.history_json) as FitnessHistoryEntry[],
      })),
      promotion_threshold: currentRow.promotion_threshold,
      minimum_runs: currentRow.minimum_runs,
      metadata: {
        last_updated: currentRow.last_updated,
        checksum: '',
      },
    };
  } finally {
    db.close();
  }
}

export function saveFitnessStateToDb(projectRoot: string, state: FitnessState): void {
  const db = openDb(projectRoot);
  if (!db) return;

  try {
    const upsert = db.prepare(`
      INSERT INTO evolution_fitness (concept, variant_id, current_variant, runs, fitness_current, fitness_rolling_avg, fitness_trend, test_pass_rate, quality_score, user_acceptance, history_json, promotion_threshold, minimum_runs, last_updated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(concept, variant_id) DO UPDATE SET
        current_variant = excluded.current_variant,
        runs = excluded.runs,
        fitness_current = excluded.fitness_current,
        fitness_rolling_avg = excluded.fitness_rolling_avg,
        fitness_trend = excluded.fitness_trend,
        test_pass_rate = excluded.test_pass_rate,
        quality_score = excluded.quality_score,
        user_acceptance = excluded.user_acceptance,
        history_json = excluded.history_json,
        promotion_threshold = excluded.promotion_threshold,
        minimum_runs = excluded.minimum_runs,
        last_updated = excluded.last_updated
    `);

    const now = new Date().toISOString();
    const transaction = db.transaction(() => {
      for (const v of state.variants) {
        upsert.run(
          state.concept, v.variant_id,
          v.variant_id === state.current_variant ? 1 : 0,
          v.runs, v.fitness.current, v.fitness.rolling_avg_10, v.fitness.trend,
          v.metrics.test_pass_rate, v.metrics.quality_score, v.metrics.user_acceptance,
          JSON.stringify(v.history), state.promotion_threshold, state.minimum_runs, now,
        );
      }
    });
    transaction();
  } finally {
    db.close();
  }
}

export function listFitnessConceptsFromDb(projectRoot: string): Concept[] {
  const db = openDb(projectRoot, true);
  if (!db) return [];

  try {
    const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='evolution_fitness'").get();
    if (!tableCheck) return [];

    const rows = db.prepare('SELECT DISTINCT concept FROM evolution_fitness ORDER BY concept').all() as { concept: string }[];
    return rows.map(r => r.concept as Concept);
  } finally {
    db.close();
  }
}

// ============================================================================
// PERFORMANCE
// ============================================================================

export function loadPerformanceStateFromDb(projectRoot: string): PerformanceState {
  const db = openDb(projectRoot, true);
  const defaultState: PerformanceState = {
    concept_actions: [],
    metadata: { last_updated: new Date().toISOString(), checksum: '' },
  };

  if (!db) return defaultState;

  try {
    const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='evolution_performance'").get();
    if (!tableCheck) return defaultState;

    const rows = db.prepare('SELECT * FROM evolution_performance ORDER BY concept, action, model').all() as PerformanceRow[];
    if (rows.length === 0) return defaultState;

    const caMap = new Map<string, ConceptActionPerformance>();
    for (const r of rows) {
      const key = `${r.concept}:${r.action}`;
      if (!caMap.has(key)) {
        caMap.set(key, { concept: r.concept as Concept, action: r.action, models: {} });
      }
      const ca = caMap.get(key)!;
      ca.models[r.model as Model] = {
        runs: r.runs,
        successes: r.successes,
        failures: r.failures,
        success_rate: r.success_rate,
        avg_cost: r.avg_cost,
        avg_duration_ms: r.avg_duration_ms,
        last_20_runs: safeJsonParse(r.last_20_runs_json) as boolean[],
      };
    }

    return {
      concept_actions: [...caMap.values()],
      metadata: { last_updated: rows[0]?.last_updated || new Date().toISOString(), checksum: '' },
    };
  } finally {
    db.close();
  }
}

export function savePerformanceStateToDb(projectRoot: string, state: PerformanceState): void {
  const db = openDb(projectRoot);
  if (!db) return;

  try {
    const upsert = db.prepare(`
      INSERT INTO evolution_performance (concept, action, model, runs, successes, failures, success_rate, avg_cost, avg_duration_ms, last_20_runs_json, last_updated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(concept, action, model) DO UPDATE SET
        runs = excluded.runs,
        successes = excluded.successes,
        failures = excluded.failures,
        success_rate = excluded.success_rate,
        avg_cost = excluded.avg_cost,
        avg_duration_ms = excluded.avg_duration_ms,
        last_20_runs_json = excluded.last_20_runs_json,
        last_updated = excluded.last_updated
    `);

    const now = new Date().toISOString();
    const transaction = db.transaction(() => {
      for (const ca of state.concept_actions) {
        for (const [model, metrics] of Object.entries(ca.models)) {
          if (!metrics) continue;
          upsert.run(
            ca.concept, ca.action, model,
            metrics.runs, metrics.successes, metrics.failures,
            metrics.success_rate, metrics.avg_cost, metrics.avg_duration_ms,
            JSON.stringify(metrics.last_20_runs), now,
          );
        }
      }
    });
    transaction();
  } finally {
    db.close();
  }
}

// ============================================================================
// BUDGET
// ============================================================================

export function loadBudgetStateFromDb(projectRoot: string): BudgetState {
  const db = openDb(projectRoot, true);
  if (!db) return createDefaultBudgetState();

  try {
    const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='evolution_budget'").get();
    if (!tableCheck) return createDefaultBudgetState();

    const budgetRow = db.prepare('SELECT * FROM evolution_budget WHERE id = ?').get('global') as BudgetRow | undefined;
    const spendRows = db.prepare('SELECT * FROM evolution_spend_records ORDER BY timestamp DESC').all() as SpendRow[];

    const limits = budgetRow ? {
      daily_limit_usd: budgetRow.daily_limit_usd,
      weekly_limit_usd: budgetRow.weekly_limit_usd,
      monthly_limit_usd: budgetRow.monthly_limit_usd,
      per_operation_limit_usd: budgetRow.per_operation_limit_usd,
    } : createDefaultBudgetState().limits;

    return {
      limits,
      spend_records: spendRows.map(r => ({
        timestamp: r.timestamp,
        concept: r.concept as Concept,
        action: r.action,
        model: r.model as Model,
        cost: r.cost,
      })),
      metadata: {
        last_updated: budgetRow?.last_updated || new Date().toISOString(),
        checksum: '',
      },
    };
  } finally {
    db.close();
  }
}

export function saveBudgetStateToDb(projectRoot: string, state: BudgetState): void {
  const db = openDb(projectRoot);
  if (!db) return;

  try {
    const now = new Date().toISOString();
    const transaction = db.transaction(() => {
      // Upsert budget limits
      db.prepare(`
        INSERT INTO evolution_budget (id, daily_limit_usd, weekly_limit_usd, monthly_limit_usd, per_operation_limit_usd, last_updated)
        VALUES ('global', ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          daily_limit_usd = excluded.daily_limit_usd,
          weekly_limit_usd = excluded.weekly_limit_usd,
          monthly_limit_usd = excluded.monthly_limit_usd,
          per_operation_limit_usd = excluded.per_operation_limit_usd,
          last_updated = excluded.last_updated
      `).run(
        state.limits.daily_limit_usd, state.limits.weekly_limit_usd,
        state.limits.monthly_limit_usd, state.limits.per_operation_limit_usd, now,
      );

      // Insert new spend records (deduplicate by checking existing)
      const existingCount = (db.prepare('SELECT COUNT(*) as cnt FROM evolution_spend_records').get() as { cnt: number }).cnt;
      const insertSpend = db.prepare(
        'INSERT INTO evolution_spend_records (timestamp, concept, action, model, cost) VALUES (?, ?, ?, ?, ?)'
      );
      // Only insert records beyond what already exists
      for (const r of state.spend_records.slice(0, state.spend_records.length - existingCount)) {
        insertSpend.run(r.timestamp, r.concept, r.action, r.model, r.cost);
      }
    });
    transaction();
  } finally {
    db.close();
  }
}

// ============================================================================
// DEBATES
// ============================================================================

export function loadDebateFromDb(projectRoot: string, archId: string): DebateResult | null {
  const db = openDb(projectRoot, true);
  if (!db) return null;

  try {
    const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='evolution_debates'").get();
    if (!tableCheck) return null;

    const row = db.prepare('SELECT debate_json FROM evolution_debates WHERE arch_id = ?').get(archId) as DebateRow | undefined;
    if (!row) return null;

    return JSON.parse(row.debate_json) as DebateResult;
  } finally {
    db.close();
  }
}

export function saveDebateToDb(projectRoot: string, debate: DebateResult): void {
  const db = openDb(projectRoot);
  if (!db) return;

  try {
    debate.metadata.last_updated = new Date().toISOString();
    db.prepare(`
      INSERT INTO evolution_debates (arch_id, debate_json, last_updated)
      VALUES (?, ?, ?)
      ON CONFLICT(arch_id) DO UPDATE SET
        debate_json = excluded.debate_json,
        last_updated = excluded.last_updated
    `).run(debate.arch_id, JSON.stringify(debate), debate.metadata.last_updated);
  } finally {
    db.close();
  }
}

export function listDebatesFromDb(projectRoot: string): string[] {
  const db = openDb(projectRoot, true);
  if (!db) return [];

  try {
    const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='evolution_debates'").get();
    if (!tableCheck) return [];

    const rows = db.prepare('SELECT arch_id FROM evolution_debates ORDER BY arch_id').all() as { arch_id: string }[];
    return rows.map(r => r.arch_id);
  } finally {
    db.close();
  }
}

// ============================================================================
// QUARANTINE
// ============================================================================

export function saveQuarantineToDb(projectRoot: string, record: QuarantineRecord): void {
  const db = openDb(projectRoot);
  if (!db) return;

  try {
    db.prepare(`
      INSERT INTO evolution_quarantine (variant_id, quarantined_at, reason, findings_json, content)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(variant_id) DO UPDATE SET
        quarantined_at = excluded.quarantined_at,
        reason = excluded.reason,
        findings_json = excluded.findings_json,
        content = excluded.content
    `).run(record.variant_id, record.quarantined_at, record.reason, JSON.stringify(record.findings), record.content);
  } finally {
    db.close();
  }
}

export function loadQuarantineFromDb(projectRoot: string): QuarantineRecord[] {
  const db = openDb(projectRoot, true);
  if (!db) return [];

  try {
    const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='evolution_quarantine'").get();
    if (!tableCheck) return [];

    const rows = db.prepare('SELECT * FROM evolution_quarantine ORDER BY quarantined_at DESC').all() as QuarantineRow[];
    return rows.map(r => ({
      variant_id: r.variant_id,
      quarantined_at: r.quarantined_at,
      reason: r.reason,
      findings: JSON.parse(r.findings_json) as Finding[],
      content: r.content,
    }));
  } finally {
    db.close();
  }
}

// ============================================================================
// SANITIZATION LOG
// ============================================================================

export function logSanitizationToDb(projectRoot: string, entry: SanitizationEntry): void {
  const db = openDb(projectRoot);
  if (!db) return;

  try {
    db.prepare(
      'INSERT INTO evolution_sanitization_log (type, subtype, count, timestamp, context_hash) VALUES (?, ?, ?, ?, ?)'
    ).run(entry.type, entry.subtype, entry.count, entry.timestamp, entry.context_hash || null);

    // Cleanup entries older than 90 days
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    db.prepare('DELETE FROM evolution_sanitization_log WHERE timestamp < ?').run(ninetyDaysAgo.toISOString());
  } finally {
    db.close();
  }
}

export function getSanitizationLogFromDb(projectRoot: string): SanitizationEntry[] {
  const db = openDb(projectRoot, true);
  if (!db) return [];

  try {
    const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='evolution_sanitization_log'").get();
    if (!tableCheck) return [];

    const rows = db.prepare('SELECT * FROM evolution_sanitization_log ORDER BY timestamp DESC').all() as SanitizationRow[];
    return rows.map(r => ({
      type: r.type as 'pii' | 'secret',
      subtype: r.subtype,
      count: r.count,
      timestamp: r.timestamp,
      context_hash: r.context_hash || undefined,
    }));
  } finally {
    db.close();
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function safeJsonParse(str: string): unknown[] {
  try {
    const parsed = JSON.parse(str);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
