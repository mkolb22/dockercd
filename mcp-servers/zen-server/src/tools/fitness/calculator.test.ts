import { describe, it, expect } from "vitest";
import { computeFitness, rankVariants } from "./calculator.js";

function makeAction(overrides: Record<string, unknown> = {}) {
  return {
    status: "completed",
    error: null,
    timestamp: "2026-02-15T10:00:00Z",
    metadata: {},
    ...overrides,
  };
}

describe("computeFitness", () => {
  it("returns zero fitness for empty actions", () => {
    const score = computeFitness("v1", []);
    expect(score.runs).toBe(0);
    expect(score.fitness.current).toBe(0);
    expect(score.fitness.trend).toBe("stable");
  });

  it("computes perfect fitness for all completed actions", () => {
    const actions = Array.from({ length: 5 }, () => makeAction());
    const score = computeFitness("v1", actions);
    expect(score.fitness.current).toBe(1.0);
    expect(score.runs).toBe(5);
  });

  it("reduces fitness with failures", () => {
    const actions = [
      makeAction(),
      makeAction(),
      makeAction({ status: "failed" }),
    ];
    const score = computeFitness("v1", actions);
    expect(score.fitness.current).toBeLessThan(1.0);
    expect(score.fitness.current).toBeGreaterThan(0);
  });

  it("detects improving trend", () => {
    const actions = [
      ...Array.from({ length: 3 }, () => makeAction({ status: "failed", timestamp: "2026-02-01T10:00:00Z" })),
      ...Array.from({ length: 3 }, () => makeAction({ timestamp: "2026-02-15T10:00:00Z" })),
    ];
    const score = computeFitness("v1", actions);
    expect(score.fitness.trend).toBe("improving");
  });

  it("detects degrading trend", () => {
    const actions = [
      ...Array.from({ length: 3 }, () => makeAction({ timestamp: "2026-02-01T10:00:00Z" })),
      ...Array.from({ length: 3 }, () => makeAction({ status: "failed", timestamp: "2026-02-15T10:00:00Z" })),
    ];
    const score = computeFitness("v1", actions);
    expect(score.fitness.trend).toBe("degrading");
  });

  it("builds history at sample intervals", () => {
    const actions = Array.from({ length: 15 }, (_, i) =>
      makeAction({ timestamp: `2026-02-${String(i + 1).padStart(2, "0")}T10:00:00Z` }),
    );
    const score = computeFitness("v1", actions);
    expect(score.history.length).toBe(3); // samples at 5, 10, 15
  });

  it("uses quality_score from metadata when available", () => {
    const actions = [
      makeAction({ metadata: { quality_score: 0.5 } }),
      makeAction({ metadata: { quality_score: 0.8 } }),
    ];
    const score = computeFitness("v1", actions);
    // quality_score = mean(0.5, 0.8) = 0.65
    // test_pass_rate = 1.0, user_acceptance = 1.0
    // fitness = 0.4*1.0 + 0.3*0.65 + 0.3*1.0 = 0.895
    expect(score.fitness.current).toBeCloseTo(0.895, 2);
  });
});

describe("rankVariants", () => {
  it("sorts by fitness descending", () => {
    const variants = [
      computeFitness("v1", [makeAction({ status: "failed" })]),
      computeFitness("v2", [makeAction()]),
    ];
    const ranked = rankVariants(variants);
    expect(ranked[0].variant_id).toBe("v2");
  });
});
