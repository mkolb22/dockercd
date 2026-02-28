/**
 * Density-Difficulty Mapping
 *
 * Maps task complexity to optimal topological density using the
 * AgentConductor principle: simple tasks need sparse topologies
 * (low overhead), complex tasks need dense topologies (thorough review).
 *
 * The mapping is bidirectional:
 * - Forward: given task complexity → target density range
 * - Inverse: given topology density → inferred complexity match
 *
 * Used by:
 * 1. Topology selection: pick the best topology for a given task
 * 2. MAP-Elites placement: density as a behavioral dimension
 * 3. Evolution guidance: bias mutations toward target density
 */

import type {
  TaskComplexity,
  DensityMappingConfig,
  DensityMetrics,
  WorkflowDAG,
} from './types.js';
import { DEFAULT_DENSITY_MAPPING_CONFIG, DEFAULT_DENSITY_TARGETS } from './types.js';
import { computeDensity } from './dag.js';

// ---------------------------------------------------------------------------
// Complexity levels (ordered)
// ---------------------------------------------------------------------------

const COMPLEXITY_ORDER: readonly TaskComplexity[] = [
  'trivial',
  'simple',
  'medium',
  'complex',
  'expert',
];

const COMPLEXITY_INDEX = new Map<TaskComplexity, number>(
  COMPLEXITY_ORDER.map((c, i) => [c, i]),
);

// ---------------------------------------------------------------------------
// Forward mapping: complexity → density
// ---------------------------------------------------------------------------

/**
 * Returns the target density range [min, max] for a given task complexity.
 *
 * The range is centered on the target density with ± tolerance.
 * Both bounds are clamped to [0, 1].
 */
export function targetDensityRange(
  complexity: TaskComplexity,
  config: DensityMappingConfig = DEFAULT_DENSITY_MAPPING_CONFIG,
): { min: number; max: number; target: number } {
  const target = config.targets[complexity];
  return {
    min: Math.max(0, target - config.tolerance),
    max: Math.min(1, target + config.tolerance),
    target,
  };
}

/**
 * Returns whether a topology's density falls within the acceptable
 * range for a given task complexity.
 */
export function isDensityMatch(
  density: number,
  complexity: TaskComplexity,
  config: DensityMappingConfig = DEFAULT_DENSITY_MAPPING_CONFIG,
): boolean {
  const range = targetDensityRange(complexity, config);
  return density >= range.min && density <= range.max;
}

// ---------------------------------------------------------------------------
// Inverse mapping: density → complexity
// ---------------------------------------------------------------------------

/**
 * Infers the best-matching task complexity for a given topology density.
 *
 * Returns the complexity level whose target is closest to the
 * observed density. Ties are broken by preferring simpler levels.
 */
export function inferComplexity(
  density: number,
  config: DensityMappingConfig = DEFAULT_DENSITY_MAPPING_CONFIG,
): TaskComplexity {
  let bestLevel: TaskComplexity = 'medium';
  let bestDist = Infinity;

  for (const level of COMPLEXITY_ORDER) {
    const target = config.targets[level];
    const dist = Math.abs(density - target);
    if (dist < bestDist) {
      bestDist = dist;
      bestLevel = level;
    }
  }

  return bestLevel;
}

// ---------------------------------------------------------------------------
// Scoring: how well does a topology match a task?
// ---------------------------------------------------------------------------

/**
 * Computes a match score (0-1) between a topology's density and a task complexity.
 *
 * Score of 1.0 means the density exactly matches the target.
 * Score drops linearly outside the tolerance band.
 * Score of 0.0 means density is very far from target.
 */
export function densityMatchScore(
  density: number,
  complexity: TaskComplexity,
  config: DensityMappingConfig = DEFAULT_DENSITY_MAPPING_CONFIG,
): number {
  const target = config.targets[complexity];
  const dist = Math.abs(density - target);

  if (dist <= config.tolerance) {
    // Within tolerance: linear from 1.0 (exact match) to 0.5 (edge of tolerance)
    return 1.0 - 0.5 * (dist / config.tolerance);
  }

  // Outside tolerance: linear decay from 0.5 to 0
  const maxDist = 1.0; // Maximum possible density distance
  const remaining = maxDist - config.tolerance;
  const excessDist = dist - config.tolerance;
  return Math.max(0, 0.5 * (1 - excessDist / remaining));
}

