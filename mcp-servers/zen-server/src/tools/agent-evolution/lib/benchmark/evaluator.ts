/**
 * Evaluator: computes fitness scores from criterion ratings and
 * performs statistical comparisons between genome variants.
 *
 * All functions are pure (no side effects, no LLM calls).
 * Statistical functions implement Welch's t-test with exact p-values
 * via the regularized incomplete beta function (Lentz's algorithm).
 *
 * Design constraints:
 * - Zero external dependencies
 * - Numerically stable implementations
 * - All inputs validated before computation
 */

import {
  type BenchmarkTask,
  type ComparisonResult,
  type CriterionScore,
  type DimensionComparison,
  type EvaluationDimension,
  type EvaluatorType,
  type PortfolioResult,
  type ResourceUsage,
  type TaskResult,
  DEFAULT_DIMENSION_WEIGHTS,
  EVALUATION_DIMENSIONS,
  MAX_RUBRIC_SCORE,
} from './schema.js';

// ---------------------------------------------------------------------------
// Statistical primitives
// ---------------------------------------------------------------------------

/**
 * Lanczos approximation coefficients for ln(Gamma(z)).
 * g = 7, accurate to ~15 significant digits.
 */
const LANCZOS_G = 7;
const LANCZOS_COEFFICIENTS: readonly number[] = [
  0.99999999999980993,
  676.5203681218851,
  -1259.1392167224028,
  771.32342877765313,
  -176.61502916214059,
  12.507343278686905,
  -0.13857109526572012,
  9.9843695780195716e-6,
  1.5056327351493116e-7,
];

/** Natural log of the gamma function via Lanczos approximation. */
export function lnGamma(z: number): number {
  if (z < 0.5) {
    // Reflection formula: Gamma(z) * Gamma(1-z) = pi / sin(pi*z)
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  }
  z -= 1;
  let x = LANCZOS_COEFFICIENTS[0];
  for (let i = 1; i < LANCZOS_G + 2; i++) {
    x += LANCZOS_COEFFICIENTS[i] / (z + i);
  }
  const t = z + LANCZOS_G + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/** Natural log of the beta function: B(a,b) = Gamma(a)*Gamma(b)/Gamma(a+b). */
function lnBeta(a: number, b: number): number {
  return lnGamma(a) + lnGamma(b) - lnGamma(a + b);
}

/**
 * Continued fraction for the regularized incomplete beta function.
 * Uses Lentz's modified algorithm for numerical stability.
 *
 * Reference: Numerical Recipes, 3rd edition, section 6.4.
 */
function betaContinuedFraction(a: number, b: number, x: number): number {
  const maxIterations = 200;
  const epsilon = 3e-14;
  const tiny = 1e-30;

  let c = 1.0;
  let d = 1.0 - (a + b) * x / (a + 1.0);
  if (Math.abs(d) < tiny) d = tiny;
  d = 1.0 / d;
  let h = d;

  for (let m = 1; m <= maxIterations; m++) {
    // Even step: d_{2m}
    const m2 = 2 * m;
    let an = m * (b - m) * x / ((a + m2 - 1) * (a + m2));
    d = 1.0 + an * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1.0 + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1.0 / d;
    h *= d * c;

    // Odd step: d_{2m+1}
    an = -(a + m) * (a + b + m) * x / ((a + m2) * (a + m2 + 1));
    d = 1.0 + an * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1.0 + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1.0 / d;
    const delta = d * c;
    h *= delta;

    if (Math.abs(delta - 1.0) < epsilon) break;
  }

  return h;
}

/**
 * Regularized incomplete beta function I_x(a, b).
 *
 * Uses the continued fraction representation with symmetry
 * transformation for numerical stability.
 */
export function regularizedBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  // Use symmetry relation for numerical stability:
  // I_x(a,b) = 1 - I_{1-x}(b,a)
  if (x < (a + 1) / (a + b + 2)) {
    const lnPrefactor = a * Math.log(x) + b * Math.log(1 - x) - lnBeta(a, b);
    return Math.exp(lnPrefactor) * betaContinuedFraction(a, b, x) / a;
  } else {
    const lnPrefactor = b * Math.log(1 - x) + a * Math.log(x) - lnBeta(b, a);
    return 1.0 - Math.exp(lnPrefactor) * betaContinuedFraction(b, a, 1 - x) / b;
  }
}

/**
 * CDF of the Student's t-distribution.
 *
 * P(T <= t) where T ~ t(df).
 */
export function tDistCDF(t: number, df: number): number {
  const x = df / (df + t * t);
  const prob = 0.5 * regularizedBeta(x, df / 2, 0.5);
  return t >= 0 ? 1.0 - prob : prob;
}

// ---------------------------------------------------------------------------
// Descriptive statistics helpers
// ---------------------------------------------------------------------------

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function variance(values: readonly number[], sampleMean: number): number {
  if (values.length < 2) return 0;
  let sumSq = 0;
  for (const v of values) sumSq += (v - sampleMean) ** 2;
  return sumSq / (values.length - 1);
}

