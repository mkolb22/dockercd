import { describe, it, expect } from 'vitest';
import {
  type BenchmarkTask,
  type CriterionScore,
  type ResourceUsage,
  STANDARD_RUBRICS,
} from '../schema.js';
import {
  cohensD,
  compareVariants,
  computePortfolioFitness,
  computeTaskFitness,
  lnGamma,
  regularizedBeta,
  tDistCDF,
  welchTTest,
} from '../evaluator.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const ZERO_USAGE: ResourceUsage = {
  inputTokens: 0,
  outputTokens: 0,
  durationMs: 0,
  estimatedCostUsd: 0,
};

function makeTask(criteriaWeights: [string, string, number][]): BenchmarkTask {
  return {
    id: 'test-task',
    name: 'Test',
    description: 'Test task',
    targetAgent: 'story-concept',
    category: 'feature',
    difficulty: 'simple',
    prompt: 'test',
    context: { projectDescription: 'test', files: [], constraints: [] },
    criteria: criteriaWeights.map(([id, dim, weight]) => ({
      id,
      dimension: dim as any,
      description: id,
      weight,
      rubric: STANDARD_RUBRICS[dim as keyof typeof STANDARD_RUBRICS],
    })),
    expectedElements: [],
    tags: [],
  };
}

function makeScores(pairs: [string, 0 | 1 | 2 | 3 | 4][]): CriterionScore[] {
  return pairs.map(([id, score]) => ({
    criterionId: id,
    score,
    rationale: `Score: ${score}`,
  }));
}

// ---------------------------------------------------------------------------
// Statistical primitives
// ---------------------------------------------------------------------------

describe('lnGamma', () => {
  it('lnGamma(1) = 0 (since Gamma(1) = 1)', () => {
    expect(Math.abs(lnGamma(1))).toBeLessThan(1e-10);
  });

  it('lnGamma(0.5) ≈ ln(sqrt(pi))', () => {
    const expected = 0.5 * Math.log(Math.PI); // ln(Gamma(0.5)) = ln(sqrt(pi))
    expect(Math.abs(lnGamma(0.5) - expected)).toBeLessThan(1e-10);
  });

  it('lnGamma(5) = ln(24)', () => {
    // Gamma(5) = 4! = 24
    expect(Math.abs(lnGamma(5) - Math.log(24))).toBeLessThan(1e-10);
  });

  it('lnGamma(10) = ln(362880)', () => {
    // Gamma(10) = 9! = 362880
    expect(Math.abs(lnGamma(10) - Math.log(362880))).toBeLessThan(1e-8);
  });
});

describe('regularizedBeta', () => {
  it('I_0(a,b) = 0', () => {
    expect(regularizedBeta(0, 2, 3)).toBe(0);
  });

  it('I_1(a,b) = 1', () => {
    expect(regularizedBeta(1, 2, 3)).toBe(1);
  });

  it('I_0.5(1,1) = 0.5 (uniform distribution)', () => {
    const result = regularizedBeta(0.5, 1, 1);
    expect(Math.abs(result - 0.5)).toBeLessThan(1e-10);
  });

  it('I_0.5(2,2) = 0.5 (symmetric beta)', () => {
    const result = regularizedBeta(0.5, 2, 2);
    expect(Math.abs(result - 0.5)).toBeLessThan(1e-10);
  });

  it('matches known value: I_0.3(2,5) ≈ 0.58', () => {
    // From standard tables: I_0.3(2,5) ≈ 0.5798
    const result = regularizedBeta(0.3, 2, 5);
    expect(Math.abs(result - 0.5798)).toBeLessThan(0.001);
  });
});

describe('tDistCDF', () => {
  it('t=0, any df → CDF = 0.5', () => {
    expect(Math.abs(tDistCDF(0, 10) - 0.5)).toBeLessThan(1e-10);
    expect(Math.abs(tDistCDF(0, 1) - 0.5)).toBeLessThan(1e-10);
  });

  it('large positive t → CDF ≈ 1', () => {
    expect(tDistCDF(100, 10)).toBeGreaterThan(0.999);
  });

  it('large negative t → CDF ≈ 0', () => {
    expect(tDistCDF(-100, 10)).toBeLessThan(0.001);
  });

  it('t=2.228, df=10 → CDF ≈ 0.975 (two-tailed alpha=0.05)', () => {
    // Critical value for df=10, alpha=0.05 two-tailed is ~2.228
    const cdf = tDistCDF(2.228, 10);
    expect(Math.abs(cdf - 0.975)).toBeLessThan(0.001);
  });

  it('symmetry: CDF(-t, df) = 1 - CDF(t, df)', () => {
    const cdfPos = tDistCDF(1.5, 15);
    const cdfNeg = tDistCDF(-1.5, 15);
    expect(Math.abs(cdfPos + cdfNeg - 1.0)).toBeLessThan(1e-10);
  });
});

