/**
 * MAP-Elites population manager: orchestrates the evolutionary loop.
 *
 * The manager coordinates:
 * 1. Population seeding (initial genomes → evaluate → place in grid)
 * 2. Parent selection (uniform random from occupied cells)
 * 3. Mutation (deterministic or ELM-style LLM-based)
 * 4. Fitness evaluation (via EvaluationHarness)
 * 5. Niche update (place child in grid, potentially replacing incumbent)
 * 6. Stagnation detection (early stopping)
 *
 * Design constraints:
 * - Harness and mutation strategy are injectable
 * - Each generation evaluates exactly one child
 * - Evolution history is recorded for analysis
 * - Deterministic when seeded (reproducible experiments)
 */

import type { AgentGenome, CanonicalSectionId } from '../genome/schema.js';
import type { BenchmarkTask, PortfolioResult } from '../benchmark/schema.js';
import type { MutationResult, LLMCompleteFn } from '../mutation/types.js';
import { EvaluationHarness } from '../harness/harness.js';
import { ElitesGrid } from './grid.js';
import type {
  EvolutionStep,
  GridConfig,
  ManagerConfig,
  PopulationStats,
} from './types.js';
import { DEFAULT_GRID_CONFIG, DEFAULT_MANAGER_CONFIG } from './types.js';

// ---------------------------------------------------------------------------
// Mutation strategy interface
// ---------------------------------------------------------------------------

/**
 * Strategy for producing mutations from a parent genome.
 *
 * Implementations choose mutation operators based on the parent's
 * portfolio result, generation number, and randomness.
 *
 * Decoupled from the manager to allow:
 * - Pure deterministic strategies (for testing)
 * - ELM-style LLM-guided rewriting
 * - Composite strategies with adaptive operator selection
 */
export interface MutationStrategy {
  /**
   * Produces a mutated child genome from a parent.
   *
   * @param parent - The parent genome to mutate
   * @param portfolio - Parent's most recent fitness evaluation
   * @param generation - Current generation number
   * @param rng - Seeded random function (or Math.random)
   * @returns The mutation result (may have applied=false if mutation is a no-op)
   */
  mutate(
    parent: AgentGenome,
    portfolio: PortfolioResult,
    generation: number,
    rng: () => number,
  ): Promise<MutationResult>;
}

// ---------------------------------------------------------------------------
// Seeded PRNG (xoshiro128**)
// ---------------------------------------------------------------------------

/**
 * Creates a seeded pseudo-random number generator.
 *
 * Uses splitmix32 for seed expansion and xoshiro128** for generation.
 * Produces deterministic sequences for reproducible experiments.
 *
 * @param seed - Integer seed value
 * @returns Function returning uniform random values in [0, 1)
 */
export function createRng(seed: number): () => number {
  // splitmix32 for initial state expansion
  let s = seed | 0;
  function splitmix32(): number {
    s = (s + 0x9e3779b9) | 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  }

  // Initialize xoshiro128** state from seed
  let a = splitmix32();
  let b = splitmix32();
  let c = splitmix32();
  let d = splitmix32();

  return function xoshiro128ss(): number {
    const result = Math.imul(rotl(Math.imul(b, 5), 7), 9);
    const t = b << 9;
    c ^= a;
    d ^= b;
    b ^= c;
    a ^= d;
    c ^= t;
    d = rotl(d, 11);
    return (result >>> 0) / 4294967296; // 2^32
  };
}

function rotl(x: number, k: number): number {
  return (x << k) | (x >>> (32 - k));
}

// ---------------------------------------------------------------------------
// Evolution run result
// ---------------------------------------------------------------------------

/** Complete result of an evolution run. */
export interface EvolutionResult {
  /** Final grid state. */
  readonly grid: ElitesGrid;

  /** All evolution steps in chronological order. */
  readonly history: readonly EvolutionStep[];

  /** Population statistics at each generation. */
  readonly statsHistory: readonly PopulationStats[];

  /** Final population statistics. */
  readonly finalStats: PopulationStats;

  /** Number of generations completed. */
  readonly generationsCompleted: number;

  /** Whether evolution stopped early due to stagnation. */
  readonly stagnated: boolean;
}

// ---------------------------------------------------------------------------
// PopulationManager
// ---------------------------------------------------------------------------

/**
 * Orchestrates MAP-Elites evolutionary optimization.
 *
 * Usage:
 * ```typescript
 * const manager = new PopulationManager(harness, strategy, config);
 * await manager.seed(initialGenomes, benchmarkTasks);
 * const result = await manager.evolve(benchmarkTasks);
 * console.log(result.finalStats.maxFitness);
 * ```
 */
export class PopulationManager {
  private readonly harness: EvaluationHarness;
  private readonly strategy: MutationStrategy;
  private readonly config: ManagerConfig;
  private readonly grid: ElitesGrid;
  private readonly rng: () => number;
  private generation: number = 0;
  private totalEvaluations: number = 0;
  private readonly history: EvolutionStep[] = [];
  private readonly statsHistory: PopulationStats[] = [];

