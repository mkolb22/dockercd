/**
 * Pure functions for computing benchmark metrics from provenance actions.
 */

import type {
  ProvenanceAction,
  BenchmarkMetrics,
  CostMetrics,
  DurationMetrics,
  QualityMetrics,
  ModelUsage,
  FailureMetrics,
  TrendData,
} from './types.js';
import { mean, percentile } from './stats.js';

export function aggregateCosts(actions: ProvenanceAction[]): CostMetrics {
  const total_spend = actions.reduce((sum, action) => {
    return sum + (action.cost?.cost_usd || 0);
  }, 0);

  // Group by concept
  const byConcept = new Map<string, { total: number; count: number }>();
  for (const action of actions) {
    const concept = action.concept;
    const cost = action.cost?.cost_usd || 0;
    const existing = byConcept.get(concept) || { total: 0, count: 0 };
    byConcept.set(concept, {
      total: existing.total + cost,
      count: existing.count + 1,
    });
  }

  const by_concept = Array.from(byConcept.entries())
    .map(([concept, data]) => ({
      concept,
      total: data.total,
      avg: data.count > 0 ? data.total / data.count : 0,
      count: data.count,
    }))
    .sort((a, b) => b.total - a.total);

  // Group by story
  const byStory = new Map<string, { total: number; count: number }>();
  for (const action of actions) {
    const story_id = action.flow_id || 'untracked';
    const cost = action.cost?.cost_usd || 0;
    const existing = byStory.get(story_id) || { total: 0, count: 0 };
    byStory.set(story_id, {
      total: existing.total + cost,
      count: existing.count + 1,
    });
  }

  const by_story = Array.from(byStory.entries())
    .map(([story_id, data]) => ({
      story_id,
      total: data.total,
      count: data.count,
    }))
    .sort((a, b) => b.total - a.total);

  // Group by model
  const byModel = new Map<string, { total: number; count: number }>();
  for (const action of actions) {
    const model = action.model || 'unknown';
    const cost = action.cost?.cost_usd || 0;
    const existing = byModel.get(model) || { total: 0, count: 0 };
    byModel.set(model, {
      total: existing.total + cost,
      count: existing.count + 1,
    });
  }

  const by_model = Array.from(byModel.entries())
    .map(([model, data]) => ({
      model,
      total: data.total,
      avg: data.count > 0 ? data.total / data.count : 0,
      count: data.count,
    }))
    .sort((a, b) => b.total - a.total);

  return {
    total_spend,
    by_concept,
    by_story,
    by_model,
  };
}

export function aggregateDurations(actions: ProvenanceAction[]): DurationMetrics {
  const total_duration_ms = actions.reduce((sum, action) => {
    return sum + (action.duration_ms || 0);
  }, 0);

  // Group by concept
  const byConcept = new Map<string, number[]>();
  for (const action of actions) {
    const concept = action.concept;
    const duration = action.duration_ms || 0;
    const existing = byConcept.get(concept) || [];
    existing.push(duration);
    byConcept.set(concept, existing);
  }

  const by_concept = Array.from(byConcept.entries())
    .map(([concept, durations]) => ({
      concept,
      total_ms: durations.reduce((sum, d) => sum + d, 0),
      avg_ms: mean(durations),
      p50_ms: percentile(durations, 50),
      p90_ms: percentile(durations, 90),
      p99_ms: percentile(durations, 99),
      count: durations.length,
    }))
    .sort((a, b) => b.total_ms - a.total_ms);

  // Group by story
  const byStory = new Map<string, { total_ms: number; count: number }>();
  for (const action of actions) {
    const story_id = action.flow_id || 'untracked';
    const duration = action.duration_ms || 0;
    const existing = byStory.get(story_id) || { total_ms: 0, count: 0 };
    byStory.set(story_id, {
      total_ms: existing.total_ms + duration,
      count: existing.count + 1,
    });
  }

  const by_story = Array.from(byStory.entries())
    .map(([story_id, data]) => ({
      story_id,
      total_ms: data.total_ms,
      count: data.count,
    }))
    .sort((a, b) => b.total_ms - a.total_ms);

  return {
    total_duration_ms,
    by_concept,
    by_story,
  };
}

export function aggregateQuality(actions: ProvenanceAction[]): QualityMetrics {
  // Quality reviews are actions with concept='quality' or concept='verification'
  const reviewActions = actions.filter(
    a => a.concept === 'quality' || a.concept === 'verification'
  );

  const total_reviews = reviewActions.length;
  const approvals = reviewActions.filter(
    a => a.status === 'completed' && !a.error
  ).length;
  const approval_rate = total_reviews > 0 ? approvals / total_reviews : 0;

  // Calculate review cycles by counting retries
  const retries = reviewActions.filter(
    a => a.metadata?.retry === true
  ).length;
  const avg_review_cycles = total_reviews > 0 ? 1 + (retries / total_reviews) : 0;

  // Group by concept
  const byConcept = new Map<
    string,
    { reviews: number; approvals: number; rejections: number }
  >();
  for (const action of reviewActions) {
    const concept = action.concept;
    const existing = byConcept.get(concept) || {
      reviews: 0,
      approvals: 0,
      rejections: 0,
    };
    existing.reviews += 1;
    if (action.status === 'completed' && !action.error) {
      existing.approvals += 1;
    } else {
      existing.rejections += 1;
    }
    byConcept.set(concept, existing);
  }

  const by_concept = Array.from(byConcept.entries()).map(([concept, data]) => ({
    concept,
    ...data,
  }));

  return {
    total_reviews,
    approval_rate,
    avg_review_cycles,
    by_concept,
  };
}

