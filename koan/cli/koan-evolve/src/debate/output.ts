/**
 * Debate output management - save and load debate results via SQLite.
 */

import type { DebateResult } from '../types.js';
import { loadDebateFromDb, saveDebateToDb, listDebatesFromDb } from '../db.js';

/**
 * Save debate result.
 */
export async function saveDebate(
  projectRoot: string,
  debate: DebateResult
): Promise<void> {
  saveDebateToDb(projectRoot, debate);
}

/**
 * Load debate result.
 */
export async function loadDebate(
  projectRoot: string,
  archId: string
): Promise<DebateResult | null> {
  return loadDebateFromDb(projectRoot, archId);
}

/**
 * List all debates.
 */
export async function listDebates(projectRoot: string): Promise<string[]> {
  return listDebatesFromDb(projectRoot);
}

/**
 * Calculate confidence score from debate agreement.
 */
export function calculateConfidence(debate: DebateResult): number {
  const { advocate, critic, synthesis } = debate;

  // Weight synthesis confidence most heavily
  const synthesisWeight = 0.5;
  const advocateWeight = 0.25;
  const criticWeight = 0.25;

  const weightedConfidence =
    synthesis.confidence * synthesisWeight +
    advocate.confidence * advocateWeight +
    (1 - (critic.concerns.filter(c => c.severity === 'high').length / Math.max(critic.concerns.length, 1))) * criticWeight;

  return Math.min(1.0, Math.max(0.0, weightedConfidence));
}
