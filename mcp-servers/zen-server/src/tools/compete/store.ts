/**
 * Compete Store
 * SQLite-backed storage for competitive evaluation sessions, rounds, and ablation runs.
 * Uses the existing state.db via shared stateDbPath config.
 */

import { BaseStore, type FieldMapping } from "../../core/store.js";
import { generateId } from "../../utils/ids.js";
import type {
  CompeteSession,
  CompeteConfig,
  CompeteStatus,
  CompeteArm,
  CompeteRound,
  FitnessScores,
  AblationRun,
  ToolCategory,
} from "./types.js";

// ─── Row Types ─────────────────────────────────────────

interface SessionRow {
  id: string;
  spec_id: string;
  spec_name: string;
  config: string;
  status: string;
  current_round: number;
  winner: string | null;
  summary_json: string | null;
  created_at: string;
  updated_at: string;
}

interface RoundRow {
  id: string;
  session_id: string;
  round: number;
  arm: string;
  scores: string;
  composite: number;
  raw_metrics: string | null;
  created_at: string;
}

interface AblationRow {
  id: string;
  session_id: string;
  disabled_category: string;
  round: number;
  scores: string;
  composite: number;
  status: string;
  created_at: string;
}

// ─── Store ─────────────────────────────────────────────

export class CompeteStore extends BaseStore {
  constructor(dbPath: string) {
    super(dbPath);
    this.initTables();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS compete_sessions (
        id TEXT PRIMARY KEY,
        spec_id TEXT NOT NULL,
        spec_name TEXT NOT NULL,
        config TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        current_round INTEGER DEFAULT 0,
        winner TEXT,
        summary_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS compete_rounds (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        round INTEGER NOT NULL,
        arm TEXT NOT NULL,
        scores TEXT NOT NULL,
        composite REAL NOT NULL,
        raw_metrics TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_comp_rounds_session
        ON compete_rounds (session_id);
      CREATE INDEX IF NOT EXISTS idx_comp_rounds_session_arm
        ON compete_rounds (session_id, arm);

      CREATE TABLE IF NOT EXISTS compete_ablations (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        disabled_category TEXT NOT NULL,
        round INTEGER NOT NULL,
        scores TEXT NOT NULL,
        composite REAL NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_comp_ablations_session
        ON compete_ablations (session_id);
      CREATE INDEX IF NOT EXISTS idx_comp_ablations_category
        ON compete_ablations (session_id, disabled_category);
    `);
  }

  // ─── Sessions ──────────────────────────────────────────

  createSession(
    specId: string,
    specName: string,
    config: CompeteConfig,
  ): CompeteSession {
    const id = generateId("com");
    const now = new Date().toISOString();

    this.execute(
      `INSERT INTO compete_sessions
        (id, spec_id, spec_name, config, status, current_round, winner, summary_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', 0, NULL, NULL, ?, ?)`,
      [id, specId, specName, JSON.stringify(config), now, now],
    );

    return {
      id,
      specId,
      specName,
      config,
      status: "active",
      currentRound: 0,
      winner: null,
      summaryJson: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  getSession(id: string): CompeteSession | null {
    const row = this.queryOne<SessionRow>(
      "SELECT * FROM compete_sessions WHERE id = ?",
      [id],
    );
    return row ? this.rowToSession(row) : null;
  }

  private static readonly sessionFields: FieldMapping[] = [
    { key: "currentRound", column: "current_round" },
    { key: "status", column: "status" },
    { key: "winner", column: "winner" },
    { key: "summaryJson", column: "summary_json" },
  ];

  updateSession(
    id: string,
    updates: Partial<Pick<CompeteSession, "currentRound" | "status" | "winner" | "summaryJson">>,
  ): void {
    this.partialUpdate("compete_sessions", "id = ?", [id], updates, CompeteStore.sessionFields);
  }

  // ─── Rounds ────────────────────────────────────────────

  insertRound(
    sessionId: string,
    round: number,
    arm: CompeteArm,
    scores: FitnessScores,
    composite: number,
    rawMetrics?: string,
  ): CompeteRound {
    const id = generateId("rnd");
    const now = new Date().toISOString();

    this.execute(
      `INSERT INTO compete_rounds
        (id, session_id, round, arm, scores, composite, raw_metrics, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, sessionId, round, arm, JSON.stringify(scores), composite, rawMetrics ?? null, now],
    );

    return {
      id,
      sessionId,
      round,
      arm,
      scores,
      composite,
      rawMetrics: rawMetrics ?? null,
      createdAt: now,
    };
  }

  getRounds(sessionId: string, arm?: CompeteArm): CompeteRound[] {
    if (arm) {
      return this.query<RoundRow>(
        "SELECT * FROM compete_rounds WHERE session_id = ? AND arm = ? ORDER BY round ASC",
        [sessionId, arm],
      ).map((r) => this.rowToRound(r));
    }
    return this.query<RoundRow>(
      "SELECT * FROM compete_rounds WHERE session_id = ? ORDER BY round ASC, arm ASC",
      [sessionId],
    ).map((r) => this.rowToRound(r));
  }

  getRoundPair(sessionId: string, round: number): { control?: CompeteRound; treatment?: CompeteRound } {
    const rows = this.query<RoundRow>(
      "SELECT * FROM compete_rounds WHERE session_id = ? AND round = ?",
      [sessionId, round],
    );

    const result: { control?: CompeteRound; treatment?: CompeteRound } = {};
    for (const row of rows) {
      const parsed = this.rowToRound(row);
      if (parsed.arm === "control") result.control = parsed;
      else if (parsed.arm === "treatment") result.treatment = parsed;
    }
    return result;
  }

  getRoundCount(sessionId: string): number {
    const result = this.queryOne<{ count: number }>(
      "SELECT COUNT(DISTINCT round) as count FROM compete_rounds WHERE session_id = ?",
      [sessionId],
    );
    return result?.count ?? 0;
  }

  // ─── Ablations ─────────────────────────────────────────

  insertAblationRun(
    sessionId: string,
    disabledCategory: ToolCategory,
    round: number,
    scores: FitnessScores,
    composite: number,
  ): AblationRun {
    const id = generateId("abl");
    const now = new Date().toISOString();

    this.execute(
      `INSERT INTO compete_ablations
        (id, session_id, disabled_category, round, scores, composite, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'completed', ?)`,
      [id, sessionId, disabledCategory, round, JSON.stringify(scores), composite, now],
    );

    return {
      id,
      sessionId,
      disabledCategory,
      round,
      scores,
      composite,
      status: "completed",
      createdAt: now,
    };
  }

  getAblationRuns(sessionId: string, category?: ToolCategory): AblationRun[] {
    if (category) {
      return this.query<AblationRow>(
        "SELECT * FROM compete_ablations WHERE session_id = ? AND disabled_category = ? ORDER BY round ASC",
        [sessionId, category],
      ).map((r) => this.rowToAblation(r));
    }
    return this.query<AblationRow>(
      "SELECT * FROM compete_ablations WHERE session_id = ? ORDER BY disabled_category ASC, round ASC",
      [sessionId],
    ).map((r) => this.rowToAblation(r));
  }

  getAblationCategories(sessionId: string): ToolCategory[] {
    const rows = this.query<{ disabled_category: string }>(
      "SELECT DISTINCT disabled_category FROM compete_ablations WHERE session_id = ? ORDER BY disabled_category",
      [sessionId],
    );
    return rows.map((r) => r.disabled_category as ToolCategory);
  }

  // ─── Row Converters ────────────────────────────────────

  private rowToSession(row: SessionRow): CompeteSession {
    return {
      id: row.id,
      specId: row.spec_id,
      specName: row.spec_name,
      config: JSON.parse(row.config),
      status: row.status as CompeteStatus,
      currentRound: row.current_round,
      winner: row.winner,
      summaryJson: row.summary_json,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private rowToRound(row: RoundRow): CompeteRound {
    return {
      id: row.id,
      sessionId: row.session_id,
      round: row.round,
      arm: row.arm as CompeteArm,
      scores: JSON.parse(row.scores),
      composite: row.composite,
      rawMetrics: row.raw_metrics,
      createdAt: row.created_at,
    };
  }

  private rowToAblation(row: AblationRow): AblationRun {
    return {
      id: row.id,
      sessionId: row.session_id,
      disabledCategory: row.disabled_category as ToolCategory,
      round: row.round,
      scores: JSON.parse(row.scores),
      composite: row.composite,
      status: row.status,
      createdAt: row.created_at,
    };
  }
}
