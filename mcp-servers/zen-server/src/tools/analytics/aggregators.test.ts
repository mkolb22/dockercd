import { describe, it, expect } from "vitest";
import {
  mean,
  percentile,
  computeCostAnalytics,
  computeBenchmarks,
  aggregateCosts,
  aggregateDurations,
  aggregateQuality,
  aggregateModelUsage,
  aggregateFailures,
  computeTrends,
} from "./aggregators.js";
import type { ProvenanceAction } from "./types.js";

function makeAction(overrides: Partial<ProvenanceAction> = {}): ProvenanceAction {
  return {
    action_id: `act-${Math.random().toString(36).slice(2, 8)}`,
    concept: "implementation",
    action: "complete",
    status: "completed",
    timestamp: "2026-02-15T10:00:00Z",
    model: "sonnet",
    cost: { cost_usd: 0.01, input_tokens: 1000, output_tokens: 500 },
    duration_ms: 5000,
    ...overrides,
  };
}

describe("statistical helpers", () => {
  it("mean of empty array is 0", () => {
    expect(mean([])).toBe(0);
  });

  it("mean computes correctly", () => {
    expect(mean([2, 4, 6])).toBe(4);
  });

  it("percentile of single value returns that value", () => {
    expect(percentile([42], 50)).toBe(42);
  });

  it("percentile computes p50 correctly", () => {
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
  });

  it("percentile computes p90 with interpolation", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(values, 90)).toBeCloseTo(9.1, 1);
  });
});

describe("computeCostAnalytics", () => {
  it("returns zero totals for empty array", () => {
    const result = computeCostAnalytics([]);
    expect(result.total_cost).toBe(0);
    expect(result.total_actions).toBe(0);
    expect(result.by_concept).toHaveLength(0);
  });

  it("aggregates by concept", () => {
    const actions = [
      makeAction({ concept: "story", cost: { cost_usd: 0.05 } }),
      makeAction({ concept: "story", cost: { cost_usd: 0.03 } }),
      makeAction({ concept: "implementation", cost: { cost_usd: 0.10 } }),
    ];
    const result = computeCostAnalytics(actions);
    expect(result.total_cost).toBeCloseTo(0.18);
    expect(result.by_concept).toHaveLength(2);
    expect(result.by_concept[0].dimension).toBe("implementation");
    expect(result.by_concept[0].total_cost).toBeCloseTo(0.10);
  });

  it("aggregates by model", () => {
    const actions = [
      makeAction({ model: "opus", cost: { cost_usd: 0.20 } }),
      makeAction({ model: "haiku", cost: { cost_usd: 0.01 } }),
    ];
    const result = computeCostAnalytics(actions);
    expect(result.by_model).toHaveLength(2);
    expect(result.by_model[0].dimension).toBe("opus");
  });

  it("builds time series sorted by date", () => {
    const actions = [
      makeAction({ timestamp: "2026-02-15T10:00:00Z", cost: { cost_usd: 0.05 } }),
      makeAction({ timestamp: "2026-02-14T10:00:00Z", cost: { cost_usd: 0.03 } }),
      makeAction({ timestamp: "2026-02-15T14:00:00Z", cost: { cost_usd: 0.02 } }),
    ];
    const result = computeCostAnalytics(actions);
    expect(result.time_series).toHaveLength(2);
    expect(result.time_series[0].date).toBe("2026-02-14");
    expect(result.time_series[1].cost).toBeCloseTo(0.07);
  });
});

describe("aggregateCosts", () => {
  it("groups by concept, story, and model", () => {
    const actions = [
      makeAction({ concept: "story", flow_id: "flow-1", model: "opus" }),
      makeAction({ concept: "story", flow_id: "flow-1", model: "sonnet" }),
    ];
    const result = aggregateCosts(actions);
    expect(result.by_concept).toHaveLength(1);
    expect(result.by_story).toHaveLength(1);
    expect(result.by_model).toHaveLength(2);
  });
});

