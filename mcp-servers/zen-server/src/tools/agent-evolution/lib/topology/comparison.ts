/**
 * Statistical comparison for topology experiments.
 *
 * Compares control (fixed-linear topology) vs treatment (evolved-adaptive topology)
 * using Welch's t-test and Cohen's d from the compete module.
 *
 * This module provides:
 * 1. Experiment design: define control and treatment conditions
 * 2. Trial execution: run evaluations and collect scores
 * 3. Statistical analysis: significance testing and effect size
 * 4. Result formatting: human-readable comparison reports
 *
 * Design reference:
 * - AgentConductor (Wang et al., 2026): +14.6% accuracy, -68% tokens
 * - compete module: Welch's t-test, Cohen's d implementations
 * - AGENT-EVOLUTION-RESEARCH.md Phase 2, Step 4
 *
 * Constraints:
 * - Pure functions (no I/O)
 * - Reuses compete module statistical functions
 * - All types serializable (JSON round-trip safe)
 */

import type { WorkflowDAG, TaskComplexity, CompositeGenome } from './types.js';
import { computeDensity } from './dag.js';
import { welchTTest, cohensD, mean, stddev } from '../../../compete/evaluator.js';
import type { TTestResult } from '../../../compete/evaluator.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Experiment condition: either control (fixed) or treatment (evolved). */
export type ConditionLabel = 'control' | 'treatment';

/** A single trial result: one evaluation of one topology on one task. */
export interface TrialResult {
  /** Which condition (control or treatment). */
  readonly condition: ConditionLabel;

  /** Task complexity level for this trial. */
  readonly complexity: TaskComplexity;

  /** Fitness score achieved (0-1). */
  readonly fitness: number;

  /** Composite density of the topology used. */
  readonly density: number;

  /** Number of nodes in the topology. */
  readonly nodeCount: number;

  /** Optional cost metric (e.g., token usage). */
  readonly cost?: number;

  /** Trial identifier. */
  readonly trialId: string;
}

/** Comparison result for one metric across control vs treatment. */
export interface MetricComparison {
  /** Metric name (e.g., 'fitness', 'cost', 'density'). */
  readonly metric: string;

  /** Control group statistics. */
  readonly control: {
    readonly mean: number;
    readonly stddev: number;
    readonly n: number;
  };

  /** Treatment group statistics. */
  readonly treatment: {
    readonly mean: number;
    readonly stddev: number;
    readonly n: number;
  };

  /** Welch's t-test result. */
  readonly tTest: TTestResult;

  /** Cohen's d effect size (positive = treatment > control). */
  readonly effectSize: number;

  /** Relative improvement: (treatment_mean - control_mean) / control_mean. */
  readonly relativeImprovement: number;

  /** Whether the difference is statistically significant at the given alpha. */
  readonly significant: boolean;
}

/** Experiment configuration. */
export interface ExperimentConfig {
  /** Significance level (default 0.05). */
  readonly alpha: number;

  /** Minimum trials per condition for valid comparison (default 5). */
  readonly minTrials: number;

  /** Task complexities to test (default: all five levels). */
  readonly complexities: readonly TaskComplexity[];
}

/** Complete experiment result. */
export interface ExperimentResult {
  /** Per-metric comparisons (fitness, cost, density). */
  readonly metrics: readonly MetricComparison[];

  /** Per-complexity breakdown. */
  readonly perComplexity: ReadonlyMap<TaskComplexity, readonly MetricComparison[]>;

  /** Overall verdict. */
  readonly verdict: ExperimentVerdict;
}

/** Summary verdict of the experiment. */
export interface ExperimentVerdict {
  /** Whether evolved topologies significantly outperform fixed. */
  readonly treatmentWins: boolean;

  /** Number of metrics where treatment significantly outperforms control. */
  readonly significantImprovements: number;

  /** Number of metrics where control significantly outperforms treatment. */
  readonly significantRegressions: number;

