/**
 * YAML→SQLite migrator.
 * Reads legacy YAML state files from koan/ and inserts into state.db.
 * Also supports exporting state.db back to YAML for debugging.
 */

import * as fs from "fs";
import * as path from "path";
import Database from "better-sqlite3";

export interface MigrateResult {
  health: { migrated: number; skipped: number; errors: string[] };
  events: { migrated: number; skipped: number; errors: string[] };
  checkpoints: { migrated: number; skipped: number; errors: string[] };
  archived: string[];
}

export interface ExportResult {
  exported: number;
  outputDir: string;
}

// ─── YAML Parsing (minimal, for known structures) ────────────

function parseKeyValue(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const line of content.split("\n")) {
    const match = line.match(/^(\w[\w_-]*):\s*(.+)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    let value: unknown = rawValue.trim();
    // Unquote strings
    if (typeof value === "string" && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    } else if (typeof value === "string" && value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    // Parse numbers
    if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) {
      value = parseFloat(value);
    }
    result[key] = value;
  }
  return result;
}

function safeReadYaml(filePath: string): Record<string, unknown> | null {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return parseKeyValue(content);
  } catch {
    return null;
  }
}

function listYamlFiles(dir: string, pattern?: string): string[] {
  if (!fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith(".yaml"))
      .filter((f) => !pattern || f.match(new RegExp(pattern)))
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

// ─── Migration ───────────────────────────────────────────────

function migrateHealth(db: Database.Database, koanDir: string): MigrateResult["health"] {
  const result = { migrated: 0, skipped: 0, errors: [] as string[] };
  const healthPath = path.join(koanDir, "health", "status.yaml");

  if (!fs.existsSync(healthPath)) return result;

  const data = safeReadYaml(healthPath);
  if (!data) {
    result.errors.push(`Failed to parse ${healthPath}`);
    return result;
  }

  const percent = Number(data.context_usage_percent ?? 0);
  const zone = String(data.zone ?? "green");

  try {
    db.prepare("DELETE FROM health").run();
    db.prepare("INSERT INTO health (context_usage_percent, zone, updated_at) VALUES (?, ?, ?)").run(
      percent, zone, new Date().toISOString(),
    );
    result.migrated = 1;
  } catch (err) {
    result.errors.push(`Health insert failed: ${err}`);
  }

  return result;
}

function migrateEvents(db: Database.Database, koanDir: string): MigrateResult["events"] {
  const result = { migrated: 0, skipped: 0, errors: [] as string[] };
  const eventsDir = path.join(koanDir, "events", "processed");
  const files = listYamlFiles(eventsDir);

  if (files.length === 0) return result;

  const insertStmt = db.prepare(
    "INSERT OR IGNORE INTO events (id, type, data, created_at) VALUES (?, ?, ?, ?)",
  );

  const insertMany = db.transaction((eventFiles: string[]) => {
    for (const filePath of eventFiles) {
      const data = safeReadYaml(filePath);
      if (!data || !data.event_id || !data.type) {
        result.errors.push(`Skipping invalid event: ${path.basename(filePath)}`);
        result.skipped++;
        continue;
      }

      const type = String(data.type).replace(/\./g, "_");
      const payload = data.payload ?? {};
      const timestamp = String(data.timestamp ?? new Date().toISOString());

      try {
        const info = insertStmt.run(String(data.event_id), type, JSON.stringify(payload), timestamp);
        if (info.changes > 0) {
          result.migrated++;
        } else {
          result.skipped++;
        }
      } catch (err) {
        result.errors.push(`Event ${data.event_id}: ${err}`);
      }
    }
  });

  insertMany(files);
  return result;
}

function migrateCheckpoints(db: Database.Database, koanDir: string): MigrateResult["checkpoints"] {
  const result = { migrated: 0, skipped: 0, errors: [] as string[] };
  const checkpointsDir = path.join(koanDir, "session-state");
  const files = listYamlFiles(checkpointsDir, "^checkpoint-");

  if (files.length === 0) return result;

  const insertStmt = db.prepare(
    "INSERT OR IGNORE INTO checkpoints (id, name, type, data, created_at) VALUES (?, ?, ?, ?, ?)",
  );

  const insertMany = db.transaction((chkFiles: string[]) => {
    for (const filePath of chkFiles) {
      const data = safeReadYaml(filePath);
      if (!data) {
        result.errors.push(`Skipping unparseable: ${path.basename(filePath)}`);
        result.skipped++;
        continue;
      }

      const id = String(data.checkpoint_id ?? path.basename(filePath, ".yaml"));
      const name = String(data.name ?? id);
      const type = String(data.type ?? inferCheckpointType(path.basename(filePath)));
      const createdAt = String(data.created_at ?? new Date().toISOString());

      const fullData = { ...data };
      delete fullData.checkpoint_id;
      delete fullData.name;
      delete fullData.type;
      delete fullData.created_at;

      try {
        const info = insertStmt.run(id, name, type, JSON.stringify(fullData), createdAt);
        if (info.changes > 0) {
          result.migrated++;
        } else {
          result.skipped++;
        }
      } catch (err) {
        result.errors.push(`Checkpoint ${id}: ${err}`);
      }
    }
  });

  insertMany(files);
  return result;
}

function inferCheckpointType(filename: string): string {
  if (filename.includes("-safety-")) return "safety";
  if (filename.includes("-session_exit-")) return "session_exit";
  if (filename.includes("-pre-compact-")) return "pre_compact";
  if (filename.includes("-commit-")) return "commit";
  return "manual";
}

function archiveFiles(koanDir: string, dryRun: boolean): string[] {
  const archived: string[] = [];
  const archiveDir = path.join(koanDir, ".archive");

  const toArchive: Array<{ src: string; dest: string }> = [];

  const healthPath = path.join(koanDir, "health", "status.yaml");
  if (fs.existsSync(healthPath)) {
    toArchive.push({ src: healthPath, dest: "health/status.yaml" });
  }

  for (const f of listYamlFiles(path.join(koanDir, "events", "processed"))) {
    toArchive.push({ src: f, dest: `events/processed/${path.basename(f)}` });
  }

  for (const f of listYamlFiles(path.join(koanDir, "session-state"), "^checkpoint-")) {
    toArchive.push({ src: f, dest: `session-state/${path.basename(f)}` });
  }

  for (const { src, dest } of toArchive) {
    const destPath = path.join(archiveDir, dest);
    if (!dryRun) {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.renameSync(src, destPath);
    }
    archived.push(dest);
  }

  return archived;
}

/**
 * Run full YAML→SQLite migration.
 */
export function migrate(dbPath: string, koanDir: string, options: {
  dryRun?: boolean;
  noArchive?: boolean;
} = {}): MigrateResult {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  const health = migrateHealth(db, koanDir);
  const events = migrateEvents(db, koanDir);
  const checkpoints = migrateCheckpoints(db, koanDir);

  let archived: string[] = [];
  if (!options.dryRun && !options.noArchive) {
    archived = archiveFiles(koanDir, false);
  } else if (options.dryRun) {
    archived = archiveFiles(koanDir, true);
  }

  db.close();
  return { health, events, checkpoints, archived };
}

/**
 * Export state.db back to YAML for debugging.
 */
export function exportToYaml(dbPath: string, outputDir: string): ExportResult {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`No state.db found at ${dbPath}`);
  }

  const db = new Database(dbPath, { readonly: true });
  fs.mkdirSync(outputDir, { recursive: true });

  let exported = 0;

  const checkpoints = db.prepare("SELECT * FROM checkpoints ORDER BY created_at DESC").all() as Array<{
    id: string; name: string; type: string; data: string; created_at: string;
  }>;

  for (const chk of checkpoints) {
    let data: Record<string, unknown> = {};
    try { data = JSON.parse(chk.data); } catch { /* empty */ }

    const content = {
      checkpoint_id: chk.id,
      name: chk.name,
      type: chk.type,
      created_at: chk.created_at,
      ...data,
    };

    const yamlStr = Object.entries(content)
      .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
      .join("\n");
    fs.writeFileSync(path.join(outputDir, `${chk.id}.yaml`), yamlStr + "\n");
    exported++;
  }

  db.close();
  return { exported, outputDir };
}
