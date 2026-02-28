/**
 * Fitness evaluation harness: orchestrates genome → execution → scoring.
 *
 * The harness is the integration point between:
 * - Genome module (assembly)
 * - Benchmark module (tasks, scoring math)
 * - Mutation module (variant genomes)
 *
 * It handles:
 * - Genome assembly into runnable prompts
 * - Task filtering by agent type
 * - Sequential task execution with error isolation
 * - Fitness computation from scorer output
 * - Portfolio aggregation and variant comparison
 *
 * Design constraints:
 * - Executor and scorer are injectable (testable)
 * - Single task failure does not abort portfolio evaluation
 * - All results are immutable
 */

import type { AgentGenome } from '../genome/schema.js';
import { assembleGenome } from '../genome/assembler.js';
import type {
  BenchmarkTask,
  CriterionScore,
  EvaluationDimension,
  PortfolioResult,
  ResourceUsage,
  RubricScore,
  TaskResult,
} from '../benchmark/schema.js';
import {
  EVALUATION_DIMENSIONS,
  type ComparisonResult,
  type TargetAgent,
  TARGET_AGENTS,
} from '../benchmark/schema.js';
import {
  compareVariants,
  computePortfolioFitness,
  computeTaskFitness,
} from '../benchmark/evaluator.js';
import type { AgentExecutor, HarnessConfig, Scorer } from './types.js';

// ---------------------------------------------------------------------------
// Zero-value constants
// ---------------------------------------------------------------------------

const ZERO_USAGE: ResourceUsage = {
  inputTokens: 0,
  outputTokens: 0,
  durationMs: 0,
  estimatedCostUsd: 0,
};

// ---------------------------------------------------------------------------
// Task filtering
// ---------------------------------------------------------------------------

/**
 * Determines the target agent for task filtering.
 *
 * Priority:
 * 1. Explicit config.filterAgent
 * 2. Genome's agentName if it matches a known target agent
 * 3. null (run all tasks)
 */
function resolveTargetAgent(
  genome: AgentGenome,
  config: HarnessConfig,
): TargetAgent | null {
  if (config.filterAgent) return config.filterAgent;

  if ((TARGET_AGENTS as readonly string[]).includes(genome.agentName)) {
    return genome.agentName as TargetAgent;
  }

  return null;
}

/** Filters tasks to those matching the target agent (or all if null). */
function filterTasks(
  tasks: readonly BenchmarkTask[],
  targetAgent: TargetAgent | null,
): readonly BenchmarkTask[] {
  if (!targetAgent) return tasks;
  return tasks.filter(t => t.targetAgent === targetAgent);
}

// ---------------------------------------------------------------------------
// Error result factory
// ---------------------------------------------------------------------------

/**
 * Creates a zero-score TaskResult for a failed evaluation.
 * All criterion scores are 0 (Missing) and the error is recorded in output.
 */
function failedTaskResult(
  task: BenchmarkTask,
  genomeId: string,
  error: unknown,
): TaskResult {
  const errorMessage = error instanceof Error ? error.message : String(error);

  const criterionScores: CriterionScore[] = task.criteria.map(c => ({
    criterionId: c.id,
    score: 0 as RubricScore,
    rationale: `Evaluation failed: ${errorMessage}`,
  }));

  const dimensionScores = {} as Record<EvaluationDimension, number>;
  for (const dim of EVALUATION_DIMENSIONS) {
    dimensionScores[dim] = 0;
  }

  return {
    taskId: task.id,
    genomeId,
    criterionScores,
    dimensionScores,
    fitness: 0,
    usage: ZERO_USAGE,
    output: `[ERROR] ${errorMessage}`,
    evaluatedAt: new Date().toISOString(),
    evaluator: 'automated',
  };
}

// ---------------------------------------------------------------------------
// Evaluation harness
// ---------------------------------------------------------------------------