  /** Human-readable summary. */
  readonly summary: string;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_EXPERIMENT_CONFIG: ExperimentConfig = {
  alpha: 0.05,
  minTrials: 5,
  complexities: ['trivial', 'simple', 'medium', 'complex', 'expert'],
};

// ---------------------------------------------------------------------------
// Comparison functions
// ---------------------------------------------------------------------------

/**
 * Compares a single metric across control and treatment groups.
 *
 * @param controlValues - Metric values from control condition
 * @param treatmentValues - Metric values from treatment condition
 * @param metric - Name of the metric being compared
 * @param alpha - Significance level
 * @returns MetricComparison with statistical tests
 */
export function compareMetric(
  controlValues: readonly number[],
  treatmentValues: readonly number[],
  metric: string,
  alpha: number = 0.05,
): MetricComparison {
  const cArr = controlValues as number[];
  const tArr = treatmentValues as number[];

  const cMean = mean(cArr);
  const tMean = mean(tArr);
  const cStd = stddev(cArr);
  const tStd = stddev(tArr);

  const tTest = welchTTest(tArr, cArr);
  const d = cohensD(tArr, cArr);

  const relativeImprovement = cMean !== 0 ? (tMean - cMean) / Math.abs(cMean) : 0;

  return {
    metric,
    control: { mean: cMean, stddev: cStd, n: cArr.length },
    treatment: { mean: tMean, stddev: tStd, n: tArr.length },
    tTest,
    effectSize: d,
    relativeImprovement,
    significant: tTest.p < alpha,
  };
}

/**
 * Runs a complete statistical comparison experiment.
 *
 * Collects trials into control/treatment groups, computes
 * per-metric and per-complexity comparisons, and generates
 * a verdict.
 *
 * @param trials - All trial results from both conditions
 * @param config - Experiment configuration
 * @returns Complete experiment result
 */
export function analyzeExperiment(
  trials: readonly TrialResult[],
  config: ExperimentConfig = DEFAULT_EXPERIMENT_CONFIG,
): ExperimentResult {
  const controlTrials = trials.filter((t) => t.condition === 'control');
  const treatmentTrials = trials.filter((t) => t.condition === 'treatment');

  // Overall metric comparisons
  const metrics: MetricComparison[] = [];

  // Fitness comparison
  metrics.push(compareMetric(
    controlTrials.map((t) => t.fitness),
    treatmentTrials.map((t) => t.fitness),
    'fitness',
    config.alpha,
  ));

  // Density comparison
  metrics.push(compareMetric(
    controlTrials.map((t) => t.density),
    treatmentTrials.map((t) => t.density),
    'density',
    config.alpha,
  ));

  // Node count comparison
  metrics.push(compareMetric(
    controlTrials.map((t) => t.nodeCount),
    treatmentTrials.map((t) => t.nodeCount),
    'nodeCount',
    config.alpha,
  ));

  // Cost comparison (if available)
  const controlCosts = controlTrials.filter((t) => t.cost !== undefined).map((t) => t.cost!);
  const treatmentCosts = treatmentTrials.filter((t) => t.cost !== undefined).map((t) => t.cost!);
  if (controlCosts.length >= config.minTrials && treatmentCosts.length >= config.minTrials) {
    metrics.push(compareMetric(controlCosts, treatmentCosts, 'cost', config.alpha));
  }

  // Per-complexity breakdown
  const perComplexity = new Map<TaskComplexity, MetricComparison[]>();

  for (const complexity of config.complexities) {
    const cTrials = controlTrials.filter((t) => t.complexity === complexity);
    const tTrials = treatmentTrials.filter((t) => t.complexity === complexity);

    if (cTrials.length < config.minTrials || tTrials.length < config.minTrials) {
      continue;
    }

    const complexityMetrics: MetricComparison[] = [];

    complexityMetrics.push(compareMetric(
      cTrials.map((t) => t.fitness),
      tTrials.map((t) => t.fitness),
      'fitness',
      config.alpha,
    ));

    complexityMetrics.push(compareMetric(
      cTrials.map((t) => t.density),
      tTrials.map((t) => t.density),
      'density',
      config.alpha,
    ));

    perComplexity.set(complexity, complexityMetrics);
  }

  // Verdict
  const verdict = computeVerdict(metrics, config.alpha);

  return { metrics, perComplexity, verdict };
}

// ---------------------------------------------------------------------------
// Verdict computation
// ---------------------------------------------------------------------------

function computeVerdict(metrics: readonly MetricComparison[], alpha: number): ExperimentVerdict {
  let significantImprovements = 0;
  let significantRegressions = 0;

  for (const m of metrics) {
    if (!m.significant) continue;

    // For fitness: higher is better (positive d = treatment wins)
    // For cost: lower is better (negative d = treatment wins)
    const treatmentBetter = m.metric === 'cost'
      ? m.effectSize < 0
      : m.effectSize > 0;

    if (treatmentBetter) {
      significantImprovements++;
    } else {
      significantRegressions++;
    }
  }

  const treatmentWins = significantImprovements > significantRegressions;

  const fitnessMetric = metrics.find((m) => m.metric === 'fitness');
  const fitnessImprovement = fitnessMetric
    ? `${(fitnessMetric.relativeImprovement * 100).toFixed(1)}%`
    : 'N/A';

  let summary: string;
  if (significantImprovements === 0 && significantRegressions === 0) {
    summary = `No significant differences detected (p > ${alpha}).`;
  } else if (treatmentWins) {
    summary = `Evolved topologies significantly outperform fixed topologies ` +
      `(${significantImprovements} improvements, fitness ${fitnessImprovement}).`;
  } else {
    summary = `Fixed topologies perform comparably or better than evolved ` +
      `(${significantRegressions} regressions, ${significantImprovements} improvements).`;
  }

  return { treatmentWins, significantImprovements, significantRegressions, summary };
}

// ---------------------------------------------------------------------------
// Trial generation helpers
// ---------------------------------------------------------------------------

/**
 * Creates trial results from evaluating a fixed (control) topology
 * against a set of tasks.
 *
 * @param topology - The fixed topology to evaluate
 * @param scores - Fitness scores per trial
 * @param complexity - Task complexity level
 * @param costs - Optional cost per trial
 * @returns Array of TrialResult for the control condition
 */
export function createControlTrials(
  topology: WorkflowDAG,
  scores: readonly number[],
  complexity: TaskComplexity,
  costs?: readonly number[],
): readonly TrialResult[] {
  const metrics = computeDensity(topology);
  return scores.map((fitness, i) => ({
    condition: 'control' as const,
    complexity,
    fitness,
    density: metrics.compositeDensity,
    nodeCount: metrics.nodeCount,
    cost: costs?.[i],
    trialId: `control-${complexity}-${i}`,
  }));
}

/**
 * Creates trial results from evaluating an evolved (treatment) topology
 * against a set of tasks.
 *
 * @param composite - The evolved composite genome
 * @param scores - Fitness scores per trial
 * @param complexity - Task complexity level
 * @param costs - Optional cost per trial
 * @returns Array of TrialResult for the treatment condition
 */
export function createTreatmentTrials(
  composite: CompositeGenome,
  scores: readonly number[],
  complexity: TaskComplexity,
  costs?: readonly number[],
): readonly TrialResult[] {
  const metrics = computeDensity(composite.topology);
  return scores.map((fitness, i) => ({
    condition: 'treatment' as const,
    complexity,
    fitness,
    density: metrics.compositeDensity,
    nodeCount: metrics.nodeCount,
    cost: costs?.[i],
    trialId: `treatment-${complexity}-${i}`,
  }));
}

/**
 * Formats an experiment result as a human-readable report.
 */
export function formatReport(result: ExperimentResult): string {
  const lines: string[] = [];
  lines.push('# Topology Comparison Report');
  lines.push('');

  // Verdict
  lines.push(`## Verdict`);
  lines.push(result.verdict.summary);
  lines.push('');

  // Overall metrics
  lines.push('## Overall Metrics');
  lines.push('');
  lines.push('| Metric | Control | Treatment | Improvement | p-value | Cohen\'s d | Sig? |');
  lines.push('|--------|---------|-----------|-------------|---------|-----------|------|');

  for (const m of result.metrics) {
    const sig = m.significant ? 'YES' : 'no';
    const improvement = `${(m.relativeImprovement * 100).toFixed(1)}%`;
    lines.push(
      `| ${m.metric} | ${m.control.mean.toFixed(3)} ± ${m.control.stddev.toFixed(3)} (n=${m.control.n})` +
      ` | ${m.treatment.mean.toFixed(3)} ± ${m.treatment.stddev.toFixed(3)} (n=${m.treatment.n})` +
      ` | ${improvement} | ${m.tTest.p.toFixed(4)} | ${m.effectSize.toFixed(2)} | ${sig} |`,
    );
  }
  lines.push('');

  // Per-complexity
  if (result.perComplexity.size > 0) {
    lines.push('## Per-Complexity Breakdown');
    for (const [complexity, metrics] of result.perComplexity) {
      lines.push('');
      lines.push(`### ${complexity}`);
      for (const m of metrics) {
        const sig = m.significant ? ' **significant**' : '';
        lines.push(
          `- ${m.metric}: control=${m.control.mean.toFixed(3)}, treatment=${m.treatment.mean.toFixed(3)}, ` +
          `d=${m.effectSize.toFixed(2)}, p=${m.tTest.p.toFixed(4)}${sig}`,
        );
      }
    }
  }

  return lines.join('\n');
}
