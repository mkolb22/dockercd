/**
 * Types for section-level ablation analysis.
 *
 * Ablation analysis answers: "Which sections have the highest impact
 * on output quality?" by systematically removing each section and
 * measuring the fitness delta.
 *
 * Results feed into the mutation budget: high-impact sections receive
 * more mutation attempts in the evolutionary loop.
 *
 * Design reference: AGENT-EVOLUTION-RESEARCH.md Phase 1, Step 6
 */

import type { CanonicalSectionId } from '../genome/schema.js';
import type {
  ComparisonResult,
  EvaluationDimension,
  PortfolioResult,
} from '../benchmark/schema.js';

// ---------------------------------------------------------------------------
// Section impact
// ---------------------------------------------------------------------------

/**
 * Fitness impact of ablating a single section from a genome.
 *
 * A negative fitnessDelta indicates the section improves fitness
 * (removing it hurts performance). A positive delta indicates
 * the section hurts fitness (removing it helps).
 */
export interface SectionImpact {
  /** The section that was ablated. */
  readonly sectionId: CanonicalSectionId | 'custom';

  /** Whether this section exists in the genome. */
  readonly present: boolean;

  /**
   * Fitness change when section is removed: ablated - baseline.
   * Negative = section is beneficial (removing hurts fitness).
   * Positive = section is harmful (removing improves fitness).
   * null if section not present.
   */
  readonly fitnessDelta: number | null;

  /**
   * Absolute fitness impact magnitude.
   * |fitnessDelta| — larger values indicate more important sections.
   * null if section not present.
   */
  readonly impactMagnitude: number | null;

  /** Cohen's d effect size. null if not applicable. */
  readonly effectSize: number | null;

  /** Whether the fitness delta is statistically significant. */
  readonly significant: boolean;

  /** Two-tailed p-value from Welch's t-test. null if not applicable. */
  readonly pValue: number | null;

  /**
   * Per-dimension fitness deltas.
   * Shows which quality dimensions are most affected by this section.
   * null if section not present.
   */
  readonly dimensionDeltas: Readonly<Record<EvaluationDimension, number>> | null;

  /** Baseline fitness (full genome). */
  readonly baselineFitness: number;

  /** Ablated fitness (genome without this section). null if not present. */
  readonly ablatedFitness: number | null;

  /** Full statistical comparison. null if section not present. */
  readonly comparison: ComparisonResult | null;
}

// ---------------------------------------------------------------------------
// Ablation report
// ---------------------------------------------------------------------------

/**
 * Complete ablation analysis report for a genome.
 *
 * Contains per-section impacts ranked by importance, plus
 * derived mutation budget weights.
 */
export interface AblationReport {
  /** Genome identifier that was analyzed. */
  readonly genomeId: string;

  /** Agent name of the analyzed genome. */
  readonly agentName: string;

  /** Baseline portfolio result (full genome). */
  readonly baseline: PortfolioResult;

  /**
   * Per-section impact results, ranked by impact magnitude (descending).
   * Sections with highest fitness impact appear first.
   * Sections not present in the genome are ranked last.
   */
  readonly impacts: readonly SectionImpact[];

  /**
   * Mutation budget weights derived from impact magnitudes.
   * Higher weight = section should receive more mutation attempts.
   * Only includes sections present in the genome.
   * Values sum to 1.0.
   */
  readonly mutationWeights: ReadonlyMap<CanonicalSectionId | 'custom', number>;

  /** Number of sections analyzed (present in genome). */
  readonly sectionsAnalyzed: number;

  /** Number of sections with statistically significant impact. */
  readonly significantCount: number;

  /** Total evaluations performed (1 baseline + N ablations). */
  readonly totalEvaluations: number;

  /** ISO 8601 timestamp. */
  readonly analyzedAt: string;
}

// ---------------------------------------------------------------------------
// Analyzer configuration
// ---------------------------------------------------------------------------

/** Configuration for the ablation analyzer. */
export interface AblationConfig {
  /**
   * Significance level for statistical tests.
   * Sections with p < alpha are marked as significant.
   * Default: 0.05
   */
  readonly alpha: number;

  /**
   * Minimum impact magnitude to include in mutation weights.
   * Sections below this threshold get zero mutation budget.
   * Default: 0.01
   */
  readonly minImpactThreshold: number;

  /**
   * Whether to analyze only canonical sections or also custom sections.
   * Default: false (analyze all sections)
   */
  readonly canonicalOnly: boolean;
}

/** Default ablation analysis configuration. */
export const DEFAULT_ABLATION_CONFIG: AblationConfig = {
  alpha: 0.05,
  minImpactThreshold: 0.01,
  canonicalOnly: false,
};
