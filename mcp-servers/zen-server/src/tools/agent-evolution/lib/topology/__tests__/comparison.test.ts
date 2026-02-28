import { describe, it, expect } from 'vitest';
import {
  compareMetric,
  analyzeExperiment,
  createControlTrials,
  createTreatmentTrials,
  formatReport,
  DEFAULT_EXPERIMENT_CONFIG,
} from '../comparison.js';
import type { TrialResult, ExperimentConfig } from '../comparison.js';
import { createMinimalDAG, createLinearDAG } from '../dag.js';
import { createComposite } from '../conductor.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateScores(mean: number, stddev: number, n: number, seed: number = 0): number[] {
  // Deterministic pseudo-normal distribution using Box-Muller with seeded values
  const scores: number[] = [];
  let s = seed;
  for (let i = 0; i < n; i++) {
    // Simple hash-based pseudo-random
    s = ((s * 1103515245 + 12345) >>> 0) % 2147483648;
    const u1 = (s / 2147483648) || 0.0001;
    s = ((s * 1103515245 + 12345) >>> 0) % 2147483648;
    const u2 = s / 2147483648;
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    scores.push(Math.max(0, Math.min(1, mean + stddev * z)));
  }
  return scores;
}

function makeTrials(
  condition: 'control' | 'treatment',
  complexity: 'trivial' | 'simple' | 'medium' | 'complex' | 'expert',
  fitnesses: number[],
  density: number = 0.3,
  nodeCount: number = 3,
): TrialResult[] {
  return fitnesses.map((f, i) => ({
    condition,
    complexity,
    fitness: f,
    density,
    nodeCount,
    trialId: `${condition}-${complexity}-${i}`,
  }));
}

// ---------------------------------------------------------------------------
// compareMetric
// ---------------------------------------------------------------------------

