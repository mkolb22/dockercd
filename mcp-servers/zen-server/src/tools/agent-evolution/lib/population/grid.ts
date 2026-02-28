/**
 * MAP-Elites grid: a 2D archive of elite genomes indexed by behavioral
 * dimensions (cost × quality).
 *
 * Each cell holds at most one elite — the genome with the highest fitness
 * that maps to that behavioral niche. This maintains quality-diversity:
 * the population explores the full cost/quality Pareto front rather than
 * converging to a single optimum.
 *
 * Key operations:
 * - quantize: map continuous behavioral values to discrete grid coordinates
 * - tryPlace: attempt to insert a genome, replacing the incumbent only if fitter
 * - selectRandom: uniform random selection from occupied cells
 * - getStats: population-level statistics
 *
 * Design constraints:
 * - All operations are O(1) except iteration (O(cells))
 * - Grid is dense-allocated as a flat array for cache locality
 * - No external dependencies
 */

import type { AgentGenome } from '../genome/schema.js';
import type { PortfolioResult } from '../benchmark/schema.js';
import type {
  AxisConfig,
  EliteEntry,
  GridConfig,
  GridCoordinate,
  PlacementOutcome,
  PopulationStats,
} from './types.js';
import { DEFAULT_GRID_CONFIG } from './types.js';

// ---------------------------------------------------------------------------
// Axis quantization
// ---------------------------------------------------------------------------

/**
 * Quantizes a continuous value to a bin index along an axis.
 *
 * Linear: uniform bin widths across [min, max].
 * Log: uniform bin widths in log-space (for values spanning orders of magnitude).
 *
 * Values outside [min, max] are clamped to the nearest bin.
 */
export function quantize(value: number, axis: AxisConfig): number {
  const { bins, min, max, scale } = axis;

  if (bins <= 0) return 0;
  if (value <= min) return 0;
  if (value >= max) return bins - 1;

  if (scale === 'log') {
    // Guard: log-scale requires positive min
    const safeMin = Math.max(min, 1e-10);
    const logMin = Math.log(safeMin);
    const logMax = Math.log(max);
    const logValue = Math.log(Math.max(value, safeMin));
    const ratio = (logValue - logMin) / (logMax - logMin);
    return Math.min(Math.floor(ratio * bins), bins - 1);
  }

  // Linear scale
  const ratio = (value - min) / (max - min);
  return Math.min(Math.floor(ratio * bins), bins - 1);
}

/**
 * Returns the center value of a bin for display/debugging.
 *
 * Useful for labeling grid cells with their behavioral niche.
 */
export function binCenter(binIndex: number, axis: AxisConfig): number {
  const { bins, min, max, scale } = axis;

  if (bins <= 0) return min;

  const clampedIndex = Math.max(0, Math.min(binIndex, bins - 1));
  const midpoint = (clampedIndex + 0.5) / bins;

  if (scale === 'log') {
    const safeMin = Math.max(min, 1e-10);
    const logMin = Math.log(safeMin);
    const logMax = Math.log(max);
    return Math.exp(logMin + midpoint * (logMax - logMin));
  }

  return min + midpoint * (max - min);
}

// ---------------------------------------------------------------------------
// Grid key encoding
// ---------------------------------------------------------------------------

/** Encodes grid coordinates to a flat array index. */
function coordToIndex(coord: GridCoordinate, qualityBins: number): number {
  return coord.x * qualityBins + coord.y;
}

// ---------------------------------------------------------------------------
// ElitesGrid
// ---------------------------------------------------------------------------

/**
 * 2D MAP-Elites archive.
 *
 * Stores one elite per cell in a cost × quality grid. Provides uniform
 * random selection from occupied cells for parent selection.
 *
 * Usage:
 * ```typescript
 * const grid = new ElitesGrid();
 * const coord = grid.coordinateFor(portfolio);
 * const outcome = grid.tryPlace(genome, portfolio, 'gen-1', 0, null);
 * const parent = grid.selectRandom(rng);
 * ```
 */
export class ElitesGrid {
  private readonly config: GridConfig;
  private readonly cells: (EliteEntry | null)[];
  private readonly occupiedIndices: Set<number>;

  constructor(config: GridConfig = DEFAULT_GRID_CONFIG) {
    this.config = config;
    const totalCells = config.costAxis.bins * config.qualityAxis.bins;
    this.cells = new Array<EliteEntry | null>(totalCells).fill(null);
    this.occupiedIndices = new Set();
  }

  /** Total number of cells in the grid. */
  get totalCells(): number {
    return this.config.costAxis.bins * this.config.qualityAxis.bins;
  }

  /** Number of currently occupied cells. */
  get occupiedCount(): number {
    return this.occupiedIndices.size;
  }

  /** Grid configuration (read-only). */
  get gridConfig(): GridConfig {
    return this.config;
  }

  // -------------------------------------------------------------------------
  // Coordinate mapping
  // -------------------------------------------------------------------------

  /**
   * Maps a portfolio result to grid coordinates.
   *
   * x-axis (cost): estimated cost per action from total usage
   * y-axis (quality): overall fitness score
   */
  coordinateFor(portfolio: PortfolioResult): GridCoordinate {
    const costPerAction = portfolio.taskCount > 0
      ? portfolio.totalUsage.estimatedCostUsd / portfolio.taskCount
      : 0;

    return {
      x: quantize(costPerAction, this.config.costAxis),
      y: quantize(portfolio.fitness, this.config.qualityAxis),
    };
  }

