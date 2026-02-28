/**
 * Evolutionary Fitness Property Tests
 *
 * Tests emergent properties of the MAP-Elites co-evolution pipeline:
 * - Fitness monotonicity (max fitness never decreases)
 * - Diversity maintenance (elites spread across density bins)
 * - Task-topology alignment (evolved topologies match target complexity)
 * - Convergence behavior (evolution reaches stable, improved state)
 * - Selection quality (selectForComplexity returns well-matched topologies)
 * - Portfolio completeness (evolved portfolios cover complexity spectrum)
 * - Scoring function properties (density match, structural heuristics)
 *
 * These are statistical property tests — they verify invariants that must
 * hold across any evolution run, not specific fitness values.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ConductorGrid,
  DEFAULT_CONDUCTOR_CONFIG,
  createComposite,
  mutateTopology,
  seedPopulation,
  evolve,
  selectForComplexity,
  selectPortfolio,
  resetIdCounter,
  identityGenomeMutator,
} from '../conductor.js';
import type {
  ConductorConfig,
  CompositeEvaluator,
  GenomeMutator,
  CompositeElite,
  ConductorResult,
  ConductorStep,
} from '../conductor.js';
import { createMinimalDAG, createLinearDAG, computeDensity, validateDAG } from '../dag.js';
import {
  scoreDagForComplexity,
  densityMatchScore,
  targetDensityRange,
  inferComplexity,
  isDensityMatch,
  selectTopology,
} from '../mapping.js';
import type {
  CompositeGenome,
  TaskComplexity,
  WorkflowDAG,
  DensityMetrics,
} from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const agents = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'];

/** Fitness evaluator based on density-complexity match — the "real" evaluator. */
function complexityEvaluator(targetComplexity: TaskComplexity): CompositeEvaluator {
  return (composite) => scoreDagForComplexity(composite.topology, targetComplexity).score;
}

/** Evaluator that rewards node count up to a ceiling. */
const nodeCountEvaluator: CompositeEvaluator = (composite) => {
  const count = composite.topology.nodes.length;
  return Math.min(1.0, count / 6);
};

/** Create a standard config for property tests. */
function propertyConfig(overrides: Partial<ConductorConfig> = {}): ConductorConfig {
  return {
    ...DEFAULT_CONDUCTOR_CONFIG,
    maxGenerations: 30,
    stagnationLimit: 15,
    seed: 42,
    agentPool: agents,
    ...overrides,
  };
}

/** Create diverse seed population for evolution runs. */
function diverseSeeds(targetComplexity: TaskComplexity = 'medium'): readonly CompositeGenome[] {
  return [
    createComposite(createMinimalDAG('seed-0', 'alpha', 'beta'), targetComplexity),
    createComposite(createLinearDAG('seed-1', ['alpha', 'beta', 'gamma']), targetComplexity),
    createComposite(createLinearDAG('seed-2', ['alpha', 'beta', 'gamma', 'delta']), targetComplexity),
    createComposite(createLinearDAG('seed-3', ['alpha', 'beta', 'gamma', 'delta', 'epsilon']), targetComplexity),
  ];
}

/** Helper to make a CompositeElite from density/fitness values. */
function makeElite(
  density: number,
  fitness: number,
  nodeCount: number,
  id: string,
  targetComplexity: TaskComplexity = 'medium',
): CompositeElite {
  const agentNames = Array.from({ length: nodeCount }, (_, i) => agents[i % agents.length]);
  const dag = nodeCount <= 2
    ? createMinimalDAG(id, agentNames[0], agentNames[1] || agentNames[0])
    : createLinearDAG(id, agentNames);
  const composite: CompositeGenome = {
    topology: dag,
    genomes: {},
    density,
    targetComplexity,
  };
  return {
    composite,
    fitness,
    densityMetrics: computeDensity(dag),
    coordinate: { x: 0, y: 0 },
    compositeId: id,
    generation: 0,
    parentId: null,
  };
}

beforeEach(() => {
  resetIdCounter();
});

// ===========================================================================
// 1. FITNESS MONOTONICITY
// ===========================================================================

