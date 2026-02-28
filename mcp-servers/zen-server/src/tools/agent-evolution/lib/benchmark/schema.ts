/**
 * Benchmark task schema for evolutionary agent fitness evaluation.
 *
 * Defines types, dimensions, rubrics, and validation for benchmark tasks
 * that measure agent genome fitness across multiple quality dimensions.
 *
 * Key concepts:
 * - Tasks are self-contained evaluation scenarios (no external dependencies)
 * - Scoring uses a standardized 5-level rubric (0-4) per criterion
 * - Each criterion maps to one of 6 evaluation dimensions
 * - Dimension weights control the fitness function priorities
 * - Criteria link to genome sections via targetSections for mutation targeting
 *
 * Design constraints:
 * - Zero external dependencies
 * - All types are immutable (readonly)
 * - Exhaustive validation for every data structure
 */

import type { CanonicalSectionId } from '../genome/schema.js';

// ---------------------------------------------------------------------------
// Evaluation dimensions
// ---------------------------------------------------------------------------

/**
 * Fitness evaluation dimensions.
 * Aligned with the hybrid ELM + MAP-Elites fitness function
 * defined in AGENT-EVOLUTION-RESEARCH.md.
 */
export const EVALUATION_DIMENSIONS = [
  'correctness',
  'completeness',
  'quality',
  'efficiency',
  'safety',
  'speed',
] as const;

export type EvaluationDimension = typeof EVALUATION_DIMENSIONS[number];

/**
 * Default weights for evaluation dimensions.
 * Source: AGENT-EVOLUTION-RESEARCH.md fitness function.
 * Sum: 1.00
 */
export const DEFAULT_DIMENSION_WEIGHTS: Readonly<Record<EvaluationDimension, number>> = {
  correctness: 0.30,
  completeness: 0.20,
  quality: 0.15,
  efficiency: 0.15,
  safety: 0.10,
  speed: 0.10,
};

// ---------------------------------------------------------------------------
// Rubric
// ---------------------------------------------------------------------------

/** Standard 5-level rubric scores. */
export const RUBRIC_LEVELS = [0, 1, 2, 3, 4] as const;
export type RubricScore = typeof RUBRIC_LEVELS[number];

/** Human-readable labels for each rubric level. */
export const RUBRIC_LABELS: Readonly<Record<RubricScore, string>> = {
  0: 'Missing',
  1: 'Poor',
  2: 'Adequate',
  3: 'Good',
  4: 'Excellent',
};

/** Maximum possible score on the rubric. */
export const MAX_RUBRIC_SCORE: number = 4;

/** Rubric level descriptor for a specific criterion. */
export interface RubricDescriptor {
  readonly score: RubricScore;
  readonly label: string;
  readonly description: string;
}

/**
 * Standard rubrics per evaluation dimension.
 * Tasks use these by default; can be overridden with criterion-specific rubrics.
 */
export const STANDARD_RUBRICS: Readonly<Record<EvaluationDimension, readonly RubricDescriptor[]>> = {
  correctness: [
    { score: 0, label: 'Missing', description: 'Requirements not addressed; output is irrelevant or absent' },
    { score: 1, label: 'Poor', description: 'Major requirements missed; fundamental errors present' },
    { score: 2, label: 'Adequate', description: 'Core requirements partially met; some errors remain' },
    { score: 3, label: 'Good', description: 'All core requirements met; minor issues only' },
    { score: 4, label: 'Excellent', description: 'All requirements met precisely; edge cases handled' },
  ],
  completeness: [
    { score: 0, label: 'Missing', description: 'No criteria addressed' },
    { score: 1, label: 'Poor', description: 'Less than 25% of criteria addressed' },
    { score: 2, label: 'Adequate', description: '25-75% of criteria addressed' },
    { score: 3, label: 'Good', description: '75-100% of criteria addressed with minor gaps' },
    { score: 4, label: 'Excellent', description: 'All criteria fully addressed with thoroughness' },
  ],
  quality: [
    { score: 0, label: 'Missing', description: 'Output is incoherent or unusable' },
    { score: 1, label: 'Poor', description: 'Output is poorly structured; hard to follow or act on' },
    { score: 2, label: 'Adequate', description: 'Output is functional but lacks clarity or polish' },
    { score: 3, label: 'Good', description: 'Output is clear, well-structured, and actionable' },
    { score: 4, label: 'Excellent', description: 'Output is exemplary; insightful and immediately actionable' },
  ],
  efficiency: [
    { score: 0, label: 'Missing', description: 'Excessive token usage with no useful output' },
    { score: 1, label: 'Poor', description: 'Highly verbose; significant unnecessary content' },
    { score: 2, label: 'Adequate', description: 'Some unnecessary verbosity; could be more concise' },
    { score: 3, label: 'Good', description: 'Concise with good signal-to-noise ratio' },
    { score: 4, label: 'Excellent', description: 'Maximally efficient; every token adds value' },
  ],
  safety: [
    { score: 0, label: 'Missing', description: 'Introduces security vulnerabilities or regressions' },
    { score: 1, label: 'Poor', description: 'Ignores safety considerations; potential risks unaddressed' },
    { score: 2, label: 'Adequate', description: 'Basic safety considered; some risks remain' },
    { score: 3, label: 'Good', description: 'Safety well-addressed; no significant risks' },
    { score: 4, label: 'Excellent', description: 'Proactively identifies and mitigates all safety concerns' },
  ],
  speed: [
    { score: 0, label: 'Missing', description: 'No response within timeout' },
    { score: 1, label: 'Poor', description: 'Excessively slow; more than 4x expected duration' },
    { score: 2, label: 'Adequate', description: '1.5-4x expected duration' },
    { score: 3, label: 'Good', description: 'Within expected duration range' },
    { score: 4, label: 'Excellent', description: 'Faster than expected with no quality loss' },
  ],
};

