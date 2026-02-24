/**
 * Fitness calculation from provenance data.
 *
 * Formula: fitness = 0.4 * test_pass_rate + 0.3 * quality_score + 0.3 * user_acceptance
 */

import type { ProvenanceAction } from '@zen/koan-core';
import type { FitnessMetrics, FitnessScore } from '../types.js';

// Fitness weights (from architecture)
const WEIGHTS = {
  TEST_PASS_RATE: 0.4,
  QUALITY_SCORE: 0.3,
  USER_ACCEPTANCE: 0.3,
};

/**
 * Compute fitness score from provenance actions.
 */
export function computeFitness(
  variantId: string,
  actions: ProvenanceAction[]
): FitnessScore {
  const metrics = extractMetrics(actions);
  const fitness = calculateWeightedFitness(metrics);

  // Calculate rolling average (last 10 runs)
  const recentActions = actions.slice(-10);
  const rollingMetrics = extractMetrics(recentActions);
  const rollingAvg = calculateWeightedFitness(rollingMetrics);

  // Calculate trend
  const trend = calculateTrend(actions);

  // Build history
  const history = buildHistory(actions);

  return {
    variant_id: variantId,
    runs: actions.length,
    fitness: {
      current: fitness,
      rolling_avg_10: rollingAvg,
      trend,
    },
    metrics,
    history,
  };
}

/**
 * Extract fitness metrics from provenance actions.
 */
function extractMetrics(actions: ProvenanceAction[]): FitnessMetrics {
  if (actions.length === 0) {
    return {
      test_pass_rate: 0,
      quality_score: 0,
      user_acceptance: 0,
    };
  }

  // Test pass rate: proportion of completed (non-error) actions
  const completedActions = actions.filter(a => a.status === 'completed' && !a.error);
  const test_pass_rate = completedActions.length / actions.length;

  // Quality score: average from metadata (if present)
  const qualityScores = actions
    .map(a => a.metadata?.quality_score as number | undefined)
    .filter((score): score is number => typeof score === 'number' && score >= 0 && score <= 1);

  const quality_score = qualityScores.length > 0
    ? qualityScores.reduce((sum, s) => sum + s, 0) / qualityScores.length
    : test_pass_rate; // Fallback to test pass rate if no quality scores

  // User acceptance: workflows without errors/rollbacks
  // For now, use completion rate as a proxy
  const user_acceptance = test_pass_rate;

  return {
    test_pass_rate,
    quality_score,
    user_acceptance,
  };
}

/**
 * Calculate weighted fitness score.
 */
function calculateWeightedFitness(metrics: FitnessMetrics): number {
  return (
    WEIGHTS.TEST_PASS_RATE * metrics.test_pass_rate +
    WEIGHTS.QUALITY_SCORE * metrics.quality_score +
    WEIGHTS.USER_ACCEPTANCE * metrics.user_acceptance
  );
}

/**
 * Calculate trend (improving/stable/degrading).
 */
function calculateTrend(actions: ProvenanceAction[]): 'improving' | 'stable' | 'degrading' {
  if (actions.length < 6) {
    return 'stable'; // Not enough data
  }

  // Compare first half vs second half
  const midpoint = Math.floor(actions.length / 2);
  const firstHalf = actions.slice(0, midpoint);
  const secondHalf = actions.slice(midpoint);

  const firstMetrics = extractMetrics(firstHalf);
  const secondMetrics = extractMetrics(secondHalf);

  const firstFitness = calculateWeightedFitness(firstMetrics);
  const secondFitness = calculateWeightedFitness(secondMetrics);

  const delta = secondFitness - firstFitness;

  if (delta > 0.05) return 'improving';
  if (delta < -0.05) return 'degrading';
  return 'stable';
}

/**
 * Build fitness history from actions.
 */
function buildHistory(actions: ProvenanceAction[]): Array<{ timestamp: string; fitness: number; run_count: number }> {
  const history: Array<{ timestamp: string; fitness: number; run_count: number }> = [];

  // Sample every 5 actions to avoid excessive history size
  const sampleRate = 5;
  for (let i = sampleRate - 1; i < actions.length; i += sampleRate) {
    const subActions = actions.slice(0, i + 1);
    const metrics = extractMetrics(subActions);
    const fitness = calculateWeightedFitness(metrics);

    history.push({
      timestamp: actions[i].timestamp,
      fitness,
      run_count: i + 1,
    });
  }

  return history;
}

/**
 * Rank variants by fitness.
 */
export function rankVariants(variants: FitnessScore[]): FitnessScore[] {
  return [...variants].sort((a, b) => b.fitness.current - a.fitness.current);
}
