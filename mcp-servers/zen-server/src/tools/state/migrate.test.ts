import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import Database from "better-sqlite3";
import { migrate, exportToYaml } from "./migrate.js";
import type { MigrateResult } from "./migrate.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = path.join(os.tmpdir(), `migrate-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

function writeYaml(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
}

function createStateDb(dbPath: string): void {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS health (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      context_usage_percent REAL NOT NULL DEFAULT 0,
      zone TEXT NOT NULL DEFAULT 'green',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      data TEXT DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS checkpoints (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'manual',
      data TEXT DEFAULT '{}',
      created_at TEXT NOT NULL
    );
  `);
  db.close();
}

// ─── migrate() ───────────────────────────────────────────────

describe("migrate — health", () => {
  it("migrates health status.yaml", () => {
    const dbPath = path.join(tmpDir, "state.db");
    const koanDir = path.join(tmpDir, "koan");
    createStateDb(dbPath);
    writeYaml(path.join(koanDir, "health", "status.yaml"), [
      "context_usage_percent: 42.5",
      'zone: "yellow"',
    ].join("\n"));

    const result = migrate(dbPath, koanDir, { noArchive: true });
    expect(result.health.migrated).toBe(1);
    expect(result.health.errors).toHaveLength(0);

    const db = new Database(dbPath, { readonly: true });
    const row = db.prepare("SELECT * FROM health WHERE id = 1").get() as Record<string, unknown>;
    db.close();
    expect(row.context_usage_percent).toBe(42.5);
    expect(row.zone).toBe("yellow");
  });

  it("skips when no health file exists", () => {
    const dbPath = path.join(tmpDir, "state.db");
    const koanDir = path.join(tmpDir, "koan");
    createStateDb(dbPath);

    const result = migrate(dbPath, koanDir);
    expect(result.health.migrated).toBe(0);
    expect(result.health.errors).toHaveLength(0);
  });
});

describe("migrate — events", () => {
  it("migrates event YAML files", () => {
    const dbPath = path.join(tmpDir, "state.db");
    const koanDir = path.join(tmpDir, "koan");
    createStateDb(dbPath);

    writeYaml(path.join(koanDir, "events", "processed", "evt-001.yaml"), [
      "event_id: evt-001",
      "type: session_exit",
      'timestamp: "2026-02-15T10:00:00Z"',
    ].join("\n"));
    writeYaml(path.join(koanDir, "events", "processed", "evt-002.yaml"), [
      "event_id: evt-002",
      "type: context.threshold",
      'timestamp: "2026-02-15T11:00:00Z"',
    ].join("\n"));

    const result = migrate(dbPath, koanDir, { noArchive: true });
    expect(result.events.migrated).toBe(2);

    const db = new Database(dbPath, { readonly: true });
    const rows = db.prepare("SELECT * FROM events ORDER BY id").all() as Array<Record<string, unknown>>;
    db.close();
    expect(rows).toHaveLength(2);
    // Dots normalized to underscores
    expect(rows[1].type).toBe("context_threshold");
  });

  it("skips duplicate events on re-migrate", () => {
    const dbPath = path.join(tmpDir, "state.db");
    const koanDir = path.join(tmpDir, "koan");
    createStateDb(dbPath);

    writeYaml(path.join(koanDir, "events", "processed", "evt-001.yaml"), [
      "event_id: evt-001",
      "type: test_event",
      'timestamp: "2026-02-15T10:00:00Z"',
    ].join("\n"));

    migrate(dbPath, koanDir, { noArchive: true });
    const result2 = migrate(dbPath, koanDir, { noArchive: true });
    expect(result2.events.migrated).toBe(0);
    expect(result2.events.skipped).toBe(1);
  });

  it("reports errors for invalid events", () => {
    const dbPath = path.join(tmpDir, "state.db");
    const koanDir = path.join(tmpDir, "koan");
    createStateDb(dbPath);

    // Missing required event_id
    writeYaml(path.join(koanDir, "events", "processed", "bad.yaml"), "type: test\n");

    const result = migrate(dbPath, koanDir, { noArchive: true });
    expect(result.events.skipped).toBe(1);
    expect(result.events.errors).toHaveLength(1);
  });
});

describe("migrate — checkpoints", () => {
  it("migrates checkpoint YAML files", () => {
    const dbPath = path.join(tmpDir, "state.db");
    const koanDir = path.join(tmpDir, "koan");
    createStateDb(dbPath);

    writeYaml(path.join(koanDir, "session-state", "checkpoint-abc.yaml"), [
      "checkpoint_id: chk-abc",
      'name: "phase1-complete"',
      'type: "milestone"',
      'created_at: "2026-02-15T10:00:00Z"',
      "extra_field: extra_value",
    ].join("\n"));

    const result = migrate(dbPath, koanDir, { noArchive: true });
    expect(result.checkpoints.migrated).toBe(1);

    const db = new Database(dbPath, { readonly: true });
    const row = db.prepare("SELECT * FROM checkpoints WHERE id = ?").get("chk-abc") as Record<string, unknown>;
    db.close();
    expect(row.name).toBe("phase1-complete");
    expect(row.type).toBe("milestone");
    const data = JSON.parse(String(row.data));
    expect(data.extra_field).toBe("extra_value");
  });

  it("infers type from filename", () => {
    const dbPath = path.join(tmpDir, "state.db");
    const koanDir = path.join(tmpDir, "koan");
    createStateDb(dbPath);

    writeYaml(path.join(koanDir, "session-state", "checkpoint-safety-001.yaml"), [
      "checkpoint_id: safety-001",
      'name: "auto-safety"',
    ].join("\n"));

    const result = migrate(dbPath, koanDir, { noArchive: true });
    expect(result.checkpoints.migrated).toBe(1);

    const db = new Database(dbPath, { readonly: true });
    const row = db.prepare("SELECT type FROM checkpoints WHERE id = ?").get("safety-001") as Record<string, unknown>;
    db.close();
    expect(row.type).toBe("safety");
  });

  it("uses filename as ID when checkpoint_id missing", () => {
    const dbPath = path.join(tmpDir, "state.db");
    const koanDir = path.join(tmpDir, "koan");
    createStateDb(dbPath);

    writeYaml(path.join(koanDir, "session-state", "checkpoint-noid.yaml"), [
      'name: "no-id-checkpoint"',
    ].join("\n"));

    migrate(dbPath, koanDir, { noArchive: true });

    const db = new Database(dbPath, { readonly: true });
    const row = db.prepare("SELECT * FROM checkpoints WHERE id = ?").get("checkpoint-noid") as Record<string, unknown>;
    db.close();
    expect(row).toBeDefined();
    expect(row.name).toBe("no-id-checkpoint");
  });
});

describe("migrate — archiving", () => {
  it("archives migrated files by default", () => {
    const dbPath = path.join(tmpDir, "state.db");
    const koanDir = path.join(tmpDir, "koan");
    createStateDb(dbPath);

    writeYaml(path.join(koanDir, "health", "status.yaml"), "zone: green\ncontext_usage_percent: 10\n");

    const result = migrate(dbPath, koanDir);
    expect(result.archived).toContain("health/status.yaml");
    expect(fs.existsSync(path.join(koanDir, "health", "status.yaml"))).toBe(false);
    expect(fs.existsSync(path.join(koanDir, ".archive", "health", "status.yaml"))).toBe(true);
  });

  it("dry run previews without archiving", () => {
    const dbPath = path.join(tmpDir, "state.db");
    const koanDir = path.join(tmpDir, "koan");
    createStateDb(dbPath);

    writeYaml(path.join(koanDir, "health", "status.yaml"), "zone: green\ncontext_usage_percent: 10\n");

    const result = migrate(dbPath, koanDir, { dryRun: true });
    expect(result.archived).toContain("health/status.yaml");
    // File should still exist (dry run)
    expect(fs.existsSync(path.join(koanDir, "health", "status.yaml"))).toBe(true);
  });

  it("noArchive skips archiving", () => {
    const dbPath = path.join(tmpDir, "state.db");
    const koanDir = path.join(tmpDir, "koan");
    createStateDb(dbPath);

    writeYaml(path.join(koanDir, "health", "status.yaml"), "zone: green\ncontext_usage_percent: 10\n");

    const result = migrate(dbPath, koanDir, { noArchive: true });
    expect(result.archived).toHaveLength(0);
    expect(fs.existsSync(path.join(koanDir, "health", "status.yaml"))).toBe(true);
  });
});

describe("migrate — empty koan dir", () => {
  it("handles completely empty koan dir gracefully", () => {
    const dbPath = path.join(tmpDir, "state.db");
    const koanDir = path.join(tmpDir, "empty-koan");
    createStateDb(dbPath);
    fs.mkdirSync(koanDir, { recursive: true });

    const result = migrate(dbPath, koanDir);
    expect(result.health.migrated).toBe(0);
    expect(result.events.migrated).toBe(0);
    expect(result.checkpoints.migrated).toBe(0);
    expect(result.archived).toHaveLength(0);
  });
});

// ─── exportToYaml() ──────────────────────────────────────────

describe("exportToYaml", () => {
  it("exports checkpoints to YAML files", () => {
    const dbPath = path.join(tmpDir, "export.db");
    createStateDb(dbPath);

    const db = new Database(dbPath);
    db.prepare("INSERT INTO checkpoints (id, name, type, data, created_at) VALUES (?, ?, ?, ?, ?)").run(
      "chk-1", "test-checkpoint", "milestone", JSON.stringify({ task: "testing" }), "2026-02-15T10:00:00Z",
    );
    db.close();

    const outputDir = path.join(tmpDir, "export-output");
    const result = exportToYaml(dbPath, outputDir);
    expect(result.exported).toBe(1);

    const exported = fs.readFileSync(path.join(outputDir, "chk-1.yaml"), "utf-8");
    expect(exported).toContain("chk-1");
    expect(exported).toContain("test-checkpoint");
    expect(exported).toContain("milestone");
  });

  it("exports multiple checkpoints", () => {
    const dbPath = path.join(tmpDir, "multi.db");
    createStateDb(dbPath);

    const db = new Database(dbPath);
    const stmt = db.prepare("INSERT INTO checkpoints (id, name, type, data, created_at) VALUES (?, ?, ?, ?, ?)");
    stmt.run("c1", "first", "safety", "{}", "2026-02-15T10:00:00Z");
    stmt.run("c2", "second", "manual", "{}", "2026-02-15T11:00:00Z");
    stmt.run("c3", "third", "commit", "{}", "2026-02-15T12:00:00Z");
    db.close();

    const outputDir = path.join(tmpDir, "multi-out");
    const result = exportToYaml(dbPath, outputDir);
    expect(result.exported).toBe(3);
    expect(fs.existsSync(path.join(outputDir, "c1.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, "c2.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, "c3.yaml"))).toBe(true);
  });

  it("throws for nonexistent db", () => {
    expect(() => exportToYaml("/nonexistent/state.db", tmpDir)).toThrow("No state.db found");
  });

  it("handles empty database", () => {
    const dbPath = path.join(tmpDir, "empty.db");
    createStateDb(dbPath);

    const outputDir = path.join(tmpDir, "empty-out");
    const result = exportToYaml(dbPath, outputDir);
    expect(result.exported).toBe(0);
  });
});
