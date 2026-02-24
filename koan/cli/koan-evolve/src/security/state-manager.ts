/**
 * SEC-002: State validation with Zod schemas.
 * Checksum/integrity logic removed — SQLite ACID replaces it.
 */

import { z } from 'zod';
import type { FitnessState, ValidationResult } from '../types.js';

// Zod schema for FitnessState validation
const FitnessMetricsSchema = z.object({
  test_pass_rate: z.number().min(0).max(1),
  quality_score: z.number().min(0).max(1),
  user_acceptance: z.number().min(0).max(1),
});

const FitnessHistoryEntrySchema = z.object({
  timestamp: z.string(),
  fitness: z.number().min(0).max(1),
  run_count: z.number().int().nonnegative(),
});

const FitnessScoreSchema = z.object({
  variant_id: z.string(),
  runs: z.number().int().nonnegative(),
  fitness: z.object({
    current: z.number().min(0).max(1),
    rolling_avg_10: z.number().min(0).max(1),
    trend: z.enum(['improving', 'stable', 'degrading']),
  }),
  metrics: FitnessMetricsSchema,
  history: z.array(FitnessHistoryEntrySchema),
});

const FitnessStateSchema = z.object({
  concept: z.string(),
  current_variant: z.string(),
  variants: z.array(FitnessScoreSchema),
  promotion_threshold: z.number().min(0).max(1),
  minimum_runs: z.number().int().positive(),
  metadata: z.object({
    last_updated: z.string(),
    checksum: z.string(),
  }),
});

/**
 * Validate fitness state against schema.
 */
export function validateFitnessState(state: unknown): ValidationResult {
  try {
    FitnessStateSchema.parse(state);
    return { valid: true, errors: [] };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        valid: false,
        errors: error.errors.map(e => `${e.path.join('.')}: ${e.message}`),
      };
    }
    return {
      valid: false,
      errors: ['Unknown validation error'],
    };
  }
}
