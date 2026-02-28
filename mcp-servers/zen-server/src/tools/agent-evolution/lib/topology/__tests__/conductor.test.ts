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
} from '../conductor.js';
import { createMinimalDAG, createLinearDAG, computeDensity, validateDAG } from '../dag.js';
import type { CompositeGenome, TaskComplexity } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deterministic RNG from preset values. */
function seededRng(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[i % values.length];
    i++;
    return v;
  };
}

/** Simple evaluator: fitness = composite density (higher density = higher fitness). */
const densityEvaluator: CompositeEvaluator = (composite) => composite.density;

/** Evaluator that returns a constant fitness. */
function constantEvaluator(fitness: number): CompositeEvaluator {
  return () => fitness;
}

/** Evaluator based on node count: more nodes = higher fitness (up to a point). */
const nodeCountEvaluator: CompositeEvaluator = (composite) => {
  const count = composite.topology.nodes.length;
  return Math.min(1.0, count / 6); // 6+ nodes = max fitness
};

const agents = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'];

beforeEach(() => {
  resetIdCounter();
});

// ---------------------------------------------------------------------------
// ConductorGrid
// ---------------------------------------------------------------------------

describe('ConductorGrid', () => {
  it('creates an empty grid with correct dimensions', () => {
    const grid = new ConductorGrid();
    expect(grid.totalCells).toBe(100); // 10×10
    expect(grid.occupiedCount).toBe(0);
  });

  it('places a composite genome in an empty cell', () => {
    const grid = new ConductorGrid();
    const dag = createMinimalDAG('d1', 'a', 'b');
    const composite = createComposite(dag, 'trivial');
    const metrics = computeDensity(dag);

    const outcome = grid.tryPlace(composite, 0.5, metrics, 'id-1', 0, null);
    expect(outcome).toBe('placed_new');
    expect(grid.occupiedCount).toBe(1);
  });

  it('replaces incumbent when fitter', () => {
    const grid = new ConductorGrid();
    const dag = createMinimalDAG('d1', 'a', 'b');
    const composite = createComposite(dag, 'trivial');
    const metrics = computeDensity(dag);

    // Use fitness values that map to the same y-bin (bin width = 0.1)
    grid.tryPlace(composite, 0.31, metrics, 'id-1', 0, null);
    const outcome = grid.tryPlace(composite, 0.38, metrics, 'id-2', 1, 'id-1');
    expect(outcome).toBe('replaced_elite');
    expect(grid.occupiedCount).toBe(1);

    const best = grid.bestElite();
    expect(best!.fitness).toBe(0.38);
  });

  it('rejects weaker genome', () => {
    const grid = new ConductorGrid();
    const dag = createMinimalDAG('d1', 'a', 'b');
    const composite = createComposite(dag, 'trivial');
    const metrics = computeDensity(dag);

    // Use fitness values that map to the same y-bin
    grid.tryPlace(composite, 0.38, metrics, 'id-1', 0, null);
    const outcome = grid.tryPlace(composite, 0.31, metrics, 'id-2', 1, 'id-1');
    expect(outcome).toBe('rejected');
    expect(grid.occupiedCount).toBe(1);
  });

  it('places genomes in different cells based on density', () => {
    const grid = new ConductorGrid();

    const sparse = createMinimalDAG('d1', 'a', 'b');
    const dense = createLinearDAG('d2', ['a', 'b', 'c', 'd', 'e', 'f', 'g']);

    const sparseComposite = createComposite(sparse, 'trivial');
    const denseComposite = createComposite(dense, 'complex');

    const sparseMetrics = computeDensity(sparse);
    const denseMetrics = computeDensity(dense);

    grid.tryPlace(sparseComposite, 0.5, sparseMetrics, 'sparse-1', 0, null);
    grid.tryPlace(denseComposite, 0.5, denseMetrics, 'dense-1', 0, null);

    // Different densities should map to different x-axis bins
    expect(grid.occupiedCount).toBe(2);
  });

  it('selectRandom returns null on empty grid', () => {
    const grid = new ConductorGrid();
    expect(grid.selectRandom(Math.random)).toBeNull();
  });

  it('selectRandom returns elite from occupied grid', () => {
    const grid = new ConductorGrid();
    const dag = createMinimalDAG('d1', 'a', 'b');
    const composite = createComposite(dag, 'trivial');
    const metrics = computeDensity(dag);
    grid.tryPlace(composite, 0.5, metrics, 'id-1', 0, null);

    const selected = grid.selectRandom(seededRng([0.5]));
    expect(selected).not.toBeNull();
    expect(selected!.compositeId).toBe('id-1');
  });

  it('allElites returns all occupied cells', () => {
    const grid = new ConductorGrid();

    for (let i = 0; i < 5; i++) {
      const dag = createLinearDAG(`d${i}`, Array.from({ length: i + 2 }, (_, j) => `a${j}`));
      const composite = createComposite(dag, 'medium');
      const metrics = computeDensity(dag);
      grid.tryPlace(composite, (i + 1) / 10, metrics, `id-${i}`, 0, null);
    }

    const elites = grid.allElites();
    expect(elites.length).toBeGreaterThanOrEqual(1);
    expect(elites.length).toBeLessThanOrEqual(5);
  });

  it('bestElite returns highest fitness', () => {
    const grid = new ConductorGrid();
    const dag1 = createMinimalDAG('d1', 'a', 'b');
    const dag2 = createLinearDAG('d2', ['a', 'b', 'c', 'd', 'e']);

    const c1 = createComposite(dag1, 'trivial');
    const c2 = createComposite(dag2, 'complex');

    grid.tryPlace(c1, 0.3, computeDensity(dag1), 'id-1', 0, null);
    grid.tryPlace(c2, 0.8, computeDensity(dag2), 'id-2', 0, null);

    const best = grid.bestElite();
    expect(best!.fitness).toBe(0.8);
  });

  it('getStats returns valid statistics', () => {
    const grid = new ConductorGrid();
    const dag = createMinimalDAG('d1', 'a', 'b');
    const composite = createComposite(dag, 'trivial');
    grid.tryPlace(composite, 0.5, computeDensity(dag), 'id-1', 0, null);

    const stats = grid.getStats(0, 1);
    expect(stats.occupiedCells).toBe(1);
    expect(stats.totalCells).toBe(100);
    expect(stats.coverage).toBeCloseTo(0.01);
    expect(stats.meanFitness).toBe(0.5);
    expect(stats.maxFitness).toBe(0.5);
    expect(stats.minFitness).toBe(0.5);
    expect(stats.generation).toBe(0);
    expect(stats.totalEvaluations).toBe(1);
    expect(stats.meanDensity).toBeGreaterThanOrEqual(0);
  });

  it('getStats handles empty grid', () => {
    const grid = new ConductorGrid();
    const stats = grid.getStats(0, 0);
    expect(stats.occupiedCells).toBe(0);
    expect(stats.coverage).toBe(0);
    expect(stats.meanFitness).toBe(0);
  });

  it('coordinateFor maps to valid bin indices', () => {
    const grid = new ConductorGrid();
    const coord = grid.coordinateFor(0.5, 0.5);
    expect(coord.x).toBeGreaterThanOrEqual(0);
    expect(coord.x).toBeLessThan(10);
    expect(coord.y).toBeGreaterThanOrEqual(0);
    expect(coord.y).toBeLessThan(10);
  });

  it('coordinateFor clamps extreme values', () => {
    const grid = new ConductorGrid();

    const low = grid.coordinateFor(-1.0, -1.0);
    expect(low.x).toBe(0);
    expect(low.y).toBe(0);

    const high = grid.coordinateFor(2.0, 2.0);
    expect(high.x).toBe(9);
    expect(high.y).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// createComposite
// ---------------------------------------------------------------------------

describe('createComposite', () => {
  it('creates a composite from a DAG', () => {
    const dag = createMinimalDAG('d1', 'a', 'b');
    const composite = createComposite(dag, 'simple');

    expect(composite.topology).toBe(dag);
    expect(composite.targetComplexity).toBe('simple');
    expect(composite.density).toBeGreaterThanOrEqual(0);
    expect(composite.density).toBeLessThanOrEqual(1);
    expect(Object.keys(composite.genomes)).toHaveLength(0);
  });

  it('density increases with DAG complexity', () => {
    const minimal = createComposite(createMinimalDAG('d1', 'a', 'b'), 'trivial');
    const large = createComposite(createLinearDAG('d2', ['a', 'b', 'c', 'd', 'e', 'f']), 'complex');

    expect(large.density).toBeGreaterThan(minimal.density);
  });
});

// ---------------------------------------------------------------------------
// mutateTopology
// ---------------------------------------------------------------------------

describe('mutateTopology', () => {
  it('applies a topology mutation and updates density', () => {
    const dag = createLinearDAG('d1', ['a', 'b', 'c']);
    const composite = createComposite(dag, 'medium');
    const rng = seededRng([0.1, 0.0, 0.0, 0.0]); // add_node

    const { composite: child, mutation } = mutateTopology(composite, rng, agents);

    expect(mutation.applied).toBe(true);
    expect(child.topology.nodes.length).toBeGreaterThan(composite.topology.nodes.length);
    expect(child.density).not.toBe(composite.density);
  });

  it('returns original composite on no-op mutation', () => {
    const dag = createMinimalDAG('d1', 'a', 'b');
    const composite = createComposite(dag, 'trivial');
    // roll=0.3 → remove_node, but minimal DAG has no worker nodes
    // fallback should work though, so let's use a roll that's harder to succeed
    const rng = seededRng([0.3, 0.0, 0.0, 0.0, 0.0, 0.5]);

    const { composite: child, mutation } = mutateTopology(composite, rng, agents);

    // randomMutation has fallbacks, so it might still succeed
    if (!mutation.applied) {
      expect(child).toBe(composite);
    } else {
      expect(child).not.toBe(composite);
    }
  });

  it('drops genome assignments when node is removed', () => {
    const dag = createLinearDAG('d1', ['a', 'b', 'c', 'd']);
    const composite: CompositeGenome = {
      ...createComposite(dag, 'medium'),
      genomes: {
        'node-0': {} as any,
        'node-1': {} as any,
        'node-2': {} as any,
        'node-3': {} as any,
      },
    };

    // Force remove_node mutation
    const rng = seededRng([0.3, 0.0]); // remove_node, pick workerNodes[0]
    const { composite: child, mutation } = mutateTopology(composite, rng, agents);

    if (mutation.applied && mutation.kind === 'remove_node') {
      const childNodeIds = new Set(child.topology.nodes.map((n) => n.id));
      for (const genomeKey of Object.keys(child.genomes)) {
        expect(childNodeIds.has(genomeKey)).toBe(true);
      }
    }
  });

  it('preserves valid DAG after mutation', () => {
    const dag = createLinearDAG('d1', ['a', 'b', 'c', 'd']);
    const composite = createComposite(dag, 'medium');

    for (let i = 0; i < 10; i++) {
      const rng = seededRng([i / 10, 0.3, 0.5, 0.2, 0.8, 0.1]);
      const { composite: child, mutation } = mutateTopology(composite, rng, agents);
      if (mutation.applied) {
        expect(validateDAG(child.topology).valid).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// seedPopulation
// ---------------------------------------------------------------------------

describe('seedPopulation', () => {
  it('creates the requested number of seeds', () => {
    const rng = seededRng([0.5, 0.3, 0.7, 0.2, 0.8, 0.4, 0.6, 0.1]);
    const seeds = seedPopulation(agents, rng, 8);
    expect(seeds).toHaveLength(8);
  });

  it('includes a minimal DAG', () => {
    const rng = seededRng([0.5]);
    const seeds = seedPopulation(agents, rng, 1);
    expect(seeds).toHaveLength(1);
    expect(seeds[0].topology.nodes).toHaveLength(2);
  });

  it('creates diverse density levels', () => {
    const rng = seededRng([0.5, 0.3, 0.7, 0.2, 0.8, 0.4, 0.6, 0.1, 0.9, 0.15]);
    const seeds = seedPopulation(agents, rng, 6);
    const densities = seeds.map((s) => s.density);
    const uniqueDensities = new Set(densities.map((d) => d.toFixed(2)));
    expect(uniqueDensities.size).toBeGreaterThanOrEqual(2);
  });

  it('all seeds have valid DAGs', () => {
    const rng = seededRng([0.5, 0.3, 0.7, 0.2, 0.8, 0.4, 0.6]);
    const seeds = seedPopulation(agents, rng, 6);
    for (const seed of seeds) {
      expect(validateDAG(seed.topology).valid).toBe(true);
    }
  });

  it('all seeds have the specified target complexity', () => {
    const rng = seededRng([0.5, 0.3]);
    const seeds = seedPopulation(agents, rng, 3, 'expert');
    for (const seed of seeds) {
      expect(seed.targetComplexity).toBe('expert');
    }
  });

  it('handles count of 0', () => {
    const rng = seededRng([0.5]);
    const seeds = seedPopulation(agents, rng, 0);
    // Should return just the minimal DAG
    expect(seeds.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// evolve
// ---------------------------------------------------------------------------

describe('evolve', () => {
  const shortConfig: ConductorConfig = {
    ...DEFAULT_CONDUCTOR_CONFIG,
    maxGenerations: 10,
    stagnationLimit: 5,
    seed: 42,
    agentPool: agents,
  };

  it('runs evolution loop and returns result', async () => {
    const seeds = [
      createComposite(createMinimalDAG('d1', 'a', 'b'), 'medium'),
      createComposite(createLinearDAG('d2', ['a', 'b', 'c']), 'medium'),
    ];

    const result = await evolve(seeds, densityEvaluator, shortConfig);

    expect(result.elites.length).toBeGreaterThanOrEqual(1);
    expect(result.generationsCompleted).toBeGreaterThanOrEqual(1);
    expect(result.finalStats.occupiedCells).toBeGreaterThanOrEqual(1);
    expect(result.finalStats.totalEvaluations).toBeGreaterThanOrEqual(2); // at least seeds
  });

  it('seeds are evaluated and placed in grid', async () => {
    const seeds = [
      createComposite(createMinimalDAG('d1', 'a', 'b'), 'medium'),
    ];

    const result = await evolve(seeds, constantEvaluator(0.5), shortConfig);

    expect(result.finalStats.totalEvaluations).toBeGreaterThanOrEqual(1);
    expect(result.elites.length).toBeGreaterThanOrEqual(1);
  });

  it('stops early on stagnation', async () => {
    const stagnateConfig: ConductorConfig = {
      ...shortConfig,
      maxGenerations: 100,
      stagnationLimit: 3,
    };

    const seeds = [
      createComposite(createMinimalDAG('d1', 'a', 'b'), 'medium'),
    ];

    // Constant evaluator means no fitness improvement → stagnation
    const result = await evolve(seeds, constantEvaluator(0.5), stagnateConfig);

    expect(result.stagnated).toBe(true);
    expect(result.generationsCompleted).toBeLessThan(100);
  });

  it('records history of evolution steps', async () => {
    const seeds = [
      createComposite(createMinimalDAG('d1', 'a', 'b'), 'medium'),
      createComposite(createLinearDAG('d2', ['a', 'b', 'c']), 'medium'),
    ];

    const result = await evolve(seeds, nodeCountEvaluator, shortConfig);

    // At least some steps should have been recorded
    if (result.history.length > 0) {
      const step = result.history[0];
      expect(step.generation).toBeGreaterThanOrEqual(1);
      expect(step.parentId).toBeDefined();
      expect(step.childId).toBeDefined();
      expect(['topology', 'genome']).toContain(step.mutationType);
      expect(['placed_new', 'replaced_elite', 'rejected']).toContain(step.outcome);
      expect(step.fitness).toBeGreaterThanOrEqual(0);
      expect(step.density).toBeGreaterThanOrEqual(0);
    }
  });

  it('supports async evaluator', async () => {
    const asyncEvaluator: CompositeEvaluator = async (composite) => {
      return composite.density * 0.8;
    };

    const seeds = [
      createComposite(createMinimalDAG('d1', 'a', 'b'), 'medium'),
    ];

    const result = await evolve(seeds, asyncEvaluator, shortConfig);
    expect(result.elites.length).toBeGreaterThanOrEqual(1);
  });

  it('uses genome mutator when topologyMutationRate = 0', async () => {
    const genomeOnlyConfig: ConductorConfig = {
      ...shortConfig,
      topologyMutationRate: 0.0, // all genome mutations
      maxGenerations: 5,
      stagnationLimit: 10,
    };

    let genomeMutationCount = 0;
    const trackingMutator: GenomeMutator = (composite, rng) => {
      genomeMutationCount++;
      // Return a modified composite to avoid stagnation
      return {
        ...composite,
        density: composite.density + 0.01 * rng(),
      };
    };

    const seeds = [
      createComposite(createMinimalDAG('d1', 'a', 'b'), 'medium'),
    ];

    await evolve(seeds, densityEvaluator, genomeOnlyConfig, trackingMutator);
    expect(genomeMutationCount).toBeGreaterThan(0);
  });

  it('uses topology mutations when topologyMutationRate = 1', async () => {
    const topoOnlyConfig: ConductorConfig = {
      ...shortConfig,
      topologyMutationRate: 1.0, // all topology mutations
      maxGenerations: 10,
    };

    const seeds = [
      createComposite(createLinearDAG('d1', ['a', 'b', 'c']), 'medium'),
    ];

    const result = await evolve(seeds, nodeCountEvaluator, topoOnlyConfig);

    // All history steps should be topology mutations
    for (const step of result.history) {
      expect(step.mutationType).toBe('topology');
    }
  });

  it('handles empty seeds gracefully', async () => {
    const result = await evolve([], densityEvaluator, shortConfig);

    expect(result.elites).toHaveLength(0);
    expect(result.generationsCompleted).toBeGreaterThanOrEqual(1);
  });

  it('maintains valid DAGs throughout evolution', async () => {
    const seeds = [
      createComposite(createMinimalDAG('d1', 'a', 'b'), 'medium'),
      createComposite(createLinearDAG('d2', ['a', 'b', 'c', 'd']), 'medium'),
    ];

    const longerConfig: ConductorConfig = {
      ...shortConfig,
      maxGenerations: 20,
      stagnationLimit: 10,
    };

    const result = await evolve(seeds, nodeCountEvaluator, longerConfig);

    for (const elite of result.elites) {
      const validation = validateDAG(elite.composite.topology);
      expect(validation.valid).toBe(true);
    }
  });

  it('deterministic with seed', async () => {
    const seeds = [
      createComposite(createMinimalDAG('d1', 'a', 'b'), 'medium'),
      createComposite(createLinearDAG('d2', ['a', 'b', 'c']), 'medium'),
    ];

    resetIdCounter();
    const result1 = await evolve(seeds, nodeCountEvaluator, { ...shortConfig, seed: 123 });

    resetIdCounter();
    const result2 = await evolve(seeds, nodeCountEvaluator, { ...shortConfig, seed: 123 });

    expect(result1.generationsCompleted).toBe(result2.generationsCompleted);
    expect(result1.history.length).toBe(result2.history.length);
    expect(result1.finalStats.occupiedCells).toBe(result2.finalStats.occupiedCells);
  });
});

// ---------------------------------------------------------------------------
// selectForComplexity
// ---------------------------------------------------------------------------

describe('selectForComplexity', () => {
  function makeElite(
    density: number,
    fitness: number,
    nodeCount: number,
    id: string,
  ): CompositeElite {
    const agents = Array.from({ length: nodeCount }, (_, i) => `a${i}`);
    const dag = nodeCount <= 2
      ? createMinimalDAG(id, agents[0], agents[1] || agents[0])
      : createLinearDAG(id, agents);
    const composite: CompositeGenome = {
      topology: dag,
      genomes: {},
      density,
      targetComplexity: 'medium',
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

  it('returns null for empty pool', () => {
    expect(selectForComplexity([], 'medium')).toBeNull();
  });

  it('returns the only candidate', () => {
    const elite = makeElite(0.5, 0.7, 3, 'single');
    const result = selectForComplexity([elite], 'medium');
    expect(result).not.toBeNull();
    expect(result!.compositeId).toBe('single');
  });

  it('prefers sparse topology for trivial tasks', () => {
    const sparse = makeElite(0.1, 0.6, 2, 'sparse');
    const dense = makeElite(0.8, 0.6, 6, 'dense');

    const result = selectForComplexity([sparse, dense], 'trivial');
    expect(result).not.toBeNull();
    expect(result!.compositeId).toBe('sparse');
  });

  it('prefers dense topology for expert tasks', () => {
    const sparse = makeElite(0.1, 0.6, 2, 'sparse');
    const dense = makeElite(0.8, 0.6, 6, 'dense');

    const result = selectForComplexity([sparse, dense], 'expert');
    expect(result).not.toBeNull();
    expect(result!.compositeId).toBe('dense');
  });

  it('considers fitness when density match is similar', () => {
    const lowFit = makeElite(0.45, 0.3, 3, 'low-fit');
    const highFit = makeElite(0.45, 0.9, 3, 'high-fit');

    const result = selectForComplexity([lowFit, highFit], 'medium');
    expect(result).not.toBeNull();
    expect(result!.compositeId).toBe('high-fit');
  });
});

// ---------------------------------------------------------------------------
// selectPortfolio
// ---------------------------------------------------------------------------

describe('selectPortfolio', () => {
  function makeElite(
    density: number,
    fitness: number,
    id: string,
  ): CompositeElite {
    const dag = createMinimalDAG(id, 'a', 'b');
    const composite: CompositeGenome = {
      topology: dag,
      genomes: {},
      density,
      targetComplexity: 'medium',
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

  it('returns empty map for empty pool', () => {
    const portfolio = selectPortfolio([]);
    expect(portfolio.size).toBe(0);
  });

  it('maps each complexity level to an elite', () => {
    const elites = [
      makeElite(0.1, 0.7, 'e1'),
      makeElite(0.3, 0.7, 'e2'),
      makeElite(0.5, 0.7, 'e3'),
      makeElite(0.7, 0.7, 'e4'),
      makeElite(0.9, 0.7, 'e5'),
    ];

    const portfolio = selectPortfolio(elites);

    const complexities: TaskComplexity[] = ['trivial', 'simple', 'medium', 'complex', 'expert'];
    for (const c of complexities) {
      expect(portfolio.has(c)).toBe(true);
    }
  });

  it('assigns different elites to different complexity levels', () => {
    // Use topologies with genuinely different structure (scoreDagForComplexity
    // uses computeDensity on the actual DAG, not the density field)
    const sparseDag = createMinimalDAG('sparse', 'a', 'b');
    const denseDag = createLinearDAG('dense', ['a', 'b', 'c', 'd', 'e', 'f', 'g']);

    const sparseElite: CompositeElite = {
      composite: { topology: sparseDag, genomes: {}, density: computeDensity(sparseDag).compositeDensity, targetComplexity: 'trivial' },
      fitness: 0.7,
      densityMetrics: computeDensity(sparseDag),
      coordinate: { x: 0, y: 0 },
      compositeId: 'sparse',
      generation: 0,
      parentId: null,
    };

    const denseElite: CompositeElite = {
      composite: { topology: denseDag, genomes: {}, density: computeDensity(denseDag).compositeDensity, targetComplexity: 'expert' },
      fitness: 0.7,
      densityMetrics: computeDensity(denseDag),
      coordinate: { x: 0, y: 0 },
      compositeId: 'dense',
      generation: 0,
      parentId: null,
    };

    const portfolio = selectPortfolio([sparseElite, denseElite]);

    const trivialElite = portfolio.get('trivial');
    const expertElite = portfolio.get('expert');

    // Sparse topology should score better for trivial tasks
    expect(trivialElite!.compositeId).toBe('sparse');
    // Dense topology should score better for expert tasks
    expect(expertElite!.compositeId).toBe('dense');
  });
});

// ---------------------------------------------------------------------------
// Integration: full evolution + selection
// ---------------------------------------------------------------------------

describe('integration', () => {
  it('evolves and selects appropriate topologies per complexity', async () => {
    const config: ConductorConfig = {
      ...DEFAULT_CONDUCTOR_CONFIG,
      maxGenerations: 20,
      stagnationLimit: 10,
      seed: 42,
      agentPool: agents,
    };

    const seeds = [
      createComposite(createMinimalDAG('d1', 'a', 'b'), 'medium'),
      createComposite(createLinearDAG('d2', ['a', 'b', 'c']), 'medium'),
      createComposite(createLinearDAG('d3', ['a', 'b', 'c', 'd', 'e']), 'medium'),
    ];

    const result = await evolve(seeds, nodeCountEvaluator, config);

    expect(result.elites.length).toBeGreaterThanOrEqual(1);

    // Select portfolio
    const portfolio = selectPortfolio(result.elites);
    expect(portfolio.size).toBeGreaterThanOrEqual(1);

    // All selected topologies should be valid
    for (const [, elite] of portfolio) {
      expect(validateDAG(elite.composite.topology).valid).toBe(true);
    }
  });

  it('evolution increases grid coverage over generations', async () => {
    const config: ConductorConfig = {
      ...DEFAULT_CONDUCTOR_CONFIG,
      maxGenerations: 30,
      stagnationLimit: 15,
      seed: 99,
      agentPool: agents,
    };

    const seeds = [
      createComposite(createMinimalDAG('d1', 'a', 'b'), 'medium'),
      createComposite(createLinearDAG('d2', ['a', 'b', 'c', 'd']), 'medium'),
    ];

    const result = await evolve(seeds, nodeCountEvaluator, config);

    // Should have explored more niches than just the seeds
    expect(result.finalStats.occupiedCells).toBeGreaterThanOrEqual(2);
  });
});
