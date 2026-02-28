/**
 * Skill analyzer: measures fitness impact of adding/removing skills.
 *
 * For each skill in a genome:
 *   - Remove it, evaluate fitness delta → how important is this skill?
 * For each candidate skill not in the genome:
 *   - Add it, evaluate fitness delta → would this skill help?
 *
 * Results are ranked by impact and used to:
 * 1. Identify essential skills (large fitness drop on removal)
 * 2. Identify beneficial candidates (large fitness gain on addition)
 * 3. Identify wasteful skills (no fitness impact on removal → cut them)
 * 4. Recommend optimal skill sets per agent
 *
 * Design constraints:
 * - Harness is injectable (testable)
 * - Non-destructive (original genome never modified)
 * - Graceful with small samples (skips t-test when < 2 tasks)
 * - Mutation operators are reused from the mutation module
 */

import type { AgentGenome, SkillEntry } from '../genome/schema.js';
import type {
  BenchmarkTask,
  EvaluationDimension,
  PortfolioResult,
} from '../benchmark/schema.js';
import { EVALUATION_DIMENSIONS } from '../benchmark/schema.js';
import { compareVariants } from '../benchmark/evaluator.js';
import { addSkill, removeSkill } from '../mutation/operators.js';
import { EvaluationHarness } from '../harness/harness.js';
import type {
  SkillAnalyzerConfig,
  SkillCatalogEntry,
  SkillEvolutionReport,
  SkillImpact,
  SkillMutationDirection,
} from './types.js';
import { DEFAULT_SKILL_ANALYZER_CONFIG } from './types.js';

// ---------------------------------------------------------------------------
// Impact ranking
// ---------------------------------------------------------------------------

/** Sorts skill impacts by impact magnitude (descending). */
function rankByImpact(impacts: SkillImpact[]): SkillImpact[] {
  return impacts.sort((a, b) => b.impactMagnitude - a.impactMagnitude);
}

// ---------------------------------------------------------------------------
// Optimal skill set computation
// ---------------------------------------------------------------------------

/**
 * Recommends an optimal skill set based on impact analysis.
 *
 * Strategy:
 * - Keep current skills whose removal causes fitness loss >= minRemovalPenalty
 * - Add candidate skills whose addition causes fitness gain >= minAdditionBenefit
 * - Remove current skills whose removal has negligible impact (save cost)
 */
function computeRecommendedSkills(
  currentSkills: readonly SkillEntry[],
  removalImpacts: readonly SkillImpact[],
  additionImpacts: readonly SkillImpact[],
  config: SkillAnalyzerConfig,
): readonly SkillEntry[] {
  const recommended: SkillEntry[] = [];

  // Build removal impact lookup
  const removalMap = new Map<string, SkillImpact>();
  for (const impact of removalImpacts) {
    removalMap.set(impact.skill.name, impact);
  }

  // Keep current skills that are beneficial (removal hurts)
  for (const skill of currentSkills) {
    const impact = removalMap.get(skill.name);
    if (!impact) {
      // No impact data → keep by default
      recommended.push(skill);
      continue;
    }

    // fitnessDelta is negative when removal hurts (skill is beneficial)
    // Keep if removing causes penalty >= threshold
    if (impact.fitnessDelta <= -config.minRemovalPenalty) {
      recommended.push(skill);
    }
    // Otherwise: skill is wasteful, don't include in recommendation
  }

  // Add candidate skills that are beneficial (addition helps)
  for (const impact of additionImpacts) {
    // fitnessDelta is positive when addition helps
    if (impact.fitnessDelta >= config.minAdditionBenefit) {
      recommended.push(impact.skill);
    }
  }

  return recommended;
}

// ---------------------------------------------------------------------------
// SkillAnalyzer
// ---------------------------------------------------------------------------

/**
 * Analyzes skill impact on genome fitness through systematic add/remove testing.
 *
 * Usage:
 * ```typescript
 * const analyzer = new SkillAnalyzer(harness);
 * const report = await analyzer.analyze(genome, tasks, candidateSkills);
 *
 * // Most impactful skill removal
 * console.log(report.removalImpacts[0].skill.name, report.removalImpacts[0].fitnessDelta);
 *
 * // Best skill to add
 * console.log(report.additionImpacts[0].skill.name, report.additionImpacts[0].fitnessDelta);
 *
 * // Recommended optimal set
 * console.log(report.recommendedSkills.map(s => s.name));
 * ```
 */
export class SkillAnalyzer {
  private readonly harness: EvaluationHarness;
  private readonly config: SkillAnalyzerConfig;

  constructor(
    harness: EvaluationHarness,
    config: Partial<SkillAnalyzerConfig> = {},
  ) {
    this.harness = harness;
    this.config = { ...DEFAULT_SKILL_ANALYZER_CONFIG, ...config };
  }

