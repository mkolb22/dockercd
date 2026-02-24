/**
 * State Store
 * SQLite-backed operational state for health, events, and checkpoints.
 * Replaces YAML files in koan/health/, koan/events/, koan/session-state/.
 */

import { BaseStore } from "../../core/store.js";
import { generateId } from "../../utils/ids.js";
import type {
  HealthRecord,
  HealthZone,
  EventRecord,
  EventType,
  CheckpointRecord,
  CheckpointType,
  WorkflowSessionRecord,
  WorkflowSessionStatus,
  StoryRecord,
  StoryStatus,
  StateStats,
} from "./types.js";

/**
 * Row types matching SQLite schema
 */
interface HealthRow {
  id: number;
  context_usage_percent: number;
  zone: string;
  updated_at: string;
}

interface EventRow {
  id: string;
  type: string;
  data: string;
  created_at: string;
}

interface CheckpointRow {
  id: string;
  name: string;
  type: string;
  data: string;
  created_at: string;
}

interface WorkflowSessionRow {
  id: string;
  task: string;
  context: string | null;
  plan: string;
  steps: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface StoryRow {
  id: string;
  title: string;
  status: string;
  data: string;
  created_at: string;
  updated_at: string;
}

export class StateStore extends BaseStore {
  constructor(dbPath: string) {
    super(dbPath);
    this.initTables();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS health (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        context_usage_percent REAL NOT NULL,
        zone TEXT NOT NULL DEFAULT 'green',
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        data TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS checkpoints (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'manual',
        data TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_events_type ON events (type);
      CREATE INDEX IF NOT EXISTS idx_events_created ON events (created_at);
      CREATE INDEX IF NOT EXISTS idx_checkpoints_type ON checkpoints (type);
      CREATE INDEX IF NOT EXISTS idx_checkpoints_created ON checkpoints (created_at);

      CREATE TABLE IF NOT EXISTS workflow_sessions (
        id TEXT PRIMARY KEY,
        task TEXT NOT NULL,
        context TEXT,
        plan TEXT NOT NULL DEFAULT '{}',
        steps TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_workflow_sessions_status ON workflow_sessions (status);
      CREATE INDEX IF NOT EXISTS idx_workflow_sessions_updated ON workflow_sessions (updated_at);

      CREATE TABLE IF NOT EXISTS stories (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        data TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_stories_status ON stories (status);
      CREATE INDEX IF NOT EXISTS idx_stories_updated ON stories (updated_at);
    `);
  }

  // ─── Health ───────────────────────────────────────────────

  /**
   * Update health status (upsert — keeps only latest record)
   */
  updateHealth(contextUsagePercent: number, zone: HealthZone): HealthRecord {
    const now = new Date().toISOString();

    // Delete all existing health records and insert fresh
    this.transaction(() => {
      this.execute("DELETE FROM health");
      this.execute(
        "INSERT INTO health (context_usage_percent, zone, updated_at) VALUES (?, ?, ?)",
        [contextUsagePercent, zone, now],
      );
    });

    return {
      id: 1,
      contextUsagePercent,
      zone,
      updatedAt: now,
    };
  }

  /**
   * Get latest health status
   */
  getHealth(): HealthRecord | null {
    const row = this.queryOne<HealthRow>(
      "SELECT * FROM health ORDER BY id DESC LIMIT 1",
    );
    return row ? this.rowToHealth(row) : null;
  }

  // ─── Events ───────────────────────────────────────────────

  /**
   * Log an event
   */
  logEvent(
    type: EventType,
    data: Record<string, unknown> = {},
  ): EventRecord {
    const id = generateId("evt");
    const now = new Date().toISOString();

    this.execute(
      "INSERT INTO events (id, type, data, created_at) VALUES (?, ?, ?, ?)",
      [id, type, JSON.stringify(data), now],
    );

    return { id, type, data, createdAt: now };
  }

  /**
   * Query events by type and/or time range
   */
  queryEvents(options: {
    type?: EventType;
    since?: string;
    limit?: number;
  } = {}): EventRecord[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options.type) {
      conditions.push("type = ?");
      params.push(options.type);
    }
    if (options.since) {
      conditions.push("created_at >= ?");
      params.push(options.since);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = options.limit ?? 50;

    const rows = this.query<EventRow>(
      `SELECT * FROM events ${where} ORDER BY created_at DESC LIMIT ?`,
      [...params, limit],
    );

    return rows.map((r) => this.rowToEvent(r));
  }

  /**
   * Get event count by type
   */
  getEventCounts(): Record<string, number> {
    const rows = this.query<{ type: string; count: number }>(
      "SELECT type, COUNT(*) as count FROM events GROUP BY type",
    );
    const counts: Record<string, number> = {};
    for (const row of rows) {
      counts[row.type] = row.count;
    }
    return counts;
  }

  // ─── Checkpoints ──────────────────────────────────────────

  /**
   * Save a checkpoint
   */
  saveCheckpoint(
    name: string,
    type: CheckpointType,
    data: Record<string, unknown>,
  ): CheckpointRecord {
    const id = `chk-${name}-${Date.now().toString(36)}`;
    const now = new Date().toISOString();

    this.execute(
      "INSERT INTO checkpoints (id, name, type, data, created_at) VALUES (?, ?, ?, ?, ?)",
      [id, name, type, JSON.stringify(data), now],
    );

    return { id, name, type, data, createdAt: now };
  }

  /**
   * List checkpoints with optional type filter
   */
  listCheckpoints(options: {
    type?: CheckpointType;
    limit?: number;
  } = {}): CheckpointRecord[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options.type) {
      conditions.push("type = ?");
      params.push(options.type);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = options.limit ?? 20;

    const rows = this.query<CheckpointRow>(
      `SELECT * FROM checkpoints ${where} ORDER BY created_at DESC LIMIT ?`,
      [...params, limit],
    );

    return rows.map((r) => this.rowToCheckpoint(r));
  }

  /**
   * Get a specific checkpoint by ID
   */
  getCheckpoint(id: string): CheckpointRecord | null {
    const row = this.queryOne<CheckpointRow>(
      "SELECT * FROM checkpoints WHERE id = ?",
      [id],
    );
    return row ? this.rowToCheckpoint(row) : null;
  }

  /**
   * Get latest checkpoint (optionally by type)
   */
  getLatestCheckpoint(type?: CheckpointType): CheckpointRecord | null {
    if (type) {
      const row = this.queryOne<CheckpointRow>(
        "SELECT * FROM checkpoints WHERE type = ? ORDER BY created_at DESC LIMIT 1",
        [type],
      );
      return row ? this.rowToCheckpoint(row) : null;
    }
    const row = this.queryOne<CheckpointRow>(
      "SELECT * FROM checkpoints ORDER BY created_at DESC LIMIT 1",
    );
    return row ? this.rowToCheckpoint(row) : null;
  }

  // ─── Workflow Sessions ─────────────────────────────────────

  /**
   * Save or update a workflow session
   */
  saveWorkflowSession(session: WorkflowSessionRecord): void {
    const existing = this.queryOne<{ id: string }>(
      "SELECT id FROM workflow_sessions WHERE id = ?",
      [session.id],
    );

    if (existing) {
      this.execute(
        `UPDATE workflow_sessions SET task = ?, context = ?, plan = ?, steps = ?,
         status = ?, updated_at = ? WHERE id = ?`,
        [
          session.task,
          session.context,
          JSON.stringify(session.plan),
          JSON.stringify(session.steps),
          session.status,
          session.updatedAt,
          session.id,
        ],
      );
    } else {
      this.execute(
        `INSERT INTO workflow_sessions (id, task, context, plan, steps, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          session.id,
          session.task,
          session.context,
          JSON.stringify(session.plan),
          JSON.stringify(session.steps),
          session.status,
          session.createdAt,
          session.updatedAt,
        ],
      );
    }
  }

  /**
   * Get a workflow session by ID
   */
  getWorkflowSession(id: string): WorkflowSessionRecord | null {
    const row = this.queryOne<WorkflowSessionRow>(
      "SELECT * FROM workflow_sessions WHERE id = ?",
      [id],
    );
    return row ? this.rowToWorkflowSession(row) : null;
  }

  /**
   * Get the most recent active workflow session
   */
  getActiveWorkflowSession(): WorkflowSessionRecord | null {
    const row = this.queryOne<WorkflowSessionRow>(
      "SELECT * FROM workflow_sessions WHERE status = 'active' ORDER BY updated_at DESC LIMIT 1",
    );
    return row ? this.rowToWorkflowSession(row) : null;
  }

  /**
   * List workflow sessions
   */
  listWorkflowSessions(options: {
    status?: WorkflowSessionStatus;
    limit?: number;
  } = {}): WorkflowSessionRecord[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options.status) {
      conditions.push("status = ?");
      params.push(options.status);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = options.limit ?? 20;

    const rows = this.query<WorkflowSessionRow>(
      `SELECT * FROM workflow_sessions ${where} ORDER BY updated_at DESC LIMIT ?`,
      [...params, limit],
    );

    return rows.map((r) => this.rowToWorkflowSession(r));
  }

  /**
   * Count workflow sessions by status
   */
  getWorkflowSessionCounts(): { active: number; completed: number; failed: number; total: number } {
    const rows = this.query<{ status: string; count: number }>(
      "SELECT status, COUNT(*) as count FROM workflow_sessions GROUP BY status",
    );
    const counts = { active: 0, completed: 0, failed: 0, total: 0 };
    for (const row of rows) {
      if (row.status === "active") counts.active = row.count;
      else if (row.status === "completed") counts.completed = row.count;
      else if (row.status === "failed") counts.failed = row.count;
      counts.total += row.count;
    }
    return counts;
  }

  // ─── Stories ─────────────────────────────────────────────

  /**
   * Save or update a story
   */
  saveStory(
    id: string,
    title: string,
    status: StoryStatus,
    data: Record<string, unknown>,
  ): StoryRecord {
    const now = new Date().toISOString();
    const existing = this.queryOne<{ id: string }>(
      "SELECT id FROM stories WHERE id = ?",
      [id],
    );

    if (existing) {
      this.execute(
        "UPDATE stories SET title = ?, status = ?, data = ?, updated_at = ? WHERE id = ?",
        [title, status, JSON.stringify(data), now, id],
      );
    } else {
      this.execute(
        "INSERT INTO stories (id, title, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        [id, title, status, JSON.stringify(data), now, now],
      );
    }

    return { id, title, status, data, createdAt: existing ? now : now, updatedAt: now };
  }

  /**
   * Get a story by ID
   */
  getStory(id: string): StoryRecord | null {
    const row = this.queryOne<StoryRow>(
      "SELECT * FROM stories WHERE id = ?",
      [id],
    );
    return row ? this.rowToStory(row) : null;
  }

  /**
   * List stories with optional status filter
   */
  listStories(options: {
    status?: StoryStatus;
    limit?: number;
  } = {}): StoryRecord[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options.status) {
      conditions.push("status = ?");
      params.push(options.status);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = options.limit ?? 20;

    const rows = this.query<StoryRow>(
      `SELECT * FROM stories ${where} ORDER BY updated_at DESC LIMIT ?`,
      [...params, limit],
    );

    return rows.map((r) => this.rowToStory(r));
  }

  // ─── Statistics ───────────────────────────────────────────

  /**
   * Get state store statistics
   */
  getStateStats(): StateStats {
    const healthCount = this.getRowCount("health");
    const eventCount = this.getRowCount("events");
    const checkpointCount = this.getRowCount("checkpoints");
    const sessionCount = this.getRowCount("workflow_sessions");
    const storyCount = this.getRowCount("stories");
    const latestHealth = this.getHealth();

    const oldestEvent = this.queryOne<{ created_at: string }>(
      "SELECT created_at FROM events ORDER BY created_at ASC LIMIT 1",
    );
    const newestEvent = this.queryOne<{ created_at: string }>(
      "SELECT created_at FROM events ORDER BY created_at DESC LIMIT 1",
    );

    return {
      healthRecords: healthCount,
      events: eventCount,
      checkpoints: checkpointCount,
      workflowSessions: sessionCount,
      stories: storyCount,
      latestHealth,
      oldestEvent: oldestEvent?.created_at ?? null,
      newestEvent: newestEvent?.created_at ?? null,
    };
  }

  // ─── Row converters ───────────────────────────────────────

  private rowToHealth(row: HealthRow): HealthRecord {
    return {
      id: row.id,
      contextUsagePercent: row.context_usage_percent,
      zone: row.zone as HealthZone,
      updatedAt: row.updated_at,
    };
  }

  private rowToEvent(row: EventRow): EventRecord {
    return {
      id: row.id,
      type: row.type,
      data: JSON.parse(row.data),
      createdAt: row.created_at,
    };
  }

  private rowToCheckpoint(row: CheckpointRow): CheckpointRecord {
    return {
      id: row.id,
      name: row.name,
      type: row.type as CheckpointType,
      data: JSON.parse(row.data),
      createdAt: row.created_at,
    };
  }

  private rowToWorkflowSession(row: WorkflowSessionRow): WorkflowSessionRecord {
    return {
      id: row.id,
      task: row.task,
      context: row.context,
      plan: JSON.parse(row.plan),
      steps: JSON.parse(row.steps),
      status: row.status as WorkflowSessionStatus,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private rowToStory(row: StoryRow): StoryRecord {
    return {
      id: row.id,
      title: row.title,
      status: row.status as StoryStatus,
      data: JSON.parse(row.data),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
