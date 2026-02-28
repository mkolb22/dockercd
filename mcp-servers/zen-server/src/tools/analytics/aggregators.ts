/**
 * Pure aggregation functions for cost analytics and benchmark metrics.
 * No I/O — operates on in-memory ProvenanceAction arrays.
 */

import type {
  ProvenanceAction,
  CostByDimension,
  CostAnalytics,
  CostMetrics,
  DurationMetrics,
  QualityMetrics,
  ModelUsage,
  FailureMetrics,
  TrendData,
  BenchmarkMetrics,
} from "./types.js";

// ─── Statistical helpers ──────────────────────────────────────

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0];
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const frac = idx - lo;
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

// ─── Cost analytics (koan-costs) ──────────────────────────────

function aggregateBy(
  actions: ProvenanceAction[],
  keyFn: (a: ProvenanceAction) => string,
): CostByDimension[] {
  const groups = new Map<string, { cost: number; count: number; input: number; output: number }>();

  for (const action of actions) {
    const key = keyFn(action);
    const g = groups.get(key) || { cost: 0, count: 0, input: 0, output: 0 };
    g.cost += action.cost?.cost_usd || 0;
    g.count += 1;
    g.input += action.cost?.input_tokens || 0;
    g.output += action.cost?.output_tokens || 0;
    groups.set(key, g);
  }

  return Array.from(groups.entries())
    .map(([dimension, d]) => ({
      dimension,
      total_cost: d.cost,
      count: d.count,
      avg_cost: d.count > 0 ? d.cost / d.count : 0,
      input_tokens: d.input,
      output_tokens: d.output,
    }))
    .sort((a, b) => b.total_cost - a.total_cost);
}

