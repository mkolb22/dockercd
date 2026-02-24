import { describe, it, expect } from 'vitest';
import type { ProvenanceAction } from '@zen/koan-core';
import { computeAnalytics } from './analytics.js';

function makeAction(overrides: Partial<ProvenanceAction> = {}): ProvenanceAction {
  return {
    action_id: 'act-001',
    concept: 'story',
    action: 'create',
    status: 'completed',
    timestamp: '2026-01-15T12:00:00Z',
    model: 'sonnet',
    ...overrides,
  };
}

describe('computeAnalytics', () => {
  it('returns zeroed analytics for empty actions', () => {
    const result = computeAnalytics([]);
    expect(result.total_cost).toBe(0);
    expect(result.total_actions).toBe(0);
    expect(result.by_concept).toEqual([]);
    expect(result.by_model).toEqual([]);
    expect(result.by_flow).toEqual([]);
    expect(result.time_series).toEqual([]);
  });

  it('computes total cost and action count', () => {
    const actions = [
      makeAction({ cost: { cost_usd: 0.01 } }),
      makeAction({ action_id: 'act-002', cost: { cost_usd: 0.02 } }),
    ];
    const result = computeAnalytics(actions);
    expect(result.total_cost).toBeCloseTo(0.03);
    expect(result.total_actions).toBe(2);
  });

  it('aggregates by concept sorted by cost descending', () => {
    const actions = [
      makeAction({ concept: 'story', cost: { cost_usd: 0.01 } }),
      makeAction({ action_id: 'act-002', concept: 'architecture', cost: { cost_usd: 0.05 } }),
      makeAction({ action_id: 'act-003', concept: 'story', cost: { cost_usd: 0.02 } }),
    ];
    const result = computeAnalytics(actions);
    expect(result.by_concept).toHaveLength(2);
    // Sorted by cost descending: architecture ($0.05) > story ($0.03)
    expect(result.by_concept[0].dimension).toBe('architecture');
    expect(result.by_concept[0].total_cost).toBeCloseTo(0.05);
    expect(result.by_concept[1].dimension).toBe('story');
    expect(result.by_concept[1].total_cost).toBeCloseTo(0.03);
    expect(result.by_concept[1].count).toBe(2);
    expect(result.by_concept[1].avg_cost).toBeCloseTo(0.015);
  });

  it('aggregates by model', () => {
    const actions = [
      makeAction({ model: 'sonnet', cost: { cost_usd: 0.01 } }),
      makeAction({ action_id: 'act-002', model: 'opus', cost: { cost_usd: 0.05 } }),
    ];
    const result = computeAnalytics(actions);
    expect(result.by_model).toHaveLength(2);
    expect(result.by_model[0].dimension).toBe('opus');
    expect(result.by_model[1].dimension).toBe('sonnet');
  });

  it('uses "unknown" for missing model', () => {
    const actions = [makeAction({ model: undefined, cost: { cost_usd: 0.01 } })];
    const result = computeAnalytics(actions);
    expect(result.by_model[0].dimension).toBe('unknown');
  });

  it('aggregates by flow, uses "untracked" for missing flow_id', () => {
    const actions = [
      makeAction({ flow_id: 'flow-1', cost: { cost_usd: 0.01 } }),
      makeAction({ action_id: 'act-002', cost: { cost_usd: 0.02 } }),
    ];
    const result = computeAnalytics(actions);
    expect(result.by_flow).toHaveLength(2);
    const untracked = result.by_flow.find(d => d.dimension === 'untracked');
    expect(untracked).toBeDefined();
    expect(untracked!.total_cost).toBeCloseTo(0.02);
  });

  it('aggregates by date', () => {
    const actions = [
      makeAction({ timestamp: '2026-01-15T12:00:00Z', cost: { cost_usd: 0.01 } }),
      makeAction({ action_id: 'act-002', timestamp: '2026-01-15T14:00:00Z', cost: { cost_usd: 0.02 } }),
      makeAction({ action_id: 'act-003', timestamp: '2026-01-16T10:00:00Z', cost: { cost_usd: 0.05 } }),
    ];
    const result = computeAnalytics(actions);
    expect(result.by_date).toHaveLength(2);
    expect(result.by_date[0].dimension).toBe('2026-01-16'); // highest cost first
    expect(result.by_date[0].total_cost).toBeCloseTo(0.05);
  });

  it('builds time series sorted chronologically', () => {
    const actions = [
      makeAction({ timestamp: '2026-01-16T10:00:00Z', cost: { cost_usd: 0.05 } }),
      makeAction({ action_id: 'act-002', timestamp: '2026-01-15T12:00:00Z', cost: { cost_usd: 0.01 } }),
    ];
    const result = computeAnalytics(actions);
    expect(result.time_series).toEqual([
      { date: '2026-01-15', cost: 0.01 },
      { date: '2026-01-16', cost: 0.05 },
    ]);
  });

  it('accumulates tokens in aggregations', () => {
    const actions = [
      makeAction({ concept: 'story', cost: { cost_usd: 0.01, input_tokens: 1000, output_tokens: 500 } }),
      makeAction({ action_id: 'act-002', concept: 'story', cost: { cost_usd: 0.02, input_tokens: 2000, output_tokens: 800 } }),
    ];
    const result = computeAnalytics(actions);
    expect(result.by_concept[0].input_tokens).toBe(3000);
    expect(result.by_concept[0].output_tokens).toBe(1300);
  });

  it('handles actions with no cost gracefully', () => {
    const actions = [makeAction(), makeAction({ action_id: 'act-002' })];
    const result = computeAnalytics(actions);
    expect(result.total_cost).toBe(0);
    expect(result.total_actions).toBe(2);
    expect(result.by_concept[0].count).toBe(2);
  });
});