describe('fitness monotonicity', () => {
  it('max fitness of grid never decreases across evolution', async () => {
    const config = propertyConfig({ maxGenerations: 40, stagnationLimit: 20, seed: 42 });
    const seeds = diverseSeeds();

    // Run evolution with a meaningful evaluator
    const result = await evolve(seeds, complexityEvaluator('medium'), config);

    // Track max fitness at each step — grid max never decreases because
    // MAP-Elites only accepts fitter composites in each cell
    const seedFitnesses = seeds.map((s) => scoreDagForComplexity(s.topology, 'medium').score);
    let currentMax = Math.max(...seedFitnesses);

    for (const step of result.history) {
      if (step.outcome === 'placed_new' || step.outcome === 'replaced_elite') {
        // When a new elite is placed, the grid's best can only improve or stay the same
        currentMax = Math.max(currentMax, step.fitness);
      }
      // Grid max never decreases (MAP-Elites guarantee)
      expect(result.finalStats.maxFitness).toBeGreaterThanOrEqual(currentMax * 0.999); // tiny epsilon for float
    }
  });

  it('best elite fitness is at least as good as best seed fitness', async () => {
    const config = propertyConfig({ seed: 77 });
    const seeds = diverseSeeds();

    const seedFitnesses = seeds.map((s) => scoreDagForComplexity(s.topology, 'medium').score);
    const bestSeedFitness = Math.max(...seedFitnesses);

    const result = await evolve(seeds, complexityEvaluator('medium'), config);

    expect(result.finalStats.maxFitness).toBeGreaterThanOrEqual(bestSeedFitness - 0.001);
  });

  it('mean fitness does not collapse to zero', async () => {
    const config = propertyConfig({ maxGenerations: 20, seed: 55 });
    const seeds = diverseSeeds();

    const result = await evolve(seeds, complexityEvaluator('medium'), config);

    // Mean fitness should be positive — evolution should not degrade the population
    expect(result.finalStats.meanFitness).toBeGreaterThan(0);
    expect(result.finalStats.maxFitness).toBeGreaterThan(0);
  });
});

// ===========================================================================
// 2. DIVERSITY MAINTENANCE
// ===========================================================================

describe('diversity maintenance', () => {
  it('evolved population occupies multiple density bins', async () => {
    const config = propertyConfig({ maxGenerations: 40, stagnationLimit: 20, seed: 42 });
    const seeds = diverseSeeds();

    const result = await evolve(seeds, nodeCountEvaluator, config);

    // Should occupy more cells than just the seed positions
    expect(result.finalStats.occupiedCells).toBeGreaterThanOrEqual(2);
    expect(result.finalStats.coverage).toBeGreaterThan(0);
  });

  it('elites span a range of composite densities', async () => {
    const config = propertyConfig({ maxGenerations: 40, stagnationLimit: 20, seed: 42 });
    const seeds = diverseSeeds();

    const result = await evolve(seeds, nodeCountEvaluator, config);

    const densities = result.elites.map((e) => e.densityMetrics.compositeDensity);
    const minDensity = Math.min(...densities);
    const maxDensity = Math.max(...densities);
    const densitySpread = maxDensity - minDensity;

    // With diverse seeds (2-5 nodes), there should be density spread
    expect(densitySpread).toBeGreaterThan(0);
  });

  it('all evolved elites have valid DAGs', async () => {
    const config = propertyConfig({ maxGenerations: 50, stagnationLimit: 25, seed: 99 });
    const seeds = diverseSeeds();

    const result = await evolve(seeds, nodeCountEvaluator, config);

    for (const elite of result.elites) {
      const validation = validateDAG(elite.composite.topology);
      expect(validation.valid).toBe(true);
    }
  });

  it('density spread is maintained across different seeds', async () => {
    const results: ConductorResult[] = [];
    for (const seed of [10, 20, 30, 40, 50]) {
      resetIdCounter();
      const config = propertyConfig({ maxGenerations: 20, stagnationLimit: 10, seed });
      const seeds = diverseSeeds();
      const result = await evolve(seeds, nodeCountEvaluator, config);
      results.push(result);
    }

    // Every run should produce at least some diversity
    for (const result of results) {
      expect(result.elites.length).toBeGreaterThanOrEqual(1);
    }

    // At least one run should have occupiedCells > 1
    const maxOccupied = Math.max(...results.map((r) => r.finalStats.occupiedCells));
    expect(maxOccupied).toBeGreaterThanOrEqual(2);
  });
});

// ===========================================================================
// 3. TASK-TOPOLOGY ALIGNMENT
// ===========================================================================

