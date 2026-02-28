/**
 * Co-Evolution Conductor: simultaneously evolves topology structure
 * and agent section content using MAP-Elites with density × quality
 * behavioral dimensions.
 *
 * Design:
 * - MAP-Elites grid: density (x) × fitness (y), one composite genome per cell
 * - Each generation: select parent → mutate topology OR genome → evaluate → place
 * - Topology mutations change DAG structure (add/remove nodes/edges, change roles)
 * - Genome mutations change agent section content (ablate, swap, replace)
 * - When topology adds a node, a genome is assigned from the agent pool
 * - When topology removes a node, its genome is dropped
 *
 * NEAT principle: start minimal (entry→exit), grow complexity through
 * structural mutations. Density-difficulty mapping ensures diverse
 * topologies across the complexity spectrum.
 *
 * Design references:
 * - Wang et al. (2026): AgentConductor — adaptive topology +14.6% accuracy
 * - Stanley & Miikkulainen (2002): NEAT — evolve topology + weights
 * - Mouret & Clune (2015): MAP-Elites — quality-diversity search
 * - AGENT-EVOLUTION-RESEARCH.md Phase 2, Step 4
 *
 * Constraints:
 * - Zero external dependencies (beyond local module imports)
 * - All operations pure/deterministic given same RNG state
 * - Evaluator is injectable for testability
 */

import type {
  WorkflowDAG,
  TopologyMutationResult,
  TaskComplexity,
  CompositeGenome,
  DensityMetrics,
} from './types.js';
import { computeDensity } from './dag.js';
import { createMinimalDAG, createLinearDAG } from './dag.js';
import { randomMutation } from './mutations.js';
import { scoreDagForComplexity } from './mapping.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for one axis of the conductor's MAP-Elites grid. */
export interface ConductorAxisConfig {
  readonly bins: number;
  readonly min: number;
  readonly max: number;
}

/** Configuration for the co-evolution conductor. */
export interface ConductorConfig {
  /** X-axis: composite density (0-1). */
  readonly densityAxis: ConductorAxisConfig;

  /** Y-axis: fitness score (0-1). */
  readonly fitnessAxis: ConductorAxisConfig;

  /** Maximum generations per evolution run. */
  readonly maxGenerations: number;

  /** Stop early after this many consecutive generations with no improvement. */
  readonly stagnationLimit: number;

  /**
   * Probability of applying a topology mutation vs. a genome mutation.
   * 0.0 = all genome mutations, 1.0 = all topology mutations.
   */
  readonly topologyMutationRate: number;

  /** Random seed for reproducibility (null = non-deterministic). */
  readonly seed: number | null;

  /** Agent names available for topology node assignment. */
  readonly agentPool: readonly string[];
}

/** Default conductor configuration. */
export const DEFAULT_CONDUCTOR_CONFIG: ConductorConfig = {
  densityAxis: { bins: 10, min: 0.0, max: 1.0 },
  fitnessAxis: { bins: 10, min: 0.0, max: 1.0 },
  maxGenerations: 50,
  stagnationLimit: 15,
  topologyMutationRate: 0.6,
  seed: null,
  agentPool: [
    'story-concept',
    'architecture-concept',
    'implementation-concept',
    'quality-concept',
    'verification-concept',
  ],
};

/** A composite elite occupying one grid cell. */
export interface CompositeElite {
  readonly composite: CompositeGenome;
  readonly fitness: number;
  readonly densityMetrics: DensityMetrics;
  readonly coordinate: GridCoord;
  readonly compositeId: string;
  readonly generation: number;
  readonly parentId: string | null;
}

/** Grid coordinate (density bin × fitness bin). */
export interface GridCoord {
  readonly x: number; // density bin
  readonly y: number; // fitness bin
}

/** Outcome of placing a composite genome. */
export type ConductorPlacement = 'placed_new' | 'replaced_elite' | 'rejected';

/** Record of one co-evolution step. */
export interface ConductorStep {
  readonly generation: number;
  readonly parentId: string;
  readonly childId: string;
  readonly mutationType: 'topology' | 'genome';
  readonly mutationDescription: string;
  readonly fitness: number;
  readonly density: number;
  readonly coordinate: GridCoord;
  readonly outcome: ConductorPlacement;
}