// ---------------------------------------------------------------------------
// Welch's t-test
// ---------------------------------------------------------------------------

describe('welchTTest', () => {
  it('identical samples → t ≈ 0, p ≈ 1', () => {
    const samples = [0.5, 0.6, 0.7, 0.5, 0.6];
    const result = welchTTest(samples, [...samples]);
    expect(Math.abs(result.tStatistic)).toBeLessThan(1e-10);
    expect(result.pValue).toBeGreaterThan(0.99);
  });

  it('clearly different samples → significant', () => {
    const a = [0.9, 0.85, 0.88, 0.92, 0.87, 0.91, 0.89];
    const b = [0.3, 0.35, 0.28, 0.32, 0.30, 0.34, 0.29];
    const result = welchTTest(a, b);
    expect(result.tStatistic).toBeGreaterThan(0);
    expect(result.pValue).toBeLessThan(0.001);
  });

  it('positive t when A > B', () => {
    const a = [0.8, 0.9, 0.85];
    const b = [0.2, 0.3, 0.25];
    const result = welchTTest(a, b);
    expect(result.tStatistic).toBeGreaterThan(0);
  });

  it('negative t when A < B', () => {
    const a = [0.2, 0.3, 0.25];
    const b = [0.8, 0.9, 0.85];
    const result = welchTTest(a, b);
    expect(result.tStatistic).toBeLessThan(0);
  });

  it('throws with fewer than 2 samples', () => {
    expect(() => welchTTest([1], [2, 3])).toThrow('at least 2');
    expect(() => welchTTest([1, 2], [3])).toThrow('at least 2');
  });

  it('handles zero variance (all identical)', () => {
    const result = welchTTest([0.5, 0.5, 0.5], [0.5, 0.5, 0.5]);
    expect(result.tStatistic).toBe(0);
    expect(result.pValue).toBe(1);
  });
});