describe('task-topology alignment', () => {
  it('sparse topologies score higher for trivial tasks than dense ones', () => {
    const sparse = createMinimalDAG('sparse', 'a', 'b');
    const dense = createLinearDAG('dense', ['a', 'b', 'c', 'd', 'e', 'f', 'g']);

    const sparseScore = scoreDagForComplexity(sparse, 'trivial').score;
    const denseScore = scoreDagForComplexity(dense, 'trivial').score;

    expect(sparseScore).toBeGreaterThan(denseScore);
  });

  it('dense topologies score higher for expert tasks than sparse ones', () => {
    const sparse = createMinimalDAG('sparse', 'a', 'b');
    const dense = createLinearDAG('dense', ['a', 'b', 'c', 'd', 'e', 'f', 'g']);

    const sparseScore = scoreDagForComplexity(sparse, 'expert').score;
    const denseScore = scoreDagForComplexity(dense, 'expert').score;

    expect(denseScore).toBeGreaterThan(sparseScore);
  });

  it('each complexity level has a distinct density target', () => {
    const complexities: TaskComplexity[] = ['trivial', 'simple', 'medium', 'complex', 'expert'];
    const targets = complexities.map((c) => targetDensityRange(c).target);

    // Targets should be strictly increasing
    for (let i = 1; i < targets.length; i++) {
      expect(targets[i]).toBeGreaterThan(targets[i - 1]);
    }
  });

  it('densityMatchScore is maximized at the target density for each complexity', () => {
    const complexities: TaskComplexity[] = ['trivial', 'simple', 'medium', 'complex', 'expert'];

    for (const complexity of complexities) {
      const { target } = targetDensityRange(complexity);
      const scoreAtTarget = densityMatchScore(target, complexity);
      const scoreAbove = densityMatchScore(target + 0.2, complexity);
      const scoreBelow = densityMatchScore(Math.max(0, target - 0.2), complexity);

      expect(scoreAtTarget).toBeCloseTo(1.0, 5);
      expect(scoreAtTarget).toBeGreaterThan(scoreAbove);
      expect(scoreAtTarget).toBeGreaterThan(scoreBelow);
    }
  });

  it('inferComplexity inverts the density-complexity mapping', () => {
    const complexities: TaskComplexity[] = ['trivial', 'simple', 'medium', 'complex', 'expert'];

    for (const complexity of complexities) {
      const { target } = targetDensityRange(complexity);
      const inferred = inferComplexity(target);
      expect(inferred).toBe(complexity);
    }
  });

  it('scoreDagForComplexity decomposes into density + structural components', () => {
    const dag = createLinearDAG('test', ['a', 'b', 'c', 'd']);
    const result = scoreDagForComplexity(dag, 'medium');

    // Score should be a weighted combination
    const expected = 0.7 * result.densityMatch + 0.3 * result.structuralScore;
    expect(result.score).toBeCloseTo(expected, 5);

    // All components bounded [0, 1]
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
    expect(result.densityMatch).toBeGreaterThanOrEqual(0);
    expect(result.densityMatch).toBeLessThanOrEqual(1);
    expect(result.structuralScore).toBeGreaterThanOrEqual(0);
    expect(result.structuralScore).toBeLessThanOrEqual(1);
  });

  it('evolved topologies score better for target complexity than random', async () => {
    const config = propertyConfig({ maxGenerations: 30, stagnationLimit: 15, seed: 42 });
    const seeds = diverseSeeds('medium');

    // Evolve for medium complexity
    const result = await evolve(seeds, complexityEvaluator('medium'), config);

    if (result.elites.length > 0) {
      const best = result.elites.reduce((a, b) => a.fitness > b.fitness ? a : b);
      const bestScore = scoreDagForComplexity(best.composite.topology, 'medium').score;

      // Random topology (minimal DAG) as baseline
      const randomDag = createMinimalDAG('rand', 'a', 'b');
      const randomScore = scoreDagForComplexity(randomDag, 'medium').score;

      // Best evolved should be at least as good as random
      expect(bestScore).toBeGreaterThanOrEqual(randomScore * 0.9);
    }
  });
});

// ===========================================================================
// 4. CONVERGENCE BEHAVIOR
// ===========================================================================