export function aggregateModelUsage(actions: ProvenanceAction[]): ModelUsage {
  const total = actions.length;

  // Count by model
  const modelCounts = new Map<string, number>();
  const modelCosts = new Map<string, number>();

  for (const action of actions) {
    const model = action.model || 'unknown';
    modelCounts.set(model, (modelCounts.get(model) || 0) + 1);
    const cost = action.cost?.cost_usd || 0;
    modelCosts.set(model, (modelCosts.get(model) || 0) + cost);
  }

  const distribution = Array.from(modelCounts.entries())
    .map(([model, count]) => ({
      model,
      count,
      percentage: total > 0 ? (count / total) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count);

  const totalCost = Array.from(modelCosts.values()).reduce((sum, c) => sum + c, 0);
  const cost_distribution = Array.from(modelCosts.entries())
    .map(([model, cost]) => ({
      model,
      cost,
      percentage: totalCost > 0 ? (cost / totalCost) * 100 : 0,
    }))
    .sort((a, b) => b.cost - a.cost);

  return {
    distribution,
    cost_distribution,
  };
}

export function aggregateFailures(actions: ProvenanceAction[]): FailureMetrics {
  const total_failures = actions.filter(a => a.status === 'failed').length;
  const failure_rate = actions.length > 0 ? total_failures / actions.length : 0;
  const retry_count = actions.filter(a => a.metadata?.retry === true).length;

  // Group by concept
  const byConcept = new Map<string, { failures: number; retries: number }>();
  for (const action of actions) {
    const concept = action.concept;
    const existing = byConcept.get(concept) || { failures: 0, retries: 0 };
    if (action.status === 'failed') {
      existing.failures += 1;
    }
    if (action.metadata?.retry === true) {
      existing.retries += 1;
    }
    byConcept.set(concept, existing);
  }

  const by_concept = Array.from(byConcept.entries())
    .map(([concept, data]) => ({
      concept,
      ...data,
    }))
    .filter(item => item.failures > 0 || item.retries > 0)
    .sort((a, b) => b.failures - a.failures);

  // Group by error type
  const byErrorType = new Map<string, number>();
  for (const action of actions) {
    if (action.error?.type) {
      const errorType = action.error.type;
      byErrorType.set(errorType, (byErrorType.get(errorType) || 0) + 1);
    }
  }

  const by_error_type = Array.from(byErrorType.entries())
    .map(([error_type, count]) => ({
      error_type,
      count,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    total_failures,
    failure_rate,
    retry_count,
    by_concept,
    by_error_type,
  };
}

export function computeTrends(
  actions: ProvenanceAction[],
  windowSize: number
): TrendData | undefined {
  if (!windowSize || windowSize <= 0) {
    return undefined;
  }

  // Group actions by story (flow_id)
  const byStory = new Map<string, ProvenanceAction[]>();
  for (const action of actions) {
    const story_id = action.flow_id || 'untracked';
    const existing = byStory.get(story_id) || [];
    existing.push(action);
    byStory.set(story_id, existing);
  }

  // Get unique stories sorted by timestamp
  const stories = Array.from(byStory.keys())
    .map(story_id => {
      const storyActions = byStory.get(story_id) || [];
      const timestamps = storyActions.map(a => new Date(a.timestamp).getTime());
      return {
        story_id,
        timestamp: Math.min(...timestamps),
      };
    })
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-windowSize);

  // Compute trends
  let cumulative = 0;
  const cost_trend = stories.map(story => {
    const storyActions = byStory.get(story.story_id) || [];
    const cost = storyActions.reduce((sum, a) => sum + (a.cost?.cost_usd || 0), 0);
    cumulative += cost;
    return {
      story_id: story.story_id,
      cost,
      cumulative,
    };
  });

  const duration_trend = stories.map(story => {
    const storyActions = byStory.get(story.story_id) || [];
    const duration_ms = storyActions.reduce((sum, a) => sum + (a.duration_ms || 0), 0);
    return {
      story_id: story.story_id,
      duration_ms,
    };
  });

  const failure_trend = stories.map(story => {
    const storyActions = byStory.get(story.story_id) || [];
    const failures = storyActions.filter(a => a.status === 'failed').length;
    const failure_rate = storyActions.length > 0 ? failures / storyActions.length : 0;
    return {
      story_id: story.story_id,
      failure_rate,
    };
  });

  return {
    window_size: stories.length,
    cost_trend,
    duration_trend,
    failure_trend,
  };
}

export function computeBenchmarks(
  actions: ProvenanceAction[],
  options: { stories?: number } = {}
): BenchmarkMetrics {
  const uniqueStories = new Set(actions.map(a => a.flow_id).filter(Boolean));

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
