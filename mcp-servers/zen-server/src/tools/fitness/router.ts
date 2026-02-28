/**
 * Epsilon-greedy model router with minimum tier constraints.
 * Pure functions — no I/O.
 */

import type {
  Model,
  PerformanceState,
  RoutingDecision,
  RoutingConfig,
  RoutingRecommendation,
  ModelPerformanceMetrics,
} from "./types.js";

const MINIMUM_TIERS: Record<string, Model> = {
  "story.create": "haiku",
  "story.refine": "haiku",
  "architecture.design": "opus",
  "implementation.code": "sonnet",
  "quality.review": "sonnet",
  "security.scan": "sonnet",
  "verification.verify": "sonnet",
};

const MODEL_TIERS: Record<Model, number> = { haiku: 1, sonnet: 2, opus: 3 };
const ALL_MODELS: Model[] = ["haiku", "sonnet", "opus"];
const COST_ESTIMATES: Record<Model, number> = { haiku: 0.0001, sonnet: 0.0003, opus: 0.015 };

const DEFAULT_CONFIG: RoutingConfig = { epsilon: 0.05, success_threshold: 0.90 };

function getPerformance(
  state: PerformanceState,
  concept: string,
  action: string,
  model: Model,
): ModelPerformanceMetrics | undefined {
  const ca = state.concept_actions.find((c) => c.concept === concept && c.action === action);
  return ca?.models[model];
}

/**
 * Select model using epsilon-greedy strategy.
 */
export function selectModel(
  state: PerformanceState,
  concept: string,
  action: string,
  config: RoutingConfig = DEFAULT_CONFIG,
): RoutingDecision {
  const key = `${concept}.${action}`;
  const minTier = MINIMUM_TIERS[key] || "haiku";
  const eligible = ALL_MODELS.filter((m) => MODEL_TIERS[m] >= MODEL_TIERS[minTier]);

  if (Math.random() < config.epsilon) {
    const model = eligible[Math.floor(Math.random() * eligible.length)];
    return { model, reason: "explore", confidence: 0.5, estimated_cost: COST_ESTIMATES[model] };
  }

  // Exploit: find best model meeting threshold
  for (const model of eligible) {
    const perf = getPerformance(state, concept, action, model);
    if (perf && perf.runs >= 5 && perf.success_rate >= config.success_threshold) {
      return { model, reason: "exploit", confidence: perf.success_rate, estimated_cost: COST_ESTIMATES[model] };
    }
  }

  // Find best from eligible with enough data
  let bestModel: Model | null = null;
  let bestRate = -1;
  for (const model of eligible) {
    const perf = getPerformance(state, concept, action, model);
    if (perf && perf.runs >= 5 && perf.success_rate > bestRate) {
      bestModel = model;
      bestRate = perf.success_rate;
    }
  }

  if (bestModel) {
    return { model: bestModel, reason: "exploit", confidence: bestRate, estimated_cost: COST_ESTIMATES[bestModel] };
  }

  const fallback = eligible[eligible.length - 1];
  return { model: fallback, reason: "fallback", confidence: 0.3, estimated_cost: COST_ESTIMATES[fallback] };
}

/**
 * Get downgrade recommendations for cost optimization.
 */
export function getRecommendations(
  state: PerformanceState,
  config: RoutingConfig = DEFAULT_CONFIG,
): RoutingRecommendation[] {
  const recs: RoutingRecommendation[] = [];

  for (const ca of state.concept_actions) {
    const key = `${ca.concept}.${ca.action}`;
    const minTier = MINIMUM_TIERS[key] || "haiku";

    const withData = (Object.entries(ca.models) as [Model, ModelPerformanceMetrics][])
      .filter(([, m]) => m.runs >= 10)
      .map(([model, metrics]) => ({ model, metrics }));

    if (withData.length === 0) continue;

    const current = withData.reduce((max, cur) =>
      MODEL_TIERS[cur.model] > MODEL_TIERS[max.model] ? cur : max,
    );

    for (const candidate of withData) {
      if (
        MODEL_TIERS[candidate.model] < MODEL_TIERS[current.model]
        && MODEL_TIERS[candidate.model] >= MODEL_TIERS[minTier]
        && candidate.metrics.success_rate >= config.success_threshold
      ) {
        recs.push({
          concept: ca.concept,
          action: ca.action,
          current_model: current.model,
          recommended_model: candidate.model,
          potential_savings_per_run: current.metrics.avg_cost - candidate.metrics.avg_cost,
          success_rate: candidate.metrics.success_rate,
          runs: candidate.metrics.runs,
        });
        break;
      }
    }
  }

  return recs.sort((a, b) => b.potential_savings_per_run - a.potential_savings_per_run);
}
