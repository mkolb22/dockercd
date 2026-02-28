/**
 * Types for the MAP-Elites population manager.
 *
 * MAP-Elites maintains a grid of elite solutions indexed by behavioral
 * dimensions. Each cell holds the single best genome for that behavioral
 * niche. This provides quality-diversity: the population explores the
 * full cost/quality trade-off space rather than converging to a single
 * optimum.
 *
 * Design references:
 * - Mouret & Clune (2015): Illuminating search spaces by mapping elites
 * - AGENT-EVOLUTION-RESEARCH.md Phase 1, Step 5
 *
 * Grid axes (configurable, 2D to start):
 *   x-axis: cost (estimated USD per action) — log-scale bins
 *   y-axis: quality (overall fitness score 0–1) — linear bins
 */

import type { AgentGenome } from '../genome/schema.js';
import type { PortfolioResult } from '../benchmark/schema.js';
import type { MutationResult } from '../mutation/types.js';

// ---------------------------------------------------------------------------
// Grid coordinate types
// ---------------------------------------------------------------------------

/**
 * Behavioral dimension identifiers for grid axes.
 * 'cost' uses log-scale binning; 'quality' uses linear binning.
 */
export type BehavioralDimension = 'cost' | 'quality';

/** Integer grid coordinates. Both values are zero-indexed bin indices. */
export interface GridCoordinate {
  readonly x: number; // cost bin
  readonly y: number; // quality bin
}

// ---------------------------------------------------------------------------
// Elite entry
// ---------------------------------------------------------------------------

/**
 * A single elite occupying one grid cell.
 *
 * Immutable: once placed, the entry is only replaced by a strictly
 * fitter genome at the same coordinates.
 */
export interface EliteEntry {
  /** The genome variant occupying this cell. */
  readonly genome: AgentGenome;

  /** Full portfolio evaluation result (fitness, dimension scores, usage). */
  readonly portfolio: PortfolioResult;

  /** Grid cell this elite occupies. */
  readonly coordinate: GridCoordinate;

  /** Unique identifier for this genome variant. */
  readonly genomeId: string;

  /** Generation number when this elite was placed. */
  readonly generation: number;

  /** Mutation lineage: what produced this genome. */
  readonly parentId: string | null;

  /** ISO 8601 timestamp when this elite was placed. */
  readonly placedAt: string;
}

// ---------------------------------------------------------------------------
// Grid configuration
// ---------------------------------------------------------------------------

/** Axis range and binning configuration for one behavioral dimension. */
export interface AxisConfig {
  /** Number of bins along this axis. */
  readonly bins: number;

  /** Minimum value (inclusive). Values below are clamped to bin 0. */
  readonly min: number;

  /** Maximum value (inclusive). Values above are clamped to last bin. */
  readonly max: number;

  /**
   * Binning scale.
   * - 'linear': uniform bin widths
   * - 'log': logarithmic bin widths (for cost, which spans orders of magnitude)
   */
  readonly scale: 'linear' | 'log';
}

/**
 * Configuration for the MAP-Elites grid.
 *
 * Default: 10×10 grid with cost ($0.0005–$0.10 log-scale) × quality (0–1 linear).
 */
export interface GridConfig {
  /** X-axis (cost) configuration. */
  readonly costAxis: AxisConfig;

  /** Y-axis (quality) configuration. */
  readonly qualityAxis: AxisConfig;
}

// ---------------------------------------------------------------------------
// Population statistics
// ---------------------------------------------------------------------------

/** Summary statistics for the current population state. */
export interface PopulationStats {
  /** Total number of occupied cells. */
  readonly occupiedCells: number;

  /** Total possible cells (costBins × qualityBins). */
  readonly totalCells: number;

  /** Coverage ratio (occupied / total). */
  readonly coverage: number;

  /** Mean fitness across all elites. */
  readonly meanFitness: number;

  /** Maximum fitness across all elites. */
  readonly maxFitness: number;

  /** Minimum fitness across all elites. */
  readonly minFitness: number;

  /** Standard deviation of fitness across all elites. */
  readonly stddevFitness: number;

  /** Current generation number. */
  readonly generation: number;

  /** Total evaluations performed since initialization. */
  readonly totalEvaluations: number;
}

// ---------------------------------------------------------------------------
// Evolution event types
// ---------------------------------------------------------------------------

/** Outcome of attempting to place a genome into the grid. */
export type PlacementOutcome =
  | 'placed_new'      // Cell was empty — genome placed
  | 'replaced_elite'  // Cell occupied — new genome is fitter, replaces incumbent
  | 'rejected';       // Cell occupied — incumbent is fitter, genome discarded

/** Record of one evolution step (select → mutate → evaluate → place). */
export interface EvolutionStep {
  /** Generation number. */
  readonly generation: number;

  /** Parent genome that was selected and mutated. */
  readonly parentId: string;

  /** Resulting child genome. */
  readonly childId: string;

  /** Mutation that produced the child. */
  readonly mutation: MutationResult;

  /** Child's portfolio evaluation result. */
  readonly portfolio: PortfolioResult;

  /** Grid coordinate the child maps to. */
  readonly coordinate: GridCoordinate;

  /** What happened when the child was placed. */
  readonly outcome: PlacementOutcome;
}

// ---------------------------------------------------------------------------
// Manager configuration
// ---------------------------------------------------------------------------

/** Configuration for the population manager's evolution loop. */
export interface ManagerConfig {
  /** Grid configuration. Uses defaults if not specified. */
  readonly grid?: GridConfig;

  /** Maximum number of generations per evolution run. */
  readonly maxGenerations: number;

  /** Stop early if no grid improvements in this many consecutive generations. */
  readonly stagnationLimit: number;

  /** Probability of applying ELM (LLM-based) mutation vs. deterministic. */
  readonly elmProbability: number;

  /** Random seed for reproducibility (null = non-deterministic). */
  readonly seed: number | null;
}

// ---------------------------------------------------------------------------
// Default configurations
// ---------------------------------------------------------------------------

/** Default cost axis: $0.0005 to $0.10, log-scale, 10 bins. */
export const DEFAULT_COST_AXIS: AxisConfig = {
  bins: 10,
  min: 0.0005,
  max: 0.10,
  scale: 'log',
};

/** Default quality axis: 0.0 to 1.0, linear, 10 bins. */
export const DEFAULT_QUALITY_AXIS: AxisConfig = {
  bins: 10,
  min: 0.0,
  max: 1.0,
  scale: 'linear',
};

/** Default grid configuration: 10×10 cost × quality. */
export const DEFAULT_GRID_CONFIG: GridConfig = {
  costAxis: DEFAULT_COST_AXIS,
  qualityAxis: DEFAULT_QUALITY_AXIS,
};

/** Default manager configuration. */
export const DEFAULT_MANAGER_CONFIG: ManagerConfig = {
  maxGenerations: 100,
  stagnationLimit: 20,
  elmProbability: 0.5,
  seed: null,
};