describe('cohensD', () => {
  it('identical samples → d = 0', () => {
    const samples = [0.5, 0.6, 0.7, 0.5, 0.6];
    expect(cohensD(samples, [...samples])).toBe(0);
  });

  it('large separation → large d', () => {
    const a = [0.9, 0.85, 0.88, 0.92, 0.87];
    const b = [0.1, 0.15, 0.12, 0.08, 0.13];
    const d = cohensD(a, b);
    expect(d).toBeGreaterThan(2); // Very large effect
  });

  it('positive d when A > B', () => {
    const d = cohensD([0.8, 0.9], [0.2, 0.3]);
    expect(d).toBeGreaterThan(0);
  });

  it('throws with fewer than 2 samples', () => {
    expect(() => cohensD([1], [2, 3])).toThrow('at least 2');
  });

  it('handles zero variance', () => {
    expect(cohensD([0.5, 0.5, 0.5], [0.5, 0.5, 0.5])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Task fitness computation
// ---------------------------------------------------------------------------

describe('computeTaskFitness', () => {
  it('perfect scores → fitness 1.0 for covered dimensions', () => {
    const task = makeTask([
      ['c1', 'correctness', 0.5],
      ['c2', 'completeness', 0.5],
    ]);
    const scores = makeScores([['c1', 4], ['c2', 4]]);
    const result = computeTaskFitness(task, scores, ZERO_USAGE, 'output', 'g1');

    // Both covered dimensions should be 1.0
    expect(result.dimensionScores.correctness).toBe(1.0);
    expect(result.dimensionScores.completeness).toBe(1.0);
    // Uncovered dimensions are 0
    expect(result.dimensionScores.quality).toBe(0);
  });

  it('zero scores → fitness 0', () => {
    const task = makeTask([
      ['c1', 'correctness', 0.5],
      ['c2', 'completeness', 0.5],
    ]);
    const scores = makeScores([['c1', 0], ['c2', 0]]);
    const result = computeTaskFitness(task, scores, ZERO_USAGE, '', 'g1');

    expect(result.fitness).toBe(0);
    expect(result.dimensionScores.correctness).toBe(0);
  });

  it('weighted scoring is correct', () => {
    const task = makeTask([
      ['c1', 'correctness', 0.7],
      ['c2', 'correctness', 0.3],
    ]);
    // Both criteria map to correctness with different weights
    // Score: c1=4 (weight 0.7), c2=2 (weight 0.3)
    const scores = makeScores([['c1', 4], ['c2', 2]]);
    const result = computeTaskFitness(task, scores, ZERO_USAGE, 'out', 'g1');

    // Dimension score = (4/4 * 0.7 + 2/4 * 0.3) / (0.7 + 0.3) = (0.7 + 0.15) = 0.85
    expect(Math.abs(result.dimensionScores.correctness - 0.85)).toBeLessThan(0.001);
  });

  it('multi-dimension scoring respects dimension weights', () => {
    const task = makeTask([
      ['c1', 'correctness', 0.5],  // weight 0.30 in dimension
      ['c2', 'quality', 0.5],      // weight 0.15 in dimension
    ]);
    const scores = makeScores([['c1', 4], ['c2', 4]]);
    const result = computeTaskFitness(task, scores, ZERO_USAGE, 'out', 'g1');

    // correctness = 1.0, quality = 1.0, others = 0
    // fitness = 1.0 * 0.30 + 1.0 * 0.15 = 0.45
    expect(Math.abs(result.fitness - 0.45)).toBeLessThan(0.001);
  });

  it('preserves metadata', () => {
    const task = makeTask([['c1', 'correctness', 1.0]]);
    const usage: ResourceUsage = {
      inputTokens: 500,
      outputTokens: 1000,
      durationMs: 2000,
      estimatedCostUsd: 0.05,
    };
    const result = computeTaskFitness(task, makeScores([['c1', 3]]), usage, 'my output', 'genome-42', 'llm-judge');

    expect(result.taskId).toBe('test-task');
    expect(result.genomeId).toBe('genome-42');
    expect(result.output).toBe('my output');
    expect(result.evaluator).toBe('llm-judge');
    expect(result.usage.inputTokens).toBe(500);
    expect(result.evaluatedAt).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Portfolio aggregation
// ---------------------------------------------------------------------------

describe('computePortfolioFitness', () => {
  it('empty results → fitness 0', () => {
    const result = computePortfolioFitness('g1', []);
    expect(result.fitness).toBe(0);
    expect(result.taskCount).toBe(0);
  });

  it('aggregates dimension means correctly', () => {
    const task = makeTask([['c1', 'correctness', 1.0]]);
    const r1 = computeTaskFitness(task, makeScores([['c1', 4]]), ZERO_USAGE, '', 'g1');
    const r2 = computeTaskFitness(task, makeScores([['c1', 2]]), ZERO_USAGE, '', 'g1');

    const portfolio = computePortfolioFitness('g1', [r1, r2]);

    // Mean correctness: (1.0 + 0.5) / 2 = 0.75
    expect(Math.abs(portfolio.dimensionMeans.correctness - 0.75)).toBeLessThan(0.001);
    expect(portfolio.taskCount).toBe(2);
  });

  it('computes standard deviations', () => {
    const task = makeTask([['c1', 'correctness', 1.0]]);
    const r1 = computeTaskFitness(task, makeScores([['c1', 4]]), ZERO_USAGE, '', 'g1');
    const r2 = computeTaskFitness(task, makeScores([['c1', 0]]), ZERO_USAGE, '', 'g1');

    const portfolio = computePortfolioFitness('g1', [r1, r2]);

    // StdDev of [1.0, 0.0] with sample stddev = sqrt(((1-0.5)^2 + (0-0.5)^2) / 1) = sqrt(0.5) ≈ 0.707
    expect(portfolio.dimensionStdDevs.correctness).toBeGreaterThan(0.5);
  });

  it('aggregates resource usage', () => {
    const task = makeTask([['c1', 'correctness', 1.0]]);
    const usage1: ResourceUsage = { inputTokens: 100, outputTokens: 200, durationMs: 500, estimatedCostUsd: 0.01 };
    const usage2: ResourceUsage = { inputTokens: 300, outputTokens: 400, durationMs: 1500, estimatedCostUsd: 0.03 };

    const r1 = computeTaskFitness(task, makeScores([['c1', 3]]), usage1, '', 'g1');
    const r2 = computeTaskFitness(task, makeScores([['c1', 3]]), usage2, '', 'g1');

    const portfolio = computePortfolioFitness('g1', [r1, r2]);

    expect(portfolio.totalUsage.inputTokens).toBe(400);
    expect(portfolio.totalUsage.outputTokens).toBe(600);
    expect(portfolio.totalUsage.durationMs).toBe(2000);
    expect(Math.abs(portfolio.totalUsage.estimatedCostUsd - 0.04)).toBeLessThan(0.001);
  });
});

// ---------------------------------------------------------------------------
// Variant comparison
// ---------------------------------------------------------------------------

describe('compareVariants', () => {
  it('significantly different portfolios produce significant result', () => {
    const task = makeTask([['c1', 'correctness', 1.0]]);

    const resultsA = [4, 4, 3, 4, 3].map(s =>
      computeTaskFitness(task, makeScores([['c1', s as 0 | 1 | 2 | 3 | 4]]), ZERO_USAGE, '', 'gA'),
    );
    const resultsB = [1, 0, 1, 1, 0].map(s =>
      computeTaskFitness(task, makeScores([['c1', s as 0 | 1 | 2 | 3 | 4]]), ZERO_USAGE, '', 'gB'),
    );

    const pA = computePortfolioFitness('gA', resultsA);
    const pB = computePortfolioFitness('gB', resultsB);

    const comparison = compareVariants(pA, pB);

    expect(comparison.significant).toBe(true);
    expect(comparison.tStatistic).toBeGreaterThan(0); // A > B
    expect(comparison.pValue).toBeLessThan(0.05);
    expect(comparison.effectSize).toBeGreaterThan(0.8); // Large effect
    expect(comparison.genomeA).toBe('gA');
    expect(comparison.genomeB).toBe('gB');
  });

  it('identical portfolios produce non-significant result', () => {
    const task = makeTask([['c1', 'correctness', 1.0]]);

    const results = [3, 3, 2, 3, 2].map(s =>
      computeTaskFitness(task, makeScores([['c1', s as 0 | 1 | 2 | 3 | 4]]), ZERO_USAGE, '', 'g1'),
    );

    const pA = computePortfolioFitness('gA', results);
    const pB = computePortfolioFitness('gB', results);

    const comparison = compareVariants(pA, pB);

    expect(comparison.significant).toBe(false);
    expect(comparison.pValue).toBeGreaterThan(0.05);
  });

  it('includes per-dimension comparisons', () => {
    const task = makeTask([
      ['c1', 'correctness', 0.5],
      ['c2', 'quality', 0.5],
    ]);

    const resultsA = [
      computeTaskFitness(task, makeScores([['c1', 4], ['c2', 1]]), ZERO_USAGE, '', 'gA'),
      computeTaskFitness(task, makeScores([['c1', 4], ['c2', 1]]), ZERO_USAGE, '', 'gA'),
      computeTaskFitness(task, makeScores([['c1', 4], ['c2', 1]]), ZERO_USAGE, '', 'gA'),
    ];
    const resultsB = [
      computeTaskFitness(task, makeScores([['c1', 1], ['c2', 4]]), ZERO_USAGE, '', 'gB'),
      computeTaskFitness(task, makeScores([['c1', 1], ['c2', 4]]), ZERO_USAGE, '', 'gB'),
      computeTaskFitness(task, makeScores([['c1', 1], ['c2', 4]]), ZERO_USAGE, '', 'gB'),
    ];

    const pA = computePortfolioFitness('gA', resultsA);
    const pB = computePortfolioFitness('gB', resultsB);

    const comparison = compareVariants(pA, pB);

    // A better on correctness, B better on quality
    expect(comparison.dimensionComparisons.correctness.delta).toBeGreaterThan(0);
    expect(comparison.dimensionComparisons.quality.delta).toBeLessThan(0);
  });
});
