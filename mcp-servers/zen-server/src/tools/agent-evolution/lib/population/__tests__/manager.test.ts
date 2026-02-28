import { describe, it, expect, vi } from 'vitest';
import { PopulationManager, createRng } from '../manager.js';
import type { MutationStrategy } from '../manager.js';
import { EvaluationHarness } from '../../harness/harness.js';
import type { AgentExecutor, Scorer, ExecutionOutput } from '../../harness/types.js';
import type { AgentGenome } from '../../genome/schema.js';
import type {
  BenchmarkTask,
  CriterionScore,
  EvaluationDimension,
  PortfolioResult,
  RubricScore,
} from '../../benchmark/schema.js';
import { EVALUATION_DIMENSIONS, STANDARD_RUBRICS } from '../../benchmark/schema.js';
import type { MutationResult } from '../../mutation/types.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const MOCK_USAGE = {
  inputTokens: 100,
  outputTokens: 200,
  durationMs: 500,
  estimatedCostUsd: 0.01,
} as const;

function makeGenome(name: string): AgentGenome {
  return {
    agentName: name,
    frontmatter: {
      name,
      description: 'Test',
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
    rawFrontmatter: `name: ${name}`,
    title: `# ${name}`,
    sections: [
      { id: 'purpose', heading: 'Purpose', level: 2, content: 'Test agent.' },
    ],
  };
}

function makeTask(id: string, targetAgent: string = 'story-concept'): BenchmarkTask {
  return {
    id,
    name: `Task ${id}`,
    description: `Description for ${id}`,
    targetAgent: targetAgent as BenchmarkTask['targetAgent'],
    category: 'feature',
    difficulty: 'simple',
    prompt: `Prompt for ${id}`,
    context: { projectDescription: 'Test', files: [], constraints: [] },
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
    expectedElements: ['test element'],
    tags: [],
  };
}

function makeExecutor(output: string = 'Mock output'): AgentExecutor {
  return {
    execute: vi.fn().mockResolvedValue({
      output,
      usage: MOCK_USAGE,
    } satisfies ExecutionOutput),
  };
}

function makeScorer(score: RubricScore = 3): Scorer {
  return {
    score: vi.fn().mockImplementation(
      (task: BenchmarkTask) =>
        Promise.resolve(
          task.criteria.map(c => ({
            criterionId: c.id,
            score,
            rationale: 'Mock score',
          })),
        ),
    ),
  };
}

function makeHarness(score: RubricScore = 3): EvaluationHarness {
  return new EvaluationHarness(makeExecutor(), makeScorer(score));
}

/** Strategy that mutates the genome name and always applies. */
function makeMutationStrategy(): MutationStrategy {
  let callCount = 0;
  return {
    mutate: vi.fn().mockImplementation(
      (parent: AgentGenome) => {
        callCount++;
        const child: AgentGenome = {
          ...parent,
          agentName: `${parent.agentName}-mut-${callCount}`,
          frontmatter: {
            ...parent.frontmatter,
            name: `${parent.agentName}-mut-${callCount}`,
          },
        };
        return Promise.resolve({
          genome: child,
          applied: true,
          kind: 'replace_content',
          description: `Mutation ${callCount}`,
          affectedSections: ['purpose'],
        } satisfies MutationResult);
      },
    ),
  };
}

/** Strategy that always returns no-op mutations. */
function makeNoOpStrategy(): MutationStrategy {
  return {
    mutate: vi.fn().mockImplementation(
      (parent: AgentGenome) =>
        Promise.resolve({
          genome: parent,
          applied: false,
          kind: 'replace_content',
          description: 'No-op',
          affectedSections: [],
        } satisfies MutationResult),
    ),
  };
}

// ---------------------------------------------------------------------------
// createRng
// ---------------------------------------------------------------------------

describe('createRng', () => {
  it('produces values in [0, 1)', () => {
    const rng = createRng(42);
    for (let i = 0; i < 100; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('is deterministic with same seed', () => {
    const rng1 = createRng(42);
    const rng2 = createRng(42);

    for (let i = 0; i < 20; i++) {
      expect(rng1()).toBe(rng2());
    }
  });

  it('produces different sequences with different seeds', () => {
    const rng1 = createRng(1);
    const rng2 = createRng(2);

    // Collect sequences
    const seq1 = Array.from({ length: 10 }, () => rng1());
    const seq2 = Array.from({ length: 10 }, () => rng2());

    // Not all values should match
    const matches = seq1.filter((v, i) => v === seq2[i]).length;
    expect(matches).toBeLessThan(10);
  });

  it('has reasonable distribution (chi-squared proxy)', () => {
    const rng = createRng(123);
    const buckets = new Array(10).fill(0);
    const n = 10000;

    for (let i = 0; i < n; i++) {
      const bin = Math.floor(rng() * 10);
      buckets[Math.min(bin, 9)]++;
    }

    // Each bucket should have roughly n/10 = 1000 ± 100
    for (const count of buckets) {
      expect(count).toBeGreaterThan(800);
      expect(count).toBeLessThan(1200);
    }
  });
});

// ---------------------------------------------------------------------------
// PopulationManager – seed
// ---------------------------------------------------------------------------

describe('PopulationManager – seed', () => {
  it('seeds initial genomes into grid', async () => {
    const harness = makeHarness(3);
    const strategy = makeMutationStrategy();
    const manager = new PopulationManager(harness, strategy, {
      maxGenerations: 10,
      stagnationLimit: 5,
      elmProbability: 0.5,
      seed: 42,
    });

    const genomes = [makeGenome('story-concept'), makeGenome('story-concept')];
    const tasks = [makeTask('t1', 'story-concept')];

    const placed = await manager.seed(genomes, tasks);

    // At least 1 should be placed (both may map to same cell)
    expect(placed).toBeGreaterThanOrEqual(1);
    expect(manager.currentGrid.occupiedCount).toBeGreaterThanOrEqual(1);
  });

  it('evaluates each genome against tasks', async () => {
    const executor = makeExecutor();
    const scorer = makeScorer(3);
    const harness = new EvaluationHarness(executor, scorer);
    const strategy = makeMutationStrategy();
    const manager = new PopulationManager(harness, strategy, {
      maxGenerations: 10,
      stagnationLimit: 5,
      elmProbability: 0.5,
      seed: 42,
    });

    const genomes = [makeGenome('story-concept'), makeGenome('story-concept')];
    const tasks = [makeTask('t1', 'story-concept')];

    await manager.seed(genomes, tasks);

    // Executor should have been called once per genome
    expect(executor.execute).toHaveBeenCalledTimes(2);
  });

  it('handles empty genome list', async () => {
    const manager = new PopulationManager(makeHarness(), makeMutationStrategy(), {
      maxGenerations: 10,
      stagnationLimit: 5,
      elmProbability: 0.5,
      seed: 42,
    });

    const placed = await manager.seed([], [makeTask('t1')]);
    expect(placed).toBe(0);
    expect(manager.currentGrid.occupiedCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// PopulationManager – evolve
// ---------------------------------------------------------------------------

describe('PopulationManager – evolve', () => {
  it('runs for maxGenerations', async () => {
    const harness = makeHarness(3);
    const strategy = makeMutationStrategy();
    const manager = new PopulationManager(harness, strategy, {
      maxGenerations: 5,
      stagnationLimit: 100, // High limit to avoid early stop
      elmProbability: 0.5,
      seed: 42,
    });

    const tasks = [makeTask('t1', 'story-concept')];
    await manager.seed([makeGenome('story-concept')], tasks);

    const result = await manager.evolve(tasks);

    expect(result.generationsCompleted).toBe(5);
    expect(result.stagnated).toBe(false);
    expect(result.history.length).toBe(5);
  });

  it('records evolution steps', async () => {
    const harness = makeHarness(3);
    const strategy = makeMutationStrategy();
    const manager = new PopulationManager(harness, strategy, {
      maxGenerations: 3,
      stagnationLimit: 100,
      elmProbability: 0.5,
      seed: 42,
    });

    const tasks = [makeTask('t1', 'story-concept')];
    await manager.seed([makeGenome('story-concept')], tasks);

    const result = await manager.evolve(tasks);

    for (const step of result.history) {
      expect(step.generation).toBeGreaterThan(0);
      expect(step.parentId).toBeTruthy();
      expect(step.childId).toBeTruthy();
      expect(step.mutation.applied).toBe(true);
      expect(step.portfolio).toBeDefined();
      expect(step.coordinate).toBeDefined();
      expect(['placed_new', 'replaced_elite', 'rejected']).toContain(step.outcome);
    }
  });

  it('stops early on stagnation (no-op mutations)', async () => {
    const harness = makeHarness(3);
    const strategy = makeNoOpStrategy();
    const manager = new PopulationManager(harness, strategy, {
      maxGenerations: 100,
      stagnationLimit: 3,
      elmProbability: 0.5,
      seed: 42,
    });

    const tasks = [makeTask('t1', 'story-concept')];
    await manager.seed([makeGenome('story-concept')], tasks);

    const result = await manager.evolve(tasks);

    expect(result.stagnated).toBe(true);
    expect(result.generationsCompleted).toBeLessThan(100);
    // History should be empty since all mutations were no-ops
    expect(result.history.length).toBe(0);
  });

  it('stops early on stagnation (all rejected)', async () => {
    // Use a single-cell grid so all children compete with incumbent
    const harness = makeHarness(3);
    const strategy = makeMutationStrategy();
    const manager = new PopulationManager(harness, strategy, {
      maxGenerations: 100,
      stagnationLimit: 5,
      elmProbability: 0.5,
      seed: 42,
      grid: {
        costAxis: { bins: 1, min: 0, max: 1, scale: 'linear' },
        qualityAxis: { bins: 1, min: 0, max: 1, scale: 'linear' },
      },
    });

    const tasks = [makeTask('t1', 'story-concept')];
    await manager.seed([makeGenome('story-concept')], tasks);

    const result = await manager.evolve(tasks);

    // All children score the same as incumbent (score=3), so all rejected
    expect(result.stagnated).toBe(true);
    expect(result.generationsCompleted).toBeLessThanOrEqual(6); // 5 + possible initial
  });

  it('returns empty result from empty grid', async () => {
    const manager = new PopulationManager(makeHarness(), makeMutationStrategy(), {
      maxGenerations: 10,
      stagnationLimit: 5,
      elmProbability: 0.5,
      seed: 42,
    });

    // Don't seed — grid is empty
    const result = await manager.evolve([makeTask('t1')]);

    expect(result.generationsCompleted).toBe(1);
    expect(result.history.length).toBe(0);
    expect(result.finalStats.occupiedCells).toBe(0);
  });

  it('tracks statistics across generations', async () => {
    const harness = makeHarness(3);
    const strategy = makeMutationStrategy();
    const manager = new PopulationManager(harness, strategy, {
      maxGenerations: 3,
      stagnationLimit: 100,
      elmProbability: 0.5,
      seed: 42,
    });

    const tasks = [makeTask('t1', 'story-concept')];
    await manager.seed([makeGenome('story-concept')], tasks);

    const result = await manager.evolve(tasks);

    // Stats should be recorded for seed + each generation
    expect(result.statsHistory.length).toBeGreaterThanOrEqual(2);
    expect(result.finalStats.occupiedCells).toBeGreaterThanOrEqual(1);
    expect(result.finalStats.totalEvaluations).toBeGreaterThanOrEqual(4); // 1 seed + 3 gens
  });

  it('passes correct arguments to mutation strategy', async () => {
    const harness = makeHarness(3);
    const strategy = makeMutationStrategy();
    const manager = new PopulationManager(harness, strategy, {
      maxGenerations: 1,
      stagnationLimit: 100,
      elmProbability: 0.5,
      seed: 42,
    });

    const tasks = [makeTask('t1', 'story-concept')];
    await manager.seed([makeGenome('story-concept')], tasks);
    await manager.evolve(tasks);

    expect(strategy.mutate).toHaveBeenCalledOnce();
    const [parent, portfolio, generation, rng] = (strategy.mutate as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(parent).toBeDefined();
    expect(parent.agentName).toBe('story-concept');
    expect(portfolio).toBeDefined();
    expect(portfolio.fitness).toBeDefined();
    expect(generation).toBe(1);
    expect(typeof rng).toBe('function');
  });

  it('produces deterministic results with same seed', async () => {
    async function runEvolution(seed: number) {
      const harness = makeHarness(3);
      const strategy = makeMutationStrategy();
      const manager = new PopulationManager(harness, strategy, {
        maxGenerations: 5,
        stagnationLimit: 100,
        elmProbability: 0.5,
        seed,
      });

      const tasks = [makeTask('t1', 'story-concept')];
      await manager.seed([makeGenome('story-concept')], tasks);
      return manager.evolve(tasks);
    }

    const result1 = await runEvolution(42);
    const result2 = await runEvolution(42);

    expect(result1.generationsCompleted).toBe(result2.generationsCompleted);
    expect(result1.history.length).toBe(result2.history.length);
    expect(result1.finalStats.occupiedCells).toBe(result2.finalStats.occupiedCells);
  });
});

// ---------------------------------------------------------------------------
// PopulationManager – getStats / getHistory
// ---------------------------------------------------------------------------

describe('PopulationManager – accessors', () => {
  it('getStats returns current population state', async () => {
    const manager = new PopulationManager(makeHarness(), makeMutationStrategy(), {
      maxGenerations: 10,
      stagnationLimit: 5,
      elmProbability: 0.5,
      seed: 42,
    });

    const tasks = [makeTask('t1', 'story-concept')];
    await manager.seed([makeGenome('story-concept')], tasks);

    const stats = manager.getStats();
    expect(stats.occupiedCells).toBeGreaterThanOrEqual(1);
    expect(stats.totalCells).toBe(100);
  });

  it('getHistory returns evolution steps', async () => {
    const manager = new PopulationManager(makeHarness(), makeMutationStrategy(), {
      maxGenerations: 2,
      stagnationLimit: 100,
      elmProbability: 0.5,
      seed: 42,
    });

    const tasks = [makeTask('t1', 'story-concept')];
    await manager.seed([makeGenome('story-concept')], tasks);
    await manager.evolve(tasks);

    const history = manager.getHistory();
    expect(history.length).toBe(2);
  });
});
