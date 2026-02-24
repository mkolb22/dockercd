/**
 * Migrator — reads YAML state files from koan/ and inserts into state.db
 *
 * Handles three categories:
 *   - koan/health/status.yaml → health table
 *   - koan/events/processed/*.yaml → events table
 *   - koan/session-state/checkpoint-*.yaml → checkpoints table
 */

import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { parse as parseYaml } from 'yaml';
import fg from 'fast-glob';

export interface MigrateResult {
  health: { migrated: number; skipped: number; errors: string[] };
  events: { migrated: number; skipped: number; errors: string[] };
  checkpoints: { migrated: number; skipped: number; errors: string[] };
  archived: string[];
}

interface EventYaml {
  event_id?: string;
  type?: string;
  timestamp?: string;
  payload?: Record<string, unknown>;
}

interface CheckpointYaml {
  checkpoint_id?: string;
  name?: string;
  type?: string;
  created_at?: string;
  [key: string]: unknown;
}

interface HealthYaml {
  context_usage_percent?: number;
  zone?: string;
}

/**
 * Initialize state.db schema (same as StateStore)
 */
function initSchema(db: Database.Database): void {
  db.pragma('journal_mode = WAL');
  db.exec(`
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

    CREATE INDEX IF NOT EXISTS idx_events_type ON events (type);
    CREATE INDEX IF NOT EXISTS idx_events_created ON events (created_at);
    CREATE INDEX IF NOT EXISTS idx_checkpoints_type ON checkpoints (type);
    CREATE INDEX IF NOT EXISTS idx_checkpoints_created ON checkpoints (created_at);
    CREATE INDEX IF NOT EXISTS idx_workflow_sessions_status ON workflow_sessions (status);
    CREATE INDEX IF NOT EXISTS idx_workflow_sessions_updated ON workflow_sessions (updated_at);
  `);
}

/**
 * Parse a YAML file safely, returning null on failure
 */
function safeParseYaml<T>(filePath: string): T | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return parseYaml(content) as T;
  } catch {
    return null;
  }
}

/**
 * Migrate health status
 */
function migrateHealth(db: Database.Database, koanDir: string): MigrateResult['health'] {
  const result = { migrated: 0, skipped: 0, errors: [] as string[] };
  const healthPath = path.join(koanDir, 'health', 'status.yaml');

  if (!fs.existsSync(healthPath)) {
    return result;
  }

  const data = safeParseYaml<HealthYaml>(healthPath);
  if (!data) {
    result.errors.push(`Failed to parse ${healthPath}`);
    return result;
  }

  const percent = data.context_usage_percent ?? 0;
  const zone = data.zone ?? 'green';
  const now = new Date().toISOString();

  try {
    db.prepare('DELETE FROM health').run();
    db.prepare('INSERT INTO health (context_usage_percent, zone, updated_at) VALUES (?, ?, ?)').run(
      percent, zone, now,
    );
    result.migrated = 1;
  } catch (err) {
    result.errors.push(`Health insert failed: ${err}`);
  }

  return result;
}

/**
 * Migrate event YAML files
 */
function migrateEvents(db: Database.Database, koanDir: string): MigrateResult['events'] {
  const result = { migrated: 0, skipped: 0, errors: [] as string[] };
  const eventsDir = path.join(koanDir, 'events', 'processed');

  if (!fs.existsSync(eventsDir)) {
    return result;
  }

  const files = fg.sync('*.yaml', { cwd: eventsDir, absolute: true });
  const insertStmt = db.prepare(
    'INSERT OR IGNORE INTO events (id, type, data, created_at) VALUES (?, ?, ?, ?)',
  );

  const insertMany = db.transaction((eventFiles: string[]) => {
    for (const filePath of eventFiles) {
      const data = safeParseYaml<EventYaml>(filePath);
      if (!data || !data.event_id || !data.type) {
        result.errors.push(`Skipping invalid event: ${path.basename(filePath)}`);
        result.skipped++;
        continue;
      }

      // Normalize type: "session.exit" → "session_exit"
      const type = data.type.replace(/\./g, '_');
      const payload = data.payload ?? {};
      const timestamp = data.timestamp ?? new Date().toISOString();

      try {
        const info = insertStmt.run(data.event_id, type, JSON.stringify(payload), timestamp);
        if (info.changes > 0) {
          result.migrated++;
        } else {
          result.skipped++; // Already exists
        }
      } catch (err) {
        result.errors.push(`Event ${data.event_id}: ${err}`);
      }
    }
  });

  insertMany(files);
  return result;
}