/** Population-level statistics. */
export interface ConductorStats {
  readonly occupiedCells: number;
  readonly totalCells: number;
  readonly coverage: number;
  readonly meanFitness: number;
  readonly maxFitness: number;
  readonly minFitness: number;
  readonly generation: number;
  readonly totalEvaluations: number;
  /** Mean composite density across all elites. */
  readonly meanDensity: number;
  /** Density range: [min, max] across all elites. */
  readonly densityRange: readonly [number, number];
}

/** Final result of a conductor evolution run. */
export interface ConductorResult {
  readonly elites: readonly CompositeElite[];
  readonly history: readonly ConductorStep[];
  readonly finalStats: ConductorStats;
  readonly generationsCompleted: number;
  readonly stagnated: boolean;
}

/**
 * Evaluator function: scores a composite genome and returns fitness [0, 1].
 * Injectable for testability — production version calls the benchmark harness.
 */
export type CompositeEvaluator = (composite: CompositeGenome) => number | Promise<number>;

/**
 * Genome mutation function: mutates the agent genome content of a composite.
 * Returns a new composite with modified genome sections (topology unchanged).
 * Injectable for testability — production version uses mutation operators.
 */
export type GenomeMutator = (
  composite: CompositeGenome,
  rng: () => number,
) => CompositeGenome;

// ---------------------------------------------------------------------------
// Seeded PRNG (xoshiro128**)
// ---------------------------------------------------------------------------

function splitmix32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x9E3779B9) | 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x85EBCA6B);
    z = Math.imul(z ^ (z >>> 13), 0xC2B2AE35);
    return (z ^ (z >>> 16)) >>> 0;
  };
}

