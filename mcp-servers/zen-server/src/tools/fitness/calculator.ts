/**
 * Pure fitness calculation from provenance data.
 * Formula: fitness = 0.4 * test_pass_rate + 0.3 * quality_score + 0.3 * user_acceptance
 */

import type { FitnessMetrics, FitnessScore, FitnessHistoryEntry, FitnessTrend } from "./types.js";

const WEIGHTS = {
  TEST_PASS_RATE: 0.4,
  QUALITY_SCORE: 0.3,
  USER_ACCEPTANCE: 0.3,
} as const;

interface ActionLike {
  status: string;
  error?: unknown;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

function extractMetrics(actions: ActionLike[]): FitnessMetrics {
  if (actions.length === 0) {
    return { test_pass_rate: 0, quality_score: 0, user_acceptance: 0 };
  }

  const completed = actions.filter((a) => a.status === "completed" && !a.error);
  const test_pass_rate = completed.length / actions.length;

  const qualityScores = actions
    .map((a) => a.metadata?.quality_score as number | undefined)
    .filter((s): s is number => typeof s === "number" && s >= 0 && s <= 1);

  const quality_score = qualityScores.length > 0
    ? qualityScores.reduce((sum, s) => sum + s, 0) / qualityScores.length
    : test_pass_rate;

  return { test_pass_rate, quality_score, user_acceptance: test_pass_rate };
}

function weightedFitness(m: FitnessMetrics): number {
  return WEIGHTS.TEST_PASS_RATE * m.test_pass_rate
    + WEIGHTS.QUALITY_SCORE * m.quality_score
    + WEIGHTS.USER_ACCEPTANCE * m.user_acceptance;
}

function calculateTrend(actions: ActionLike[]): FitnessTrend {
  if (actions.length < 6) return "stable";
  const mid = Math.floor(actions.length / 2);
  const firstFit = weightedFitness(extractMetrics(actions.slice(0, mid)));
  const secondFit = weightedFitness(extractMetrics(actions.slice(mid)));
  const delta = secondFit - firstFit;
  if (delta > 0.05) return "improving";
  if (delta < -0.05) return "degrading";
  return "stable";
}

function buildHistory(actions: ActionLike[]): FitnessHistoryEntry[] {
  const history: FitnessHistoryEntry[] = [];
  const sampleRate = 5;
  for (let i = sampleRate - 1; i < actions.length; i += sampleRate) {
    const sub = actions.slice(0, i + 1);
    history.push({
      timestamp: actions[i].timestamp,
      fitness: weightedFitness(extractMetrics(sub)),
      run_count: i + 1,
    });
  }
  return history;
}

/**
 * Compute fitness score for a variant from its provenance actions.
 */
export function computeFitness(variantId: string, actions: ActionLike[]): FitnessScore {
  const metrics = extractMetrics(actions);
  const fitness = weightedFitness(metrics);
  const rolling = weightedFitness(extractMetrics(actions.slice(-10)));

  return {
    variant_id: variantId,
    runs: actions.length,
    fitness: { current: fitness, rolling_avg_10: rolling, trend: calculateTrend(actions) },
    metrics,
    history: buildHistory(actions),
  };
}

/**
 * Rank variants by current fitness descending.
 */
export function rankVariants(variants: FitnessScore[]): FitnessScore[] {
  return [...variants].sort((a, b) => b.fitness.current - a.fitness.current);
}