// ---------------------------------------------------------------------------
// Task classification types
// ---------------------------------------------------------------------------

/** Agent types that can be targeted by benchmark tasks. */
export const TARGET_AGENTS = [
  'story-concept',
  'architecture-concept',
  'implementation-concept',
  'quality-concept',
  'verification-concept',
  'context-concept',
  'documentation-concept',
  'security-concept',
  'code-analysis-concept',
  'version-concept',
] as const;

export type TargetAgent = typeof TARGET_AGENTS[number];

/** Task categories for stratified analysis. */
export const TASK_CATEGORIES = [
  'feature',
  'bugfix',
  'refactor',
  'optimization',
  'security',
  'documentation',
] as const;

export type TaskCategory = typeof TASK_CATEGORIES[number];

/** Task difficulty levels. Aligns with MAP-Elites behavioral dimension. */
export const TASK_DIFFICULTIES = [
  'trivial',
  'simple',
  'moderate',
  'complex',
  'expert',
] as const;

export type TaskDifficulty = typeof TASK_DIFFICULTIES[number];

// ---------------------------------------------------------------------------
// Task schema
// ---------------------------------------------------------------------------

/** A file embedded in task context for self-contained evaluation. */
export interface ContextFile {
  readonly path: string;
  readonly content: string;
  readonly language: string;
}

/** Self-contained context for a benchmark task. */
export interface TaskContext {
  readonly projectDescription: string;
  readonly files: readonly ContextFile[];
  readonly constraints: readonly string[];
}

/**
 * A single evaluation criterion within a benchmark task.
 * Maps to one evaluation dimension with a specific weight.
 */
export interface EvaluationCriterion {
  readonly id: string;
  readonly dimension: EvaluationDimension;
  readonly description: string;

  /** Weight within this task. All criteria weights must sum to 1.0. */
  readonly weight: number;

  /** Scoring rubric (5 levels, 0-4). */
  readonly rubric: readonly RubricDescriptor[];

  /**
   * Genome sections this criterion primarily exercises.
   * Used by mutation operators to target improvements.
   */
  readonly targetSections?: readonly CanonicalSectionId[];
}

/**
 * Complete benchmark task definition.
 *
 * Self-contained: includes all context needed for evaluation,
 * requiring no external file system access during scoring.
 */
export interface BenchmarkTask {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly targetAgent: TargetAgent;
  readonly category: TaskCategory;
  readonly difficulty: TaskDifficulty;

  /** The prompt sent to the agent under evaluation. */
  readonly prompt: string;

  /** Embedded context (makes task self-contained and reproducible). */
  readonly context: TaskContext;

  /** Multi-dimensional evaluation criteria with rubrics. */
  readonly criteria: readonly EvaluationCriterion[];

  /** Expected elements in a good response (checklist for automated scoring). */
  readonly expectedElements: readonly string[];

  /** Optional reference output for comparison-based scoring. */
  readonly referenceOutput?: string;

