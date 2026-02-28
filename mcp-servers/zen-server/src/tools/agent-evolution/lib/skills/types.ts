/**
 * Types for skills evolution: combinatorial optimization of agent skill sets.
 *
 * Skills are discrete choices — each agent has a set of skills that can be
 * added, removed, or swapped. This module applies the same evolutionary
 * framework used for sections to the skill domain:
 *
 * 1. Skill impact analysis: measure fitness delta per skill (add/remove)
 * 2. Combinatorial mutation: add/remove skills weighted by impact
 * 3. MAP-Elites integration: skill variants populate the cost/quality grid
 *
 * Design reference: AGENT-EVOLUTION-RESEARCH.md Phase 1, Step 7
 */

import type { SkillEntry } from '../genome/schema.js';
import type {
  ComparisonResult,
  EvaluationDimension,
  PortfolioResult,
} from '../benchmark/schema.js';

// ---------------------------------------------------------------------------
// Skill impact
// ---------------------------------------------------------------------------

/** The direction of a skill mutation: adding or removing. */
export type SkillMutationDirection = 'add' | 'remove';

/**
 * Fitness impact of adding or removing a single skill.
 *
 * For additions: positive fitnessDelta means the skill helps.
 * For removals: negative fitnessDelta means the skill was beneficial
 * (removing it hurts).
 */
export interface SkillImpact {
  /** The skill that was mutated. */
  readonly skill: SkillEntry;

  /** Whether this skill is in the baseline genome. */
  readonly presentInBaseline: boolean;

  /** Whether we tested adding or removing this skill. */
  readonly direction: SkillMutationDirection;

  /**
   * Fitness change from baseline: mutated - baseline.
   * For additions: positive = skill helps, negative = skill hurts.
   * For removals: negative = skill was beneficial, positive = skill was harmful.
   */
  readonly fitnessDelta: number;

  /** Absolute fitness impact magnitude. */
  readonly impactMagnitude: number;

  /** Cohen's d effect size. null if insufficient samples. */
  readonly effectSize: number | null;

  /** Whether the delta is statistically significant. */
  readonly significant: boolean;

  /** Two-tailed p-value. null if insufficient samples. */
  readonly pValue: number | null;

  /** Per-dimension fitness deltas. */
  readonly dimensionDeltas: Readonly<Record<EvaluationDimension, number>>;

  /** Baseline fitness. */
  readonly baselineFitness: number;

  /** Mutated fitness (after add/remove). */
  readonly mutatedFitness: number;

  /** Full statistical comparison. null if insufficient samples. */
  readonly comparison: ComparisonResult | null;
}

// ---------------------------------------------------------------------------
// Skill catalog
// ---------------------------------------------------------------------------

/**
 * The full catalog of available skills for evolution.
 *
 * Sourced from the skills manifest (.claude/skills-manifest.yaml).
 * Each entry includes the skill name, description, and priority tier.
 */
export interface SkillCatalogEntry {
  readonly skill: SkillEntry;

  /** Priority tier from the manifest. */
  readonly priority: 'P0' | 'P1' | 'P2' | 'P3' | 'meta';

  /** Which agent types typically use this skill. */
  readonly typicalAgents: readonly string[];
}

// ---------------------------------------------------------------------------
// Skill evolution report
// ---------------------------------------------------------------------------

/**
 * Complete skill evolution analysis for a genome.
 *
 * Contains both addition impacts (skills not in baseline → tested by adding)
 * and removal impacts (skills in baseline → tested by removing).
 */
export interface SkillEvolutionReport {
  /** Genome identifier. */
  readonly genomeId: string;

  /** Agent name. */
  readonly agentName: string;

  /** Baseline portfolio (current skill set). */
  readonly baseline: PortfolioResult;

  /** Skills currently in the genome. */
  readonly currentSkills: readonly SkillEntry[];

  /**
   * Impact of removing each current skill.
   * Ranked by impact magnitude (most impactful removal first).
   * Negative fitnessDelta = skill is beneficial (removing hurts).
   */
  readonly removalImpacts: readonly SkillImpact[];

  /**
   * Impact of adding each candidate skill.
   * Ranked by impact magnitude (most impactful addition first).
   * Positive fitnessDelta = skill helps when added.
   */
  readonly additionImpacts: readonly SkillImpact[];

  /**
   * Recommended optimal skill set based on impact analysis.
   * Includes: current skills that hurt when removed + candidate skills that help when added.
   */
  readonly recommendedSkills: readonly SkillEntry[];

  /** Number of skill mutations tested. */
  readonly totalMutationsTested: number;

  /** Number of evaluations performed (1 baseline + N mutations). */
  readonly totalEvaluations: number;

  /** ISO 8601 timestamp. */
  readonly analyzedAt: string;
}

// ---------------------------------------------------------------------------
// Analyzer configuration
// ---------------------------------------------------------------------------

/** Configuration for the skill analyzer. */
export interface SkillAnalyzerConfig {
  /** Significance level for statistical tests. Default: 0.05 */
  readonly alpha: number;

  /**
   * Minimum fitness improvement to recommend adding a skill.
   * Prevents recommending marginal additions that add cost.
   * Default: 0.01
   */
  readonly minAdditionBenefit: number;

  /**
   * Minimum fitness loss to consider a skill essential.
   * Skills whose removal causes less than this drop may be cut.
   * Default: 0.005
   */
  readonly minRemovalPenalty: number;
}

/** Default skill analyzer configuration. */
export const DEFAULT_SKILL_ANALYZER_CONFIG: SkillAnalyzerConfig = {
  alpha: 0.05,
  minAdditionBenefit: 0.01,
  minRemovalPenalty: 0.005,
};