  constructor(
    harness: EvaluationHarness,
    strategy: MutationStrategy,
    config: Partial<ManagerConfig> = {},
  ) {
    this.harness = harness;
    this.strategy = strategy;
    this.config = { ...DEFAULT_MANAGER_CONFIG, ...config };
    this.grid = new ElitesGrid(this.config.grid ?? DEFAULT_GRID_CONFIG);

    this.rng = this.config.seed !== null
      ? createRng(this.config.seed)
      : Math.random;
  }

  /** Access the current grid state (read-only). */
  get currentGrid(): ElitesGrid {
    return this.grid;
  }

  /** Current generation number. */
  get currentGeneration(): number {
    return this.generation;
  }

  // -------------------------------------------------------------------------
  // Population seeding
  // -------------------------------------------------------------------------

  /**
   * Seeds the grid with initial genomes.
   *
   * Evaluates each genome against the benchmark tasks and places the
   * results in the grid. This establishes the baseline population.
   *
   * @param genomes - Initial genome variants to evaluate
   * @param tasks - Benchmark task catalog
   * @returns Number of genomes successfully placed in the grid
   */
  async seed(
    genomes: readonly AgentGenome[],
    tasks: readonly BenchmarkTask[],
  ): Promise<number> {
    let placed = 0;

    for (let i = 0; i < genomes.length; i++) {
      const genome = genomes[i];
      const genomeId = `seed-${genome.agentName}-${i}`;

      const portfolio = await this.harness.evaluatePortfolio(
        genome,
        tasks,
        genomeId,
      );
      this.totalEvaluations++;

      const outcome = this.grid.tryPlace(
        genome,
        portfolio,
        genomeId,
        0,
        null,
      );

      if (outcome !== 'rejected') placed++;
    }

    // Record initial stats
    this.statsHistory.push(
      this.grid.getStats(0, this.totalEvaluations),
    );

    return placed;
  }

  // -------------------------------------------------------------------------
  // Evolution loop
  // -------------------------------------------------------------------------

  /**
   * Runs the MAP-Elites evolutionary loop.
   *
   * Each generation:
   * 1. Select a parent uniformly at random from occupied cells
   * 2. Apply mutation strategy to produce a child
   * 3. Evaluate child on benchmark tasks
   * 4. Attempt to place child in grid (may replace incumbent)
   * 5. Record step and update statistics
   *
   * Stops when maxGenerations is reached or stagnation is detected.
   *
   * @param tasks - Benchmark task catalog
   * @returns Complete evolution result with history and statistics
   */
  async evolve(
    tasks: readonly BenchmarkTask[],
  ): Promise<EvolutionResult> {
    let consecutiveNoImprovement = 0;
    let stagnated = false;

    for (let gen = 1; gen <= this.config.maxGenerations; gen++) {
      this.generation = gen;

      // 1. Select parent
      const parent = this.grid.selectRandom(this.rng);
      if (!parent) break; // Grid is empty — cannot evolve

      // 2. Mutate
      const mutation = await this.strategy.mutate(
        parent.genome,
        parent.portfolio,
        gen,
        this.rng,
      );

      // Skip evaluation if mutation was a no-op
      if (!mutation.applied) {
        consecutiveNoImprovement++;
        if (consecutiveNoImprovement >= this.config.stagnationLimit) {
          stagnated = true;
          break;
        }
        continue;
      }

      const childId = `gen-${gen}-${mutation.kind}`;

      // 3. Evaluate child
      const portfolio = await this.harness.evaluatePortfolio(
        mutation.genome,
        tasks,
        childId,
      );
      this.totalEvaluations++;

      // 4. Place in grid
      const coordinate = this.grid.coordinateFor(portfolio);
      const outcome = this.grid.tryPlace(
        mutation.genome,
        portfolio,
        childId,
        gen,
        parent.genomeId,
      );

      // 5. Record
      const step: EvolutionStep = {
        generation: gen,
        parentId: parent.genomeId,
        childId,
        mutation,
        portfolio,
        coordinate,
        outcome,
      };
      this.history.push(step);

      // Stagnation tracking
      if (outcome === 'placed_new' || outcome === 'replaced_elite') {
        consecutiveNoImprovement = 0;
      } else {
        consecutiveNoImprovement++;
      }

      if (consecutiveNoImprovement >= this.config.stagnationLimit) {
        stagnated = true;
        break;
      }

      // Record stats every generation
      this.statsHistory.push(
        this.grid.getStats(gen, this.totalEvaluations),
      );
    }

    // Final stats
    const finalStats = this.grid.getStats(
      this.generation,
      this.totalEvaluations,
    );
    if (this.statsHistory.length === 0 ||
        this.statsHistory[this.statsHistory.length - 1] !== finalStats) {
      this.statsHistory.push(finalStats);
    }

    return {
      grid: this.grid,
      history: this.history,
      statsHistory: this.statsHistory,
      finalStats,
      generationsCompleted: this.generation,
      stagnated,
    };
  }

  // -------------------------------------------------------------------------
  // Accessors
  // -------------------------------------------------------------------------

  /** Returns the current population statistics. */
  getStats(): PopulationStats {
    return this.grid.getStats(this.generation, this.totalEvaluations);
  }

  /** Returns the complete evolution history. */
  getHistory(): readonly EvolutionStep[] {
    return this.history;
  }
}
