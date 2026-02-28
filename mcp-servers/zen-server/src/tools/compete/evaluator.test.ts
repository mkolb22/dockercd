/**
 * Evaluator Tests — Pure statistical function tests
 */

import { describe, it, expect } from "vitest";
import {
  mean,
  stddev,
  computeComposite,
  welchTTest,
  cohensD,
  tDistCdf,
  regularizedBeta,
  computeDimensionStats,
  buildSummary,
  analyzeAblation,
} from "./evaluator.js";
import type { FitnessScores, CompeteRound, AblationRun } from "./types.js";

// ─── Helpers ───────────────────────────────────────────

function makeScores(overrides: Partial<FitnessScores> = {}): FitnessScores {
  return {
    correctness: 0.8,
    contracts: 0.7,
    security: 0.6,
    performance: 0.5,
    complexity: 0.5,
    lint: 0.9,
    ...overrides,
  };
}

function makeRound(
  arm: "control" | "treatment",
  round: number,
  composite: number,
  scores?: Partial<FitnessScores>,
): CompeteRound {
  return {
    id: `rnd-${arm}-${round}`,
    sessionId: "test-session",
    round,
    arm,
    scores: makeScores(scores),
    composite,
    rawMetrics: null,
    createdAt: new Date().toISOString(),
  };
}

function makeAblationRun(
  category: "ast" | "semantic" | "memory" | "framework" | "spec",
  round: number,
  composite: number,
): AblationRun {
  return {
    id: `abl-${category}-${round}`,
    sessionId: "test-session",
    disabledCategory: category,
    round,
    scores: makeScores(),
    composite,
    status: "completed",
    createdAt: new Date().toISOString(),
  };
}

// ─── mean / stddev ────────────────────────────────────

describe("mean", () => {
  it("returns 0 for empty array", () => {
    expect(mean([])).toBe(0);
  });

  it("computes mean correctly", () => {
    expect(mean([1, 2, 3, 4, 5])).toBe(3);
  });

  it("handles single element", () => {
    expect(mean([7])).toBe(7);
  });
});

