import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EvaluationHarness } from '../harness.js';
import type { AgentExecutor, ExecutionOutput, Scorer } from '../types.js';
import type { AgentGenome } from '../../genome/schema.js';
import type {
  BenchmarkTask,
  CriterionScore,
  RubricScore,
  TaskContext,
} from '../../benchmark/schema.js';
import { STANDARD_RUBRICS } from '../../benchmark/schema.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const ZERO_USAGE = {
  inputTokens: 100,
  outputTokens: 200,
  durationMs: 500,
  estimatedCostUsd: 0.003,
} as const;

function makeGenome(
  agentName: string,
  overrides?: Partial<AgentGenome>,
): AgentGenome {
  return {
    agentName,
    frontmatter: {
      name: agentName,
      description: 'Test agent',
      model: 'sonnet',
      tools: '*',
      disallowedTools: [],
      mcpServers: [],
      color: '#888',
      hooks: {},
      skills: [],
      type: 'workflow',
      execution: 'task-tool',
      costPerAction: 0.01,
      optimizationLevel: 'baseline',
      expectedContextTokens: 1000,
      expectedDurationSeconds: 30,
    },
    rawFrontmatter: `name: ${agentName}\ndescription: Test agent`,
    title: `# ${agentName}`,
    sections: [
      {
        id: 'purpose',
        heading: 'Purpose',
        level: 2,
        content: 'This is a test agent.',
      },
    ],
    ...overrides,
  };
}

function makeTask(
  id: string,
  targetAgent: string = 'story-concept',
  expectedElements: string[] = ['element one'],
): BenchmarkTask {
  return {
    id,
    name: `Task ${id}`,
    description: `Description for ${id}`,
    targetAgent: targetAgent as BenchmarkTask['targetAgent'],
    category: 'feature',
    difficulty: 'simple',
    prompt: `Prompt for ${id}`,
    context: { projectDescription: 'Test project', files: [], constraints: [] },
    criteria: [
      {
        id: 'c-correctness',
        dimension: 'correctness',
        description: 'Is it correct?',
        weight: 0.6,
        rubric: STANDARD_RUBRICS.correctness,
      },
      {
        id: 'c-completeness',
        dimension: 'completeness',
        description: 'Is it complete?',
        weight: 0.4,
        rubric: STANDARD_RUBRICS.completeness,
      },
    ],
    expectedElements,
    tags: [],
  };
}

function makeExecutor(output: string = 'Mock output'): AgentExecutor {
  return {
    execute: vi.fn().mockResolvedValue({
      output,
      usage: ZERO_USAGE,
    } satisfies ExecutionOutput),
  };
}

function makeScorer(
  score: RubricScore = 3,
  rationale: string = 'Good',
): Scorer {
  return {
    score: vi.fn().mockImplementation(
      (task: BenchmarkTask, _output: string) =>
        Promise.resolve(
          task.criteria.map(c => ({
            criterionId: c.id,
            score,
            rationale,
          })),
        ),
    ),
  };
}

// ---------------------------------------------------------------------------
// EvaluationHarness – evaluateTask
// ---------------------------------------------------------------------------

