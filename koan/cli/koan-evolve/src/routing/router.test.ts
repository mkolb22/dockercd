/**
 * Tests for epsilon-greedy model router.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { selectModel, getRecommendations, type RoutingConfig } from './router.js';
import type { PerformanceState } from './performance.js';

describe('selectModel', () => {
  beforeEach(() => {
    // Mock Math.random for deterministic tests
    vi.spyOn(Math, 'random');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exploits best model when random > epsilon', () => {
    vi.mocked(Math.random).mockReturnValue(0.95); // > 0.05, should exploit

    const state: PerformanceState = {
      concept_actions: [
        {
          concept: 'story',
          action: 'create',
          models: {
            haiku: {
              runs: 20,
              successes: 18,
              failures: 2,
              success_rate: 0.9,
              avg_cost: 0.0001,
              avg_duration_ms: 800,
              last_20_runs: Array(20).fill(true),
            },
            sonnet: {
              runs: 10,
              successes: 9,
              failures: 1,
              success_rate: 0.9,
              avg_cost: 0.0003,
              avg_duration_ms: 1200,
              last_20_runs: Array(10).fill(true),
            },
          },
        },
      ],
      metadata: { last_updated: '', checksum: '' },
    };

    const result = selectModel(state, 'story', 'create');

    expect(result.reason).toBe('exploit');
    expect(result.model).toBe('haiku'); // Cheaper model with good success rate
  });

  it('explores random model when random < epsilon', () => {
    vi.mocked(Math.random).mockReturnValue(0.02); // < 0.05, should explore

    const state: PerformanceState = {
      concept_actions: [],
      metadata: { last_updated: '', checksum: '' },
    };

    const result = selectModel(state, 'story', 'create');

    expect(result.reason).toBe('explore');
    expect(['haiku', 'sonnet', 'opus']).toContain(result.model);
  });

  it('respects minimum tier constraints', () => {
    vi.mocked(Math.random).mockReturnValue(0.95); // Exploit

    const state: PerformanceState = {
      concept_actions: [
        {
          concept: 'architecture',
          action: 'design',
          models: {
            opus: {
              runs: 10,
              successes: 9,
              failures: 1,
              success_rate: 0.9,
              avg_cost: 0.015,
              avg_duration_ms: 3500,
              last_20_runs: Array(10).fill(true),
            },
          },
        },
      ],
      metadata: { last_updated: '', checksum: '' },
    };

    const result = selectModel(state, 'architecture', 'design');

    // Architecture.design requires opus minimum
    expect(result.model).toBe('opus');
  });

  it('falls back to most expensive model when no performance data', () => {
    vi.mocked(Math.random).mockReturnValue(0.95); // Exploit

    const state: PerformanceState = {
      concept_actions: [],
      metadata: { last_updated: '', checksum: '' },
    };

    const result = selectModel(state, 'implementation', 'code');

    expect(result.reason).toBe('fallback');
    expect(result.model).toBe('opus'); // Most expensive eligible (minimum is sonnet)
  });

  it('selects best model from multiple candidates', () => {
    vi.mocked(Math.random).mockReturnValue(0.95); // Exploit

    const state: PerformanceState = {
      concept_actions: [
        {
          concept: 'story',
          action: 'create',
          models: {
            haiku: {
              runs: 20,
              successes: 16,
              failures: 4,
              success_rate: 0.8, // Below 0.9 threshold
              avg_cost: 0.0001,
              avg_duration_ms: 800,
              last_20_runs: Array(20).fill(true),
            },
            sonnet: {
              runs: 15,
              successes: 14,
              failures: 1,
              success_rate: 0.933, // Above 0.9 threshold
              avg_cost: 0.0003,
              avg_duration_ms: 1200,
              last_20_runs: Array(15).fill(true),
            },
          },
        },
      ],
      metadata: { last_updated: '', checksum: '' },
    };

    const result = selectModel(state, 'story', 'create');

    expect(result.reason).toBe('exploit');
    expect(result.model).toBe('sonnet'); // Only sonnet meets threshold
  });

  it('requires minimum runs before using model', () => {
    vi.mocked(Math.random).mockReturnValue(0.95); // Exploit

    const state: PerformanceState = {
      concept_actions: [
        {
          concept: 'story',
          action: 'create',
          models: {
            haiku: {
              runs: 2, // Below 5 runs minimum
              successes: 2,
              failures: 0,
              success_rate: 1.0,
              avg_cost: 0.0001,
              avg_duration_ms: 800,
              last_20_runs: [true, true],
            },
          },
        },
      ],
      metadata: { last_updated: '', checksum: '' },
    };

    const result = selectModel(state, 'story', 'create');

    expect(result.reason).toBe('fallback'); // Not enough data
  });
});

describe('getRecommendations', () => {
  it('recommends downgrade when cheaper model has high success rate', () => {
    const state: PerformanceState = {
      concept_actions: [
        {
          concept: 'story',
          action: 'create',
          models: {
            haiku: {
              runs: 15,
              successes: 14,
              failures: 1,
              success_rate: 0.933,
              avg_cost: 0.0001,
              avg_duration_ms: 800,
              last_20_runs: Array(15).fill(true),
            },
            sonnet: {
              runs: 20,
              successes: 18,
              failures: 2,
              success_rate: 0.9,
              avg_cost: 0.0003,
              avg_duration_ms: 1200,
              last_20_runs: Array(20).fill(true),
            },
          },
        },
      ],
      metadata: { last_updated: '', checksum: '' },
    };

    const recommendations = getRecommendations(state);

    expect(recommendations).toHaveLength(1);
    expect(recommendations[0].current_model).toBe('sonnet');
    expect(recommendations[0].recommended_model).toBe('haiku');
    expect(recommendations[0].potential_savings_per_run).toBeCloseTo(0.0002, 4);
  });

  it('does not recommend downgrade below minimum tier', () => {
    const state: PerformanceState = {
      concept_actions: [
        {
          concept: 'architecture',
          action: 'design',
          models: {
            sonnet: {
              runs: 15,
              successes: 14,
              failures: 1,
              success_rate: 0.933,
              avg_cost: 0.0003,
              avg_duration_ms: 1200,
              last_20_runs: Array(15).fill(true),
            },
            opus: {
              runs: 20,
              successes: 18,
              failures: 2,
              success_rate: 0.9,
              avg_cost: 0.015,
              avg_duration_ms: 3500,
              last_20_runs: Array(20).fill(true),
            },
          },
        },
      ],
      metadata: { last_updated: '', checksum: '' },
    };

    const recommendations = getRecommendations(state);

    // Should not recommend sonnet for architecture (requires opus)
    expect(recommendations).toHaveLength(0);
  });

  it('requires minimum runs before recommending', () => {
    const state: PerformanceState = {
      concept_actions: [
        {
          concept: 'story',
          action: 'create',
          models: {
            haiku: {
              runs: 5, // Below 10 runs minimum for recommendations
              successes: 5,
              failures: 0,
              success_rate: 1.0,
              avg_cost: 0.0001,
              avg_duration_ms: 800,
              last_20_runs: Array(5).fill(true),
            },
            sonnet: {
              runs: 20,
              successes: 18,
              failures: 2,
              success_rate: 0.9,
              avg_cost: 0.0003,
              avg_duration_ms: 1200,
              last_20_runs: Array(20).fill(true),
            },
          },
        },
      ],
      metadata: { last_updated: '', checksum: '' },
    };

    const recommendations = getRecommendations(state);

    expect(recommendations).toHaveLength(0);
  });

  it('sorts recommendations by potential savings', () => {
    const state: PerformanceState = {
      concept_actions: [
        {
          concept: 'story',
          action: 'create',
          models: {
            haiku: {
              runs: 15,
              successes: 14,
              failures: 1,
              success_rate: 0.933,
              avg_cost: 0.0001,
              avg_duration_ms: 800,
              last_20_runs: Array(15).fill(true),
            },
            sonnet: {
              runs: 20,
              successes: 18,
              failures: 2,
              success_rate: 0.9,
              avg_cost: 0.0003,
              avg_duration_ms: 1200,
              last_20_runs: Array(20).fill(true),
            },
          },
        },
        {
          concept: 'implementation',
          action: 'code',
          models: {
            sonnet: {
              runs: 15,
              successes: 14,
              failures: 1,
              success_rate: 0.933,
              avg_cost: 0.0003,
              avg_duration_ms: 1200,
              last_20_runs: Array(15).fill(true),
            },
            opus: {
              runs: 20,
              successes: 18,
              failures: 2,
              success_rate: 0.9,
              avg_cost: 0.015,
              avg_duration_ms: 3500,
              last_20_runs: Array(20).fill(true),
            },
          },
        },
      ],
      metadata: { last_updated: '', checksum: '' },
    };

    const recommendations = getRecommendations(state);

    expect(recommendations).toHaveLength(2);
    // opus → sonnet saves more than sonnet → haiku
    expect(recommendations[0].current_model).toBe('opus');
    expect(recommendations[1].current_model).toBe('sonnet');
  });
});
