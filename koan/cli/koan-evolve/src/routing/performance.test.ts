/**
 * Tests for model performance tracking.
 */

import { describe, it, expect } from 'vitest';
import {
  updatePerformanceMetrics,
  getPerformance,
  recordPerformance,
  type PerformanceState,
  type ModelPerformanceMetrics,
} from './performance.js';

describe('updatePerformanceMetrics', () => {
  it('initializes metrics for first run', () => {
    const result = updatePerformanceMetrics(undefined, true, 0.001, 1200);

    expect(result.runs).toBe(1);
    expect(result.successes).toBe(1);
    expect(result.failures).toBe(0);
    expect(result.success_rate).toBe(1.0);
    expect(result.avg_cost).toBe(0.001);
    expect(result.avg_duration_ms).toBe(1200);
    expect(result.last_20_runs).toEqual([true]);
  });

  it('updates metrics for subsequent runs', () => {
    const current: ModelPerformanceMetrics = {
      runs: 5,
      successes: 4,
      failures: 1,
      success_rate: 0.8,
      avg_cost: 0.002,
      avg_duration_ms: 1500,
      last_20_runs: [true, true, true, true, false],
    };

    const result = updatePerformanceMetrics(current, false, 0.003, 2000);

    expect(result.runs).toBe(6);
    expect(result.successes).toBe(4);
    expect(result.failures).toBe(2);
    expect(result.success_rate).toBeCloseTo(0.667, 2); // 4/6
    expect(result.last_20_runs).toHaveLength(6);
    expect(result.last_20_runs[5]).toBe(false);
  });

  it('maintains rolling window of last 20 runs', () => {
    const last20 = Array(20).fill(true);
    const current: ModelPerformanceMetrics = {
      runs: 20,
      successes: 20,
      failures: 0,
      success_rate: 1.0,
      avg_cost: 0.001,
      avg_duration_ms: 1000,
      last_20_runs: last20,
    };

    const result = updatePerformanceMetrics(current, false, 0.001, 1000);

    expect(result.last_20_runs).toHaveLength(20);
    expect(result.last_20_runs[0]).toBe(true); // Second element (first was shifted)
    expect(result.last_20_runs[19]).toBe(false); // New entry
  });

  it('calculates rolling success rate correctly', () => {
    // Start with [false, true*15, false*4] = 15 successes
    const last20 = [
      false, // This will be shifted out
      ...Array(15).fill(true),
      ...Array(4).fill(false),
    ];
    const current: ModelPerformanceMetrics = {
      runs: 20,
      successes: 15,
      failures: 5,
      success_rate: 0.75,
      avg_cost: 0.001,
      avg_duration_ms: 1000,
      last_20_runs: last20,
    };

    const result = updatePerformanceMetrics(current, true, 0.001, 1000);

    // After adding true and shifting false: [true*15, false*4, true] = 16 successes
    expect(result.success_rate).toBeCloseTo(0.8, 2);
  });
});

describe('getPerformance', () => {
  it('returns undefined when no data exists', () => {
    const state: PerformanceState = {
      concept_actions: [],
      metadata: { last_updated: '', checksum: '' },
    };

    const result = getPerformance(state, 'story', 'create', 'sonnet');
    expect(result).toBeUndefined();
  });

  it('returns performance metrics when data exists', () => {
    const state: PerformanceState = {
      concept_actions: [
        {
          concept: 'story',
          action: 'create',
          models: {
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

    const result = getPerformance(state, 'story', 'create', 'sonnet');
    expect(result).toBeDefined();
    expect(result?.runs).toBe(10);
    expect(result?.success_rate).toBe(0.9);
  });
});

describe('recordPerformance', () => {
  it('creates new concept-action entry if none exists', () => {
    const state: PerformanceState = {
      concept_actions: [],
      metadata: { last_updated: '', checksum: '' },
    };

    const result = recordPerformance(state, 'story', 'create', 'sonnet', true, 0.0003, 1200);

    expect(result.concept_actions).toHaveLength(1);
    expect(result.concept_actions[0].concept).toBe('story');
    expect(result.concept_actions[0].action).toBe('create');
    expect(result.concept_actions[0].models.sonnet).toBeDefined();
    expect(result.concept_actions[0].models.sonnet?.runs).toBe(1);
  });

  it('updates existing concept-action entry', () => {
    const state: PerformanceState = {
      concept_actions: [
        {
          concept: 'story',
          action: 'create',
          models: {
            sonnet: {
              runs: 5,
              successes: 4,
              failures: 1,
              success_rate: 0.8,
              avg_cost: 0.0003,
              avg_duration_ms: 1200,
              last_20_runs: [true, true, true, true, false],
            },
          },
        },
      ],
      metadata: { last_updated: '', checksum: '' },
    };

    const result = recordPerformance(state, 'story', 'create', 'sonnet', true, 0.0003, 1300);

    expect(result.concept_actions).toHaveLength(1);
    expect(result.concept_actions[0].models.sonnet?.runs).toBe(6);
    expect(result.concept_actions[0].models.sonnet?.successes).toBe(5);
  });

  it('handles multiple models for same concept-action', () => {
    const state: PerformanceState = {
      concept_actions: [
        {
          concept: 'story',
          action: 'create',
          models: {
            haiku: {
              runs: 3,
              successes: 2,
              failures: 1,
              success_rate: 0.667,
              avg_cost: 0.0001,
              avg_duration_ms: 800,
              last_20_runs: [true, true, false],
            },
          },
        },
      ],
      metadata: { last_updated: '', checksum: '' },
    };

    const result = recordPerformance(state, 'story', 'create', 'sonnet', true, 0.0003, 1200);

    expect(result.concept_actions[0].models.haiku).toBeDefined();
    expect(result.concept_actions[0].models.sonnet).toBeDefined();
    expect(result.concept_actions[0].models.sonnet?.runs).toBe(1);
  });
});
