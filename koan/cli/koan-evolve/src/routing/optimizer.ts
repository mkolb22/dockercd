/**
 * Cost optimizer - analyzes model performance and recommends optimizations.
 */

import type { PerformanceState } from './performance.js';
import { getRecommendations, type RoutingRecommendation } from './router.js';

export interface OptimizationReport {
  total_recommendations: number;
  total_potential_savings_per_day: number;
  recommendations: RoutingRecommendation[];
  summary: string;
  generated_at: string;
}

/**
 * Generate optimization report with cost savings recommendations.
 */
export function generateOptimizationReport(
  state: PerformanceState,
  estimatedDailyRuns: number = 10
): OptimizationReport {
  const recommendations = getRecommendations(state);

  // Calculate total potential savings
  const totalSavingsPerRun = recommendations.reduce(
    (sum, rec) => sum + rec.potential_savings_per_run,
    0
  );
  const totalSavingsPerDay = totalSavingsPerRun * estimatedDailyRuns;

  // Generate summary
  const summary = generateSummary(recommendations, totalSavingsPerDay);

  return {
    total_recommendations: recommendations.length,
    total_potential_savings_per_day: totalSavingsPerDay,
    recommendations,
    summary,
    generated_at: new Date().toISOString(),
  };
}

/**
 * Generate human-readable summary.
 */
function generateSummary(
  recommendations: RoutingRecommendation[],
  totalSavingsPerDay: number
): string {
  if (recommendations.length === 0) {
    return 'No optimization opportunities found. Current model routing is optimal.';
  }

  const lines = [
    `Found ${recommendations.length} optimization opportunit${recommendations.length === 1 ? 'y' : 'ies'}:`,
    '',
  ];

  for (const rec of recommendations) {
    const savingsPercent = (
      (rec.potential_savings_per_run /
        (rec.potential_savings_per_run +
          estimateModelCost(rec.recommended_model))) *
      100
    ).toFixed(0);

    lines.push(
      `- ${rec.concept}.${rec.action}: ${rec.current_model} → ${rec.recommended_model}`,
      `  Success rate: ${(rec.success_rate * 100).toFixed(1)}% over ${rec.runs} runs`,
      `  Savings: $${rec.potential_savings_per_run.toFixed(4)}/run (~${savingsPercent}% reduction)`,
      ''
    );
  }

  lines.push(
    `Estimated daily savings: $${totalSavingsPerDay.toFixed(2)} (assuming 10 runs/day)`
  );

  return lines.join('\n');
}

/**
 * Estimate model cost (must match router.ts).
 */
function estimateModelCost(model: string): number {
  const costEstimates: Record<string, number> = {
    haiku: 0.0001,
    sonnet: 0.0003,
    opus: 0.015,
  };
  return costEstimates[model] || 0;
}