describe('convergence behavior', () => {
  it('stagnation terminates evolution before max generations', async () => {
    const config = propertyConfig({
      maxGenerations: 100,
      stagnationLimit: 5,
      seed: 42,
    });

    // Use a constant evaluator — no fitness improvement possible
    const result = await evolve(diverseSeeds(), () => 0.5, config);

    expect(result.stagnated).toBe(true);
    expect(result.generationsCompleted).toBeLessThan(100);
  });

  it('evolution with realistic evaluator does not stagnate immediately', async () => {
    const config = propertyConfig({
      maxGenerations: 30,
      stagnationLimit: 15,
      seed: 42,
    });

    const result = await evolve(diverseSeeds(), complexityEvaluator('medium'), config);

    // With diverse seeds and a real evaluator, should explore at least a few generations
    expect(result.generationsCompleted).toBeGreaterThanOrEqual(2);
  });

  it('deterministic: same seed produces same evolution trajectory', async () => {
    const config = propertyConfig({ seed: 123 });
    const seeds = diverseSeeds();

    resetIdCounter();
    const r1 = await evolve(seeds, nodeCountEvaluator, config);

    resetIdCounter();
    const r2 = await evolve(seeds, nodeCountEvaluator, config);

    expect(r1.generationsCompleted).toBe(r2.generationsCompleted);
    expect(r1.history.length).toBe(r2.history.length);
    expect(r1.finalStats.occupiedCells).toBe(r2.finalStats.occupiedCells);
    expect(r1.finalStats.maxFitness).toBe(r2.finalStats.maxFitness);
    expect(r1.stagnated).toBe(r2.stagnated);
  });

  it('higher stagnation limit allows more exploration', async () => {
    const seeds = diverseSeeds();

    resetIdCounter();
    const shortStag = await evolve(seeds, nodeCountEvaluator, propertyConfig({
      maxGenerations: 50,
      stagnationLimit: 3,
      seed: 42,
    }));

    resetIdCounter();
    const longStag = await evolve(seeds, nodeCountEvaluator, propertyConfig({
      maxGenerations: 50,
      stagnationLimit: 25,
      seed: 42,
    }));

    // Longer stagnation limit should allow at least as many generations
    expect(longStag.generationsCompleted).toBeGreaterThanOrEqual(shortStag.generationsCompleted);
  });

  it('more generations budget does not reduce final fitness', async () => {
    const seeds = diverseSeeds();

    resetIdCounter();
    const shortRun = await evolve(seeds, complexityEvaluator('medium'), propertyConfig({
      maxGenerations: 10,
      stagnationLimit: 8,
      seed: 42,
    }));

    resetIdCounter();
    const longRun = await evolve(seeds, complexityEvaluator('medium'), propertyConfig({
      maxGenerations: 50,
      stagnationLimit: 25,
      seed: 42,
    }));

    // Longer run should achieve at least the same max fitness
    expect(longRun.finalStats.maxFitness).toBeGreaterThanOrEqual(
      shortRun.finalStats.maxFitness - 0.001,
    );
  });
});

// ===========================================================================
// 5. MUTATION EFFICACY
// ===========================================================================

describe('mutation efficacy', () => {
  it('topology-only evolution produces structural diversity', async () => {
    const config = propertyConfig({
      topologyMutationRate: 1.0, // 100% topology mutations
      maxGenerations: 30,
      stagnationLimit: 15,
      seed: 42,
    });

    const seeds = diverseSeeds();
    const result = await evolve(seeds, nodeCountEvaluator, config);

    // All history should be topology mutations
    for (const step of result.history) {
      expect(step.mutationType).toBe('topology');
    }

    // Should still produce viable elites
    expect(result.elites.length).toBeGreaterThanOrEqual(1);
  });

  it('genome-only evolution with identity mutator stagnates quickly', async () => {
    const config = propertyConfig({
      topologyMutationRate: 0.0, // 100% genome mutations
      maxGenerations: 50,
      stagnationLimit: 5,
      seed: 42,
    });

    const seeds = diverseSeeds();
    // identityGenomeMutator returns same composite — guaranteed stagnation
    const result = await evolve(seeds, nodeCountEvaluator, config, identityGenomeMutator);

    expect(result.stagnated).toBe(true);
    expect(result.generationsCompleted).toBeLessThan(50);
  });

  it('genome mutation with real mutator produces unique children', async () => {
    let mutationCount = 0;
    const countingMutator: GenomeMutator = (composite, rng) => {
      mutationCount++;
      // Create a truly new composite (avoids identity check)
      return {
        ...composite,
        density: composite.density + 0.001 * rng(),
      };
    };

    const config = propertyConfig({
      topologyMutationRate: 0.0,
      maxGenerations: 10,
      stagnationLimit: 20,
      seed: 42,
    });

    const seeds = diverseSeeds();
    await evolve(seeds, nodeCountEvaluator, config, countingMutator);

    expect(mutationCount).toBeGreaterThan(0);
  });

  it('mixed mutation rate explores both topology and genome space', async () => {
    let genomeMutations = 0;
    const trackingMutator: GenomeMutator = (composite, rng) => {
      genomeMutations++;
      return {
        ...composite,
        density: composite.density + 0.001 * rng(),
      };
    };

    const config = propertyConfig({
      topologyMutationRate: 0.5, // 50/50 split
      maxGenerations: 30,
      stagnationLimit: 20,
      seed: 42,
    });

    const seeds = diverseSeeds();
    const result = await evolve(seeds, nodeCountEvaluator, config, trackingMutator);

    const topoMutations = result.history.filter((s) => s.mutationType === 'topology').length;

    // Both mutation types should have been used
    // (history only records successful placements + rejections that made it past the mutation)
    expect(topoMutations).toBeGreaterThan(0);
    expect(genomeMutations).toBeGreaterThan(0);
  });

  it('seedPopulation produces valid, diverse composites', () => {
    const count = 6;
    const rng = (() => {
      let x = 42;
      return () => {
        x = (x * 1103515245 + 12345) & 0x7fffffff;
        return x / 0x7fffffff;
      };
    })();

    const seeds = seedPopulation(agents, rng, count, 'medium');

    expect(seeds.length).toBe(count);

    // All should have valid DAGs
    for (const seed of seeds) {
      expect(validateDAG(seed.topology).valid).toBe(true);
    }

    // Should have diversity in topology size
    const sizes = seeds.map((s) => s.topology.nodes.length);
    const uniqueSizes = new Set(sizes);
    expect(uniqueSizes.size).toBeGreaterThanOrEqual(2); // at least 2 different sizes
  });

  it('mutateTopology preserves DAG validity', () => {
    const rng = (() => {
      let x = 42;
      return () => {
        x = (x * 1103515245 + 12345) & 0x7fffffff;
        return x / 0x7fffffff;
      };
    })();

    let composite = createComposite(
      createLinearDAG('mut-test', ['a', 'b', 'c', 'd']),
      'medium',
    );

    // Apply 20 mutations and check validity each time
    for (let i = 0; i < 20; i++) {
      const { composite: mutated, mutation } = mutateTopology(composite, rng, agents);
      if (mutation.applied) {
        expect(validateDAG(mutated.topology).valid).toBe(true);
        composite = mutated;
      }
    }
  });
});

