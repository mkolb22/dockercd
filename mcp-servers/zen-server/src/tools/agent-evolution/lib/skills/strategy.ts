/**
 * Skill mutation strategy for the MAP-Elites evolutionary loop.
 *
 * Implements the MutationStrategy interface from the population module.
 * Selects skill add/remove mutations using weighted random selection
 * based on skill impact analysis.
 *
 * Two modes:
 * - Impact-weighted: uses SkillEvolutionReport to bias toward high-impact mutations
 * - Uniform: equal probability for all add/remove operations (baseline/fallback)
 *
 * Design constraints:
 * - Deterministic when using seeded RNG
 * - Graceful fallback when no impact data available
 * - Never adds a skill that's already present or removes one that's absent
 */

import type { AgentGenome, SkillEntry } from '../genome/schema.js';
import type { PortfolioResult } from '../benchmark/schema.js';
import type { MutationResult } from '../mutation/types.js';
import { addSkill, removeSkill } from '../mutation/operators.js';
import type { MutationStrategy } from '../population/manager.js';
import type { SkillEvolutionReport } from './types.js';

// ---------------------------------------------------------------------------
// Weighted random selection
// ---------------------------------------------------------------------------

/**
 * Selects an index from a weighted distribution.
 *
 * @param weights - Non-negative weights (do not need to sum to 1)
 * @param rng - Random number generator returning [0, 1)
 * @returns Selected index, or -1 if all weights are zero
 */
function weightedSelect(weights: readonly number[], rng: () => number): number {
  let total = 0;
  for (const w of weights) total += w;
  if (total <= 0) return -1;

  let threshold = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    threshold -= weights[i];
    if (threshold <= 0) return i;
  }
  return weights.length - 1;
}

// ---------------------------------------------------------------------------
// SkillMutationStrategy
// ---------------------------------------------------------------------------

/**
 * MAP-Elites mutation strategy for skill set evolution.
 *
 * Usage:
 * ```typescript
 * const strategy = new SkillMutationStrategy(candidateSkills);
 * // Optionally load impact data for weighted selection:
 * strategy.loadImpactReport(report);
 *
 * const manager = new PopulationManager(harness, strategy, config);
 * await manager.evolve(tasks);
 * ```
 */
export class SkillMutationStrategy implements MutationStrategy {
  private readonly candidates: readonly SkillEntry[];
  private readonly addRemoveRatio: number;
  private impactReport: SkillEvolutionReport | null = null;

  /**
   * @param candidates - Pool of skills available for addition
   * @param addRemoveRatio - Probability of addition vs removal (0-1). Default: 0.5
   */
  constructor(
    candidates: readonly SkillEntry[],
    addRemoveRatio: number = 0.5,
  ) {
    this.candidates = candidates;
    this.addRemoveRatio = Math.max(0, Math.min(1, addRemoveRatio));
  }

  /**
   * Loads impact data from a SkillEvolutionReport.
   * When loaded, mutations are biased toward high-impact skills.
   */
  loadImpactReport(report: SkillEvolutionReport): void {
    this.impactReport = report;
  }

  /**
   * Produces a skill mutation for a parent genome.
   *
   * Decision flow:
   * 1. Decide add vs remove (based on addRemoveRatio + genome state)
   * 2. If impact data available: weighted selection by impact magnitude
   * 3. If no impact data: uniform random selection
   */
  async mutate(
    parent: AgentGenome,
    _portfolio: PortfolioResult,
    _generation: number,
    rng: () => number,
  ): Promise<MutationResult> {
    const currentNames = new Set(parent.frontmatter.skills.map(s => s.name));
    const addable = this.candidates.filter(s => !currentNames.has(s.name));
    const removable = parent.frontmatter.skills;

    const canAdd = addable.length > 0;
    const canRemove = removable.length > 0;

    if (!canAdd && !canRemove) {
      return noOpResult(parent);
    }

    // Decide direction
    let doAdd: boolean;
    if (canAdd && canRemove) {
      doAdd = rng() < this.addRemoveRatio;
    } else {
      doAdd = canAdd;
    }

    if (doAdd) {
      return this.selectAndAdd(parent, addable, rng);
    } else {
      return this.selectAndRemove(parent, removable, rng);
    }
  }

