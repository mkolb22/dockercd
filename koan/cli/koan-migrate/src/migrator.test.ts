/**
 * Migrator Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import Database from 'better-sqlite3';
import { migrate, exportToYaml } from './migrator.js';

describe('migrate', () => {
  let tmpDir: string;
  let koanDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'koan-migrate-test-'));
    koanDir = path.join(tmpDir, 'koan');
    fs.mkdirSync(koanDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeYaml(relativePath: string, content: string): void {
    const fullPath = path.join(koanDir, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }

  function openDb(): Database.Database {
    return new Database(path.join(koanDir, 'state', 'state.db'));
  }

  describe('health migration', () => {
    it('should migrate health status', () => {
      writeYaml('health/status.yaml', 'context_usage_percent: 65.0\nzone: "yellow"\n');

      const result = migrate(koanDir);

      expect(result.health.migrated).toBe(1);
      expect(result.health.errors).toHaveLength(0);

      const db = openDb();
      const row = db.prepare('SELECT * FROM health').get() as { context_usage_percent: number; zone: string };
      expect(row.context_usage_percent).toBe(65.0);
      expect(row.zone).toBe('yellow');
      db.close();
    });

    it('should handle missing health file', () => {
      const result = migrate(koanDir);
      expect(result.health.migrated).toBe(0);
    });
  });

  describe('events migration', () => {
    it('should migrate event files', () => {
      writeYaml('events/processed/1770449291-session-exit.yaml', [
        'event_id: "1770449291-session-exit"',
        'type: "session.exit"',
        'timestamp: "2026-02-07T07:28:11Z"',
        'payload:',
        '  uncommitted_files: 54',
        '  git_branch: "main"',
      ].join('\n'));

      writeYaml('events/processed/1770449322-context-threshold.yaml', [
        'event_id: "1770449322-context-threshold"',
        'type: "context.threshold"',
        'timestamp: "2026-02-07T07:29:00Z"',
        'payload:',
        '  percent: 75',
      ].join('\n'));

      const result = migrate(koanDir);

      expect(result.events.migrated).toBe(2);
      expect(result.events.errors).toHaveLength(0);

      const db = openDb();
      const rows = db.prepare('SELECT * FROM events ORDER BY created_at').all() as Array<{
        id: string; type: string; data: string; created_at: string;
      }>;
      expect(rows).toHaveLength(2);
      // Type should be normalized: session.exit → session_exit
      expect(rows[0].type).toBe('session_exit');
      expect(JSON.parse(rows[0].data)).toEqual({ uncommitted_files: 54, git_branch: 'main' });
      db.close();
    });

    it('should skip duplicate events on re-run', () => {
      writeYaml('events/processed/evt-1.yaml', [
        'event_id: "evt-1"',
        'type: "test"',
        'timestamp: "2026-02-07T00:00:00Z"',
      ].join('\n'));

      migrate(koanDir, { noArchive: true });
      const result = migrate(koanDir, { noArchive: true });

      expect(result.events.migrated).toBe(0);
      expect(result.events.skipped).toBe(1);
    });

    it('should skip invalid event files', () => {
      writeYaml('events/processed/bad.yaml', 'not: valid\n');

      const result = migrate(koanDir);
      expect(result.events.skipped).toBe(1);
    });

    it('should handle missing events directory', () => {
      const result = migrate(koanDir);
      expect(result.events.migrated).toBe(0);
    });
  });

  describe('checkpoints migration', () => {
    it('should migrate checkpoint files', () => {
      writeYaml('session-state/checkpoint-safety-20260207-063525.yaml', [
        'checkpoint_id: "chk-safety-20260207-063525"',
        'name: "safety-20260207-063525"',
        'type: "safety"',
        'created_at: "2026-02-07T06:35:25Z"',
        'automatic: true',
        'git_state:',
        '  branch: "main"',
      ].join('\n'));

      const result = migrate(koanDir);

      expect(result.checkpoints.migrated).toBe(1);

      const db = openDb();
      const row = db.prepare('SELECT * FROM checkpoints').get() as {
        id: string; name: string; type: string; data: string; created_at: string;
      };
      expect(row.id).toBe('chk-safety-20260207-063525');
      expect(row.type).toBe('safety');
      expect(row.created_at).toBe('2026-02-07T06:35:25Z');
      const data = JSON.parse(row.data);
      expect(data.automatic).toBe(true);
      expect(data.git_state.branch).toBe('main');
      db.close();
    });

    it('should infer checkpoint type from filename', () => {
      writeYaml('session-state/checkpoint-pre-compact-1770099317.yaml', [
        'checkpoint_id: "chk-pre-compact-1770099317"',
        'name: "pre-compact-1770099317"',
        'created_at: "2026-02-06T00:00:00Z"',
      ].join('\n'));

      const result = migrate(koanDir);
      expect(result.checkpoints.migrated).toBe(1);

      const db = openDb();
      const row = db.prepare('SELECT type FROM checkpoints').get() as { type: string };
      expect(row.type).toBe('pre_compact');
      db.close();
    });

    it('should skip duplicate checkpoints on re-run', () => {
      writeYaml('session-state/checkpoint-test-1.yaml', [
        'checkpoint_id: "chk-test-1"',
        'name: "test-1"',
        'type: "manual"',
        'created_at: "2026-02-07T00:00:00Z"',
      ].join('\n'));

      migrate(koanDir, { noArchive: true });
      const result = migrate(koanDir, { noArchive: true });

      expect(result.checkpoints.migrated).toBe(0);
      expect(result.checkpoints.skipped).toBe(1);
    });
  });

  describe('archiving', () => {
    it('should archive migrated files', () => {
      writeYaml('health/status.yaml', 'context_usage_percent: 50\nzone: "yellow"\n');
      writeYaml('events/processed/evt-1.yaml', 'event_id: "evt-1"\ntype: "test"\ntimestamp: "2026-02-07T00:00:00Z"\n');

      const result = migrate(koanDir);

      expect(result.archived.length).toBeGreaterThan(0);
      expect(fs.existsSync(path.join(koanDir, 'health', 'status.yaml'))).toBe(false);
      expect(fs.existsSync(path.join(koanDir, '.archive', 'health', 'status.yaml'))).toBe(true);
    });

    it('should not archive in dry-run mode', () => {
      writeYaml('health/status.yaml', 'context_usage_percent: 50\nzone: "yellow"\n');

      const result = migrate(koanDir, { dryRun: true });

      expect(result.archived.length).toBeGreaterThan(0);
      // Original should still exist
      expect(fs.existsSync(path.join(koanDir, 'health', 'status.yaml'))).toBe(true);
    });

    it('should not archive with noArchive flag', () => {
      writeYaml('health/status.yaml', 'context_usage_percent: 50\nzone: "yellow"\n');

      const result = migrate(koanDir, { noArchive: true });

      expect(result.archived).toHaveLength(0);
      expect(fs.existsSync(path.join(koanDir, 'health', 'status.yaml'))).toBe(true);
    });
  });

  describe('export', () => {
    it('should export checkpoints back to YAML', () => {
      writeYaml('health/status.yaml', 'context_usage_percent: 50\nzone: "green"\n');
      writeYaml('session-state/checkpoint-test.yaml', [
        'checkpoint_id: "chk-test"',
        'name: "test"',
        'type: "manual"',
        'created_at: "2026-02-07T00:00:00Z"',
        'description: "test checkpoint"',
      ].join('\n'));

      migrate(koanDir, { noArchive: true });

      const { exported, outputDir } = exportToYaml(koanDir);
      expect(exported).toBe(1);
      expect(fs.existsSync(path.join(outputDir, 'chk-test.yaml'))).toBe(true);
    });

    it('should throw when no state.db exists', () => {
      expect(() => exportToYaml(koanDir)).toThrow('No state.db found');
    });
  });
});
