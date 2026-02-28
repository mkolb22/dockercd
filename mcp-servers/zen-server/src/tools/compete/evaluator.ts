/**
 * Competitive Evaluation — Pure Statistical Functions
 * No I/O. Implements Welch's t-test, Cohen's d, and composite scoring.
 * T-distribution CDF via Lentz's continued fraction for regularized incomplete beta.
 */

import {
  DEFAULT_WEIGHTS,
  DIMENSIONS,
  type FitnessScores,
  type DimensionStats,
  type CompeteSummary,
  type CompeteRound,
  type AblationRun,
  type AblationResult,
  type AblationSummary,
  type ToolCategory,
} from "./types.js";

// ─── Basic Statistics ──────────────────────────────────

export function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((sum, v) => sum + v, 0) / arr.length;
}

export function stddev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const variance = arr.reduce((sum, v) => sum + (v - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

// ─── Composite Score ───────────────────────────────────

export function computeComposite(
  scores: FitnessScores,
  weights: FitnessScores = DEFAULT_WEIGHTS,
): number {
  let total = 0;
  let weightSum = 0;
  for (const dim of DIMENSIONS) {
    total += scores[dim] * weights[dim];
    weightSum += weights[dim];
  }
  return weightSum > 0 ? total / weightSum : 0;
}

// ─── T-Distribution CDF ───────────────────────────────

const LN_SQRT_2PI = 0.5 * Math.log(2 * Math.PI);

/** Log-gamma via Lanczos approximation */
function lnGamma(z: number): number {
  const g = 7;
  const coef = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  }
  z -= 1;
  let x = coef[0];
  for (let i = 1; i < g + 2; i++) {
    x += coef[i] / (z + i);
  }
  const t = z + g + 0.5;
  return LN_SQRT_2PI + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/**
 * Regularized incomplete beta function I_x(a, b)
 * via Lentz's continued fraction expansion.
 */
export function regularizedBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  // Use symmetry when x > (a+1)/(a+b+2)
  if (x > (a + 1) / (a + b + 2)) {
    return 1 - regularizedBeta(1 - x, b, a);
  }

  const lnPrefix = a * Math.log(x) + b * Math.log(1 - x)
    - Math.log(a)
    - (lnGamma(a) + lnGamma(b) - lnGamma(a + b));

  // Lentz's continued fraction
  const maxIter = 200;
  const eps = 1e-14;
  const tiny = 1e-30;

  let c = 1;
  let d = 1 - (a + b) * x / (a + 1);
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;

  for (let m = 1; m <= maxIter; m++) {
    // Even step: numerator
    let numerator = m * (b - m) * x / ((a + 2 * m - 1) * (a + 2 * m));
    d = 1 + numerator * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + numerator / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    h *= d * c;

    // Odd step: numerator
    numerator = -(a + m) * (a + b + m) * x / ((a + 2 * m) * (a + 2 * m + 1));
    d = 1 + numerator * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + numerator / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    h *= delta;

    if (Math.abs(delta - 1) < eps) break;
  }

  return Math.exp(lnPrefix) * h;
}

/**
 * CDF of the t-distribution with df degrees of freedom.
 * P(T <= t) for Student's t-distribution.
 */
export function tDistCdf(t: number, df: number): number {
  const x = df / (df + t * t);
  const ibeta = regularizedBeta(x, df / 2, 0.5);
  if (t >= 0) {
    return 1 - 0.5 * ibeta;
  }
  return 0.5 * ibeta;
}

// ─── Welch's T-Test ────────────────────────────────────

export interface TTestResult {
  t: number;
  df: number;
  p: number;
}

/**
 * Welch's t-test for unequal variances.
 * Two-tailed p-value.
 */
export function welchTTest(sample1: number[], sample2: number[]): TTestResult {
  const n1 = sample1.length;
  const n2 = sample2.length;

  if (n1 < 2 || n2 < 2) {
    return { t: 0, df: 0, p: 1 };
  }

  const m1 = mean(sample1);
  const m2 = mean(sample2);
  const v1 = stddev(sample1) ** 2;
  const v2 = stddev(sample2) ** 2;

  const se = Math.sqrt(v1 / n1 + v2 / n2);
  if (se === 0) return { t: 0, df: n1 + n2 - 2, p: 1 };

  const t = (m1 - m2) / se;

  // Welch-Satterthwaite degrees of freedom
  const num = (v1 / n1 + v2 / n2) ** 2;
  const denom = (v1 / n1) ** 2 / (n1 - 1) + (v2 / n2) ** 2 / (n2 - 1);
  const df = denom > 0 ? num / denom : n1 + n2 - 2;

  // Two-tailed p-value
  const p = 2 * (1 - tDistCdf(Math.abs(t), df));

  return { t, df, p };
}

// ─── Cohen's d ────────────────────────────────────────

/**
 * Cohen's d effect size with pooled standard deviation.
 * Positive d means sample1 > sample2.
 */
export function cohensD(sample1: number[], sample2: number[]): number {
  if (sample1.length < 2 || sample2.length < 2) return 0;

  const m1 = mean(sample1);
  const m2 = mean(sample2);
  const s1 = stddev(sample1);
  const s2 = stddev(sample2);
  const n1 = sample1.length;
  const n2 = sample2.length;

  const pooledStd = Math.sqrt(
    ((n1 - 1) * s1 ** 2 + (n2 - 1) * s2 ** 2) / (n1 + n2 - 2),
  );

  if (pooledStd === 0) return 0;
  return (m1 - m2) / pooledStd;
}

// ─── Per-Dimension Statistics ──────────────────────────

export function computeDimensionStats(
  controlScores: number[],
  treatmentScores: number[],
  dimension: string,
  alpha: number,
): DimensionStats {
  const cMean = mean(controlScores);
  const cStd = stddev(controlScores);
  const tMean = mean(treatmentScores);
  const tStd = stddev(treatmentScores);

  const test = welchTTest(treatmentScores, controlScores);
  const d = cohensD(treatmentScores, controlScores);

  const significant = test.p < alpha;
  let winner: "control" | "treatment" | "inconclusive" = "inconclusive";
  if (significant) {
    winner = tMean > cMean ? "treatment" : "control";
  }

  return {
    dimension,
    controlMean: cMean,
    controlStd: cStd,
    treatmentMean: tMean,
    treatmentStd: tStd,
    tStatistic: test.t,
    pValue: test.p,
    cohensD: d,
    significant,
    winner,
  };
}

// ─── Full Summary ──────────────────────────────────────

export function buildSummary(
  controlRounds: CompeteRound[],
  treatmentRounds: CompeteRound[],
  alpha: number,
): CompeteSummary {
  const controlComposites = controlRounds.map((r) => r.composite);
  const treatmentComposites = treatmentRounds.map((r) => r.composite);

  // Per-dimension stats
  const dimensionStats: DimensionStats[] = DIMENSIONS.map((dim) => {
    const cScores = controlRounds.map((r) => r.scores[dim]);
    const tScores = treatmentRounds.map((r) => r.scores[dim]);
    return computeDimensionStats(cScores, tScores, dim, alpha);
  });

  // Composite stats
  const compositeStats = computeDimensionStats(
    controlComposites,
    treatmentComposites,
    "composite",
    alpha,
  );

  return {
    overallWinner: compositeStats.winner,
    compositeStats,
    dimensionStats,
    roundsCompleted: Math.min(controlRounds.length, treatmentRounds.length),
  };
}

// ─── Ablation Analysis ────────────────────────────────

export function analyzeAblation(
  fullTreatmentRounds: CompeteRound[],
  ablationRuns: AblationRun[],
  alpha: number,
): AblationSummary {
  const fullComposites = fullTreatmentRounds.map((r) => r.composite);
  const fullMean = mean(fullComposites);

  // Group ablation runs by disabled category
  const byCategory = new Map<ToolCategory, AblationRun[]>();
  for (const run of ablationRuns) {
    const existing = byCategory.get(run.disabledCategory) ?? [];
    existing.push(run);
    byCategory.set(run.disabledCategory, existing);
  }

  const results: AblationResult[] = [];

  for (const [category, runs] of byCategory) {
    const ablationComposites = runs.map((r) => r.composite);
    const ablationMean = mean(ablationComposites);
    const delta = fullMean - ablationMean; // positive = removing this category hurts

    const test = welchTTest(fullComposites, ablationComposites);
    const d = cohensD(fullComposites, ablationComposites);

    let recommendation: "keep" | "remove" | "investigate";
    if (delta > 0 && test.p < alpha && Math.abs(d) >= 0.5) {
      recommendation = "keep";
    } else if (delta <= 0 || test.p >= alpha) {
      recommendation = delta > 0 && test.p >= alpha ? "investigate" : "remove";
    } else {
      recommendation = "investigate";
    }

    results.push({
      category,
      meanComposite: ablationMean,
      deltaFromFull: delta,
      pValue: test.p,
      cohensD: d,
      recommendation,
    });
  }

  // Sort by delta descending (most impactful first)
  results.sort((a, b) => b.deltaFromFull - a.deltaFromFull);

  const minimalEffectiveToolset = results
    .filter((r) => r.recommendation === "keep")
    .map((r) => r.category);

  return {
    fullTreatmentMean: fullMean,
    results,
    minimalEffectiveToolset,
  };
}