  // -------------------------------------------------------------------------
  // Elite placement
  // -------------------------------------------------------------------------

  /**
   * Attempts to place a genome in its behavioral niche.
   *
   * Rules:
   * - Empty cell → genome is placed (placed_new)
   * - Occupied, new genome strictly fitter → replaces incumbent (replaced_elite)
   * - Occupied, incumbent fitter or equal → genome discarded (rejected)
   *
   * @returns The placement outcome
   */
  tryPlace(
    genome: AgentGenome,
    portfolio: PortfolioResult,
    genomeId: string,
    generation: number,
    parentId: string | null,
  ): PlacementOutcome {
    const coord = this.coordinateFor(portfolio);
    const index = coordToIndex(coord, this.config.qualityAxis.bins);

    const incumbent = this.cells[index];

    if (incumbent === null) {
      this.cells[index] = {
        genome,
        portfolio,
        coordinate: coord,
        genomeId,
        generation,
        parentId,
        placedAt: new Date().toISOString(),
      };
      this.occupiedIndices.add(index);
      return 'placed_new';
    }

    if (portfolio.fitness > incumbent.portfolio.fitness) {
      this.cells[index] = {
        genome,
        portfolio,
        coordinate: coord,
        genomeId,
        generation,
        parentId,
        placedAt: new Date().toISOString(),
      };
      return 'replaced_elite';
    }

    return 'rejected';
  }

  // -------------------------------------------------------------------------
  // Selection
  // -------------------------------------------------------------------------

  /**
   * Uniform random selection from occupied cells.
   *
   * @param rng - Random number generator returning [0, 1). Uses Math.random if null.
   * @returns The selected elite, or null if grid is empty.
   */
  selectRandom(rng: (() => number) | null = null): EliteEntry | null {
    if (this.occupiedIndices.size === 0) return null;

    const indices = Array.from(this.occupiedIndices);
    const r = rng ? rng() : Math.random();
    const selected = indices[Math.floor(r * indices.length)];
    return this.cells[selected];
  }

  // -------------------------------------------------------------------------
  // Accessors
  // -------------------------------------------------------------------------

  /** Gets the elite at specific grid coordinates, or null if empty. */
  getAt(coord: GridCoordinate): EliteEntry | null {
    const index = coordToIndex(coord, this.config.qualityAxis.bins);
    if (index < 0 || index >= this.cells.length) return null;
    return this.cells[index];
  }

  /** Returns all occupied elites in the grid. */
  allElites(): readonly EliteEntry[] {
    const result: EliteEntry[] = [];
    for (const index of this.occupiedIndices) {
      const entry = this.cells[index];
      if (entry) result.push(entry);
    }
    return result;
  }

  /** Returns the elite with the highest fitness across all cells. */
  bestElite(): EliteEntry | null {
    let best: EliteEntry | null = null;
    for (const index of this.occupiedIndices) {
      const entry = this.cells[index];
      if (entry && (best === null || entry.portfolio.fitness > best.portfolio.fitness)) {
        best = entry;
      }
    }
    return best;
  }

  // -------------------------------------------------------------------------
  // Statistics
  // -------------------------------------------------------------------------

  /** Computes population-level statistics. */
  getStats(generation: number, totalEvaluations: number): PopulationStats {
    const elites = this.allElites();
    const fitnesses = elites.map(e => e.portfolio.fitness);

    if (fitnesses.length === 0) {
      return {
        occupiedCells: 0,
        totalCells: this.totalCells,
        coverage: 0,
        meanFitness: 0,
        maxFitness: 0,
        minFitness: 0,
        stddevFitness: 0,
        generation,
        totalEvaluations,
      };
    }

    let sum = 0;
    let max = -Infinity;
    let min = Infinity;
    for (const f of fitnesses) {
      sum += f;
      if (f > max) max = f;
      if (f < min) min = f;
    }
    const mean = sum / fitnesses.length;

    let sumSq = 0;
    for (const f of fitnesses) {
      sumSq += (f - mean) ** 2;
    }
    const variance = fitnesses.length > 1 ? sumSq / (fitnesses.length - 1) : 0;

    return {
      occupiedCells: fitnesses.length,
      totalCells: this.totalCells,
      coverage: fitnesses.length / this.totalCells,
      meanFitness: mean,
      maxFitness: max,
      minFitness: min,
      stddevFitness: Math.sqrt(variance),
      generation,
      totalEvaluations,
    };
  }

  // -------------------------------------------------------------------------
  // Visualization / debugging
  // -------------------------------------------------------------------------

  /**
   * Returns a 2D fitness heatmap for visualization.
   *
   * Rows are quality bins (high to low), columns are cost bins (low to high).
   * Empty cells are null. Populated cells contain the elite's fitness.
   */
  fitnessHeatmap(): (number | null)[][] {
    const rows: (number | null)[][] = [];
    const { costAxis, qualityAxis } = this.config;

    // Iterate quality from high to low (top row = highest quality)
    for (let y = qualityAxis.bins - 1; y >= 0; y--) {
      const row: (number | null)[] = [];
      for (let x = 0; x < costAxis.bins; x++) {
        const entry = this.getAt({ x, y });
        row.push(entry ? entry.portfolio.fitness : null);
      }
      rows.push(row);
    }

    return rows;
  }
}
