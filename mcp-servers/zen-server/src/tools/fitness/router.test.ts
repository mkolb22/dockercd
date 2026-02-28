import { describe, it, expect, vi, afterEach } from "vitest";
import { selectModel, getRecommendations } from "./router.js";
import type { PerformanceState, RoutingConfig } from "./types.js";

function emptyState(): PerformanceState {
  return { concept_actions: [] };
}

function stateWithData(): PerformanceState {
  return {
    concept_actions: [
      {
        concept: "implementation",
        action: "code",
        models: {
          haiku: { runs: 20, successes: 18, failures: 2, success_rate: 0.9, avg_cost: 0.0001, avg_duration_ms: 100, last_20_runs: [] },
          sonnet: { runs: 20, successes: 19, failures: 1, success_rate: 0.95, avg_cost: 0.0003, avg_duration_ms: 200, last_20_runs: [] },
          opus: { runs: 15, successes: 15, failures: 0, success_rate: 1.0, avg_cost: 0.015, avg_duration_ms: 500, last_20_runs: [] },
        },
      },
      {
        concept: "story",
        action: "create",
        models: {
          haiku: { runs: 30, successes: 28, failures: 2, success_rate: 0.933, avg_cost: 0.0001, avg_duration_ms: 50, last_20_runs: [] },
          sonnet: { runs: 10, successes: 10, failures: 0, success_rate: 1.0, avg_cost: 0.0003, avg_duration_ms: 150, last_20_runs: [] },
        },
      },
    ],
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("selectModel", () => {
  const noExplore: RoutingConfig = { epsilon: 0, success_threshold: 0.90 };

  it("falls back to highest tier when no performance data", () => {
    const decision = selectModel(emptyState(), "implementation", "code", noExplore);
    expect(decision.reason).toBe("fallback");
    expect(decision.model).toBe("opus");
  });

  it("exploits cheapest model meeting threshold for implementation.code", () => {
    const decision = selectModel(stateWithData(), "implementation", "code", noExplore);
    expect(decision.reason).toBe("exploit");
    // sonnet is min tier for implementation.code and has 0.95 >= 0.90
    expect(decision.model).toBe("sonnet");
  });

  it("explores randomly when epsilon triggers", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.01);
    const config: RoutingConfig = { epsilon: 0.05, success_threshold: 0.90 };
    const decision = selectModel(stateWithData(), "implementation", "code", config);
    expect(decision.reason).toBe("explore");
    expect(decision.confidence).toBe(0.5);
  });

  it("respects minimum tier constraint for architecture.design", () => {
    const state: PerformanceState = {
      concept_actions: [{
        concept: "architecture",
        action: "design",
        models: {
          haiku: { runs: 50, successes: 50, failures: 0, success_rate: 1.0, avg_cost: 0.0001, avg_duration_ms: 50, last_20_runs: [] },
          opus: { runs: 5, successes: 4, failures: 1, success_rate: 0.8, avg_cost: 0.015, avg_duration_ms: 500, last_20_runs: [] },
        },
      }],
    };
    const decision = selectModel(state, "architecture", "design", noExplore);
    // opus is minimum tier for architecture.design — haiku not eligible
    expect(decision.model).toBe("opus");
  });

  it("uses haiku as fallback minimum for unknown concept-actions", () => {
    const decision = selectModel(emptyState(), "unknown", "action", noExplore);
    // all models eligible, fallback to highest
    expect(decision.model).toBe("opus");
    expect(decision.reason).toBe("fallback");
  });

  it("selects best model when none meet threshold", () => {
    const state: PerformanceState = {
      concept_actions: [{
        concept: "quality",
        action: "review",
        models: {
          sonnet: { runs: 10, successes: 8, failures: 2, success_rate: 0.8, avg_cost: 0.0003, avg_duration_ms: 200, last_20_runs: [] },
          opus: { runs: 10, successes: 7, failures: 3, success_rate: 0.7, avg_cost: 0.015, avg_duration_ms: 500, last_20_runs: [] },
        },
      }],
    };
    const decision = selectModel(state, "quality", "review", noExplore);
    // neither meets 0.90, but sonnet has best rate among eligible (sonnet tier min for quality.review)
    expect(decision.model).toBe("sonnet");
    expect(decision.reason).toBe("exploit");
    expect(decision.confidence).toBe(0.8);
  });
});

describe("getRecommendations", () => {
  it("returns empty for empty state", () => {
    const recs = getRecommendations(emptyState());
    expect(recs).toHaveLength(0);
  });

  it("recommends downgrade when cheaper model meets threshold", () => {
    const state = stateWithData();
    const recs = getRecommendations(state, { epsilon: 0, success_threshold: 0.90 });
    // story.create: haiku has 0.933 >= 0.90 and is cheaper than sonnet
    const storyRec = recs.find((r) => r.concept === "story" && r.action === "create");
    expect(storyRec).toBeDefined();
    expect(storyRec!.recommended_model).toBe("haiku");
    expect(storyRec!.current_model).toBe("sonnet");
    expect(storyRec!.potential_savings_per_run).toBeGreaterThan(0);
  });

  it("does not recommend below minimum tier", () => {
    const state: PerformanceState = {
      concept_actions: [{
        concept: "architecture",
        action: "design",
        models: {
          haiku: { runs: 50, successes: 48, failures: 2, success_rate: 0.96, avg_cost: 0.0001, avg_duration_ms: 50, last_20_runs: [] },
          opus: { runs: 50, successes: 49, failures: 1, success_rate: 0.98, avg_cost: 0.015, avg_duration_ms: 500, last_20_runs: [] },
        },
      }],
    };
    const recs = getRecommendations(state, { epsilon: 0, success_threshold: 0.90 });
    // haiku is below min tier (opus) for architecture.design
    const archRec = recs.find((r) => r.concept === "architecture");
    expect(archRec).toBeUndefined();
  });

  it("sorts by potential savings descending", () => {
    const recs = getRecommendations(stateWithData(), { epsilon: 0, success_threshold: 0.90 });
    for (let i = 1; i < recs.length; i++) {
      expect(recs[i - 1].potential_savings_per_run).toBeGreaterThanOrEqual(recs[i].potential_savings_per_run);
    }
  });

  it("skips models with insufficient data", () => {
    const state: PerformanceState = {
      concept_actions: [{
        concept: "implementation",
        action: "code",
        models: {
          sonnet: { runs: 3, successes: 3, failures: 0, success_rate: 1.0, avg_cost: 0.0003, avg_duration_ms: 200, last_20_runs: [] },
          opus: { runs: 20, successes: 20, failures: 0, success_rate: 1.0, avg_cost: 0.015, avg_duration_ms: 500, last_20_runs: [] },
        },
      }],
    };
    const recs = getRecommendations(state, { epsilon: 0, success_threshold: 0.90 });
    // sonnet has only 3 runs (< 10 minimum), so no recommendation
    expect(recs).toHaveLength(0);
  });
});