  /** Tags for filtering and stratified analysis. */
  readonly tags: readonly string[];
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/** Per-criterion score from evaluation. */
export interface CriterionScore {
  readonly criterionId: string;
  readonly score: RubricScore;
  readonly rationale: string;
}

/** Resource usage metrics from task execution. */
export interface ResourceUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly durationMs: number;
  readonly estimatedCostUsd: number;
}

/** Evaluation method used to score a task result. */
export type EvaluatorType = 'automated' | 'llm-judge' | 'human';

/**
 * Result of evaluating a single genome variant on a single task.
 *
 * Immutable: once scored, results are never modified.
 */
export interface TaskResult {
  readonly taskId: string;
  readonly genomeId: string;

  /** Per-criterion raw scores with rationale. */
  readonly criterionScores: readonly CriterionScore[];

  /** Aggregate per-dimension scores (weighted average of criteria, normalized 0-1). */
  readonly dimensionScores: Readonly<Record<EvaluationDimension, number>>;

  /** Overall weighted fitness score (0-1). */
  readonly fitness: number;

  /** Resource usage during evaluation. */
  readonly usage: ResourceUsage;

  /** Raw agent output. */
  readonly output: string;

  /** ISO 8601 timestamp. */
  readonly evaluatedAt: string;

  /** How this result was evaluated. */
  readonly evaluator: EvaluatorType;
}

/**
 * Aggregate results for a genome across the full benchmark portfolio.
 */
export interface PortfolioResult {
  readonly genomeId: string;

  /** Per-dimension aggregate scores (mean across tasks). */
  readonly dimensionMeans: Readonly<Record<EvaluationDimension, number>>;

  /** Per-dimension standard deviations. */
  readonly dimensionStdDevs: Readonly<Record<EvaluationDimension, number>>;

  /** Overall portfolio fitness (weighted sum of dimension means). */
  readonly fitness: number;

  /** Total resource usage across all tasks. */
  readonly totalUsage: ResourceUsage;

  /** Number of tasks evaluated. */
  readonly taskCount: number;

  /** Individual task results. */
  readonly taskResults: readonly TaskResult[];
}

// ---------------------------------------------------------------------------
// Statistical comparison
// ---------------------------------------------------------------------------

/** Per-dimension comparison data. */
export interface DimensionComparison {
  readonly meanA: number;
  readonly meanB: number;
  readonly delta: number;
  readonly significant: boolean;
}

/**
 * Result of a Welch's t-test comparison between two genome variants.
 */
export interface ComparisonResult {
  readonly genomeA: string;
  readonly genomeB: string;

  /** T-statistic (positive = A better). */
  readonly tStatistic: number;

  /** Two-tailed p-value. */
  readonly pValue: number;

  /** Cohen's d effect size. */
  readonly effectSize: number;

  /** Degrees of freedom (Welch-Satterthwaite). */
  readonly degreesOfFreedom: number;

  /** Whether the difference is statistically significant at alpha=0.05. */
  readonly significant: boolean;

  /** Per-dimension comparisons. */
  readonly dimensionComparisons: Readonly<Record<EvaluationDimension, DimensionComparison>>;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Validation result shared across all benchmark data structures. */
export interface BenchmarkValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

/** Floating-point tolerance for weight summation checks. */
const WEIGHT_TOLERANCE = 0.001;

/** Validates a benchmark task for structural integrity. */
export function validateTask(task: BenchmarkTask): BenchmarkValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required fields
  if (!task.id) errors.push('task.id is required');
  if (!task.name) errors.push('task.name is required');
  if (!task.prompt) errors.push('task.prompt is required');

  // Classification enums
  if (!(TARGET_AGENTS as readonly string[]).includes(task.targetAgent)) {
    errors.push(`task.targetAgent must be one of: ${TARGET_AGENTS.join(', ')}`);
  }
  if (!(TASK_CATEGORIES as readonly string[]).includes(task.category)) {
    errors.push(`task.category must be one of: ${TASK_CATEGORIES.join(', ')}`);
  }
  if (!(TASK_DIFFICULTIES as readonly string[]).includes(task.difficulty)) {
    errors.push(`task.difficulty must be one of: ${TASK_DIFFICULTIES.join(', ')}`);
  }

  // Criteria present
  if (task.criteria.length === 0) {
    errors.push('task must have at least one evaluation criterion');
  }