  /**
   * Runs complete skill evolution analysis.
   *
   * 1. Evaluate baseline genome
   * 2. For each current skill: remove it, measure fitness delta
   * 3. For each candidate skill: add it, measure fitness delta
   * 4. Rank impacts, compute recommended skill set
   *
   * @param genome - The genome to analyze
   * @param tasks - Benchmark tasks for fitness evaluation
   * @param candidates - Skills not in genome to test adding
   * @param genomeId - Optional identifier
   */
  async analyze(
    genome: AgentGenome,
    tasks: readonly BenchmarkTask[],
    candidates: readonly SkillEntry[] = [],
    genomeId?: string,
  ): Promise<SkillEvolutionReport> {
    const id = genomeId ?? genome.agentName;
    let totalEvaluations = 0;

    // 1. Evaluate baseline
    const baseline = await this.harness.evaluatePortfolio(genome, tasks, id);
    totalEvaluations++;

    const currentSkills = genome.frontmatter.skills;

    // 2. Test removal of each current skill
    const removalImpacts: SkillImpact[] = [];
    for (const skill of currentSkills) {
      const impact = await this.testSkillMutation(
        genome,
        skill,
        'remove',
        baseline,
        tasks,
        id,
      );
      removalImpacts.push(impact);
      totalEvaluations++;
    }

    // 3. Test addition of each candidate skill (skip those already present)
    const currentNames = new Set(currentSkills.map(s => s.name));
    const additionImpacts: SkillImpact[] = [];
    for (const candidate of candidates) {
      if (currentNames.has(candidate.name)) continue;

      const impact = await this.testSkillMutation(
        genome,
        candidate,
        'add',
        baseline,
        tasks,
        id,
      );
      additionImpacts.push(impact);
      totalEvaluations++;
    }

    // 4. Rank by impact magnitude
    rankByImpact(removalImpacts);
    rankByImpact(additionImpacts);

    // 5. Compute recommended skill set
    const recommendedSkills = computeRecommendedSkills(
      currentSkills,
      removalImpacts,
      additionImpacts,
      this.config,
    );

    const totalMutationsTested = removalImpacts.length + additionImpacts.length;

    return {
      genomeId: id,
      agentName: genome.agentName,
      baseline,
      currentSkills,
      removalImpacts,
      additionImpacts,
      recommendedSkills,
      totalMutationsTested,
      totalEvaluations,
      analyzedAt: new Date().toISOString(),
    };
  }

  /**
   * Tests the impact of a single skill mutation (add or remove).
   */
  private async testSkillMutation(
    genome: AgentGenome,
    skill: SkillEntry,
    direction: SkillMutationDirection,
    baseline: PortfolioResult,
    tasks: readonly BenchmarkTask[],
    genomeId: string,
  ): Promise<SkillImpact> {
    // Apply mutation
    const mutation = direction === 'add'
      ? addSkill(genome, skill)
      : removeSkill(genome, skill.name);

    if (!mutation.applied) {
      // Shouldn't happen if caller filters correctly, but handle gracefully
      return this.zeroImpact(skill, direction, baseline);
    }

    // Evaluate mutated genome
    const mutatedId = `${genomeId}-skill-${direction}-${skill.name}`;
    const mutated = await this.harness.evaluatePortfolio(
      mutation.genome,
      tasks,
      mutatedId,
    );

    // Fitness delta: mutated - baseline
    const fitnessDelta = mutated.fitness - baseline.fitness;

    // Per-dimension deltas
    const dimensionDeltas = {} as Record<EvaluationDimension, number>;
    for (const dim of EVALUATION_DIMENSIONS) {
      dimensionDeltas[dim] = mutated.dimensionMeans[dim] - baseline.dimensionMeans[dim];
    }

    // Statistical comparison (requires ≥2 task results)
    const canCompare = baseline.taskCount >= 2 && mutated.taskCount >= 2;
    const comparison = canCompare
      ? compareVariants(baseline, mutated, this.config.alpha)
      : null;

    return {
      skill,
      presentInBaseline: direction === 'remove',
      direction,
      fitnessDelta,
      impactMagnitude: Math.abs(fitnessDelta),
      effectSize: comparison?.effectSize ?? null,
      significant: comparison?.significant ?? false,
      pValue: comparison?.pValue ?? null,
      dimensionDeltas,
      baselineFitness: baseline.fitness,
      mutatedFitness: mutated.fitness,
      comparison,
    };
  }

  /** Creates a zero-impact result for mutations that couldn't be applied. */
  private zeroImpact(
    skill: SkillEntry,
    direction: SkillMutationDirection,
    baseline: PortfolioResult,
  ): SkillImpact {
    const zeroDims = {} as Record<EvaluationDimension, number>;
    for (const dim of EVALUATION_DIMENSIONS) zeroDims[dim] = 0;

    return {
      skill,
      presentInBaseline: direction === 'remove',
      direction,
      fitnessDelta: 0,
      impactMagnitude: 0,
      effectSize: null,
      significant: false,
      pValue: null,
      dimensionDeltas: zeroDims,
      baselineFitness: baseline.fitness,
      mutatedFitness: baseline.fitness,
      comparison: null,
    };
  }
}
