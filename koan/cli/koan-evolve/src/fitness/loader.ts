/**
 * Load and save fitness state via SQLite.
 */

import type { Concept } from '@zen/koan-core';
import type { FitnessState } from '../types.js';
import { validateFitnessState } from '../security/state-manager.js';
import { loadFitnessStateFromDb, saveFitnessStateToDb, listFitnessConceptsFromDb } from '../db.js';

/**
 * Load fitness state for a concept.
 */
export async function loadFitnessState(
  projectRoot: string,
  concept: Concept
): Promise<FitnessState | null> {
  const state = loadFitnessStateFromDb(projectRoot, concept);
  if (!state) return null;

  // Validate state (SEC-002)
  const validation = validateFitnessState(state);
  if (!validation.valid) {
    throw new Error(`Invalid fitness state for ${concept}: ${validation.errors.join(', ')}`);
  }

  return state;
}

/**
 * Save fitness state for a concept.
 */
export async function saveFitnessState(
  projectRoot: string,
  state: FitnessState
): Promise<void> {
  state.metadata.last_updated = new Date().toISOString();
  saveFitnessStateToDb(projectRoot, state);
}

/**
 * List all fitness states.
 */
export async function listFitnessStates(projectRoot: string): Promise<Concept[]> {
  return listFitnessConceptsFromDb(projectRoot);
}