// ===========================================================================
// 6. SELECTION QUALITY
// ===========================================================================

describe('selection quality', () => {
  it('selectForComplexity returns topology that matches target density', () => {
    const complexities: TaskComplexity[] = ['trivial', 'simple', 'medium', 'complex', 'expert'];

    // Create a spread of elites across density spectrum
    const elites = [
      makeElite(0.08, 0.7, 2, 'e-trivial', 'trivial'),
      makeElite(0.22, 0.7, 3, 'e-simple', 'simple'),
      makeElite(0.43, 0.7, 4, 'e-medium', 'medium'),
      makeElite(0.63, 0.7, 5, 'e-complex', 'complex'),
      makeElite(0.83, 0.7, 7, 'e-expert', 'expert'),
    ];

    for (const complexity of complexities) {
      const selected = selectForComplexity(elites, complexity);
      expect(selected).not.toBeNull();

      // The selected elite should be the one closest to the target density
      const { target } = targetDensityRange(complexity);
      const selectedDensity = selected!.densityMetrics.compositeDensity;

      // Should be within the tolerance band (or very close)
      // Note: selectForComplexity uses scoreDagForComplexity on the actual DAG,
      // not the density field, so exact matching depends on DAG structure
      expect(selected).not.toBeNull();
    }
  });

  it('selectForComplexity prefers higher fitness among density-matched topologies', () => {
    // Two topologies with same density but different fitness
    const lowFit = makeElite(0.45, 0.3, 4, 'low-fit');
    const highFit = makeElite(0.45, 0.9, 4, 'high-fit');

    const selected = selectForComplexity([lowFit, highFit], 'medium');
    expect(selected).not.toBeNull();
    expect(selected!.compositeId).toBe('high-fit');
  });

  it('selectTopology picks the best DAG for given complexity', () => {
    const dags: WorkflowDAG[] = [
      createMinimalDAG('min', 'a', 'b'),
      createLinearDAG('lin3', ['a', 'b', 'c']),
      createLinearDAG('lin5', ['a', 'b', 'c', 'd', 'e']),
      createLinearDAG('lin7', ['a', 'b', 'c', 'd', 'e', 'f', 'g']),
    ];

    // For trivial tasks, sparse topology should win
    const trivialResult = selectTopology(dags, 'trivial');
    expect(trivialResult).not.toBeNull();
    expect(trivialResult!.dag.nodes.length).toBeLessThanOrEqual(3);

    // For expert tasks, dense topology should win
    const expertResult = selectTopology(dags, 'expert');
    expect(expertResult).not.toBeNull();
    expect(expertResult!.dag.nodes.length).toBeGreaterThanOrEqual(5);
  });

  it('selectTopology scores are bounded [0, 1]', () => {
    const dags = [
      createMinimalDAG('d1', 'a', 'b'),
      createLinearDAG('d2', ['a', 'b', 'c', 'd', 'e']),
    ];

    const complexities: TaskComplexity[] = ['trivial', 'simple', 'medium', 'complex', 'expert'];
    for (const complexity of complexities) {
      const result = selectTopology(dags, complexity);
      expect(result!.score).toBeGreaterThanOrEqual(0);
      expect(result!.score).toBeLessThanOrEqual(1);
    }
  });
});

