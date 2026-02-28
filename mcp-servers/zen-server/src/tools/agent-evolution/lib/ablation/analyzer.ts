/**
 * Ablation analyzer: systematically removes sections to measure fitness impact.
 *
 * For each section in a genome:
 * 1. Remove the section (via ablateSection operator)
 * 2. Evaluate the ablated genome on benchmark tasks
 * 3. Compare ablated fitness against baseline (Welch's t-test)
 * 4. Record fitness delta, effect size, and statistical significance
 *
 * Results are ranked by impact magnitude and converted into mutation
 * budget weights for the evolutionary loop.
 *
 * Design constraints:
 * - Harness is injectable (testable)
 * - Analysis is non-destructive (original genome is never modified)
 * - All comparisons use rigorous statistical tests
 * - Budget allocation uses softmax-like normalization
 */

import type { AgentGenome, CanonicalSectionId } from '../genome/schema.js';
import type {
  BenchmarkTask,
  EvaluationDimension,
  PortfolioResult,
} from '../benchmark/schema.js';
import { EVALUATION_DIMENSIONS } from '../benchmark/schema.js';
import { compareVariants } from '../benchmark/evaluator.js';
import { ablateSection } from '../mutation/operators.js';
import { EvaluationHarness } from '../harness/harness.js';
import type {
  AblationConfig,
  AblationReport,
  SectionImpact,
} from './types.js';
import { DEFAULT_ABLATION_CONFIG } from './types.js';

// ---------------------------------------------------------------------------
// Section discovery
// ---------------------------------------------------------------------------

/**
 * Extracts the unique set of section IDs present in a genome.
 * Returns them in document order (preserving the genome's section ordering).
 */
