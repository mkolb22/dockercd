/**
 * Load and save routing state (performance and budget) via SQLite.
 */

import type { PerformanceState } from './performance.js';
import type { BudgetState } from '../security/budget-enforcer.js';
import {
  loadPerformanceStateFromDb,
  savePerformanceStateToDb,
  loadBudgetStateFromDb,
  saveBudgetStateToDb,
} from '../db.js';

/**
 * Load performance state.
 */
export async function loadPerformanceState(
  projectRoot: string
): Promise<PerformanceState> {
  return loadPerformanceStateFromDb(projectRoot);
}

/**
 * Save performance state.
 */
export async function savePerformanceState(
  projectRoot: string,
  state: PerformanceState
): Promise<void> {
  state.metadata.last_updated = new Date().toISOString();
  savePerformanceStateToDb(projectRoot, state);
}

/**
 * Load budget state.
 */
export async function loadBudgetState(projectRoot: string): Promise<BudgetState> {
  return loadBudgetStateFromDb(projectRoot);
}

/**
 * Save budget state.
 */
export async function saveBudgetState(
  projectRoot: string,
  state: BudgetState
): Promise<void> {
  state.metadata.last_updated = new Date().toISOString();
  saveBudgetStateToDb(projectRoot, state);
}
