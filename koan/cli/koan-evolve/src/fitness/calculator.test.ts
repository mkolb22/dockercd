/**
 * Tests for fitness calculation.
 */

import { describe, it, expect } from 'vitest';
import { computeFitness, rankVariants } from './calculator.js';
import type { ProvenanceAction } from '@zen/koan-core';

describe('computeFitness', () => {
  it('calculates fitness from completed actions', () => {
    const actions: ProvenanceAction[] = [
      createAction('completed', 1),
      createAction('completed', 2),
      createAction('completed', 3),
      createAction('completed', 4),
      createAction('completed', 5),
    ];

    const result = computeFitness('variant-00', actions);

    expect(result.variant_id).toBe('variant-00');
    expect(result.runs).toBe(5);
    expect(result.fitness.current).toBeGreaterThan(0.9); // All completed = high fitness
    expect(result.metrics.test_pass_rate).toBe(1.0);
  });

  it('penalizes failed actions', () => {
    const actions: ProvenanceAction[] = [
      createAction('completed', 1),
      createAction('failed', 2),
      createAction('completed', 3),
      createAction('failed', 4),
      createAction('completed', 5),
    ];

    const result = computeFitness('variant-00', actions);

    expect(result.metrics.test_pass_rate).toBe(0.6); // 3/5 completed
    expect(result.fitness.current).toBeLessThan(0.8);
  });

  it('uses quality scores when available', () => {
    const actions: ProvenanceAction[] = [
      createAction('completed', 1, 0.9),
      createAction('completed', 2, 0.8),
      createAction('completed', 3, 0.95),
    ];

    const result = computeFitness('variant-00', actions);

    expect(result.metrics.quality_score).toBeCloseTo(0.883, 2); // (0.9 + 0.8 + 0.95) / 3
  });

  it('calculates rolling average correctly', () => {
    const actions: ProvenanceAction[] = [];

    // First 10 actions with lower success rate
    for (let i = 0; i < 10; i++) {
      actions.push(createAction(i % 3 === 0 ? 'failed' : 'completed', i));
    }

    // Next 5 actions with higher success rate (all completed)
    for (let i = 10; i < 15; i++) {
      actions.push(createAction('completed', i));
    }

    const result = computeFitness('variant-00', actions);

    // Rolling average should be higher than overall (uses last 10)
    expect(result.fitness.rolling_avg_10).toBeGreaterThan(result.fitness.current);
  });

  it('detects improving trend', () => {
    const actions: ProvenanceAction[] = [];

    // First half: 50% success
    for (let i = 0; i < 10; i++) {
      actions.push(createAction(i % 2 === 0 ? 'completed' : 'failed', i));
    }

    // Second half: 90% success
    for (let i = 10; i < 20; i++) {
      actions.push(createAction(i % 10 === 0 ? 'failed' : 'completed', i));
    }

    const result = computeFitness('variant-00', actions);

    expect(result.fitness.trend).toBe('improving');
  });

  it('detects degrading trend', () => {
    const actions: ProvenanceAction[] = [];

    // First half: 90% success
    for (let i = 0; i < 10; i++) {
      actions.push(createAction(i % 10 === 0 ? 'failed' : 'completed', i));
    }

    // Second half: 50% success
    for (let i = 10; i < 20; i++) {
      actions.push(createAction(i % 2 === 0 ? 'completed' : 'failed', i));
    }

    const result = computeFitness('variant-00', actions);

    expect(result.fitness.trend).toBe('degrading');
  });

  it('returns stable trend for consistent performance', () => {
    const actions: ProvenanceAction[] = [];

    for (let i = 0; i < 20; i++) {
      actions.push(createAction(i % 5 === 0 ? 'failed' : 'completed', i)); // 80% success throughout
    }

    const result = computeFitness('variant-00', actions);

    expect(result.fitness.trend).toBe('stable');
  });

  it('builds history with sampling', () => {
    const actions: ProvenanceAction[] = [];

    for (let i = 0; i < 25; i++) {
      actions.push(createAction('completed', i));
    }

    const result = computeFitness('variant-00', actions);

    // Should have sampled every 5 actions
    expect(result.history.length).toBe(5); // Indices 4, 9, 14, 19, 24
    expect(result.history[0].run_count).toBe(5);
    expect(result.history[4].run_count).toBe(25);
  });

  it('handles empty actions gracefully', () => {
    const result = computeFitness('variant-00', []);

    expect(result.runs).toBe(0);
    expect(result.fitness.current).toBe(0);
    expect(result.metrics.test_pass_rate).toBe(0);
    expect(result.history).toEqual([]);
  });
});

describe('rankVariants', () => {
  it('sorts variants by fitness descending', () => {
    const variants = [
      { variant_id: 'v1', fitness: { current: 0.6 } },
      { variant_id: 'v2', fitness: { current: 0.9 } },
      { variant_id: 'v3', fitness: { current: 0.75 } },
    ] as any;

    const ranked = rankVariants(variants);

    expect(ranked[0].variant_id).toBe('v2'); // 0.9
    expect(ranked[1].variant_id).toBe('v3'); // 0.75
    expect(ranked[2].variant_id).toBe('v1'); // 0.6
  });

  it('does not mutate original array', () => {
    const variants = [
      { variant_id: 'v1', fitness: { current: 0.6 } },
      { variant_id: 'v2', fitness: { current: 0.9 } },
    ] as any;

    const original = [...variants];
    rankVariants(variants);

    expect(variants).toEqual(original);
  });
});

// Helper: create a provenance action
function createAction(
  status: 'completed' | 'failed',
  index: number,
  qualityScore?: number
): ProvenanceAction {
  return {
    action_id: `act-${index}`,
    concept: 'story',
    action: 'create',
    status: status as any,
    timestamp: new Date(Date.now() + index * 1000).toISOString(),
    model: 'sonnet',
    error: status === 'failed' ? { type: 'error', message: 'test error', recoverable: true } : null,
    metadata: qualityScore !== undefined ? { quality_score: qualityScore } : {},
  };
}