describe('compareMetric', () => {
  it('detects significant difference between clearly different groups', () => {
    const control = [0.3, 0.35, 0.32, 0.28, 0.31, 0.33, 0.29, 0.34, 0.30, 0.32];
    const treatment = [0.7, 0.72, 0.68, 0.71, 0.69, 0.73, 0.70, 0.67, 0.72, 0.71];

    const result = compareMetric(control, treatment, 'fitness');

    expect(result.significant).toBe(true);
    expect(result.effectSize).toBeGreaterThan(0); // treatment > control
    expect(result.tTest.p).toBeLessThan(0.001);
    expect(result.relativeImprovement).toBeGreaterThan(1.0); // > 100% improvement
    expect(result.metric).toBe('fitness');
    expect(result.control.n).toBe(10);
    expect(result.treatment.n).toBe(10);
  });

  it('detects no significant difference for similar groups', () => {
    const control = [0.50, 0.52, 0.48, 0.51, 0.49];
    const treatment = [0.51, 0.50, 0.49, 0.52, 0.50];

    const result = compareMetric(control, treatment, 'fitness');

    expect(result.significant).toBe(false);
    expect(Math.abs(result.effectSize)).toBeLessThan(0.5);
  });

  it('handles identical groups', () => {
    const values = [0.5, 0.5, 0.5, 0.5, 0.5];
    const result = compareMetric(values, values, 'fitness');

    expect(result.significant).toBe(false);
    expect(result.relativeImprovement).toBe(0);
  });

  it('handles small samples', () => {
    const control = [0.3, 0.4];
    const treatment = [0.7, 0.8];

    const result = compareMetric(control, treatment, 'fitness');

    // With n=2, should still compute but may not be significant
    expect(result.control.n).toBe(2);
    expect(result.treatment.n).toBe(2);
    expect(result.effectSize).toBeGreaterThan(0);
  });

  it('handles single-element samples gracefully', () => {
    const control = [0.5];
    const treatment = [0.7];

    const result = compareMetric(control, treatment, 'fitness');

    // welchTTest returns p=1 for n<2
    expect(result.tTest.p).toBe(1);
    expect(result.significant).toBe(false);
  });

  it('computes correct relative improvement', () => {
    const control = [0.4, 0.4, 0.4, 0.4, 0.4];
    const treatment = [0.5, 0.5, 0.5, 0.5, 0.5];

    const result = compareMetric(control, treatment, 'fitness');

    expect(result.relativeImprovement).toBeCloseTo(0.25, 2); // (0.5-0.4)/0.4 = 0.25
  });

  it('respects custom alpha level', () => {
    const control = [0.45, 0.48, 0.47, 0.46, 0.44];
    const treatment = [0.55, 0.52, 0.53, 0.54, 0.56];

    const strictResult = compareMetric(control, treatment, 'fitness', 0.001);
    const lenientResult = compareMetric(control, treatment, 'fitness', 0.1);

    // Same p-value, different thresholds
    expect(strictResult.tTest.p).toBe(lenientResult.tTest.p);
    // Lenient alpha is more likely to find significance
    if (strictResult.significant) {
      expect(lenientResult.significant).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// analyzeExperiment
// ---------------------------------------------------------------------------

describe('analyzeExperiment', () => {
  it('produces overall metrics and verdict', () => {
    const trials: TrialResult[] = [
      ...makeTrials('control', 'medium', [0.3, 0.32, 0.28, 0.31, 0.33]),
      ...makeTrials('treatment', 'medium', [0.7, 0.72, 0.68, 0.71, 0.69]),
    ];

    const result = analyzeExperiment(trials);

    expect(result.metrics.length).toBeGreaterThanOrEqual(3); // fitness, density, nodeCount
    expect(result.verdict).toBeDefined();

    const fitnessMetric = result.metrics.find((m) => m.metric === 'fitness');
    expect(fitnessMetric).toBeDefined();
    expect(fitnessMetric!.significant).toBe(true);
  });

  it('computes per-complexity breakdown', () => {
    const trials: TrialResult[] = [
      ...makeTrials('control', 'trivial', [0.3, 0.32, 0.28, 0.31, 0.33]),
      ...makeTrials('treatment', 'trivial', [0.5, 0.52, 0.48, 0.51, 0.49]),
      ...makeTrials('control', 'expert', [0.4, 0.42, 0.38, 0.41, 0.43]),
      ...makeTrials('treatment', 'expert', [0.8, 0.82, 0.78, 0.81, 0.79]),
    ];

    const result = analyzeExperiment(trials);

    expect(result.perComplexity.size).toBe(2);
    expect(result.perComplexity.has('trivial')).toBe(true);
    expect(result.perComplexity.has('expert')).toBe(true);
  });

  it('skips per-complexity when insufficient trials', () => {
    const trials: TrialResult[] = [
      ...makeTrials('control', 'trivial', [0.3, 0.32]),
      ...makeTrials('treatment', 'trivial', [0.5, 0.52]),
    ];

    const result = analyzeExperiment(trials);

    // Only 2 trials per condition, below minTrials=5
    expect(result.perComplexity.has('trivial')).toBe(false);
  });

  it('includes cost metric when available', () => {
    const trials: TrialResult[] = [
      ...makeTrials('control', 'medium', [0.3, 0.32, 0.28, 0.31, 0.33]).map((t, i) => ({
        ...t,
        cost: 0.05 + i * 0.01,
      })),
      ...makeTrials('treatment', 'medium', [0.7, 0.72, 0.68, 0.71, 0.69]).map((t, i) => ({
        ...t,
        cost: 0.02 + i * 0.005,
      })),
    ];

    const result = analyzeExperiment(trials);

    const costMetric = result.metrics.find((m) => m.metric === 'cost');
    expect(costMetric).toBeDefined();
  });

  it('verdict reports treatment wins on clear improvement', () => {
    const trials: TrialResult[] = [
      ...makeTrials('control', 'medium', [0.2, 0.22, 0.18, 0.21, 0.19, 0.20, 0.23, 0.17]),
      ...makeTrials('treatment', 'medium', [0.8, 0.82, 0.78, 0.81, 0.79, 0.80, 0.83, 0.77]),
    ];

    const result = analyzeExperiment(trials);

    expect(result.verdict.treatmentWins).toBe(true);
    expect(result.verdict.significantImprovements).toBeGreaterThan(0);
    expect(result.verdict.summary).toContain('outperform');
  });

  it('verdict reports no significant difference for similar groups', () => {
    const trials: TrialResult[] = [
      ...makeTrials('control', 'medium', [0.50, 0.51, 0.49, 0.50, 0.50]),
      ...makeTrials('treatment', 'medium', [0.50, 0.49, 0.51, 0.50, 0.50]),
    ];

    const result = analyzeExperiment(trials);

    expect(result.verdict.significantImprovements).toBe(0);
    expect(result.verdict.significantRegressions).toBe(0);
    expect(result.verdict.summary).toContain('No significant');
  });

  it('handles custom experiment config', () => {
    const config: ExperimentConfig = {
      alpha: 0.01,
      minTrials: 3,
      complexities: ['simple', 'medium'],
    };

    const trials: TrialResult[] = [
      ...makeTrials('control', 'simple', [0.3, 0.32, 0.28]),
      ...makeTrials('treatment', 'simple', [0.7, 0.72, 0.68]),
      ...makeTrials('control', 'medium', [0.3, 0.32, 0.28]),
      ...makeTrials('treatment', 'medium', [0.7, 0.72, 0.68]),
    ];

    const result = analyzeExperiment(trials, config);

    // With minTrials=3, per-complexity should work
    expect(result.perComplexity.size).toBe(2);
  });

  it('handles empty trials', () => {
    const result = analyzeExperiment([]);

    expect(result.metrics.length).toBeGreaterThanOrEqual(1);
    expect(result.verdict.treatmentWins).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createControlTrials / createTreatmentTrials
// ---------------------------------------------------------------------------

describe('createControlTrials', () => {
  it('creates trials with correct condition label', () => {
    const dag = createLinearDAG('d1', ['a', 'b', 'c']);
    const trials = createControlTrials(dag, [0.5, 0.6, 0.7], 'medium');

    expect(trials).toHaveLength(3);
    for (const t of trials) {
      expect(t.condition).toBe('control');
      expect(t.complexity).toBe('medium');
    }
  });

  it('computes density from the topology', () => {
    const dag = createLinearDAG('d1', ['a', 'b', 'c', 'd', 'e']);
    const trials = createControlTrials(dag, [0.5], 'complex');

    expect(trials[0].density).toBeGreaterThan(0);
    expect(trials[0].nodeCount).toBe(5);
  });

  it('includes cost when provided', () => {
    const dag = createMinimalDAG('d1', 'a', 'b');
    const trials = createControlTrials(dag, [0.5, 0.6], 'simple', [0.01, 0.02]);

    expect(trials[0].cost).toBe(0.01);
    expect(trials[1].cost).toBe(0.02);
  });
});

describe('createTreatmentTrials', () => {
  it('creates trials with correct condition label', () => {
    const composite = createComposite(createLinearDAG('d1', ['a', 'b', 'c']), 'medium');
    const trials = createTreatmentTrials(composite, [0.8, 0.85], 'medium');

    expect(trials).toHaveLength(2);
    for (const t of trials) {
      expect(t.condition).toBe('treatment');
    }
  });

  it('computes density from the composite topology', () => {
    const composite = createComposite(createLinearDAG('d1', ['a', 'b', 'c', 'd']), 'complex');
    const trials = createTreatmentTrials(composite, [0.7], 'complex');

    expect(trials[0].density).toBeGreaterThan(0);
    expect(trials[0].nodeCount).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// formatReport
// ---------------------------------------------------------------------------

describe('formatReport', () => {
  it('produces a valid markdown report', () => {
    const trials: TrialResult[] = [
      ...makeTrials('control', 'medium', [0.3, 0.32, 0.28, 0.31, 0.33]),
      ...makeTrials('treatment', 'medium', [0.7, 0.72, 0.68, 0.71, 0.69]),
    ];

    const result = analyzeExperiment(trials);
    const report = formatReport(result);

    expect(report).toContain('# Topology Comparison Report');
    expect(report).toContain('## Verdict');
    expect(report).toContain('## Overall Metrics');
    expect(report).toContain('fitness');
    expect(report).toContain('Cohen');
  });

  it('includes per-complexity section when data available', () => {
    const trials: TrialResult[] = [
      ...makeTrials('control', 'trivial', [0.3, 0.32, 0.28, 0.31, 0.33]),
      ...makeTrials('treatment', 'trivial', [0.7, 0.72, 0.68, 0.71, 0.69]),
    ];

    const result = analyzeExperiment(trials);
    const report = formatReport(result);

    expect(report).toContain('Per-Complexity');
    expect(report).toContain('trivial');
  });
});

// ---------------------------------------------------------------------------
// Integration: full pipeline
// ---------------------------------------------------------------------------

describe('integration', () => {
  it('complete experiment pipeline: create trials → analyze → report', () => {
    // Control: fixed 3-node linear topology
    const controlDag = createLinearDAG('control', ['a', 'b', 'c']);
    const controlScores = generateScores(0.4, 0.05, 10, 42);
    const controlTrials = createControlTrials(controlDag, controlScores, 'medium');

    // Treatment: evolved 5-node topology
    const treatmentDag = createLinearDAG('treatment', ['a', 'b', 'c', 'd', 'e']);
    const treatmentComposite = createComposite(treatmentDag, 'medium');
    const treatmentScores = generateScores(0.6, 0.05, 10, 99);
    const treatmentTrials = createTreatmentTrials(treatmentComposite, treatmentScores, 'medium');

    // Analyze
    const allTrials = [...controlTrials, ...treatmentTrials];
    const result = analyzeExperiment(allTrials);

    // Verify structure
    expect(result.metrics.length).toBeGreaterThanOrEqual(3);
    expect(result.verdict).toBeDefined();

    // Report
    const report = formatReport(result);
    expect(report.length).toBeGreaterThan(100);
    expect(report).toContain('fitness');
  });
});