function createRng(seed: number | null): () => number {
  if (seed === null) return Math.random;

  const sm = splitmix32(seed);
  let s0 = sm();
  let s1 = sm();
  let s2 = sm();
  let s3 = sm();

  return () => {
    const result = Math.imul(s1 * 5, 7) >>> 0;
    const t = s1 << 9;

    s2 ^= s0;
    s3 ^= s1;
    s1 ^= s2;
    s0 ^= s3;
    s2 ^= t;
    s3 = (s3 << 11) | (s3 >>> 21);

    return (result >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Grid quantization
// ---------------------------------------------------------------------------

function quantizeLinear(value: number, axis: ConductorAxisConfig): number {
  const { bins, min, max } = axis;
  if (bins <= 0) return 0;
  if (value <= min) return 0;
  if (value >= max) return bins - 1;
  const ratio = (value - min) / (max - min);
  return Math.min(Math.floor(ratio * bins), bins - 1);
}

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

let idCounter = 0;

function generateCompositeId(generation: number): string {
  idCounter++;
  return `cg-${generation}-${idCounter}`;
}

/** Reset ID counter (for testing reproducibility). */
export function resetIdCounter(): void {
  idCounter = 0;
}

// ---------------------------------------------------------------------------
// Conductor Grid
// ---------------------------------------------------------------------------

/**
 * MAP-Elites grid for composite genomes, indexed by
 * composite density (x) × fitness (y).
 *
 * Each cell holds the single best composite genome for that
 * density/fitness niche.
 */
export class ConductorGrid {
  private readonly cells: (CompositeElite | null)[];
  private readonly occupiedIndices: Set<number>;
  readonly config: ConductorConfig;

  constructor(config: ConductorConfig = DEFAULT_CONDUCTOR_CONFIG) {
    this.config = config;
    const totalCells = config.densityAxis.bins * config.fitnessAxis.bins;
    this.cells = new Array<CompositeElite | null>(totalCells).fill(null);
    this.occupiedIndices = new Set();
  }

  get totalCells(): number {
    return this.config.densityAxis.bins * this.config.fitnessAxis.bins;
  }

  get occupiedCount(): number {
    return this.occupiedIndices.size;
  }

  /** Map continuous density + fitness to grid coordinates. */
  coordinateFor(density: number, fitness: number): GridCoord {
    return {
      x: quantizeLinear(density, this.config.densityAxis),
      y: quantizeLinear(fitness, this.config.fitnessAxis),
    };
  }

  /** Attempt to place a composite genome in its behavioral niche. */
  tryPlace(
    composite: CompositeGenome,
    fitness: number,
    metrics: DensityMetrics,
    compositeId: string,
    generation: number,
    parentId: string | null,
  ): ConductorPlacement {
    const coord = this.coordinateFor(metrics.compositeDensity, fitness);
    const index = coord.x * this.config.fitnessAxis.bins + coord.y;

    const incumbent = this.cells[index];

    const entry: CompositeElite = {
      composite,
      fitness,
      densityMetrics: metrics,
      coordinate: coord,
      compositeId,
      generation,
      parentId,
    };

    if (incumbent === null) {
      this.cells[index] = entry;
      this.occupiedIndices.add(index);
      return 'placed_new';
    }

    if (fitness > incumbent.fitness) {
      this.cells[index] = entry;
      return 'replaced_elite';
    }

    return 'rejected';
  }

  /** Uniform random selection from occupied cells. */
  selectRandom(rng: () => number): CompositeElite | null {
    if (this.occupiedIndices.size === 0) return null;
    const indices = Array.from(this.occupiedIndices);
    const selected = indices[Math.floor(rng() * indices.length)];
    return this.cells[selected];
  }

  /** Get elite at specific coordinates. */
  getAt(coord: GridCoord): CompositeElite | null {
    const index = coord.x * this.config.fitnessAxis.bins + coord.y;
    if (index < 0 || index >= this.cells.length) return null;
    return this.cells[index];
  }

  /** All occupied elites. */
  allElites(): readonly CompositeElite[] {
    const result: CompositeElite[] = [];
    for (const index of this.occupiedIndices) {
      const entry = this.cells[index];
      if (entry) result.push(entry);
    }
    return result;
  }

  /** Elite with highest fitness. */
  bestElite(): CompositeElite | null {
    let best: CompositeElite | null = null;
    for (const index of this.occupiedIndices) {
      const entry = this.cells[index];
      if (entry && (best === null || entry.fitness > best.fitness)) {
        best = entry;
      }
    }
    return best;
  }

  /** Population statistics. */
  getStats(generation: number, totalEvaluations: number): ConductorStats {
    const elites = this.allElites();

    if (elites.length === 0) {
      return {
        occupiedCells: 0,
        totalCells: this.totalCells,
        coverage: 0,
        meanFitness: 0,
        maxFitness: 0,
        minFitness: 0,
        generation,
        totalEvaluations,
        meanDensity: 0,
        densityRange: [0, 0],
      };
    }

    let sumFit = 0;
    let maxFit = -Infinity;
    let minFit = Infinity;
    let sumDen = 0;
    let minDen = Infinity;
    let maxDen = -Infinity;

    for (const e of elites) {
      sumFit += e.fitness;
      if (e.fitness > maxFit) maxFit = e.fitness;
      if (e.fitness < minFit) minFit = e.fitness;
      sumDen += e.composite.density;
      if (e.composite.density < minDen) minDen = e.composite.density;
      if (e.composite.density > maxDen) maxDen = e.composite.density;
    }

    return {
      occupiedCells: elites.length,
      totalCells: this.totalCells,
      coverage: elites.length / this.totalCells,
      meanFitness: sumFit / elites.length,
      maxFitness: maxFit,
      minFitness: minFit,
      generation,
      totalEvaluations,
      meanDensity: sumDen / elites.length,
      densityRange: [minDen, maxDen],
    };
  }
}

// ---------------------------------------------------------------------------
// Composite genome construction
// ---------------------------------------------------------------------------

/**
 * Creates a CompositeGenome from a DAG with empty genome assignments.
 * Used for seeding the initial population.
 */
export function createComposite(
  dag: WorkflowDAG,
  targetComplexity: TaskComplexity,
): CompositeGenome {
  const metrics = computeDensity(dag);
  return {
    topology: dag,
    genomes: {},
    density: metrics.compositeDensity,
    targetComplexity,
  };
}

// ---------------------------------------------------------------------------
// Topology mutation adapter
// ---------------------------------------------------------------------------

/**
 * Applies a random topology mutation to a composite genome.
 *
 * When topology changes:
 * - add_node: new node gets empty genome assignment
 * - remove_node: removed node's genome is dropped
 * - reassign_agent: genome assignment updated
 * - Other mutations: genomes unchanged
 *
 * Returns a new CompositeGenome with updated topology and density.
 */
export function mutateTopology(
  composite: CompositeGenome,
  rng: () => number,
  agentPool: readonly string[],
): { composite: CompositeGenome; mutation: TopologyMutationResult } {
  const mutation = randomMutation(composite.topology, rng, agentPool);

  if (!mutation.applied) {
    return { composite, mutation };
  }

  const newDag = mutation.dag;
  const newMetrics = computeDensity(newDag);

  // Update genome assignments based on mutation kind
  const newGenomes = { ...composite.genomes };

  if (mutation.kind === 'remove_node') {
    // Find removed node IDs
    const newIds = new Set(newDag.nodes.map((n) => n.id));
    for (const nodeId of Object.keys(newGenomes)) {
      if (!newIds.has(nodeId)) {
        delete newGenomes[nodeId];
      }
    }
  }

  return {
    composite: {
      topology: newDag,
      genomes: newGenomes,
      density: newMetrics.compositeDensity,
      targetComplexity: composite.targetComplexity,
    },
    mutation,
  };
}

// ---------------------------------------------------------------------------
// Default genome mutator (identity — production overrides this)
// ---------------------------------------------------------------------------

/**
 * Default no-op genome mutator. Production code should inject a real
 * mutator that uses the mutation operators.
 */
export const identityGenomeMutator: GenomeMutator = (composite) => composite;

// ---------------------------------------------------------------------------
// Seed population
// ---------------------------------------------------------------------------

/**
 * Creates a diverse initial population of composite genomes.
 *
 * Generates topologies at different density levels by starting with
 * minimal DAGs and applying controlled mutations:
 * - Minimal: entry → exit (lowest density)
 * - Linear 3-node: entry → worker → exit
 * - Linear 5-node: entry → w1 → w2 → w3 → exit
 * - Custom structures from additional mutations
 *
 * @param agentPool - Available agent names for node assignment
 * @param rng - Random number generator
 * @param count - Number of initial genomes to create
 * @param targetComplexity - Task complexity these topologies target
 * @returns Array of diverse composite genomes
 */
export function seedPopulation(
  agentPool: readonly string[],
  rng: () => number,
  count: number,
  targetComplexity: TaskComplexity = 'medium',
): readonly CompositeGenome[] {
  const composites: CompositeGenome[] = [];
  const agentAt = (i: number) => agentPool[i % agentPool.length];

  // Always include a minimal DAG
  composites.push(createComposite(
    createMinimalDAG('seed-0', agentAt(0), agentAt(1)),
    targetComplexity,
  ));

  if (count <= 1) return composites;

  // Linear DAGs of increasing size
  const sizes = [3, 4, 5, 6, 7];
  for (let i = 0; i < Math.min(count - 1, sizes.length); i++) {
    const agents = Array.from({ length: sizes[i] }, (_, j) => agentAt(j));
    composites.push(createComposite(
      createLinearDAG(`seed-${composites.length}`, agents),
      targetComplexity,
    ));
  }

  // If we need more, apply random mutations to existing topologies
  while (composites.length < count) {
    const parentIdx = Math.floor(rng() * composites.length);
    const parent = composites[parentIdx];
    const { composite: child, mutation } = mutateTopology(parent, rng, agentPool);
    if (mutation.applied) {
      composites.push({
        ...child,
        topology: {
          ...child.topology,
          id: `seed-${composites.length}`,
        },
      });
    } else {
      // Fallback: create a linear DAG with random size
      const size = 2 + Math.floor(rng() * 5);
      const agents = Array.from({ length: size }, (_, j) => agentAt(j));
      composites.push(createComposite(
        createLinearDAG(`seed-${composites.length}`, agents),
        targetComplexity,
      ));
    }
  }

  return composites;
}

// ---------------------------------------------------------------------------
// Main evolution loop
// ---------------------------------------------------------------------------

/**
 * Runs the co-evolution loop: MAP-Elites over composite genomes.
 *
 * Each generation:
 * 1. Select a parent uniformly from occupied grid cells
 * 2. With probability topologyMutationRate, apply topology mutation;
 *    otherwise apply genome mutation
 * 3. Evaluate the child's fitness
 * 4. Compute density metrics and place in grid
 * 5. Record the step and check for stagnation
 *
 * @param seeds - Initial composite genomes to seed the grid
 * @param evaluator - Fitness function (injectable)
 * @param config - Conductor configuration
 * @param genomeMutator - Genome mutation function (injectable, default no-op)
 * @returns Evolution result with final grid state, history, and statistics
 */
export async function evolve(
  seeds: readonly CompositeGenome[],
  evaluator: CompositeEvaluator,
  config: ConductorConfig = DEFAULT_CONDUCTOR_CONFIG,
  genomeMutator: GenomeMutator = identityGenomeMutator,
): Promise<ConductorResult> {
  const rng = createRng(config.seed);
  const grid = new ConductorGrid(config);
  const history: ConductorStep[] = [];
  let totalEvals = 0;

  // Seed phase: evaluate and place initial population
  for (const seed of seeds) {
    const fitness = await evaluator(seed);
    totalEvals++;
    const metrics = computeDensity(seed.topology);
    const id = generateCompositeId(0);
    grid.tryPlace(seed, fitness, metrics, id, 0, null);
  }

  // Evolution loop
  let stagnationCounter = 0;
  let gen = 0;

  for (gen = 1; gen <= config.maxGenerations; gen++) {
    const parent = grid.selectRandom(rng);
    if (!parent) break; // Empty grid — cannot continue

    let childComposite: CompositeGenome;
    let mutationType: 'topology' | 'genome';
    let mutationDescription: string;

    const roll = rng();
    if (roll < config.topologyMutationRate) {
      // Topology mutation
      const { composite, mutation } = mutateTopology(parent.composite, rng, config.agentPool);
      childComposite = composite;
      mutationType = 'topology';
      mutationDescription = mutation.description;

      if (!mutation.applied) {
        stagnationCounter++;
        if (stagnationCounter >= config.stagnationLimit) break;
        continue;
      }
    } else {
      // Genome mutation
      childComposite = genomeMutator(parent.composite, rng);
      mutationType = 'genome';
      mutationDescription = childComposite === parent.composite
        ? 'No genome mutation applied'
        : 'Genome sections mutated';

      if (childComposite === parent.composite) {
        stagnationCounter++;
        if (stagnationCounter >= config.stagnationLimit) break;
        continue;
      }
    }

    // Evaluate child
    const fitness = await evaluator(childComposite);
    totalEvals++;

    const metrics = computeDensity(childComposite.topology);
    const childId = generateCompositeId(gen);
    const outcome = grid.tryPlace(childComposite, fitness, metrics, childId, gen, parent.compositeId);
    const coord = grid.coordinateFor(metrics.compositeDensity, fitness);

    history.push({
      generation: gen,
      parentId: parent.compositeId,
      childId,
      mutationType,
      mutationDescription,
      fitness,
      density: metrics.compositeDensity,
      coordinate: coord,
      outcome,
    });

    if (outcome === 'rejected') {
      stagnationCounter++;
    } else {
      stagnationCounter = 0;
    }

    if (stagnationCounter >= config.stagnationLimit) break;
  }

  const finalStats = grid.getStats(gen, totalEvals);

  return {
    elites: grid.allElites(),
    history,
    finalStats,
    generationsCompleted: gen,
    stagnated: stagnationCounter >= config.stagnationLimit,
  };
}

// ---------------------------------------------------------------------------
// Task-specific topology selection
// ---------------------------------------------------------------------------

/**
 * Selects the best topology for a given task complexity from the
 * evolved population.
 *
 * Uses the density-difficulty mapping to find elites whose composite
 * density best matches the target for the given complexity level.
 * Among density-matched candidates, selects the one with highest fitness.
 *
 * @param elites - Pool of evolved composite elites
 * @param complexity - Task complexity to match
 * @returns The best matching elite, or null if pool is empty
 */
export function selectForComplexity(
  elites: readonly CompositeElite[],
  complexity: TaskComplexity,
): CompositeElite | null {
  if (elites.length === 0) return null;

  let bestElite: CompositeElite | null = null;
  let bestScore = -1;

  for (const elite of elites) {
    const { score } = scoreDagForComplexity(elite.composite.topology, complexity);
    // Combine density match with fitness: 60% density match, 40% fitness
    const combinedScore = 0.6 * score + 0.4 * elite.fitness;
    if (combinedScore > bestScore) {
      bestScore = combinedScore;
      bestElite = elite;
    }
  }

  return bestElite;
}

/**
 * Selects the best topology for each complexity level.
 *
 * Returns a map from TaskComplexity → best CompositeElite.
 * Useful for deploying an evolved topology portfolio.
 */
export function selectPortfolio(
  elites: readonly CompositeElite[],
): ReadonlyMap<TaskComplexity, CompositeElite> {
  const complexities: TaskComplexity[] = ['trivial', 'simple', 'medium', 'complex', 'expert'];
  const portfolio = new Map<TaskComplexity, CompositeElite>();

  for (const complexity of complexities) {
    const best = selectForComplexity(elites, complexity);
    if (best) {
      portfolio.set(complexity, best);
    }
  }

  return portfolio;
}
