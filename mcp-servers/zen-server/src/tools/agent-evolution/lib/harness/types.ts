/**
 * Interfaces for the fitness evaluation harness.
 *
 * The harness orchestrates: genome assembly → agent execution → output scoring.
 * Both executor and scorer are injectable interfaces for testability:
 * - Tests use mocks
 * - Production uses Claude Code Task tool + LLM-as-judge
 */

import type {
  BenchmarkTask,
  CriterionScore,
  ResourceUsage,
  TargetAgent,
  TaskContext,
} from '../benchmark/schema.js';

// ---------------------------------------------------------------------------
// Agent execution
// ---------------------------------------------------------------------------

/** Output from executing an agent on a task. */
export interface ExecutionOutput {
  /** The agent's raw text output. */
  readonly output: string;
  /** Resource usage metrics. */
  readonly usage: ResourceUsage;
}

/**
 * Executes an assembled agent prompt against a benchmark task.
 *
 * In production: invokes the Claude Code Task tool.
 * In tests: returns canned or computed responses.
 */
export interface AgentExecutor {
  execute(
    agentPrompt: string,
    taskPrompt: string,
    context: TaskContext,
  ): Promise<ExecutionOutput>;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Scores an agent's output against a benchmark task's criteria.
 *
 * Implementations:
 * - AutomatedScorer: fast, deterministic, pattern-based
 * - LLMJudgeScorer: accurate, slower, uses LLM-as-judge
 */
export interface Scorer {
  score(
    task: BenchmarkTask,
    output: string,
  ): Promise<readonly CriterionScore[]>;
}

// ---------------------------------------------------------------------------
// Harness configuration
// ---------------------------------------------------------------------------

/** Configuration for the evaluation harness. */
export interface HarnessConfig {
  /**
   * Only evaluate tasks targeting this agent type.
   * If undefined, inferred from the genome's agentName.
   */
  readonly filterAgent?: TargetAgent;

  /** Timeout per individual task evaluation in milliseconds. */
  readonly taskTimeoutMs?: number;
}