/**
 * Orchestrates fitness evaluation of genome variants against benchmark tasks.
 *
 * Usage:
 * ```typescript
 * const harness = new EvaluationHarness(executor, scorer);
 * const portfolio = await harness.evaluatePortfolio(genome, BENCHMARK_CATALOG);
 * console.log(portfolio.fitness); // 0.0 - 1.0
 * ```
 */
export class EvaluationHarness {
  private readonly executor: AgentExecutor;
  private readonly scorer: Scorer;
  private readonly config: HarnessConfig;

  constructor(
    executor: AgentExecutor,
    scorer: Scorer,
    config: HarnessConfig = {},
  ) {
    this.executor = executor;
    this.scorer = scorer;
    this.config = config;
  }

  /**
   * Evaluates a single genome on a single task.
   *
   * Flow: assemble → execute → score → compute fitness
   *
   * On executor or scorer failure, returns a zero-score result
   * with the error recorded in the output field.
   */
  async evaluateTask(
    genome: AgentGenome,
    task: BenchmarkTask,
    genomeId?: string,
  ): Promise<TaskResult> {
    const id = genomeId ?? genome.agentName;

    try {
      // 1. Assemble genome into agent prompt
      const agentPrompt = assembleGenome(genome);

      // 2. Execute agent on task
      const executionPromise = this.executor.execute(
        agentPrompt,
        task.prompt,
        task.context,
      );

      // 3. Apply timeout if configured
      let execution;
      if (this.config.taskTimeoutMs) {
        execution = await withTimeout(
          executionPromise,
          this.config.taskTimeoutMs,
        );
      } else {
        execution = await executionPromise;
      }

      // 4. Score the output
      const criterionScores = await this.scorer.score(task, execution.output);

      // 5. Compute fitness
      return computeTaskFitness(
        task,
        criterionScores,
        execution.usage,
        execution.output,
        id,
      );
    } catch (error) {
      return failedTaskResult(task, id, error);
    }
  }

  /**
   * Evaluates a genome across a set of benchmark tasks.
   *
   * Automatically filters tasks to those matching the genome's agent type.
   * Each task is evaluated independently — one failure does not affect others.
   *
   * @param genome - The genome variant to evaluate
   * @param tasks - Task catalog to evaluate against
   * @param genomeId - Optional unique identifier (defaults to agentName)
   * @returns Aggregated portfolio result
   */
  async evaluatePortfolio(
    genome: AgentGenome,
    tasks: readonly BenchmarkTask[],
    genomeId?: string,
  ): Promise<PortfolioResult> {
    const id = genomeId ?? genome.agentName;
    const targetAgent = resolveTargetAgent(genome, this.config);
    const matchingTasks = filterTasks(tasks, targetAgent);

    const taskResults: TaskResult[] = [];

    for (const task of matchingTasks) {
      const result = await this.evaluateTask(genome, task, id);
      taskResults.push(result);
    }

    return computePortfolioFitness(id, taskResults);
  }

  /**
   * Head-to-head comparison of two genome variants.
   *
   * Evaluates both genomes on the same task set (intersection of
   * their matching tasks) and performs Welch's t-test on fitness scores.
   *
   * @param genomeA - First variant
   * @param genomeB - Second variant
   * @param tasks - Task catalog
   * @param alpha - Significance level (default 0.05)
   * @returns Statistical comparison result
   */
  async compare(
    genomeA: AgentGenome,
    genomeB: AgentGenome,
    tasks: readonly BenchmarkTask[],
    alpha?: number,
  ): Promise<ComparisonResult> {
    const portfolioA = await this.evaluatePortfolio(genomeA, tasks);
    const portfolioB = await this.evaluatePortfolio(genomeB, tasks);

    return compareVariants(portfolioA, portfolioB, alpha);
  }
}

// ---------------------------------------------------------------------------
// Timeout utility
// ---------------------------------------------------------------------------

/**
 * Wraps a promise with a timeout.
 * Rejects with a descriptive error if the timeout expires.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Task evaluation timed out after ${ms}ms`)),
      ms,
    );
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}