describe("aggregateDurations", () => {
  it("computes percentiles correctly", () => {
    const actions = Array.from({ length: 10 }, (_, i) =>
      makeAction({ concept: "implementation", duration_ms: (i + 1) * 1000 }),
    );
    const result = aggregateDurations(actions);
    expect(result.total_duration_ms).toBe(55000);
    expect(result.by_concept[0].p50_ms).toBeCloseTo(5500, -2);
  });
});

describe("aggregateQuality", () => {
  it("computes approval rate from quality/verification actions", () => {
    const actions = [
      makeAction({ concept: "quality", status: "completed", error: null }),
      makeAction({ concept: "quality", status: "completed", error: null }),
      makeAction({ concept: "quality", status: "failed", error: { type: "test_failure", message: "failed", recoverable: true } }),
      makeAction({ concept: "implementation" }), // not a review
    ];
    const result = aggregateQuality(actions);
    expect(result.total_reviews).toBe(3);
    expect(result.approval_rate).toBeCloseTo(2 / 3);
  });

  it("returns zero for no review actions", () => {
    const result = aggregateQuality([makeAction()]);
    expect(result.total_reviews).toBe(0);
    expect(result.approval_rate).toBe(0);
  });
});

describe("aggregateModelUsage", () => {
  it("computes distribution percentages", () => {
    const actions = [
      makeAction({ model: "sonnet" }),
      makeAction({ model: "sonnet" }),
      makeAction({ model: "opus" }),
    ];
    const result = aggregateModelUsage(actions);
    expect(result.distribution[0].model).toBe("sonnet");
    expect(result.distribution[0].percentage).toBeCloseTo(66.67, 0);
  });
});

describe("aggregateFailures", () => {
  it("computes failure rate and groups by error type", () => {
    const actions = [
      makeAction({ status: "completed" }),
      makeAction({ status: "failed", error: { type: "timeout", message: "timed out", recoverable: true } }),
      makeAction({ status: "failed", error: { type: "timeout", message: "timed out", recoverable: true } }),
    ];
    const result = aggregateFailures(actions);
    expect(result.total_failures).toBe(2);
    expect(result.failure_rate).toBeCloseTo(2 / 3);
    expect(result.by_error_type[0].error_type).toBe("timeout");
    expect(result.by_error_type[0].count).toBe(2);
  });
});

describe("computeTrends", () => {
  it("returns undefined for zero window", () => {
    expect(computeTrends([], 0)).toBeUndefined();
  });

  it("computes cumulative cost trends", () => {
    const actions = [
      makeAction({ flow_id: "flow-1", timestamp: "2026-02-14T10:00:00Z", cost: { cost_usd: 0.10 } }),
      makeAction({ flow_id: "flow-2", timestamp: "2026-02-15T10:00:00Z", cost: { cost_usd: 0.20 } }),
    ];
    const result = computeTrends(actions, 5);
    expect(result).toBeDefined();
    expect(result!.cost_trend).toHaveLength(2);
    expect(result!.cost_trend[1].cumulative).toBeCloseTo(0.30);
  });
});

describe("computeBenchmarks", () => {
  it("produces complete metrics", () => {
    const actions = [
      makeAction({ flow_id: "flow-1" }),
      makeAction({ flow_id: "flow-1" }),
      makeAction({ flow_id: "flow-2" }),
    ];
    const result = computeBenchmarks(actions);
    expect(result.action_count).toBe(3);
    expect(result.story_count).toBe(2);
    expect(result.cost).toBeDefined();
    expect(result.duration).toBeDefined();
    expect(result.quality).toBeDefined();
    expect(result.trends).toBeUndefined();
  });

  it("includes trends when stories option provided", () => {
    const actions = [
      makeAction({ flow_id: "flow-1" }),
      makeAction({ flow_id: "flow-2" }),
    ];
    const result = computeBenchmarks(actions, { stories: 5 });
    expect(result.trends).toBeDefined();
  });
});
