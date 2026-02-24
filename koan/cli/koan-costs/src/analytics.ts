import type { ProvenanceAction } from '@zen/koan-core';
import type { CostAnalytics, CostByDimension } from './types.js';

function aggregateBy(actions: ProvenanceAction[], keyFn: (a: ProvenanceAction) => string): CostByDimension[] {
  const groups = new Map<string, { cost: number; count: number; input: number; output: number }>();

  for (const action of actions) {
    const key = keyFn(action);
    const existing = groups.get(key) || { cost: 0, count: 0, input: 0, output: 0 };
    existing.cost += action.cost?.cost_usd || 0;
    existing.count += 1;
    existing.input += action.cost?.input_tokens || 0;
    existing.output += action.cost?.output_tokens || 0;
    groups.set(key, existing);
  }

  return Array.from(groups.entries())
    .map(([dimension, data]) => ({
      dimension,
      total_cost: data.cost,
      count: data.count,
      avg_cost: data.count > 0 ? data.cost / data.count : 0,
      input_tokens: data.input,
      output_tokens: data.output,
    }))
    .sort((a, b) => b.total_cost - a.total_cost);
}

function buildTimeSeries(actions: ProvenanceAction[]): { date: string; cost: number }[] {
  const daily = new Map<string, number>();

  for (const action of actions) {
    const date = action.timestamp.substring(0, 10);
    daily.set(date, (daily.get(date) || 0) + (action.cost?.cost_usd || 0));
  }

  return Array.from(daily.entries())
    .map(([date, cost]) => ({ date, cost }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function computeAnalytics(actions: ProvenanceAction[]): CostAnalytics {
  const total_cost = actions.reduce((sum, a) => sum + (a.cost?.cost_usd || 0), 0);

  return {
    total_cost,
    total_actions: actions.length,
    by_concept: aggregateBy(actions, a => a.concept),
    by_model: aggregateBy(actions, a => a.model || 'unknown'),
    by_flow: aggregateBy(actions, a => a.flow_id || 'untracked'),
    by_date: aggregateBy(actions, a => a.timestamp.substring(0, 10)),
    time_series: buildTimeSeries(actions),
  };
}