describe('EvaluationHarness.evaluateTask', () => {
  it('assembles genome, executes, scores, and computes fitness', async () => {
    const executor = makeExecutor('Good output');
    const scorer = makeScorer(4, 'Excellent');
    const harness = new EvaluationHarness(executor, scorer);

    const genome = makeGenome('story-concept');
    const task = makeTask('t1');

    const result = await harness.evaluateTask(genome, task);

    // Executor called with assembled prompt
    expect(executor.execute).toHaveBeenCalledOnce();
    const [agentPrompt, taskPrompt, ctx] = (executor.execute as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(agentPrompt).toContain('story-concept');
    expect(taskPrompt).toBe('Prompt for t1');
    expect(ctx).toEqual(task.context);

    // Scorer called with task and executor output
    expect(scorer.score).toHaveBeenCalledOnce();
    expect((scorer.score as ReturnType<typeof vi.fn>).mock.calls[0][1]).toBe('Good output');

    // Result structure
    expect(result.taskId).toBe('t1');
    expect(result.genomeId).toBe('story-concept');
    expect(result.criterionScores).toHaveLength(2);
    expect(result.fitness).toBeGreaterThan(0);
    expect(result.output).toBe('Good output');
    expect(result.usage).toEqual(ZERO_USAGE);
    expect(result.evaluatedAt).toBeTruthy();
  });

  it('uses custom genomeId when provided', async () => {
    const harness = new EvaluationHarness(makeExecutor(), makeScorer());
    const genome = makeGenome('story-concept');
    const task = makeTask('t1');

    const result = await harness.evaluateTask(genome, task, 'variant-alpha');

    expect(result.genomeId).toBe('variant-alpha');
  });

  it('returns zero-score result on executor failure', async () => {
    const executor: AgentExecutor = {
      execute: vi.fn().mockRejectedValue(new Error('LLM API timeout')),
    };
    const scorer = makeScorer();
    const harness = new EvaluationHarness(executor, scorer);

    const genome = makeGenome('story-concept');
    const task = makeTask('t1');

    const result = await harness.evaluateTask(genome, task);

    expect(result.fitness).toBe(0);
    expect(result.output).toContain('LLM API timeout');
    expect(result.criterionScores.every(s => s.score === 0)).toBe(true);
    // Scorer should NOT have been called
    expect(scorer.score).not.toHaveBeenCalled();
  });

  it('returns zero-score result on scorer failure', async () => {
    const executor = makeExecutor();
    const scorer: Scorer = {
      score: vi.fn().mockRejectedValue(new Error('Scoring failed')),
    };
    const harness = new EvaluationHarness(executor, scorer);

    const genome = makeGenome('story-concept');
    const task = makeTask('t1');

    const result = await harness.evaluateTask(genome, task);

    expect(result.fitness).toBe(0);
    expect(result.output).toContain('Scoring failed');
    expect(result.criterionScores.every(s => s.score === 0)).toBe(true);
  });

  it('handles non-Error thrown objects', async () => {
    const executor: AgentExecutor = {
      execute: vi.fn().mockRejectedValue('raw string error'),
    };
    const harness = new EvaluationHarness(executor, makeScorer());

    const genome = makeGenome('story-concept');
    const task = makeTask('t1');

    const result = await harness.evaluateTask(genome, task);

    expect(result.fitness).toBe(0);
    expect(result.output).toContain('raw string error');
  });

  it('computes correct fitness from scored criteria', async () => {
    const scorer: Scorer = {
      score: vi.fn().mockResolvedValue([
        { criterionId: 'c-correctness', score: 4, rationale: 'Perfect' },
        { criterionId: 'c-completeness', score: 2, rationale: 'Adequate' },
      ] satisfies CriterionScore[]),
    };
    const harness = new EvaluationHarness(makeExecutor(), scorer);

    const genome = makeGenome('story-concept');
    const task = makeTask('t1');

    const result = await harness.evaluateTask(genome, task);

    // correctness: 4/4 = 1.0 (weight 0.6 in task, weight 0.30 in dimension)
    // completeness: 2/4 = 0.5 (weight 0.4 in task, weight 0.20 in dimension)
    expect(result.dimensionScores.correctness).toBe(1.0);
    expect(result.dimensionScores.completeness).toBe(0.5);

    // fitness = (1.0 * 0.30) + (0.5 * 0.20) + (0 * 0.15) + (0 * 0.15) + (0 * 0.10) + (0 * 0.10)
    //         = 0.30 + 0.10 = 0.40
    expect(result.fitness).toBeCloseTo(0.40, 10);
  });
});

// ---------------------------------------------------------------------------
// EvaluationHarness – evaluatePortfolio
// ---------------------------------------------------------------------------

describe('EvaluationHarness.evaluatePortfolio', () => {
  it('evaluates matching tasks only (by genome agentName)', async () => {
    const executor = makeExecutor();
    const scorer = makeScorer(3);
    const harness = new EvaluationHarness(executor, scorer);

    const genome = makeGenome('story-concept');
    const tasks = [
      makeTask('t-story-1', 'story-concept'),
      makeTask('t-story-2', 'story-concept'),
      makeTask('t-arch-1', 'architecture-concept'),
    ];

    const portfolio = await harness.evaluatePortfolio(genome, tasks);

    // Only story-concept tasks should be evaluated
    expect(portfolio.taskResults).toHaveLength(2);
    expect(portfolio.taskResults[0].taskId).toBe('t-story-1');
    expect(portfolio.taskResults[1].taskId).toBe('t-story-2');
    expect(executor.execute).toHaveBeenCalledTimes(2);
  });

  it('evaluates all tasks when genome name is not a target agent', async () => {
    const executor = makeExecutor();
    const scorer = makeScorer(2);
    const harness = new EvaluationHarness(executor, scorer);

    const genome = makeGenome('custom-agent');
    const tasks = [
      makeTask('t1', 'story-concept'),
      makeTask('t2', 'architecture-concept'),
    ];

    const portfolio = await harness.evaluatePortfolio(genome, tasks);

    expect(portfolio.taskResults).toHaveLength(2);
    expect(executor.execute).toHaveBeenCalledTimes(2);
  });

  it('respects filterAgent config override', async () => {
    const executor = makeExecutor();
    const scorer = makeScorer(3);
    const harness = new EvaluationHarness(executor, scorer, {
      filterAgent: 'architecture-concept',
    });

    // Genome says story-concept, but config overrides to architecture-concept
    const genome = makeGenome('story-concept');
    const tasks = [
      makeTask('t-story-1', 'story-concept'),
      makeTask('t-arch-1', 'architecture-concept'),
    ];

    const portfolio = await harness.evaluatePortfolio(genome, tasks);

    expect(portfolio.taskResults).toHaveLength(1);
    expect(portfolio.taskResults[0].taskId).toBe('t-arch-1');
  });

  it('returns zero-fitness portfolio when no tasks match', async () => {
    const executor = makeExecutor();
    const scorer = makeScorer();
    const harness = new EvaluationHarness(executor, scorer);

    const genome = makeGenome('story-concept');
    const tasks = [makeTask('t1', 'architecture-concept')];

    const portfolio = await harness.evaluatePortfolio(genome, tasks);

    expect(portfolio.taskResults).toHaveLength(0);
    expect(portfolio.fitness).toBe(0);
    expect(portfolio.taskCount).toBe(0);
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it('aggregates fitness across multiple tasks', async () => {
    const callCount = { n: 0 };
    const scorer: Scorer = {
      score: vi.fn().mockImplementation((task: BenchmarkTask) => {
        callCount.n++;
        // First task scores 4, second scores 2
        const s = callCount.n === 1 ? 4 : 2;
        return Promise.resolve(
          task.criteria.map(c => ({
            criterionId: c.id,
            score: s as RubricScore,
            rationale: `Score ${s}`,
          })),
        );
      }),
    };

    const harness = new EvaluationHarness(makeExecutor(), scorer);
    const genome = makeGenome('story-concept');
    const tasks = [
      makeTask('t1', 'story-concept'),
      makeTask('t2', 'story-concept'),
    ];

    const portfolio = await harness.evaluatePortfolio(genome, tasks);

    expect(portfolio.taskCount).toBe(2);
    expect(portfolio.fitness).toBeGreaterThan(0);
    // Portfolio fitness should be between the individual task fitnesses
    const fitnesses = portfolio.taskResults.map(r => r.fitness);
    expect(portfolio.fitness).toBeGreaterThanOrEqual(Math.min(...fitnesses));
    expect(portfolio.fitness).toBeLessThanOrEqual(Math.max(...fitnesses));
  });

  it('uses custom genomeId', async () => {
    const harness = new EvaluationHarness(makeExecutor(), makeScorer());
    const genome = makeGenome('story-concept');
    const tasks = [makeTask('t1', 'story-concept')];

    const portfolio = await harness.evaluatePortfolio(genome, tasks, 'gen-v2');

    expect(portfolio.genomeId).toBe('gen-v2');
    expect(portfolio.taskResults[0].genomeId).toBe('gen-v2');
  });

  it('isolates individual task failures', async () => {
    let callCount = 0;
    const executor: AgentExecutor = {
      execute: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 2) {
          return Promise.reject(new Error('Task 2 failed'));
        }
        return Promise.resolve({ output: 'Success', usage: ZERO_USAGE });
      }),
    };

    const harness = new EvaluationHarness(executor, makeScorer(4));
    const genome = makeGenome('story-concept');
    const tasks = [
      makeTask('t1', 'story-concept'),
      makeTask('t2', 'story-concept'),
      makeTask('t3', 'story-concept'),
    ];

    const portfolio = await harness.evaluatePortfolio(genome, tasks);

    // All 3 tasks should have results
    expect(portfolio.taskResults).toHaveLength(3);

    // Task 2 should be the failure
    expect(portfolio.taskResults[1].fitness).toBe(0);
    expect(portfolio.taskResults[1].output).toContain('Task 2 failed');

    // Tasks 1 and 3 should succeed
    expect(portfolio.taskResults[0].fitness).toBeGreaterThan(0);
    expect(portfolio.taskResults[2].fitness).toBeGreaterThan(0);
  });

  it('aggregates resource usage', async () => {
    const harness = new EvaluationHarness(makeExecutor(), makeScorer());
    const genome = makeGenome('story-concept');
    const tasks = [
      makeTask('t1', 'story-concept'),
      makeTask('t2', 'story-concept'),
    ];

    const portfolio = await harness.evaluatePortfolio(genome, tasks);

    // Each task uses ZERO_USAGE (inputTokens: 100, outputTokens: 200, etc.)
    expect(portfolio.totalUsage.inputTokens).toBe(200);
    expect(portfolio.totalUsage.outputTokens).toBe(400);
    expect(portfolio.totalUsage.durationMs).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// EvaluationHarness – compare
// ---------------------------------------------------------------------------

describe('EvaluationHarness.compare', () => {
  it('returns statistical comparison between two genomes', async () => {
    let callCount = 0;
    const scorer: Scorer = {
      score: vi.fn().mockImplementation((task: BenchmarkTask) => {
        callCount++;
        // Genome A scores higher than genome B
        const s = callCount <= 2 ? 4 : 1;
        return Promise.resolve(
          task.criteria.map(c => ({
            criterionId: c.id,
            score: s as RubricScore,
            rationale: `Score ${s}`,
          })),
        );
      }),
    };

    const harness = new EvaluationHarness(makeExecutor(), scorer);
    const genomeA = makeGenome('story-concept');
    const genomeB = makeGenome('story-concept');
    const tasks = [
      makeTask('t1', 'story-concept'),
      makeTask('t2', 'story-concept'),
    ];

    const comparison = await harness.compare(genomeA, genomeB, tasks);

    expect(comparison.genomeA).toBe('story-concept');
    expect(comparison.genomeB).toBe('story-concept');
    expect(typeof comparison.tStatistic).toBe('number');
    expect(typeof comparison.pValue).toBe('number');
    expect(typeof comparison.effectSize).toBe('number');
    expect(typeof comparison.degreesOfFreedom).toBe('number');
    expect(typeof comparison.significant).toBe('boolean');
    expect(comparison.dimensionComparisons).toBeDefined();
  });

  it('reports correct winner when A is better', async () => {
    let callCount = 0;
    const scorer: Scorer = {
      score: vi.fn().mockImplementation((task: BenchmarkTask) => {
        callCount++;
        // Genome A gets scores [4, 3], Genome B gets scores [1, 0]
        // This ensures variance > 0 for Welch's t-test
        const scores: RubricScore[] = [4, 3, 1, 0];
        const s = scores[callCount - 1] ?? 0;
        return Promise.resolve(
          task.criteria.map(c => ({
            criterionId: c.id,
            score: s as RubricScore,
            rationale: `Score ${s}`,
          })),
        );
      }),
    };

    const harness = new EvaluationHarness(makeExecutor(), scorer);
    const genomeA = makeGenome('story-concept');
    const genomeB = makeGenome('story-concept');
    const tasks = [
      makeTask('t1', 'story-concept'),
      makeTask('t2', 'story-concept'),
    ];

    const comparison = await harness.compare(genomeA, genomeB, tasks);

    // Positive tStatistic means A > B (with non-zero variance)
    expect(comparison.tStatistic).toBeGreaterThan(0);
    // Correctness dimension: A has higher means than B
    expect(comparison.dimensionComparisons.correctness.delta).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// EvaluationHarness – timeout
// ---------------------------------------------------------------------------

describe('EvaluationHarness – timeout', () => {
  it('times out long-running tasks', async () => {
    const executor: AgentExecutor = {
      execute: vi.fn().mockImplementation(
        () => new Promise(resolve => {
          // Never resolves within timeout
          setTimeout(() => resolve({ output: 'Late', usage: ZERO_USAGE }), 5000);
        }),
      ),
    };

    const harness = new EvaluationHarness(executor, makeScorer(), {
      taskTimeoutMs: 50,
    });

    const genome = makeGenome('story-concept');
    const task = makeTask('t1', 'story-concept');

    const result = await harness.evaluateTask(genome, task);

    expect(result.fitness).toBe(0);
    expect(result.output).toContain('timed out');
    expect(result.output).toContain('50ms');
  });

  it('does not time out when execution is fast enough', async () => {
    const executor: AgentExecutor = {
      execute: vi.fn().mockResolvedValue({
        output: 'Fast result',
        usage: ZERO_USAGE,
      }),
    };

    const harness = new EvaluationHarness(executor, makeScorer(3), {
      taskTimeoutMs: 5000,
    });

    const genome = makeGenome('story-concept');
    const task = makeTask('t1', 'story-concept');

    const result = await harness.evaluateTask(genome, task);

    expect(result.fitness).toBeGreaterThan(0);
    expect(result.output).toBe('Fast result');
  });

  it('no timeout applied when taskTimeoutMs is not set', async () => {
    const executor = makeExecutor('Normal output');
    const harness = new EvaluationHarness(executor, makeScorer());

    const genome = makeGenome('story-concept');
    const task = makeTask('t1', 'story-concept');

    const result = await harness.evaluateTask(genome, task);

    expect(result.output).toBe('Normal output');
    expect(result.fitness).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// EvaluationHarness – task filtering edge cases
// ---------------------------------------------------------------------------

describe('EvaluationHarness – task filtering', () => {
  it('matches genome name against TARGET_AGENTS list', async () => {
    const executor = makeExecutor();
    const scorer = makeScorer();

    // All valid TARGET_AGENTS should filter
    for (const agent of [
      'story-concept',
      'architecture-concept',
      'implementation-concept',
      'quality-concept',
    ] as const) {
      const harness = new EvaluationHarness(executor, scorer);
      const genome = makeGenome(agent);
      const tasks = [
        makeTask('match', agent),
        makeTask('no-match', 'story-concept' === agent ? 'architecture-concept' : 'story-concept'),
      ];

      const portfolio = await harness.evaluatePortfolio(genome, tasks);
      expect(portfolio.taskResults).toHaveLength(1);
      expect(portfolio.taskResults[0].taskId).toBe('match');
    }
  });

  it('empty task catalog produces empty portfolio', async () => {
    const harness = new EvaluationHarness(makeExecutor(), makeScorer());
    const genome = makeGenome('story-concept');

    const portfolio = await harness.evaluatePortfolio(genome, []);

    expect(portfolio.taskResults).toHaveLength(0);
    expect(portfolio.fitness).toBe(0);
    expect(portfolio.taskCount).toBe(0);
  });
});