function stddev(values: readonly number[], sampleMean: number): number {
  return Math.sqrt(variance(values, sampleMean));
}

// ---------------------------------------------------------------------------
// Task fitness computation
// ---------------------------------------------------------------------------

/**
 * Computes fitness for a single task evaluation.
 *
 * Scoring flow:
 * 1. Each criterion score (0-4) is weighted by its criterion weight
 * 2. Weighted scores are summed and normalized to [0, 1]
 * 3. Per-dimension scores aggregate criteria sharing the same dimension
 * 4. Overall fitness uses dimension weights
 *
 * @param task - The benchmark task definition
 * @param criterionScores - Raw scores for each criterion
 * @param usage - Resource usage from execution
 * @param output - Raw agent output
 * @param genomeId - Identifier for the genome variant
 * @param evaluator - How scoring was performed
 * @returns Complete TaskResult with computed fitness
 */
export function computeTaskFitness(
  task: BenchmarkTask,
  criterionScores: readonly CriterionScore[],
  usage: ResourceUsage,
  output: string,
  genomeId: string,
  evaluator: EvaluatorType = 'automated',
): TaskResult {
  // Build score lookup
  const scoreMap = new Map<string, number>();
  for (const cs of criterionScores) {
    scoreMap.set(cs.criterionId, cs.score);
  }

  // Compute per-dimension scores:
  // For each dimension, weighted average of criteria in that dimension,
  // normalized to [0, 1].
  const dimensionWeightSums = new Map<EvaluationDimension, number>();
  const dimensionWeightedScores = new Map<EvaluationDimension, number>();

  for (const criterion of task.criteria) {
    const raw = scoreMap.get(criterion.id) ?? 0;
    const normalized = raw / MAX_RUBRIC_SCORE;
    const dim = criterion.dimension;

    dimensionWeightSums.set(dim, (dimensionWeightSums.get(dim) ?? 0) + criterion.weight);
    dimensionWeightedScores.set(dim, (dimensionWeightedScores.get(dim) ?? 0) + normalized * criterion.weight);
  }

  const dimensionScores = {} as Record<EvaluationDimension, number>;
  for (const dim of EVALUATION_DIMENSIONS) {
    const totalWeight = dimensionWeightSums.get(dim) ?? 0;
    if (totalWeight > 0) {
      dimensionScores[dim] = (dimensionWeightedScores.get(dim) ?? 0) / totalWeight;
    } else {
      dimensionScores[dim] = 0;
    }
  }

  // Overall fitness: weighted sum of dimension scores
  let fitness = 0;
  for (const dim of EVALUATION_DIMENSIONS) {
    fitness += dimensionScores[dim] * DEFAULT_DIMENSION_WEIGHTS[dim];
  }

  return {
    taskId: task.id,
    genomeId,
    criterionScores,
    dimensionScores,
    fitness,
    usage,
    output,
    evaluatedAt: new Date().toISOString(),
    evaluator,
  };
}

// ---------------------------------------------------------------------------
// Portfolio aggregation
// ---------------------------------------------------------------------------

/**
 * Aggregates individual task results into a portfolio-level summary.
 *
 * @param genomeId - Identifier for the genome variant
 * @param taskResults - Individual task results (must all share genomeId)
 * @param dimensionWeights - Optional custom dimension weights
 * @returns Aggregated PortfolioResult
 */
export function computePortfolioFitness(
  genomeId: string,
  taskResults: readonly TaskResult[],
  dimensionWeights: Readonly<Record<EvaluationDimension, number>> = DEFAULT_DIMENSION_WEIGHTS,
): PortfolioResult {
  if (taskResults.length === 0) {
    const zeroDimensions = {} as Record<EvaluationDimension, number>;
    for (const dim of EVALUATION_DIMENSIONS) zeroDimensions[dim] = 0;
    return {
      genomeId,
      dimensionMeans: zeroDimensions,
      dimensionStdDevs: zeroDimensions,
      fitness: 0,
      totalUsage: { inputTokens: 0, outputTokens: 0, durationMs: 0, estimatedCostUsd: 0 },
      taskCount: 0,
      taskResults,
    };
  }

  // Per-dimension means and stddevs
  const dimensionMeans = {} as Record<EvaluationDimension, number>;
  const dimensionStdDevs = {} as Record<EvaluationDimension, number>;

  for (const dim of EVALUATION_DIMENSIONS) {
    const values = taskResults.map(r => r.dimensionScores[dim]);
    const m = mean(values);
    dimensionMeans[dim] = m;
    dimensionStdDevs[dim] = stddev(values, m);
  }

  // Portfolio fitness: weighted sum of dimension means
  let fitness = 0;
  for (const dim of EVALUATION_DIMENSIONS) {
    fitness += dimensionMeans[dim] * dimensionWeights[dim];
  }

  // Total resource usage
  let inputTokens = 0;
  let outputTokens = 0;
  let durationMs = 0;
  let estimatedCostUsd = 0;
  for (const r of taskResults) {
    inputTokens += r.usage.inputTokens;
    outputTokens += r.usage.outputTokens;
    durationMs += r.usage.durationMs;
    estimatedCostUsd += r.usage.estimatedCostUsd;
  }

  return {
    genomeId,
    dimensionMeans,
    dimensionStdDevs,
    fitness,
    totalUsage: { inputTokens, outputTokens, durationMs, estimatedCostUsd },
    taskCount: taskResults.length,
    taskResults,
  };
}

