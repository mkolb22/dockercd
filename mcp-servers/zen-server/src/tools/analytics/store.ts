/**
 * Analytics Store
 * Loads provenance data from state.db events table and manages learning state.
 */

import { BaseStore } from "../../core/store.js";
import type {
  ProvenanceAction,
  ProvenanceFilter,
  Concept,
  LearnedPattern,
  MemoryCalibration,
  LearningState,
} from "./types.js";

interface EventRow {
  id: string;
  type: string;
  data: string;
  created_at: string;
}

interface LearningPatternRow {
  concept: string;
  action: string;
  occurrences: number;
  success_rate: number;
  avg_duration_ms: number;
  avg_cost: number;
  confidence: string;
  first_seen: string;
  last_seen: string;
  models_used: string;
}

interface CalibrationRow {
  category: string;
  total_injections: number;
  led_to_success: number;
  effectiveness: number;
}

export class AnalyticsStore extends BaseStore {
  constructor(dbPath: string) {
    super(dbPath);
    this.initTables();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS learning_patterns (
        concept TEXT NOT NULL,
        action TEXT NOT NULL,
        occurrences INTEGER NOT NULL DEFAULT 0,
        success_rate REAL NOT NULL DEFAULT 0,
        avg_duration_ms REAL NOT NULL DEFAULT 0,
        avg_cost REAL NOT NULL DEFAULT 0,
        confidence TEXT NOT NULL DEFAULT 'low',
        first_seen TEXT NOT NULL,
        last_seen TEXT NOT NULL,
        models_used TEXT NOT NULL DEFAULT '[]',
        PRIMARY KEY (concept, action)
      );

      CREATE TABLE IF NOT EXISTS learning_calibration (
        category TEXT PRIMARY KEY,
        total_injections INTEGER NOT NULL DEFAULT 0,
        led_to_success INTEGER NOT NULL DEFAULT 0,
        effectiveness REAL NOT NULL DEFAULT 0
      );
    `);
  }

  /**
   * Load provenance actions from events table, mapped to ProvenanceAction shape.
   * Only events with actionable provenance semantics are included:
   *   - concept_complete / concept_complete_frontmatter -> completed action
   *   - task_invocation -> started action
   *   - git_commit -> version/commit action
   */
  loadProvenance(filter?: ProvenanceFilter): ProvenanceAction[] {
    const rows = this.query<EventRow>(
      "SELECT id, type, data, created_at FROM events ORDER BY created_at ASC",
    );

    const actions: ProvenanceAction[] = [];

    for (const row of rows) {
      const d = safeJsonParse(row.data);

      if (
        row.type === "concept_complete" ||
        row.type === "task_invocation" ||
        row.type === "concept_complete_frontmatter"
      ) {
        actions.push({
          action_id: row.id,
          concept: (d.concept as Concept) || "implementation",
          action: row.type === "task_invocation" ? "start" : "complete",
          status: "completed",
          timestamp: row.created_at,
          model: (d.model as ProvenanceAction["model"]) || undefined,
          flow_id: (d.flow_id as string) || undefined,
          duration_ms: (d.duration_ms as number) || undefined,
          cost: {
            input_tokens: (d.input_tokens as number) || 0,
            output_tokens: (d.output_tokens as number) || 0,
            cost_usd: (d.cost_usd as number) || 0,
          },
          error: d.error ? (d.error as ProvenanceAction["error"]) : null,
          metadata:
            (d.metadata as Record<string, unknown>) || undefined,
        });
      } else if (row.type === "git_commit") {
        actions.push({
          action_id: row.id,
          concept: "version",
          action: "commit",
          status: "completed",
          timestamp: row.created_at,
          flow_id: (d.flow_id as string) || undefined,
          metadata: {
            commit_hash: d.commit_hash,
            story_id: d.story_id,
            message: d.message,
          },
        });
      }
    }

    return filter ? filterActions(actions, filter) : actions;
  }

  /**
   * Load all learned patterns and memory calibrations from the learning tables.
   */
  loadLearningState(): LearningState {
    const patternRows = this.query<LearningPatternRow>(
      "SELECT * FROM learning_patterns ORDER BY occurrences DESC",
    );
    const calibrationRows = this.query<CalibrationRow>(
      "SELECT * FROM learning_calibration ORDER BY category",
    );

    return {
      patterns: patternRows.map((r) => ({
        concept: r.concept,
        action: r.action,
        occurrences: r.occurrences,
        success_rate: r.success_rate,
        avg_duration_ms: r.avg_duration_ms,
        avg_cost: r.avg_cost,
        confidence: r.confidence as LearnedPattern["confidence"],
        first_seen: r.first_seen,
        last_seen: r.last_seen,
        models_used: safeJsonParseArray(r.models_used),
      })),
      calibrations: calibrationRows.map((r) => ({
        category: r.category,
        total_injections: r.total_injections,
        led_to_success: r.led_to_success,
        effectiveness: r.effectiveness,
      })),
    };
  }

  /**
   * Persist learning state via upsert.
   * Patterns are keyed by (concept, action); calibrations by category.
   * Both use ON CONFLICT to update in-place, avoiding duplicates.
   */
  saveLearningState(state: LearningState): void {
    this.transaction(() => {
      const patternStmt = this.db.prepare(`
        INSERT INTO learning_patterns
          (concept, action, occurrences, success_rate, avg_duration_ms, avg_cost,
           confidence, first_seen, last_seen, models_used)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(concept, action) DO UPDATE SET
          occurrences    = excluded.occurrences,
          success_rate   = excluded.success_rate,
          avg_duration_ms = excluded.avg_duration_ms,
          avg_cost       = excluded.avg_cost,
          confidence     = excluded.confidence,
          last_seen      = excluded.last_seen,
          models_used    = excluded.models_used
      `);

      for (const p of state.patterns) {
        patternStmt.run(
          p.concept,
          p.action,
          p.occurrences,
          p.success_rate,
          p.avg_duration_ms,
          p.avg_cost,
          p.confidence,
          p.first_seen,
          p.last_seen,
          JSON.stringify(p.models_used),
        );
      }

      const calStmt = this.db.prepare(`
        INSERT INTO learning_calibration
          (category, total_injections, led_to_success, effectiveness)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(category) DO UPDATE SET
          total_injections = excluded.total_injections,
          led_to_success   = excluded.led_to_success,
          effectiveness    = excluded.effectiveness
      `);

      for (const c of state.calibrations) {
        calStmt.run(
          c.category,
          c.total_injections,
          c.led_to_success,
          c.effectiveness,
        );
      }
    });
  }
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function filterActions(
  actions: ProvenanceAction[],
  filter: ProvenanceFilter,
): ProvenanceAction[] {
  return actions.filter((action) => {
    if (filter.dateRange) {
      const d = new Date(action.timestamp);
      if (filter.dateRange.from && d < filter.dateRange.from) return false;
      if (filter.dateRange.to && d > filter.dateRange.to) return false;
    }
    if (
      filter.concepts?.length &&
      !filter.concepts.includes(action.concept)
    ) {
      return false;
    }
    if (
      filter.models?.length &&
      (!action.model || !filter.models.includes(action.model))
    ) {
      return false;
    }
    if (filter.flowId && action.flow_id !== filter.flowId) return false;
    return true;
  });
}

function safeJsonParse(str: string): Record<string, unknown> {
  try {
    return JSON.parse(str) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function safeJsonParseArray(str: string): string[] {
  try {
    const parsed: unknown = JSON.parse(str);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}