function buildTimeSeries(actions: ProvenanceAction[]): { date: string; cost: number }[] {
  const daily = new Map<string, number>();
  for (const a of actions) {
    const date = a.timestamp.substring(0, 10);
    daily.set(date, (daily.get(date) || 0) + (a.cost?.cost_usd || 0));
  }
  return Array.from(daily.entries())
    .map(([date, cost]) => ({ date, cost }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function computeCostAnalytics(actions: ProvenanceAction[]): CostAnalytics {
  return {
    total_cost: actions.reduce((sum, a) => sum + (a.cost?.cost_usd || 0), 0),
    total_actions: actions.length,
    by_concept: aggregateBy(actions, (a) => a.concept),
    by_model: aggregateBy(actions, (a) => a.model || "unknown"),
    by_flow: aggregateBy(actions, (a) => a.flow_id || "untracked"),
    by_date: aggregateBy(actions, (a) => a.timestamp.substring(0, 10)),
    time_series: buildTimeSeries(actions),
  };
}

// ─── Benchmark aggregators (koan-bench) ───────────────────────

export function aggregateCosts(actions: ProvenanceAction[]): CostMetrics {
  const total_spend = actions.reduce((sum, a) => sum + (a.cost?.cost_usd || 0), 0);

  const byConcept = new Map<string, { total: number; count: number }>();
  const byStory = new Map<string, { total: number; count: number }>();
  const byModel = new Map<string, { total: number; count: number }>();

  for (const a of actions) {
    const cost = a.cost?.cost_usd || 0;

    const cg = byConcept.get(a.concept) || { total: 0, count: 0 };
    cg.total += cost;
    cg.count += 1;
    byConcept.set(a.concept, cg);

    const sid = a.flow_id || "untracked";
    const sg = byStory.get(sid) || { total: 0, count: 0 };
    sg.total += cost;
    sg.count += 1;
    byStory.set(sid, sg);

    const model = a.model || "unknown";
    const mg = byModel.get(model) || { total: 0, count: 0 };
    mg.total += cost;
    mg.count += 1;
    byModel.set(model, mg);
  }

  return {
    total_spend,
    by_concept: Array.from(byConcept.entries())
      .map(([concept, d]) => ({ concept, total: d.total, avg: d.count > 0 ? d.total / d.count : 0, count: d.count }))
      .sort((a, b) => b.total - a.total),
    by_story: Array.from(byStory.entries())
      .map(([story_id, d]) => ({ story_id, total: d.total, count: d.count }))
      .sort((a, b) => b.total - a.total),
    by_model: Array.from(byModel.entries())
      .map(([model, d]) => ({ model, total: d.total, avg: d.count > 0 ? d.total / d.count : 0, count: d.count }))
      .sort((a, b) => b.total - a.total),
  };
}

export function aggregateDurations(actions: ProvenanceAction[]): DurationMetrics {
  const total_duration_ms = actions.reduce((sum, a) => sum + (a.duration_ms || 0), 0);

  const byConcept = new Map<string, number[]>();
  const byStory = new Map<string, { total_ms: number; count: number }>();

  for (const a of actions) {
    const dur = a.duration_ms || 0;

    const cd = byConcept.get(a.concept) || [];
    cd.push(dur);
    byConcept.set(a.concept, cd);

    const sid = a.flow_id || "untracked";
    const sd = byStory.get(sid) || { total_ms: 0, count: 0 };
    sd.total_ms += dur;
    sd.count += 1;
    byStory.set(sid, sd);
  }

  return {
    total_duration_ms,
    by_concept: Array.from(byConcept.entries())
      .map(([concept, durs]) => ({
        concept,
        total_ms: durs.reduce((s, d) => s + d, 0),
        avg_ms: mean(durs),
        p50_ms: percentile(durs, 50),
        p90_ms: percentile(durs, 90),
        p99_ms: percentile(durs, 99),
        count: durs.length,
      }))
      .sort((a, b) => b.total_ms - a.total_ms),
    by_story: Array.from(byStory.entries())
      .map(([story_id, d]) => ({ story_id, total_ms: d.total_ms, count: d.count }))
      .sort((a, b) => b.total_ms - a.total_ms),
  };
}

export function aggregateQuality(actions: ProvenanceAction[]): QualityMetrics {
  const reviewActions = actions.filter((a) => a.concept === "quality" || a.concept === "verification");
  const total_reviews = reviewActions.length;
  const approvals = reviewActions.filter((a) => a.status === "completed" && !a.error).length;
  const retries = reviewActions.filter((a) => a.metadata?.retry === true).length;

  const byConcept = new Map<string, { reviews: number; approvals: number; rejections: number }>();
  for (const a of reviewActions) {
    const g = byConcept.get(a.concept) || { reviews: 0, approvals: 0, rejections: 0 };
    g.reviews += 1;
    if (a.status === "completed" && !a.error) g.approvals += 1;
    else g.rejections += 1;
    byConcept.set(a.concept, g);
  }

  return {
    total_reviews,
    approval_rate: total_reviews > 0 ? approvals / total_reviews : 0,
    avg_review_cycles: total_reviews > 0 ? 1 + retries / total_reviews : 0,
    by_concept: Array.from(byConcept.entries()).map(([concept, d]) => ({ concept, ...d })),
  };
}

export function aggregateModelUsage(actions: ProvenanceAction[]): ModelUsage {
  const total = actions.length;
  const modelCounts = new Map<string, number>();
  const modelCosts = new Map<string, number>();

  for (const a of actions) {
    const model = a.model || "unknown";
    modelCounts.set(model, (modelCounts.get(model) || 0) + 1);
    modelCosts.set(model, (modelCosts.get(model) || 0) + (a.cost?.cost_usd || 0));
  }

  const totalCost = Array.from(modelCosts.values()).reduce((s, c) => s + c, 0);

  return {
    distribution: Array.from(modelCounts.entries())
      .map(([model, count]) => ({ model, count, percentage: total > 0 ? (count / total) * 100 : 0 }))
      .sort((a, b) => b.count - a.count),
    cost_distribution: Array.from(modelCosts.entries())
      .map(([model, cost]) => ({ model, cost, percentage: totalCost > 0 ? (cost / totalCost) * 100 : 0 }))
      .sort((a, b) => b.cost - a.cost),
  };
}

export function aggregateFailures(actions: ProvenanceAction[]): FailureMetrics {
  const failed = actions.filter((a) => a.status === "failed");
  const retried = actions.filter((a) => a.metadata?.retry === true);

  const byConcept = new Map<string, { failures: number; retries: number }>();
  for (const a of actions) {
    const g = byConcept.get(a.concept) || { failures: 0, retries: 0 };
    if (a.status === "failed") g.failures += 1;
    if (a.metadata?.retry === true) g.retries += 1;
    byConcept.set(a.concept, g);
  }

  const byErrorType = new Map<string, number>();
  for (const a of actions) {
    if (a.error?.type) byErrorType.set(a.error.type, (byErrorType.get(a.error.type) || 0) + 1);
  }

  return {
    total_failures: failed.length,
    failure_rate: actions.length > 0 ? failed.length / actions.length : 0,
    retry_count: retried.length,
    by_concept: Array.from(byConcept.entries())
      .map(([concept, d]) => ({ concept, ...d }))
      .filter((i) => i.failures > 0 || i.retries > 0)
      .sort((a, b) => b.failures - a.failures),
    by_error_type: Array.from(byErrorType.entries())
      .map(([error_type, count]) => ({ error_type, count }))
      .sort((a, b) => b.count - a.count),
  };
}

export function computeTrends(actions: ProvenanceAction[], windowSize: number): TrendData | undefined {
  if (!windowSize || windowSize <= 0) return undefined;

  const byStory = new Map<string, ProvenanceAction[]>();
  for (const a of actions) {
    const sid = a.flow_id || "untracked";
    const arr = byStory.get(sid) || [];
    arr.push(a);
    byStory.set(sid, arr);
  }

  const stories = Array.from(byStory.keys())
    .map((sid) => {
      const sa = byStory.get(sid)!;
      return { story_id: sid, timestamp: Math.min(...sa.map((a) => new Date(a.timestamp).getTime())) };
    })
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-windowSize);

  let cumulative = 0;
  const cost_trend = stories.map((s) => {
    const cost = (byStory.get(s.story_id) || []).reduce((sum, a) => sum + (a.cost?.cost_usd || 0), 0);
    cumulative += cost;
    return { story_id: s.story_id, cost, cumulative };
  });

  const duration_trend = stories.map((s) => {
    const dur = (byStory.get(s.story_id) || []).reduce((sum, a) => sum + (a.duration_ms || 0), 0);
    return { story_id: s.story_id, duration_ms: dur };
  });

  const failure_trend = stories.map((s) => {
    const sa = byStory.get(s.story_id) || [];
    const failures = sa.filter((a) => a.status === "failed").length;
    return { story_id: s.story_id, failure_rate: sa.length > 0 ? failures / sa.length : 0 };
  });

  return { window_size: stories.length, cost_trend, duration_trend, failure_trend };
}

export function computeBenchmarks(
  actions: ProvenanceAction[],
  options: { stories?: number } = {},
): BenchmarkMetrics {
  const uniqueStories = new Set(actions.map((a) => a.flow_id).filter(Boolean));

  const metrics: BenchmarkMetrics = {
    generated_at: new Date().toISOString(),
    action_count: actions.length,
    story_count: uniqueStories.size,
    cost: aggregateCosts(actions),
    duration: aggregateDurations(actions),
    quality: aggregateQuality(actions),
    model_usage: aggregateModelUsage(actions),
    failures: aggregateFailures(actions),
  };

  if (options.stories && options.stories > 0) {
    metrics.trends = computeTrends(actions, options.stories);
  }

  return metrics;
}