  // Criteria weights sum to 1.0
  const weightSum = task.criteria.reduce((sum, c) => sum + c.weight, 0);
  if (Math.abs(weightSum - 1.0) > WEIGHT_TOLERANCE) {
    errors.push(`criteria weights must sum to 1.0 (got ${weightSum.toFixed(4)})`);
  }

  // Per-criterion validation
  const criterionIds = new Set<string>();
  for (const criterion of task.criteria) {
    if (!criterion.id) {
      errors.push('criterion.id is required');
    }
    if (criterionIds.has(criterion.id)) {
      errors.push(`duplicate criterion id: ${criterion.id}`);
    }
    criterionIds.add(criterion.id);

    if (!(EVALUATION_DIMENSIONS as readonly string[]).includes(criterion.dimension)) {
      errors.push(`criterion '${criterion.id}': invalid dimension '${criterion.dimension}'`);
    }
    if (criterion.weight <= 0 || criterion.weight > 1) {
      errors.push(`criterion '${criterion.id}': weight must be in (0, 1]`);
    }
    if (criterion.rubric.length !== RUBRIC_LEVELS.length) {
      errors.push(`criterion '${criterion.id}': rubric must have ${RUBRIC_LEVELS.length} levels`);
    }
  }

  // Dimension coverage
  const coveredDimensions = new Set(task.criteria.map(c => c.dimension));
  for (const dim of EVALUATION_DIMENSIONS) {
    if (!coveredDimensions.has(dim)) {
      warnings.push(`dimension '${dim}' has no criteria (will score 0)`);
    }
  }

  // Context
  if (!task.context.projectDescription) {
    warnings.push('task.context.projectDescription is empty');
  }

  // Expected elements
  if (task.expectedElements.length === 0) {
    warnings.push('task has no expectedElements (limits automated scoring)');
  }

  return { valid: errors.length === 0, errors, warnings };
}

/** Validates a task result against its task definition. */
export function validateResult(result: TaskResult, task: BenchmarkTask): BenchmarkValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (result.taskId !== task.id) {
    errors.push(`result.taskId '${result.taskId}' does not match task.id '${task.id}'`);
  }

  if (!result.genomeId) {
    errors.push('result.genomeId is required');
  }
  if (!result.output) {
    warnings.push('result.output is empty');
  }

  // Criterion scores must match task criteria
  const taskCriterionIds = new Set(task.criteria.map(c => c.id));
  const resultCriterionIds = new Set(result.criterionScores.map(s => s.criterionId));

  for (const id of taskCriterionIds) {
    if (!resultCriterionIds.has(id)) {
      errors.push(`missing score for criterion '${id}'`);
    }
  }

  for (const score of result.criterionScores) {
    if (!taskCriterionIds.has(score.criterionId)) {
      warnings.push(`score for unknown criterion '${score.criterionId}'`);
    }
    if (!(RUBRIC_LEVELS as readonly number[]).includes(score.score)) {
      errors.push(`criterion '${score.criterionId}': score ${score.score} not in valid range [0-4]`);
    }
  }

  // Fitness range
  if (result.fitness < 0 || result.fitness > 1) {
    errors.push(`fitness ${result.fitness} out of range [0, 1]`);
  }

  // Resource usage non-negative
  if (result.usage.inputTokens < 0) errors.push('usage.inputTokens must be >= 0');
  if (result.usage.outputTokens < 0) errors.push('usage.outputTokens must be >= 0');
  if (result.usage.durationMs < 0) errors.push('usage.durationMs must be >= 0');

  return { valid: errors.length === 0, errors, warnings };
}

/** Validates that dimension weights are well-formed. */
export function validateDimensionWeights(
  weights: Readonly<Record<EvaluationDimension, number>>,
): BenchmarkValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const dim of EVALUATION_DIMENSIONS) {
    if (weights[dim] === undefined) {
      errors.push(`missing weight for dimension '${dim}'`);
    } else if (weights[dim] < 0) {
      errors.push(`weight for '${dim}' must be >= 0`);
    }
  }

  const sum = EVALUATION_DIMENSIONS.reduce((s, d) => s + (weights[d] ?? 0), 0);
  if (Math.abs(sum - 1.0) > WEIGHT_TOLERANCE) {
    errors.push(`dimension weights must sum to 1.0 (got ${sum.toFixed(4)})`);
  }

  return { valid: errors.length === 0, errors, warnings };
}
