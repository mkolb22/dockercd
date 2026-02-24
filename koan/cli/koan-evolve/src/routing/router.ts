/**
 * Epsilon-greedy model router with minimum tier constraints.
 *
 * 95% exploit: Use best-performing model
 * 5% explore: Try alternative model to gather data
 */

import type { Concept } from '@zen/koan-core';
import type { Model, PerformanceState } from './performance.js';
import { getPerformance } from './performance.js';

// Minimum model tier constraints (from architecture)
const MINIMUM_TIERS: Record<string, Model> = {
  'story.create': 'haiku',
  'story.refine': 'haiku',
  'architecture.design': 'opus',
  'implementation.code': 'sonnet',
  'quality.review': 'sonnet',
  'security.scan': 'sonnet',
  'verification.verify': 'sonnet',
};

// Model tier ordering (for comparison)
const MODEL_TIERS: Record<Model, number> = {
  haiku: 1,
  sonnet: 2,
  opus: 3,
};

// All available models
const ALL_MODELS: Model[] = ['haiku', 'sonnet', 'opus'];

export interface RoutingDecision {
  model: Model;
  reason: 'exploit' | 'explore' | 'fallback';
  confidence: number;
  estimated_cost: number;
}

export interface RoutingConfig {
  epsilon: number; // Exploration rate (default 0.05)
  success_threshold: number; // Success rate to recommend downgrade (default 0.90)
}

const DEFAULT_CONFIG: RoutingConfig = {
  epsilon: 0.05,
  success_threshold: 0.90,
};

/**
 * Select model using epsilon-greedy strategy.
 */
export function selectModel(
  state: PerformanceState,
  concept: Concept,
  action: string,
  config: RoutingConfig = DEFAULT_CONFIG
): RoutingDecision {
  const key = `${concept}.${action}`;
  const minTier = MINIMUM_TIERS[key] || 'haiku';

  // Filter models that meet minimum tier
  const eligibleModels = ALL_MODELS.filter(
    model => MODEL_TIERS[model] >= MODEL_TIERS[minTier]
  );

  // Epsilon-greedy decision
  const shouldExplore = Math.random() < config.epsilon;

  if (shouldExplore) {
    // Explore: Random model from eligible models
    const randomModel = eligibleModels[Math.floor(Math.random() * eligibleModels.length)];
    return {
      model: randomModel,
      reason: 'explore',
      confidence: 0.5,
      estimated_cost: estimateModelCost(randomModel),
    };
  }

  // Exploit: Select best model from eligible models
  const bestModel = findBestModel(state, concept, action, eligibleModels, config.success_threshold);

  if (bestModel) {
    return {
      model: bestModel.model,
      reason: 'exploit',
      confidence: bestModel.confidence,
      estimated_cost: estimateModelCost(bestModel.model),
    };
  }

  // Fallback: Use most expensive (safest) eligible model
  const fallbackModel = eligibleModels[eligibleModels.length - 1];
  return {
    model: fallbackModel,
    reason: 'fallback',
    confidence: 0.3,
    estimated_cost: estimateModelCost(fallbackModel),
  };
}

/**
 * Find best performing model from eligible models.
 */
function findBestModel(
  state: PerformanceState,
  concept: Concept,
  action: string,
  eligibleModels: Model[],
  successThreshold: number
): { model: Model; confidence: number } | null {
  // Check models from cheapest to most expensive
  for (const model of eligibleModels) {
    const performance = getPerformance(state, concept, action, model);

    if (!performance) {
      continue; // No data yet
    }

    // Require at least 5 runs for confidence
    if (performance.runs < 5) {
      continue;
    }

    // If success rate meets threshold, use this model
    if (performance.success_rate >= successThreshold) {
      return {
        model,
        confidence: performance.success_rate,
      };
    }
  }

  // If no model meets threshold, return most expensive with highest success rate
  let best: { model: Model; performance: any } | null = null;

  for (const model of eligibleModels) {
    const performance = getPerformance(state, concept, action, model);
    if (performance && performance.runs >= 5) {
      if (!best || performance.success_rate > best.performance.success_rate) {
        best = { model, performance };
      }
    }
  }

  if (best) {
    return {
      model: best.model,
      confidence: best.performance.success_rate,
    };
  }

  return null;
}

/**
 * Estimate cost for a model (placeholder - actual costs vary).
 */
function estimateModelCost(model: Model): number {
  const costEstimates: Record<Model, number> = {
    haiku: 0.0001,
    sonnet: 0.0003,
    opus: 0.015,
  };
  return costEstimates[model];
}

/**
 * Get routing recommendations (models that can be downgraded).
 */
export interface RoutingRecommendation {
  concept: Concept;
  action: string;
  current_model: Model;
  recommended_model: Model;
  potential_savings_per_run: number;
  success_rate: number;
  runs: number;
}

export function getRecommendations(
  state: PerformanceState,
  config: RoutingConfig = DEFAULT_CONFIG
): RoutingRecommendation[] {
  const recommendations: RoutingRecommendation[] = [];

  for (const conceptAction of state.concept_actions) {
    const { concept, action, models } = conceptAction;
    const key = `${concept}.${action}`;
    const minTier = MINIMUM_TIERS[key] || 'haiku';

    // Check if we can downgrade from current model
    const modelsWithData = Object.entries(models)
      .filter(([_, metrics]) => metrics.runs >= 10) // Require 10+ runs
      .map(([model, metrics]) => ({ model: model as Model, metrics }));

    if (modelsWithData.length === 0) {
      continue;
    }

    // Find most expensive model currently in use
    const currentModel = modelsWithData.reduce((max, curr) =>
      MODEL_TIERS[curr.model] > MODEL_TIERS[max.model] ? curr : max
    );

    // Find cheaper alternatives that meet success threshold
    for (const candidate of modelsWithData) {
      if (
        MODEL_TIERS[candidate.model] < MODEL_TIERS[currentModel.model] &&
        MODEL_TIERS[candidate.model] >= MODEL_TIERS[minTier] &&
        candidate.metrics.success_rate >= config.success_threshold
      ) {
        const savingsPerRun =
          currentModel.metrics.avg_cost - candidate.metrics.avg_cost;

        recommendations.push({
          concept,
          action,
          current_model: currentModel.model,
          recommended_model: candidate.model,
          potential_savings_per_run: savingsPerRun,
          success_rate: candidate.metrics.success_rate,
          runs: candidate.metrics.runs,
        });

        break; // Only recommend the best downgrade
      }
    }
  }

  return recommendations.sort(
    (a, b) => b.potential_savings_per_run - a.potential_savings_per_run
  );
}
