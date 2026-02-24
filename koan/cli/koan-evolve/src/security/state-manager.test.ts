/**
 * Tests for SEC-002: State validation (Zod schemas).
 */

import { describe, it, expect } from 'vitest';
import { validateFitnessState } from './state-manager.js';
import type { FitnessState } from '../types.js';

describe('validateFitnessState', () => {
  it('accepts valid fitness state', () => {
    const state: FitnessState = {
      concept: 'story',
      current_variant: 'variant-00',
      variants: [
        {
          variant_id: 'variant-00',
          runs: 10,
          fitness: {
            current: 0.85,
            rolling_avg_10: 0.83,
            trend: 'improving',
          },
          metrics: {
            test_pass_rate: 0.9,
            quality_score: 0.8,
            user_acceptance: 0.85,
          },
          history: [],
        },
      ],
      promotion_threshold: 0.1,
      minimum_runs: 10,
      metadata: {
        last_updated: '2026-01-30T20:00:00Z',
        checksum: 'sha256:abc123',
      },
    };

    const result = validateFitnessState(state);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects state with invalid fitness values', () => {
    const state = {
      concept: 'story',
      current_variant: 'variant-00',
      variants: [
        {
          variant_id: 'variant-00',
          runs: 10,
          fitness: {
            current: 1.5, // Invalid: > 1.0
            rolling_avg_10: 0.83,
            trend: 'improving',
          },
          metrics: {
            test_pass_rate: 0.9,
            quality_score: 0.8,
            user_acceptance: 0.85,
          },
          history: [],
        },
      ],
      promotion_threshold: 0.1,
      minimum_runs: 10,
      metadata: {
        last_updated: '2026-01-30T20:00:00Z',
        checksum: 'sha256:abc123',
      },
    };

    const result = validateFitnessState(state);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects state with invalid trend', () => {
    const state = {
      concept: 'story',
      current_variant: 'variant-00',
      variants: [
        {
          variant_id: 'variant-00',
          runs: 10,
          fitness: {
            current: 0.85,
            rolling_avg_10: 0.83,
            trend: 'invalid-trend', // Invalid enum value
          },
          metrics: {
            test_pass_rate: 0.9,
            quality_score: 0.8,
            user_acceptance: 0.85,
          },
          history: [],
        },
      ],
      promotion_threshold: 0.1,
      minimum_runs: 10,
      metadata: {
        last_updated: '2026-01-30T20:00:00Z',
        checksum: 'sha256:abc123',
      },
    };

    const result = validateFitnessState(state);

    expect(result.valid).toBe(false);
  });

  it('rejects state with missing required fields', () => {
    const state = {
      concept: 'story',
      // Missing current_variant
      variants: [],
      promotion_threshold: 0.1,
      minimum_runs: 10,
      metadata: {
        last_updated: '2026-01-30T20:00:00Z',
        checksum: 'sha256:abc123',
      },
    };

    const result = validateFitnessState(state);

    expect(result.valid).toBe(false);
  });
});