  /** Selects a skill to add, optionally weighted by impact data. */
  private selectAndAdd(
    genome: AgentGenome,
    addable: readonly SkillEntry[],
    rng: () => number,
  ): MutationResult {
    if (addable.length === 0) return noOpResult(genome);

    const selected = this.impactReport
      ? this.weightedSelectAddition(addable, rng)
      : this.uniformSelect(addable, rng);

    if (!selected) return noOpResult(genome);
    return addSkill(genome, selected);
  }

  /** Selects a skill to remove, optionally weighted by impact data. */
  private selectAndRemove(
    genome: AgentGenome,
    removable: readonly SkillEntry[],
    rng: () => number,
  ): MutationResult {
    if (removable.length === 0) return noOpResult(genome);

    const selected = this.impactReport
      ? this.weightedSelectRemoval(removable, rng)
      : this.uniformSelect(removable, rng);

    if (!selected) return noOpResult(genome);
    return removeSkill(genome, selected.name);
  }

  /**
   * Weighted selection for additions: prefer skills with high positive impact.
   * Falls back to uniform if no impact data matches the available skills.
   */
  private weightedSelectAddition(
    addable: readonly SkillEntry[],
    rng: () => number,
  ): SkillEntry | null {
    if (!this.impactReport) return this.uniformSelect(addable, rng);

    const impactMap = new Map<string, number>();
    for (const impact of this.impactReport.additionImpacts) {
      // Weight by positive fitness delta (only consider helpful additions)
      impactMap.set(impact.skill.name, Math.max(0, impact.fitnessDelta));
    }

    const weights = addable.map(s => impactMap.get(s.name) ?? 0);
    const totalWeight = weights.reduce((a, b) => a + b, 0);

    // Fallback to uniform if no impact data
    if (totalWeight <= 0) return this.uniformSelect(addable, rng);

    const idx = weightedSelect(weights, rng);
    return idx >= 0 ? addable[idx] : null;
  }

  /**
   * Weighted selection for removals: prefer skills with low impact (wasteful).
   * Inverts impact: high-impact skills (essential) have low removal probability.
   */
  private weightedSelectRemoval(
    removable: readonly SkillEntry[],
    rng: () => number,
  ): SkillEntry | null {
    if (!this.impactReport) return this.uniformSelect(removable, rng);

    const impactMap = new Map<string, number>();
    let maxMagnitude = 0;
    for (const impact of this.impactReport.removalImpacts) {
      impactMap.set(impact.skill.name, impact.impactMagnitude);
      if (impact.impactMagnitude > maxMagnitude) {
        maxMagnitude = impact.impactMagnitude;
      }
    }

    // Invert: low-impact skills get high weight for removal
    // Weight = maxMagnitude - magnitude + epsilon (so all have some chance)
    const epsilon = 0.001;
    const weights = removable.map(s => {
      const mag = impactMap.get(s.name) ?? 0;
      return maxMagnitude - mag + epsilon;
    });

    const idx = weightedSelect(weights, rng);
    return idx >= 0 ? removable[idx] : null;
  }

  /** Uniform random selection from a list. */
  private uniformSelect(
    skills: readonly SkillEntry[],
    rng: () => number,
  ): SkillEntry | null {
    if (skills.length === 0) return null;
    return skills[Math.floor(rng() * skills.length)];
  }
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function noOpResult(genome: AgentGenome): MutationResult {
  return {
    genome,
    applied: false,
    kind: 'add_skill',
    description: 'No valid skill mutation available',
    affectedSections: [],
  };
}
