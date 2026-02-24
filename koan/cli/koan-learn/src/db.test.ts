import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { loadLearningStateFromDb, saveLearningStateToDb } from './db.js';
import type { LearningState } from './types.js';

let testDir: string;

function makeTempDir(): string {
  const dir = join(tmpdir(), 'koan-learn-test-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  mkdirSync(dir, { recursive: true });
  return dir;
}

function createStateDb(projectRoot: string): void {
  const dbDir = join(projectRoot, 'koan', 'state');
  mkdirSync(dbDir, { recursive: true });
  const db = new Database(join(dbDir, 'state.db'));
  db.close();
}

beforeEach(() => {
  testDir = makeTempDir();
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('loadLearningStateFromDb', () => {
  it('returns empty state when no state.db exists', () => {
    const state = loadLearningStateFromDb(testDir);
    expect(state.patterns).toEqual([]);
    expect(state.calibration).toEqual([]);
  });

  it('returns empty state when tables do not exist', () => {
    createStateDb(testDir);
    const state = loadLearningStateFromDb(testDir);
    expect(state.patterns).toEqual([]);
    expect(state.calibration).toEqual([]);
  });
});

describe('saveLearningStateToDb', () => {
  it('creates tables and saves patterns', () => {
    createStateDb(testDir);

    const state: LearningState = {
      patterns: [{
        id: 'pattern-story-create',
        name: 'story create pattern',
        occurrences: 10,
        contexts: ['story'],
        success_rate: 0.9,
        confidence: 'high',
        key_decisions: ['Use structured format'],
        first_seen: '2026-01-01T00:00:00Z',
        last_seen: '2026-01-10T00:00:00Z',
      }],
      calibration: [{
        category: 'story',
        total_injections: 20,
        led_to_success: 18,
        effectiveness: 0.9,
        confidence: 'high',
      }],
      last_updated: '2026-01-10T00:00:00Z',
    };

    saveLearningStateToDb(testDir, state);

    // Verify via direct DB read
    const db = new Database(join(testDir, 'koan', 'state', 'state.db'), { readonly: true });
    const patterns = db.prepare('SELECT * FROM learning_patterns').all() as any[];
    expect(patterns).toHaveLength(1);
    expect(patterns[0].name).toBe('story create pattern');
    expect(patterns[0].occurrences).toBe(10);
    expect(JSON.parse(patterns[0].contexts_json)).toEqual(['story']);

    const calibration = db.prepare('SELECT * FROM learning_calibration').all() as any[];
    expect(calibration).toHaveLength(1);
    expect(calibration[0].category).toBe('story');
    expect(calibration[0].effectiveness).toBe(0.9);
    db.close();
  });

  it('upserts on conflict', () => {
    createStateDb(testDir);

    const state1: LearningState = {
      patterns: [{
        id: 'p1', name: 'test pattern', occurrences: 5,
        contexts: ['a'], success_rate: 0.8, confidence: 'medium',
        key_decisions: [], first_seen: '2026-01-01T00:00:00Z', last_seen: '2026-01-05T00:00:00Z',
      }],
      calibration: [],
      last_updated: '2026-01-05T00:00:00Z',
    };

    saveLearningStateToDb(testDir, state1);

    const state2: LearningState = {
      patterns: [{
        id: 'p1', name: 'test pattern', occurrences: 10,
        contexts: ['a', 'b'], success_rate: 0.9, confidence: 'high',
        key_decisions: ['Decision 1'], first_seen: '2026-01-01T00:00:00Z', last_seen: '2026-01-10T00:00:00Z',
      }],
      calibration: [],
      last_updated: '2026-01-10T00:00:00Z',
    };

    saveLearningStateToDb(testDir, state2);

    const db = new Database(join(testDir, 'koan', 'state', 'state.db'), { readonly: true });
    const patterns = db.prepare('SELECT * FROM learning_patterns').all() as any[];
    expect(patterns).toHaveLength(1);
    expect(patterns[0].occurrences).toBe(10);
    expect(patterns[0].confidence).toBe('high');
    db.close();
  });
});

describe('round-trip', () => {
  it('saves and loads patterns and calibration', () => {
    createStateDb(testDir);

    const original: LearningState = {
      patterns: [
        {
          id: 'pattern-story-create', name: 'story create pattern',
          occurrences: 10, contexts: ['story', 'feature'],
          success_rate: 0.95, confidence: 'high',
          key_decisions: ['Decision A', 'Decision B'],
          first_seen: '2026-01-01T00:00:00Z', last_seen: '2026-01-10T00:00:00Z',
        },
        {
          id: 'pattern-arch-design', name: 'architecture design pattern',
          occurrences: 5, contexts: ['architecture'],
          success_rate: 0.8, confidence: 'medium',
          key_decisions: [],
          first_seen: '2026-01-02T00:00:00Z', last_seen: '2026-01-08T00:00:00Z',
        },
      ],
      calibration: [
        { category: 'story', total_injections: 20, led_to_success: 19, effectiveness: 0.95, confidence: 'high' },
        { category: 'architecture', total_injections: 10, led_to_success: 8, effectiveness: 0.8, confidence: 'medium' },
      ],
      last_updated: '2026-01-10T00:00:00Z',
    };

    saveLearningStateToDb(testDir, original);
    const loaded = loadLearningStateFromDb(testDir);

    expect(loaded.patterns).toHaveLength(2);
    expect(loaded.calibration).toHaveLength(2);

    // Patterns are ordered by occurrences DESC
    expect(loaded.patterns[0].id).toBe('pattern-story-create');
    expect(loaded.patterns[0].occurrences).toBe(10);
    expect(loaded.patterns[0].contexts).toEqual(['story', 'feature']);
    expect(loaded.patterns[0].key_decisions).toEqual(['Decision A', 'Decision B']);

    expect(loaded.patterns[1].id).toBe('pattern-arch-design');

    // Calibration ordered by effectiveness DESC
    expect(loaded.calibration[0].category).toBe('story');
    expect(loaded.calibration[0].effectiveness).toBe(0.95);
    expect(loaded.calibration[1].category).toBe('architecture');
  });
});
