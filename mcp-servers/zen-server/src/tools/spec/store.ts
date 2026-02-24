/**
 * Spec Store
 * SQLite-backed storage for ZenSpec specifications.
 * Uses the existing state.db via shared stateDbPath config.
 */

import { BaseStore } from "../../core/store.js";
import { generateId } from "../../utils/ids.js";
import type { SpecData, SpecRecord, SpecStatus, SpecTargetLanguage } from "./types.js";

interface SpecRow {
  id: string;
  name: string;
  data: string;
  status: string;
  generated_code: string | null;
  created_at: string;
  updated_at: string;
}

export class SpecStore extends BaseStore {
  constructor(dbPath: string) {
    super(dbPath);
    this.initTables();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS specs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        data TEXT NOT NULL,
        status TEXT DEFAULT 'draft',
        generated_code TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_specs_name ON specs (name);
      CREATE INDEX IF NOT EXISTS idx_specs_status ON specs (status);
    `);
  }

  // ─── CRUD ──────────────────────────────────────────────

  saveSpec(name: string, data: SpecData, id?: string): SpecRecord {
    const specId = id ?? generateId("spec");
    const now = new Date().toISOString();

    // Upsert: insert or replace
    this.execute(
      `INSERT OR REPLACE INTO specs
        (id, name, data, status, generated_code, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        specId,
        name,
        JSON.stringify(data),
        id ? (this.getSpec(specId)?.status ?? "draft") : "draft",
        id ? (this.getSpec(specId)?.generatedCode ?? null) : null,
        id ? (this.getSpec(specId)?.createdAt ?? now) : now,
        now,
      ],
    );

    return {
      id: specId,
      name,
      data,
      status: "draft",
      generatedCode: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  getSpec(id: string): SpecRecord | null {
    const row = this.queryOne<SpecRow>(
      "SELECT * FROM specs WHERE id = ?",
      [id],
    );
    return row ? this.rowToRecord(row) : null;
  }

  getSpecByName(name: string): SpecRecord | null {
    const row = this.queryOne<SpecRow>(
      "SELECT * FROM specs WHERE name = ? ORDER BY updated_at DESC, rowid DESC LIMIT 1",
      [name],
    );
    return row ? this.rowToRecord(row) : null;
  }

  getLatestSpec(): SpecRecord | null {
    const row = this.queryOne<SpecRow>(
      "SELECT * FROM specs ORDER BY updated_at DESC, rowid DESC LIMIT 1",
    );
    return row ? this.rowToRecord(row) : null;
  }

  listSpecs(opts?: {
    status?: SpecStatus;
    target_language?: SpecTargetLanguage;
    limit?: number;
  }): SpecRecord[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (opts?.status) {
      conditions.push("status = ?");
      params.push(opts.status);
    }

    if (opts?.target_language) {
      conditions.push("json_extract(data, '$.target_language') = ?");
      params.push(opts.target_language);
    }

    const where = conditions.length > 0
      ? `WHERE ${conditions.join(" AND ")}`
      : "";
    const limit = opts?.limit ?? 20;

    const rows = this.query<SpecRow>(
      `SELECT * FROM specs ${where} ORDER BY updated_at DESC, rowid DESC LIMIT ?`,
      [...params, limit],
    );
    return rows.map((r) => this.rowToRecord(r));
  }

  updateStatus(id: string, status: SpecStatus): void {
    this.execute(
      "UPDATE specs SET status = ?, updated_at = ? WHERE id = ?",
      [status, new Date().toISOString(), id],
    );
  }

  saveGeneratedCode(id: string, code: string): void {
    this.execute(
      "UPDATE specs SET generated_code = ?, status = 'generated', updated_at = ? WHERE id = ?",
      [code, new Date().toISOString(), id],
    );
  }

  // ─── Row converter ────────────────────────────────────

  private rowToRecord(row: SpecRow): SpecRecord {
    return {
      id: row.id,
      name: row.name,
      data: JSON.parse(row.data),
      status: row.status as SpecStatus,
      generatedCode: row.generated_code,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