/**
 * Migrate checkpoint YAML files
 */
function migrateCheckpoints(db: Database.Database, koanDir: string): MigrateResult['checkpoints'] {
  const result = { migrated: 0, skipped: 0, errors: [] as string[] };
  const checkpointsDir = path.join(koanDir, 'session-state');

  if (!fs.existsSync(checkpointsDir)) {
    return result;
  }

  const files = fg.sync('checkpoint-*.yaml', { cwd: checkpointsDir, absolute: true });
  const insertStmt = db.prepare(
    'INSERT OR IGNORE INTO checkpoints (id, name, type, data, created_at) VALUES (?, ?, ?, ?, ?)',
  );

  const insertMany = db.transaction((chkFiles: string[]) => {
    for (const filePath of chkFiles) {
      const data = safeParseYaml<CheckpointYaml>(filePath);
      if (!data) {
        result.errors.push(`Skipping unparseable: ${path.basename(filePath)}`);
        result.skipped++;
        continue;
      }

      const id = data.checkpoint_id ?? path.basename(filePath, '.yaml');
      const name = data.name ?? id;
      const type = data.type ?? inferCheckpointType(path.basename(filePath));
      const createdAt = data.created_at ?? new Date().toISOString();

      // Store the full YAML content as JSON data
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

/**
 * Infer checkpoint type from filename
 */
function inferCheckpointType(filename: string): string {
  if (filename.includes('-safety-')) return 'safety';
  if (filename.includes('-session_exit-')) return 'session_exit';
  if (filename.includes('-pre-compact-')) return 'pre_compact';
  if (filename.includes('-commit-')) return 'commit';
  return 'manual';
}

/**
 * Archive migrated YAML files to koan/.archive/
 */
function archiveFiles(koanDir: string, dryRun: boolean): string[] {
  const archived: string[] = [];
  const archiveDir = path.join(koanDir, '.archive');

  const toArchive = [
    { src: path.join(koanDir, 'health', 'status.yaml'), dest: 'health/status.yaml' },
  ];

  // Events
  const eventsDir = path.join(koanDir, 'events', 'processed');
  if (fs.existsSync(eventsDir)) {
    const eventFiles = fg.sync('*.yaml', { cwd: eventsDir });
    for (const f of eventFiles) {
      toArchive.push({ src: path.join(eventsDir, f), dest: `events/processed/${f}` });
    }
  }

  // Checkpoints
  const checkpointsDir = path.join(koanDir, 'session-state');
  if (fs.existsSync(checkpointsDir)) {
    const chkFiles = fg.sync('checkpoint-*.yaml', { cwd: checkpointsDir });
    for (const f of chkFiles) {
      toArchive.push({ src: path.join(checkpointsDir, f), dest: `session-state/${f}` });
    }
  }

  for (const { src, dest } of toArchive) {
    if (!fs.existsSync(src)) continue;

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
 * Run the full migration
 */
export function migrate(koanDir: string, options: {
  dryRun?: boolean;
  noArchive?: boolean;
} = {}): MigrateResult {
  const dbPath = path.join(koanDir, 'state', 'state.db');

  // Ensure directory
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  initSchema(db);

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
 * Export state.db back to YAML (for debugging)
 */
export function exportToYaml(koanDir: string): { exported: number; outputDir: string } {
  const dbPath = path.join(koanDir, 'state', 'state.db');
  if (!fs.existsSync(dbPath)) {
    throw new Error(`No state.db found at ${dbPath}`);
  }

  const db = new Database(dbPath);
  const outputDir = path.join(koanDir, 'state', 'export');
  fs.mkdirSync(outputDir, { recursive: true });

  let exported = 0;

  // Export checkpoints
  const checkpoints = db.prepare('SELECT * FROM checkpoints ORDER BY created_at DESC').all() as Array<{
    id: string; name: string; type: string; data: string; created_at: string;
  }>;
  for (const chk of checkpoints) {
    const data = JSON.parse(chk.data);
    const content = {
      checkpoint_id: chk.id,
      name: chk.name,
      type: chk.type,
      created_at: chk.created_at,
      ...data,
    };
    const yamlStr = Object.entries(content)
      .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
      .join('\n');
    fs.writeFileSync(path.join(outputDir, `${chk.id}.yaml`), yamlStr + '\n');
    exported++;
  }

  db.close();
  return { exported, outputDir };
}