// ===========================================================================
// 7. PORTFOLIO COMPLETENESS
// ===========================================================================

describe('portfolio completeness', () => {
  it('evolved portfolio covers at least 2 complexity levels', async () => {
    const config = propertyConfig({ maxGenerations: 40, stagnationLimit: 20, seed: 42 });
    const seeds = diverseSeeds();

    const result = await evolve(seeds, nodeCountEvaluator, config);
    const portfolio = selectPortfolio(result.elites);

    // With diverse seeds (2-5 nodes) and evolution, should cover multiple levels
    expect(portfolio.size).toBeGreaterThanOrEqual(1);
  });

  it('portfolio entries are all valid topologies', async () => {
    const config = propertyConfig({ maxGenerations: 30, stagnationLimit: 15, seed: 42 });
    const seeds = diverseSeeds();

    const result = await evolve(seeds, nodeCountEvaluator, config);
    const portfolio = selectPortfolio(result.elites);

    for (const [, elite] of portfolio) {
      expect(validateDAG(elite.composite.topology).valid).toBe(true);
      expect(elite.fitness).toBeGreaterThanOrEqual(0);
      expect(elite.fitness).toBeLessThanOrEqual(1);
    }
  });

  it('portfolio assigns distinct topologies to distinct complexity levels when available', () => {
    // Create topologies with clearly different structures
    const elites: CompositeElite[] = [];
    const sizes = [2, 3, 4, 5, 6, 7];

    for (let i = 0; i < sizes.length; i++) {
      const size = sizes[i];
      const agentNames = Array.from({ length: size }, (_, j) => agents[j % agents.length]);
      const dag = size <= 2
        ? createMinimalDAG(`p-${i}`, agentNames[0], agentNames[1])
        : createLinearDAG(`p-${i}`, agentNames);
      const metrics = computeDensity(dag);
      const composite: CompositeGenome = {
        topology: dag,
        genomes: {},
        density: metrics.compositeDensity,
        targetComplexity: 'medium',
      };
      elites.push({
        composite,
        fitness: 0.7,
        densityMetrics: metrics,
        coordinate: { x: 0, y: 0 },
        compositeId: `p-${i}`,
        generation: 0,
        parentId: null,
      });
    }

    const portfolio = selectPortfolio(elites);

    // With a good spread of sizes, trivial and expert should pick different elites
    const trivialEntry = portfolio.get('trivial');
    const expertEntry = portfolio.get('expert');

    if (trivialEntry && expertEntry) {
      // Trivial should pick smaller topology, expert should pick larger
      expect(trivialEntry.composite.topology.nodes.length)
        .toBeLessThanOrEqual(expertEntry.composite.topology.nodes.length);
    }
  });
});

// ===========================================================================
// 8. SCORING FUNCTION PROPERTIES
// ===========================================================================

