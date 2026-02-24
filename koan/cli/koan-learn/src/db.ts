/**
 * SQLite storage for learning state — patterns and calibration.
 * Writes to koan/state/state.db alongside other state tables.
 */

import { existsSync } from 'fs';
import { getStateDbPath, getDatabase } from '@zen/koan-core';
import type { LearnedPattern, MemoryCalibration, LearningState } from './types.js';

const INIT_SQL = `
  CREATE TABLE IF NOT EXISTS learning_patterns (
    name TEXT PRIMARY KEY,
    id TEXT NOT NULL,
    occurrences INTEGER NOT NULL DEFAULT 0,
    contexts_json TEXT NOT NULL DEFAULT '[]',
    success_rate REAL NOT NULL DEFAULT 0,
    confidence TEXT NOT NULL DEFAULT 'low',
    key_decisions_json TEXT NOT NULL DEFAULT '[]',
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS learning_calibration (
    category TEXT PRIMARY KEY,
    total_injections INTEGER NOT NULL DEFAULT 0,
    led_to_success INTEGER NOT NULL DEFAULT 0,
    effectiveness REAL NOT NULL DEFAULT 0,
    confidence TEXT NOT NULL DEFAULT 'low'
  );
`;

function ensureTables(db: any): void {
  db.exec(INIT_SQL);
}

export function loadLearningStateFromDb(projectRoot: string): LearningState {
  const dbPath = getStateDbPath(projectRoot);
  if (!existsSync(dbPath)) return { patterns: [], calibration: [], last_updated: new Date().toISOString() };

  const db = getDatabase(dbPath, true);
  if (!db) return { patterns: [], calibration: [], last_updated: new Date().toISOString() };

  try {
    // Check if tables exist
    const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='learning_patterns'").get();
    if (!tableCheck) return { patterns: [], calibration: [], last_updated: new Date().toISOString() };

    const patternRows = db.prepare('SELECT * FROM learning_patterns ORDER BY occurrences DESC').all() as any[];
    const calibrationRows = db.prepare('SELECT * FROM learning_calibration ORDER BY effectiveness DESC').all() as any[];

    const patterns: LearnedPattern[] = patternRows.map(r => ({
      id: r.id,
      name: r.name,
      occurrences: r.occurrences,
      contexts: safeJsonParse(r.contexts_json),
      success_rate: r.success_rate,
      confidence: r.confidence as 'low' | 'medium' | 'high',
      key_decisions: safeJsonParse(r.key_decisions_json),
      first_seen: r.first_seen,
      last_seen: r.last_seen,
    }));

    const calibration: MemoryCalibration[] = calibrationRows.map(r => ({
      category: r.category,
      total_injections: r.total_injections,
      led_to_success: r.led_to_success,
      effectiveness: r.effectiveness,
      confidence: r.confidence as 'low' | 'medium' | 'high',
    }));

    return { patterns, calibration, last_updated: new Date().toISOString() };
  } finally {
    db.close();
  }
}

export function saveLearningStateToDb(projectRoot: string, state: LearningState): void {
  const dbPath = getStateDbPath(projectRoot);
  const db = getDatabase(dbPath);
  if (!db) return;

  try {
    ensureTables(db);

    const upsertPattern = db.prepare(`
      INSERT INTO learning_patterns (name, id, occurrences, contexts_json, success_rate, confidence, key_decisions_json, first_seen, last_seen)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        id = excluded.id,
        occurrences = excluded.occurrences,
        contexts_json = excluded.contexts_json,
        success_rate = excluded.success_rate,
        confidence = excluded.confidence,
        key_decisions_json = excluded.key_decisions_json,
        first_seen = excluded.first_seen,
        last_seen = excluded.last_seen
    `);

    const upsertCalibration = db.prepare(`
      INSERT INTO learning_calibration (category, total_injections, led_to_success, effectiveness, confidence)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(category) DO UPDATE SET
        total_injections = excluded.total_injections,
        led_to_success = excluded.led_to_success,
        effectiveness = excluded.effectiveness,
        confidence = excluded.confidence
    `);

    const transaction = db.transaction(() => {
      for (const p of state.patterns) {
        upsertPattern.run(
          p.name, p.id, p.occurrences,
          JSON.stringify(p.contexts), p.success_rate, p.confidence,
          JSON.stringify(p.key_decisions), p.first_seen, p.last_seen,
        );
      }
      for (const c of state.calibration) {
        upsertCalibration.run(
          c.category, c.total_injections, c.led_to_success,
          c.effectiveness, c.confidence,
        );
      }
    });

    transaction();
  } finally {
    db.close();
  }
}

function safeJsonParse(str: string): string[] {
  try {
    const parsed = JSON.parse(str);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