/**
 * Scores a DAG's fitness for a given task complexity.
 *
 * Combines density match with structural quality heuristics:
 * - Density alignment with target (primary)
 * - Review ratio appropriateness (higher complexity = more review)
 * - Fan-out appropriateness (parallel paths for complex tasks)
 */
export function scoreDagForComplexity(
  dag: WorkflowDAG,
  complexity: TaskComplexity,
  config: DensityMappingConfig = DEFAULT_DENSITY_MAPPING_CONFIG,
): { score: number; densityMatch: number; structuralScore: number; metrics: DensityMetrics } {
  const metrics = computeDensity(dag);
  const densityMatch = densityMatchScore(metrics.compositeDensity, complexity, config);

  // Structural heuristics (secondary scoring)
  const complexityIdx = COMPLEXITY_INDEX.get(complexity) ?? 2;
  const normalizedComplexity = complexityIdx / (COMPLEXITY_ORDER.length - 1); // 0-1

  // Review appropriateness: complex tasks should have more review
  const expectedReview = normalizedComplexity * 0.5; // 0 for trivial, 0.5 for expert
  const reviewDiff = Math.abs(metrics.reviewRatio - expectedReview);
  const reviewScore = Math.max(0, 1 - reviewDiff * 2);

  // Fan-out appropriateness: complex tasks benefit from parallelism
  const expectedFanOut = 1 + normalizedComplexity * 3; // 1 for trivial, 4 for expert
  const fanOutDiff = Math.abs(metrics.maxFanOut - expectedFanOut);
  const fanOutScore = Math.max(0, 1 - fanOutDiff / 3);

  const structuralScore = 0.6 * reviewScore + 0.4 * fanOutScore;

  // Combined: density is primary (70%), structural is secondary (30%)
  const score = 0.7 * densityMatch + 0.3 * structuralScore;

  return { score, densityMatch, structuralScore, metrics };
}

// ---------------------------------------------------------------------------
// Topology selection
// ---------------------------------------------------------------------------

/**
 * Selects the best topology from a pool for a given task complexity.
 *
 * Scores each candidate and returns the highest-scoring one.
 * Returns null if the pool is empty.
 */
export function selectTopology(
  candidates: readonly WorkflowDAG[],
  complexity: TaskComplexity,
  config: DensityMappingConfig = DEFAULT_DENSITY_MAPPING_CONFIG,
): { dag: WorkflowDAG; score: number } | null {
  if (candidates.length === 0) return null;

  let bestDag = candidates[0];
  let bestScore = -1;

  for (const dag of candidates) {
    const { score } = scoreDagForComplexity(dag, complexity, config);
    if (score > bestScore) {
      bestScore = score;
      bestDag = dag;
    }
  }

  return { dag: bestDag, score: bestScore };
}

/**
 * Classifies a task's complexity from numeric features.
 *
 * Features used:
 * - criteriaCount: number of evaluation criteria
 * - expectedElements: number of expected output elements
 * - contextFiles: number of context files provided
 * - difficulty: string difficulty level
 *
 * Returns a TaskComplexity classification.
 */
export function classifyTaskComplexity(features: {
  criteriaCount: number;
  expectedElements: number;
  contextFiles: number;
  difficulty: string;
}): TaskComplexity {
  const { criteriaCount, expectedElements, contextFiles, difficulty } = features;

  // Direct mapping from difficulty string
  if (difficulty === 'trivial') return 'trivial';
  if (difficulty === 'expert') return 'expert';

  // Feature-based scoring
  let score = 0;
  score += Math.min(1, criteriaCount / 6); // 6+ criteria = max
  score += Math.min(1, expectedElements / 8); // 8+ elements = max
  score += Math.min(1, contextFiles / 4); // 4+ files = max

  // Map from difficulty hint
  if (difficulty === 'simple') score += 0.3;
  else if (difficulty === 'moderate') score += 0.6;
  else if (difficulty === 'complex') score += 0.9;

  // Normalize to [0, 4]
  const normalized = score / 3.9;

  if (normalized < 0.15) return 'trivial';
  if (normalized < 0.35) return 'simple';
  if (normalized < 0.6) return 'medium';
  if (normalized < 0.8) return 'complex';
  return 'expert';
}