function discoverSections(
  genome: AgentGenome,
  canonicalOnly: boolean,
): readonly (CanonicalSectionId | 'custom')[] {
  const seen = new Set<CanonicalSectionId | 'custom'>();
  const result: (CanonicalSectionId | 'custom')[] = [];

  for (const section of genome.sections) {
    if (canonicalOnly && section.id === 'custom') continue;
    if (!seen.has(section.id)) {
      seen.add(section.id);
      result.push(section.id);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Impact ranking
// ---------------------------------------------------------------------------

/**
 * Sorts section impacts by impact magnitude (descending).
 * Sections not present in the genome are sorted last.
 */
function rankByImpact(impacts: SectionImpact[]): SectionImpact[] {
  return impacts.sort((a, b) => {
    // Present sections before absent ones
    if (a.present && !b.present) return -1;
    if (!a.present && b.present) return 1;

    // Among present sections, sort by impact magnitude (descending)
    const magA = a.impactMagnitude ?? 0;
    const magB = b.impactMagnitude ?? 0;
    return magB - magA;
  });
}

// ---------------------------------------------------------------------------
// Mutation budget computation
// ---------------------------------------------------------------------------

/**
 * Computes mutation budget weights from impact magnitudes.
 *
 * Uses normalized impact magnitudes: each section's weight is proportional
 * to its impact magnitude relative to the total. Sections below the
 * minimum threshold receive zero weight.
 *
 * @param impacts - Ranked section impacts
 * @param minThreshold - Minimum impact to receive budget
 * @returns Map of section ID → mutation weight (sums to 1.0)
 */
function computeMutationWeights(
  impacts: readonly SectionImpact[],
  minThreshold: number,
): ReadonlyMap<CanonicalSectionId | 'custom', number> {
  const weights = new Map<CanonicalSectionId | 'custom', number>();

  // Collect eligible impacts
  const eligible: { id: CanonicalSectionId | 'custom'; magnitude: number }[] = [];
  for (const impact of impacts) {
    if (!impact.present || impact.impactMagnitude === null) continue;
    if (impact.impactMagnitude >= minThreshold) {
      eligible.push({ id: impact.sectionId, magnitude: impact.impactMagnitude });
    }
  }

  if (eligible.length === 0) {
    // Uniform weights across all present sections
    const present = impacts.filter(i => i.present);
    if (present.length === 0) return weights;
    const uniform = 1.0 / present.length;
    for (const impact of present) {
      weights.set(impact.sectionId, uniform);
    }
    return weights;
  }

  // Normalize magnitudes to sum to 1.0
  let totalMagnitude = 0;
  for (const e of eligible) totalMagnitude += e.magnitude;

  for (const e of eligible) {
    weights.set(e.id, e.magnitude / totalMagnitude);
  }

  return weights;
}

// ---------------------------------------------------------------------------
// AblationAnalyzer
// ---------------------------------------------------------------------------

/**
 * Systematically ablates genome sections to measure fitness impact.
 *
 * Usage:
 * ```typescript
 * const analyzer = new AblationAnalyzer(harness);
 * const report = await analyzer.analyze(genome, benchmarkTasks);
 *
 * // Highest-impact section
 * console.log(report.impacts[0].sectionId, report.impacts[0].fitnessDelta);
 *
 * // Mutation budget weights
 * for (const [section, weight] of report.mutationWeights) {
 *   console.log(`${section}: ${(weight * 100).toFixed(1)}%`);
 * }
 * ```
 */
export class AblationAnalyzer {
  private readonly harness: EvaluationHarness;
  private readonly config: AblationConfig;

  constructor(
    harness: EvaluationHarness,
    config: Partial<AblationConfig> = {},
  ) {
    this.harness = harness;
    this.config = { ...DEFAULT_ABLATION_CONFIG, ...config };
  }

  /**
   * Runs complete ablation analysis on a genome.
   *
   * Evaluates the baseline genome once, then evaluates each ablated
   * variant independently. Returns a ranked report of section impacts
   * with derived mutation budget weights.
   *
   * @param genome - The genome to analyze
   * @param tasks - Benchmark tasks for fitness evaluation
   * @param genomeId - Optional identifier (defaults to agentName)
   * @returns Complete ablation report
   */
  async analyze(
    genome: AgentGenome,
    tasks: readonly BenchmarkTask[],
    genomeId?: string,
  ): Promise<AblationReport> {
    const id = genomeId ?? genome.agentName;
    let totalEvaluations = 0;

    // 1. Evaluate baseline (full genome)
    const baseline = await this.harness.evaluatePortfolio(genome, tasks, id);
    totalEvaluations++;

    // 2. Discover sections to ablate
    const sectionIds = discoverSections(genome, this.config.canonicalOnly);

    // 3. Ablate each section and compare
    const impacts: SectionImpact[] = [];

    for (const sectionId of sectionIds) {
      const impact = await this.analyzeSection(
        genome,
        sectionId,
        baseline,
        tasks,
        id,
      );
      impacts.push(impact);
      if (impact.present) totalEvaluations++;
    }

    // 4. Rank by impact magnitude
    rankByImpact(impacts);

    // 5. Compute mutation budget weights
    const mutationWeights = computeMutationWeights(
      impacts,
      this.config.minImpactThreshold,
    );

    const significantCount = impacts.filter(i => i.significant).length;

    return {
      genomeId: id,
      agentName: genome.agentName,
      baseline,
      impacts,
      mutationWeights,
      sectionsAnalyzed: sectionIds.length,
      significantCount,
      totalEvaluations,
      analyzedAt: new Date().toISOString(),
    };
  }

  /**
   * Analyzes the impact of a single section.
   *
   * Removes the section, evaluates the ablated genome, and compares
   * against the baseline using Welch's t-test.
   */
  private async analyzeSection(
    genome: AgentGenome,
    sectionId: CanonicalSectionId | 'custom',
    baseline: PortfolioResult,
    tasks: readonly BenchmarkTask[],
    genomeId: string,
  ): Promise<SectionImpact> {
    // Attempt ablation
    const mutation = ablateSection(genome, sectionId);

    if (!mutation.applied) {
      // Section not found in genome
      return {
        sectionId,
        present: false,
        fitnessDelta: null,
        impactMagnitude: null,
        effectSize: null,
        significant: false,
        pValue: null,
        dimensionDeltas: null,
        baselineFitness: baseline.fitness,
        ablatedFitness: null,
        comparison: null,
      };
    }

    // Evaluate ablated genome
    const ablatedId = `${genomeId}-ablated-${sectionId}`;
    const ablated = await this.harness.evaluatePortfolio(
      mutation.genome,
      tasks,
      ablatedId,
    );

    // Fitness delta: ablated - baseline
    // Negative means removing the section hurt fitness (section is valuable)
    const fitnessDelta = ablated.fitness - baseline.fitness;

    // Per-dimension deltas
    const dimensionDeltas = {} as Record<EvaluationDimension, number>;
    for (const dim of EVALUATION_DIMENSIONS) {
      dimensionDeltas[dim] = ablated.dimensionMeans[dim] - baseline.dimensionMeans[dim];
    }

    // Statistical comparison requires ≥2 task results per group.
    // With fewer samples, we still report fitness delta but skip significance testing.
    const canCompare = baseline.taskCount >= 2 && ablated.taskCount >= 2;
    const comparison = canCompare
      ? compareVariants(baseline, ablated, this.config.alpha)
      : null;

    return {
      sectionId,
      present: true,
      fitnessDelta,
      impactMagnitude: Math.abs(fitnessDelta),
      effectSize: comparison?.effectSize ?? null,
      significant: comparison?.significant ?? false,
      pValue: comparison?.pValue ?? null,
      dimensionDeltas,
      baselineFitness: baseline.fitness,
      ablatedFitness: ablated.fitness,
      comparison,
    };
  }
}