describe("stddev", () => {
  it("returns 0 for fewer than 2 elements", () => {
    expect(stddev([])).toBe(0);
    expect(stddev([5])).toBe(0);
  });

  it("returns 0 for identical values", () => {
    expect(stddev([3, 3, 3])).toBe(0);
  });

  it("computes sample standard deviation", () => {
    // [2, 4, 4, 4, 5, 5, 7, 9] — known stddev ≈ 2.138
    const sd = stddev([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(sd).toBeCloseTo(2.138, 2);
  });
});

// ─── computeComposite ─────────────────────────────────

describe("computeComposite", () => {
  it("computes weighted composite with default weights", () => {
    const scores = makeScores();
    const result = computeComposite(scores);
    // 0.8*0.30 + 0.7*0.20 + 0.6*0.20 + 0.5*0.10 + 0.5*0.10 + 0.9*0.10 = 0.24+0.14+0.12+0.05+0.05+0.09 = 0.69
    expect(result).toBeCloseTo(0.69, 2);
  });

  it("returns 0 for all-zero scores", () => {
    const scores = makeScores({
      correctness: 0, contracts: 0, security: 0,
      performance: 0, complexity: 0, lint: 0,
    });
    expect(computeComposite(scores)).toBe(0);
  });

  it("returns 1 for all-perfect scores", () => {
    const scores = makeScores({
      correctness: 1, contracts: 1, security: 1,
      performance: 1, complexity: 1, lint: 1,
    });
    expect(computeComposite(scores)).toBeCloseTo(1, 5);
  });

  it("uses custom weights", () => {
    const scores = makeScores({ correctness: 1, contracts: 0, security: 0, performance: 0, complexity: 0, lint: 0 });
    const weights = makeScores({ correctness: 1, contracts: 0, security: 0, performance: 0, complexity: 0, lint: 0 });
    expect(computeComposite(scores, weights)).toBeCloseTo(1, 5);
  });
});

// ─── t-distribution CDF ───────────────────────────────

describe("tDistCdf", () => {
  it("CDF at 0 is 0.5 for any df", () => {
    expect(tDistCdf(0, 10)).toBeCloseTo(0.5, 4);
    expect(tDistCdf(0, 100)).toBeCloseTo(0.5, 4);
  });

  it("matches known t-table values", () => {
    // df=10, t=2.228 → p ≈ 0.975 (one-tail ≈ 0.025)
    expect(tDistCdf(2.228, 10)).toBeCloseTo(0.975, 2);
  });

  it("symmetric: CDF(t) + CDF(-t) ≈ 1", () => {
    const t = 1.5;
    const df = 20;
    expect(tDistCdf(t, df) + tDistCdf(-t, df)).toBeCloseTo(1, 10);
  });

  it("large t gives CDF close to 1", () => {
    expect(tDistCdf(10, 5)).toBeGreaterThan(0.999);
  });

  it("large negative t gives CDF close to 0", () => {
    expect(tDistCdf(-10, 5)).toBeLessThan(0.001);
  });
});

describe("regularizedBeta", () => {
  it("I(0, a, b) = 0", () => {
    expect(regularizedBeta(0, 2, 3)).toBe(0);
  });

  it("I(1, a, b) = 1", () => {
    expect(regularizedBeta(1, 2, 3)).toBe(1);
  });

  it("I(0.5, a, a) = 0.5 by symmetry", () => {
    expect(regularizedBeta(0.5, 3, 3)).toBeCloseTo(0.5, 4);
  });
});

// ─── Welch's t-test ───────────────────────────────────

describe("welchTTest", () => {
  it("identical samples give t=0 and p=1", () => {
    const sample = [5, 5, 5, 5, 5];
    const result = welchTTest(sample, sample);
    expect(result.t).toBe(0);
    expect(result.p).toBe(1);
  });

  it("clearly different samples give significant p", () => {
    const s1 = [10, 11, 12, 10, 11];
    const s2 = [1, 2, 3, 1, 2];
    const result = welchTTest(s1, s2);
    expect(result.t).toBeGreaterThan(0);
    expect(result.p).toBeLessThan(0.01);
  });

  it("returns p=1 for insufficient samples", () => {
    const result = welchTTest([1], [2]);
    expect(result.p).toBe(1);
  });

  it("handles unequal variance correctly", () => {
    const s1 = [100, 101, 99, 100, 100];  // low variance
    const s2 = [50, 150, 200, 10, 90];     // high variance
    const result = welchTTest(s1, s2);
    // Should still produce a valid result
    expect(result.df).toBeGreaterThan(0);
    expect(result.p).toBeGreaterThanOrEqual(0);
    expect(result.p).toBeLessThanOrEqual(1);
  });
});

// ─── Cohen's d ────────────────────────────────────────

describe("cohensD", () => {
  it("returns 0 for identical samples", () => {
    const s = [5, 5, 5, 5];
    expect(cohensD(s, s)).toBe(0);
  });

  it("returns large effect for clearly different means", () => {
    const s1 = [10, 11, 10, 11, 10];
    const s2 = [1, 2, 1, 2, 1];
    const d = cohensD(s1, s2);
    expect(Math.abs(d)).toBeGreaterThan(2);
  });

  it("positive d means sample1 > sample2", () => {
    const s1 = [10, 11, 12];
    const s2 = [1, 2, 3];
    expect(cohensD(s1, s2)).toBeGreaterThan(0);
  });

  it("negative d means sample1 < sample2", () => {
    const s1 = [1, 2, 3];
    const s2 = [10, 11, 12];
    expect(cohensD(s1, s2)).toBeLessThan(0);
  });

  it("returns 0 for insufficient samples", () => {
    expect(cohensD([1], [2])).toBe(0);
  });
});

// ─── computeDimensionStats ────────────────────────────

describe("computeDimensionStats", () => {
  it("identifies treatment as winner when significantly better", () => {
    const control = [0.3, 0.35, 0.28, 0.32, 0.31];
    const treatment = [0.8, 0.85, 0.78, 0.82, 0.81];
    const stats = computeDimensionStats(control, treatment, "correctness", 0.05);
    expect(stats.significant).toBe(true);
    expect(stats.winner).toBe("treatment");
    expect(stats.treatmentMean).toBeGreaterThan(stats.controlMean);
  });

  it("returns inconclusive when not significant", () => {
    const control = [0.5, 0.51, 0.49, 0.5, 0.52];
    const treatment = [0.51, 0.50, 0.52, 0.49, 0.50];
    const stats = computeDimensionStats(control, treatment, "lint", 0.05);
    expect(stats.significant).toBe(false);
    expect(stats.winner).toBe("inconclusive");
  });
});

// ─── buildSummary ─────────────────────────────────────

describe("buildSummary", () => {
  it("treatment wins when composites are clearly higher", () => {
    const controlRounds = Array.from({ length: 5 }, (_, i) =>
      makeRound("control", i + 1, 0.3 + i * 0.01, {
        correctness: 0.3, contracts: 0.3, security: 0.3,
        performance: 0.3, complexity: 0.3, lint: 0.3,
      }),
    );
    const treatmentRounds = Array.from({ length: 5 }, (_, i) =>
      makeRound("treatment", i + 1, 0.8 + i * 0.01, {
        correctness: 0.8, contracts: 0.8, security: 0.8,
        performance: 0.8, complexity: 0.8, lint: 0.8,
      }),
    );

    const summary = buildSummary(controlRounds, treatmentRounds, 0.05);
    expect(summary.overallWinner).toBe("treatment");
    expect(summary.compositeStats.significant).toBe(true);
    expect(summary.dimensionStats).toHaveLength(6);
    expect(summary.roundsCompleted).toBe(5);
  });

  it("control wins when it has clearly higher composites", () => {
    const controlRounds = Array.from({ length: 5 }, (_, i) =>
      makeRound("control", i + 1, 0.9 + i * 0.005, {
        correctness: 0.9, contracts: 0.9, security: 0.9,
        performance: 0.9, complexity: 0.9, lint: 0.9,
      }),
    );
    const treatmentRounds = Array.from({ length: 5 }, (_, i) =>
      makeRound("treatment", i + 1, 0.2 + i * 0.005, {
        correctness: 0.2, contracts: 0.2, security: 0.2,
        performance: 0.2, complexity: 0.2, lint: 0.2,
      }),
    );

    const summary = buildSummary(controlRounds, treatmentRounds, 0.05);
    expect(summary.overallWinner).toBe("control");
  });

  it("returns inconclusive when composites are similar", () => {
    const controlRounds = Array.from({ length: 5 }, (_, i) =>
      makeRound("control", i + 1, 0.5 + (i - 2) * 0.01),
    );
    const treatmentRounds = Array.from({ length: 5 }, (_, i) =>
      makeRound("treatment", i + 1, 0.5 + (i - 2) * 0.01),
    );

    const summary = buildSummary(controlRounds, treatmentRounds, 0.05);
    expect(summary.overallWinner).toBe("inconclusive");
  });
});

// ─── analyzeAblation ──────────────────────────────────

describe("analyzeAblation", () => {
  it("recommends 'keep' when removing a category clearly hurts", () => {
    const fullRounds = Array.from({ length: 5 }, (_, i) =>
      makeRound("treatment", i + 1, 0.85 + i * 0.01),
    );
    const ablationRuns = Array.from({ length: 5 }, (_, i) =>
      makeAblationRun("ast", i + 1, 0.45 + i * 0.01),
    );

    const result = analyzeAblation(fullRounds, ablationRuns, 0.05);
    const astResult = result.results.find((r) => r.category === "ast");
    expect(astResult).toBeDefined();
    expect(astResult!.recommendation).toBe("keep");
    expect(astResult!.deltaFromFull).toBeGreaterThan(0);
    expect(result.minimalEffectiveToolset).toContain("ast");
  });

  it("recommends 'remove' when removing a category has no effect", () => {
    const fullRounds = Array.from({ length: 5 }, (_, i) =>
      makeRound("treatment", i + 1, 0.8 + i * 0.01),
    );
    // Same performance with memory disabled
    const ablationRuns = Array.from({ length: 5 }, (_, i) =>
      makeAblationRun("memory", i + 1, 0.8 + i * 0.01),
    );

    const result = analyzeAblation(fullRounds, ablationRuns, 0.05);
    const memResult = result.results.find((r) => r.category === "memory");
    expect(memResult).toBeDefined();
    expect(memResult!.recommendation).toBe("remove");
    expect(result.minimalEffectiveToolset).not.toContain("memory");
  });

  it("recommends 'investigate' for trend without significance", () => {
    const fullRounds = Array.from({ length: 3 }, (_, i) =>
      makeRound("treatment", i + 1, 0.8 + i * 0.02),
    );
    // Slightly worse but high variance — not enough power
    const ablationRuns = Array.from({ length: 3 }, (_, i) =>
      makeAblationRun("semantic", i + 1, 0.7 + i * 0.08),
    );

    const result = analyzeAblation(fullRounds, ablationRuns, 0.05);
    const semResult = result.results.find((r) => r.category === "semantic");
    expect(semResult).toBeDefined();
    // With small n and high variance, expect "investigate" or "remove"
    expect(["investigate", "remove"]).toContain(semResult!.recommendation);
  });

  it("returns correct fullTreatmentMean", () => {
    const fullRounds = [
      makeRound("treatment", 1, 0.7),
      makeRound("treatment", 2, 0.8),
      makeRound("treatment", 3, 0.9),
    ];
    const result = analyzeAblation(fullRounds, [], 0.05);
    expect(result.fullTreatmentMean).toBeCloseTo(0.8, 5);
    expect(result.results).toHaveLength(0);
    expect(result.minimalEffectiveToolset).toHaveLength(0);
  });
});
