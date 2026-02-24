/**
 * Model performance tracking for adaptive routing.
 *
 * Tracks success/failure rate per concept-action-model triple.
 */

import type { Concept } from '@zen/koan-core';

export type Model = 'haiku' | 'sonnet' | 'opus';

export interface ModelPerformanceMetrics {
  runs: number;
  successes: number;
  failures: number;
  success_rate: number;
  avg_cost: number;
  avg_duration_ms: number;
  last_20_runs: boolean[]; // True for success, false for failure
}

export interface ConceptActionPerformance {
  concept: Concept;
  action: string;
  models: Partial<Record<Model, ModelPerformanceMetrics>>;
}

export interface PerformanceState {
  concept_actions: ConceptActionPerformance[];
  metadata: {
    last_updated: string;
    checksum: string;
  };
}

/**
 * Update performance metrics with a new result.
 */
export function updatePerformanceMetrics(
  current: ModelPerformanceMetrics | undefined,
  success: boolean,
  cost: number,
  durationMs: number
): ModelPerformanceMetrics {
  const runs = (current?.runs || 0) + 1;
  const successes = (current?.successes || 0) + (success ? 1 : 0);
  const failures = (current?.failures || 0) + (success ? 0 : 1);

  // Update rolling last 20 runs
  const last20 = [...(current?.last_20_runs || [])];
  last20.push(success);
  if (last20.length > 20) {
    last20.shift(); // Keep only last 20
  }

  // Calculate rolling success rate from last 20
  const recentSuccesses = last20.filter(s => s).length;
  const success_rate = last20.length > 0 ? recentSuccesses / last20.length : 0;

  // Update averages
  const totalCost = (current?.avg_cost || 0) * (current?.runs || 0) + cost;
  const totalDuration = (current?.avg_duration_ms || 0) * (current?.runs || 0) + durationMs;

  return {
    runs,
    successes,
    failures,
    success_rate,
    avg_cost: totalCost / runs,
    avg_duration_ms: totalDuration / runs,
    last_20_runs: last20,
  };
}

/**
 * Get performance for a specific concept-action-model triple.
 */
export function getPerformance(
  state: PerformanceState,
  concept: Concept,
  action: string,
  model: Model
): ModelPerformanceMetrics | undefined {
  const conceptAction = state.concept_actions.find(
    ca => ca.concept === concept && ca.action === action
  );

  return conceptAction?.models[model];
}

/**
 * Record a new performance data point.
 */
export function recordPerformance(
  state: PerformanceState,
  concept: Concept,
  action: string,
  model: Model,
  success: boolean,
  cost: number,
  durationMs: number
): PerformanceState {
  // Find or create concept-action entry
  let conceptAction = state.concept_actions.find(
    ca => ca.concept === concept && ca.action === action
  );

  if (!conceptAction) {
    conceptAction = {
      concept,
      action,
      models: {},
    };
    state.concept_actions.push(conceptAction);
  }

  // Update model performance
  const currentMetrics = conceptAction.models[model];
  conceptAction.models[model] = updatePerformanceMetrics(
    currentMetrics,
    success,
    cost,
    durationMs
  );

  // Update metadata
  state.metadata.last_updated = new Date().toISOString();

  return state;
}