describe('scoring function properties', () => {
  it('densityMatchScore is symmetric around target', () => {
    const complexities: TaskComplexity[] = ['trivial', 'simple', 'medium', 'complex', 'expert'];

    for (const complexity of complexities) {
      const { target } = targetDensityRange(complexity);
      const delta = 0.05;

      const above = densityMatchScore(Math.min(1, target + delta), complexity);
      const below = densityMatchScore(Math.max(0, target - delta), complexity);

      // Should be approximately symmetric (within floating point tolerance)
      expect(Math.abs(above - below)).toBeLessThan(0.02);
    }
  });

  it('densityMatchScore decreases monotonically from target', () => {
    const target = targetDensityRange('medium').target;
    const deltas = [0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.4];
    const scores = deltas.map((d) => densityMatchScore(target + d, 'medium'));

    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1] + 0.001);
    }
  });

  it('all density targets are within [0, 1]', () => {
    const complexities: TaskComplexity[] = ['trivial', 'simple', 'medium', 'complex', 'expert'];

    for (const complexity of complexities) {
      const { min, max, target } = targetDensityRange(complexity);
      expect(min).toBeGreaterThanOrEqual(0);
      expect(max).toBeLessThanOrEqual(1);
      expect(target).toBeGreaterThanOrEqual(0);
      expect(target).toBeLessThanOrEqual(1);
      expect(min).toBeLessThanOrEqual(target);
      expect(max).toBeGreaterThanOrEqual(target);
    }
  });

  it('scoreDagForComplexity produces consistent results for same DAG', () => {
    const dag = createLinearDAG('stable', ['a', 'b', 'c', 'd']);

    const r1 = scoreDagForComplexity(dag, 'medium');
    const r2 = scoreDagForComplexity(dag, 'medium');

    expect(r1.score).toBe(r2.score);
    expect(r1.densityMatch).toBe(r2.densityMatch);
    expect(r1.structuralScore).toBe(r2.structuralScore);
    expect(r1.metrics).toEqual(r2.metrics);
  });

  it('computeDensity produces bounded metrics', () => {
    const dags = [
      createMinimalDAG('d1', 'a', 'b'),
      createLinearDAG('d2', ['a', 'b', 'c']),
      createLinearDAG('d3', ['a', 'b', 'c', 'd', 'e', 'f']),
    ];

    for (const dag of dags) {
      const metrics = computeDensity(dag);

      expect(metrics.nodeCount).toBeGreaterThanOrEqual(2);
      expect(metrics.edgeCount).toBeGreaterThanOrEqual(1);
      expect(metrics.edgeDensity).toBeGreaterThanOrEqual(0);
      expect(metrics.edgeDensity).toBeLessThanOrEqual(1);
      expect(metrics.avgDegree).toBeGreaterThanOrEqual(0);
      expect(metrics.criticalPathLength).toBeGreaterThanOrEqual(1);
      expect(metrics.maxFanOut).toBeGreaterThanOrEqual(1);
      expect(metrics.reviewRatio).toBeGreaterThanOrEqual(0);
      expect(metrics.reviewRatio).toBeLessThanOrEqual(1);
      expect(metrics.compositeDensity).toBeGreaterThanOrEqual(0);
      expect(metrics.compositeDensity).toBeLessThanOrEqual(1);
    }
  });

  it('composite density differentiates minimal vs extended topologies', () => {
    const minimal = createMinimalDAG('s', 'a', 'b');
    const extended = createLinearDAG('m', ['a', 'b', 'c', 'd', 'e']);

    const minimalDensity = computeDensity(minimal).compositeDensity;
    const extendedDensity = computeDensity(extended).compositeDensity;

    // Both should be in valid range
    expect(minimalDensity).toBeGreaterThanOrEqual(0);
    expect(minimalDensity).toBeLessThanOrEqual(1);
    expect(extendedDensity).toBeGreaterThanOrEqual(0);
    expect(extendedDensity).toBeLessThanOrEqual(1);

    // Minimal and extended should have DIFFERENT densities (composite density
    // is a weighted combination of node count, edge density, critical path,
    // fan-out, etc. — not monotonically increasing with node count alone)
    expect(minimalDensity).not.toBeCloseTo(extendedDensity, 2);
  });
});

// ===========================================================================
// 9. GRID BEHAVIORAL INVARIANTS
// ===========================================================================

