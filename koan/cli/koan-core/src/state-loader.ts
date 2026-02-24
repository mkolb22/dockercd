/**
 * SQLite state loaders for koan/state/state.db.
 * Provides read-only access to events, checkpoints, and health.
 *
 * These are the primary data source; YAML loaders in loader.ts are fallbacks.
 */

import { existsSync } from 'fs';
import { join } from 'path';
import type { ProvenanceAction, Concept } from './types.js';
import { getDatabase as getDb } from './db-utils.js';

// --- Types ---

export interface EventRecord {
  id: string;
  type: string;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface CheckpointRecord {
  id: string;
  name: string;
  type: string;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface HealthRecord {
  contextUsagePercent: number;
  zone: string;
  updatedAt: string;
}

// --- Loaders ---

/**
 * Get the path to state.db for a project root.
 */
export function getStateDbPath(projectRoot: string): string {
  return join(projectRoot, 'koan', 'state', 'state.db');
}

/**
 * Check if SQLite state is available.
 */
export function stateDbAvailable(projectRoot: string): boolean {
  return existsSync(getStateDbPath(projectRoot));
}

/**
 * Load events from state.db, optionally filtered by type.
 */
export function loadEventsFromDb(
  projectRoot: string,
  type?: string,
): EventRecord[] {
  const dbPath = getStateDbPath(projectRoot);
  if (!existsSync(dbPath)) return [];

  const db = getDb(dbPath, true);
  if (!db) return [];

  try {
    const query = type
      ? db.prepare('SELECT id, type, data, created_at FROM events WHERE type = ? ORDER BY created_at DESC')
      : db.prepare('SELECT id, type, data, created_at FROM events ORDER BY created_at DESC');

    const rows = type ? query.all(type) : query.all();

    return rows.map((r: any) => ({
      id: r.id,
      type: r.type,
      data: safeJsonParse(r.data),
      createdAt: r.created_at,
    }));
  } finally {
    db.close();
  }
}

/**
 * Load provenance actions from SQLite events.
 * Maps concept_complete + task_invocation events to the ProvenanceAction shape.
 */
export function loadProvenanceFromDb(projectRoot: string): ProvenanceAction[] {
  const events = loadEventsFromDb(projectRoot);
  const actions: ProvenanceAction[] = [];

  for (const event of events) {
    if (event.type === 'concept_complete' || event.type === 'task_invocation' || event.type === 'concept_complete_frontmatter') {
      const d = event.data;
      actions.push({
        action_id: event.id,
        concept: (d.concept as Concept) || 'implementation',
        action: event.type === 'task_invocation' ? 'start' : 'complete',
        status: 'completed',
        timestamp: event.createdAt,
        model: (d.model as any) || undefined,
        flow_id: (d.flow_id as string) || undefined,
        duration_ms: (d.duration_ms as number) || undefined,
        cost: {
          input_tokens: (d.input_tokens as number) || 0,
          output_tokens: (d.output_tokens as number) || 0,
        },
      });
    } else if (event.type === 'git_commit') {
      const d = event.data;
      actions.push({
        action_id: event.id,
        concept: 'version' as Concept,
        action: 'commit',
        status: 'completed',
        timestamp: event.createdAt,
        flow_id: (d.flow_id as string) || undefined,
        metadata: { commit_hash: d.commit_hash, story_id: d.story_id, message: d.message },
      });
    }
  }

  return actions.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

/**
 * Load checkpoints from state.db.
 */
export function loadCheckpointsFromDb(
  projectRoot: string,
  type?: string,
): CheckpointRecord[] {
  const dbPath = getStateDbPath(projectRoot);
  if (!existsSync(dbPath)) return [];

  const db = getDb(dbPath, true);
  if (!db) return [];

  try {
    const query = type
      ? db.prepare('SELECT id, name, type, data, created_at FROM checkpoints WHERE type = ? ORDER BY created_at DESC')
      : db.prepare('SELECT id, name, type, data, created_at FROM checkpoints ORDER BY created_at DESC');

    const rows = type ? query.all(type) : query.all();

    return rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      data: safeJsonParse(r.data),
      createdAt: r.created_at,
    }));
  } finally {
    db.close();
  }
}

/**
 * Load health status from state.db.
 */
export function loadHealthFromDb(projectRoot: string): HealthRecord | null {
  const dbPath = getStateDbPath(projectRoot);
  if (!existsSync(dbPath)) return null;

  const db = getDb(dbPath, true);
  if (!db) return null;

  try {
    const row = db.prepare(
      'SELECT context_usage_percent, zone, updated_at FROM health ORDER BY rowid DESC LIMIT 1'
    ).get() as any;

    if (!row) return null;

    return {
      contextUsagePercent: row.context_usage_percent,
      zone: row.zone,
      updatedAt: row.updated_at,
    };
  } finally {
    db.close();
  }
}

// --- Helpers ---

function safeJsonParse(str: string): Record<string, unknown> {
  try {
    return JSON.parse(str);
  } catch {
    return {};
  }
}