// ---------------------------------------------------------------------------
// Statistical comparison
// ---------------------------------------------------------------------------

/**
 * Performs Welch's t-test between two sets of samples.
 *
 * Returns the t-statistic, two-tailed p-value, and degrees of freedom.
 * Positive t-statistic indicates samplesA has higher mean.
 *
 * Requires at least 2 samples per group.
 */
export function welchTTest(
  samplesA: readonly number[],
  samplesB: readonly number[],
): { tStatistic: number; pValue: number; degreesOfFreedom: number } {
  const nA = samplesA.length;
  const nB = samplesB.length;

  if (nA < 2 || nB < 2) {
    throw new Error(`Welch's t-test requires at least 2 samples per group (got ${nA}, ${nB})`);
  }

  const meanA = mean(samplesA);
  const meanB = mean(samplesB);
  const varA = variance(samplesA, meanA);
  const varB = variance(samplesB, meanB);

  const seA = varA / nA;
  const seB = varB / nB;
  const seDiff = Math.sqrt(seA + seB);

  // Handle zero variance: all values identical in both groups
  if (seDiff === 0) {
    return {
      tStatistic: 0,
      pValue: 1,
      degreesOfFreedom: nA + nB - 2,
    };
  }

  const t = (meanA - meanB) / seDiff;

  // Welch-Satterthwaite degrees of freedom
  const df = (seA + seB) ** 2 / (seA ** 2 / (nA - 1) + seB ** 2 / (nB - 1));

  // Two-tailed p-value
  const p = 2 * (1 - tDistCDF(Math.abs(t), df));

  return { tStatistic: t, pValue: p, degreesOfFreedom: df };
}

/**
 * Cohen's d effect size between two sample groups.
 *
 * Uses pooled standard deviation. Positive d indicates A > B.
 * Interpretation: |d| < 0.2 negligible, 0.2-0.5 small, 0.5-0.8 medium, > 0.8 large.
 */
export function cohensD(
  samplesA: readonly number[],
  samplesB: readonly number[],
): number {
  const nA = samplesA.length;
  const nB = samplesB.length;

  if (nA < 2 || nB < 2) {
    throw new Error(`Cohen's d requires at least 2 samples per group (got ${nA}, ${nB})`);
  }

  const meanA = mean(samplesA);
  const meanB = mean(samplesB);
  const varA = variance(samplesA, meanA);
  const varB = variance(samplesB, meanB);

  // Pooled standard deviation
  const sPooled = Math.sqrt(((nA - 1) * varA + (nB - 1) * varB) / (nA + nB - 2));

  if (sPooled === 0) return 0;

  return (meanA - meanB) / sPooled;
}

/**
 * Compares two genome variants using Welch's t-test on portfolio fitness.
 *
 * Tests whether variant A performs significantly differently from variant B
 * on the overall fitness metric and each individual dimension.
 *
 * @param portfolioA - First genome variant's portfolio results
 * @param portfolioB - Second genome variant's portfolio results
 * @param alpha - Significance level (default 0.05)
 * @returns Full comparison result with per-dimension breakdowns
 */
export function compareVariants(
  portfolioA: PortfolioResult,
  portfolioB: PortfolioResult,
  alpha: number = 0.05,
): ComparisonResult {
  const fitnessA = portfolioA.taskResults.map(r => r.fitness);
  const fitnessB = portfolioB.taskResults.map(r => r.fitness);

  const overall = welchTTest(fitnessA, fitnessB);
  const effectSize = cohensD(fitnessA, fitnessB);

  // Per-dimension comparisons
  const dimensionComparisons = {} as Record<EvaluationDimension, DimensionComparison>;

  for (const dim of EVALUATION_DIMENSIONS) {
    const dimA = portfolioA.taskResults.map(r => r.dimensionScores[dim]);
    const dimB = portfolioB.taskResults.map(r => r.dimensionScores[dim]);
    const dimTest = welchTTest(dimA, dimB);

    dimensionComparisons[dim] = {
      meanA: mean(dimA),
      meanB: mean(dimB),
      delta: mean(dimA) - mean(dimB),
      significant: dimTest.pValue < alpha,
    };
  }

  return {
    genomeA: portfolioA.genomeId,
    genomeB: portfolioB.genomeId,
    tStatistic: overall.tStatistic,
    pValue: overall.pValue,
    effectSize,
    degreesOfFreedom: overall.degreesOfFreedom,
    significant: overall.pValue < alpha,
    dimensionComparisons,
  };
}