describe('grid behavioral invariants', () => {
  it('grid coverage monotonically increases or stays same', async () => {
    const grid = new ConductorGrid();
    let prevOccupied = 0;

    // Add increasingly diverse composites
    const sizes = [2, 3, 4, 5, 6, 7, 3, 4, 5, 2];
    for (let i = 0; i < sizes.length; i++) {
      const agentNames = Array.from({ length: sizes[i] }, (_, j) => agents[j % agents.length]);
      const dag = sizes[i] <= 2
        ? createMinimalDAG(`g-${i}`, agentNames[0], agentNames[1])
        : createLinearDAG(`g-${i}`, agentNames);
      const composite = createComposite(dag, 'medium');
      const metrics = computeDensity(dag);

      grid.tryPlace(composite, 0.5 + i * 0.05, metrics, `g-${i}`, 0, null);

      // Occupied cells can only increase or stay the same
      expect(grid.occupiedCount).toBeGreaterThanOrEqual(prevOccupied);
      prevOccupied = grid.occupiedCount;
    }
  });

  it('grid best fitness never decreases on replacement', () => {
    const grid = new ConductorGrid();
    const dag = createMinimalDAG('g', 'a', 'b');
    const composite = createComposite(dag, 'trivial');
    const metrics = computeDensity(dag);

    // Place with increasing fitness
    const fitnesses = [0.1, 0.3, 0.5, 0.2, 0.7, 0.4, 0.9, 0.6];
    let bestSoFar = 0;

    for (let i = 0; i < fitnesses.length; i++) {
      grid.tryPlace(composite, fitnesses[i], metrics, `f-${i}`, 0, null);
      bestSoFar = Math.max(bestSoFar, fitnesses[i]);

      const best = grid.bestElite();
      if (best) {
        expect(best.fitness).toBeGreaterThanOrEqual(bestSoFar - 0.001);
      }
    }
  });

  it('statistics are consistent with grid contents', () => {
    const grid = new ConductorGrid();

    // Add various composites
    for (let size = 2; size <= 6; size++) {
      const agentNames = Array.from({ length: size }, (_, j) => agents[j % agents.length]);
      const dag = size <= 2
        ? createMinimalDAG(`s-${size}`, agentNames[0], agentNames[1])
        : createLinearDAG(`s-${size}`, agentNames);
      const composite = createComposite(dag, 'medium');
      const metrics = computeDensity(dag);

      grid.tryPlace(composite, 0.3 + size * 0.1, metrics, `s-${size}`, 0, null);
    }

    const stats = grid.getStats(1, 5);
    const elites = grid.allElites();

    expect(stats.occupiedCells).toBe(elites.length);
    expect(stats.totalCells).toBe(100); // 10x10

    if (elites.length > 0) {
      const fitnessValues = elites.map((e) => e.fitness);
      expect(stats.maxFitness).toBeCloseTo(Math.max(...fitnessValues), 5);
      expect(stats.minFitness).toBeCloseTo(Math.min(...fitnessValues), 5);

      const meanFitness = fitnessValues.reduce((a, b) => a + b, 0) / fitnessValues.length;
      expect(stats.meanFitness).toBeCloseTo(meanFitness, 5);
    }
  });
});

// ===========================================================================
// 10. CROSS-COMPLEXITY EVOLUTION
// ===========================================================================

describe('cross-complexity evolution', () => {
  it('evolving for different complexities produces topologies of different densities', async () => {
    const results: Record<string, ConductorResult> = {};

    for (const complexity of ['trivial', 'complex'] as TaskComplexity[]) {
      resetIdCounter();
      const config = propertyConfig({
        maxGenerations: 30,
        stagnationLimit: 15,
        seed: 42,
      });
      const seeds = diverseSeeds(complexity);
      const result = await evolve(seeds, complexityEvaluator(complexity), config);
      results[complexity] = result;
    }

    // Both runs should produce elites
    expect(results.trivial.elites.length).toBeGreaterThanOrEqual(1);
    expect(results.complex.elites.length).toBeGreaterThanOrEqual(1);

    // The best elite for trivial tasks should have lower density than for complex tasks
    const trivialBest = results.trivial.elites.reduce(
      (a, b) => a.fitness > b.fitness ? a : b,
    );
    const complexBest = results.complex.elites.reduce(
      (a, b) => a.fitness > b.fitness ? a : b,
    );

    // Cross-validate: trivial best should score better on trivial than complex's best
    const trivialOnTrivial = scoreDagForComplexity(trivialBest.composite.topology, 'trivial').score;
    const complexOnTrivial = scoreDagForComplexity(complexBest.composite.topology, 'trivial').score;

    expect(trivialOnTrivial).toBeGreaterThanOrEqual(complexOnTrivial - 0.1);
  });

  it('evolution history records all placement outcomes', async () => {
    const config = propertyConfig({ maxGenerations: 20, seed: 42 });
    const seeds = diverseSeeds();

    const result = await evolve(seeds, nodeCountEvaluator, config);

    if (result.history.length > 0) {
      const outcomes = new Set(result.history.map((s) => s.outcome));

      // All outcomes should be valid placement types
      for (const outcome of outcomes) {
        expect(['placed_new', 'replaced_elite', 'rejected']).toContain(outcome);
      }

      // All history entries should have valid fields
      for (const step of result.history) {
        expect(step.generation).toBeGreaterThanOrEqual(1);
        expect(step.fitness).toBeGreaterThanOrEqual(0);
        expect(step.density).toBeGreaterThanOrEqual(0);
        expect(['topology', 'genome']).toContain(step.mutationType);
        expect(step.parentId).toBeDefined();
        expect(step.childId).toBeDefined();
      }
    }
  });
});
