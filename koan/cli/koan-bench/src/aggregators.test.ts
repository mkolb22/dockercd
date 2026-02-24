import { describe, it, expect } from 'vitest';
import type { ProvenanceAction } from './types.js';
import {
  aggregateCosts,
  aggregateDurations,
  aggregateQuality,
  aggregateModelUsage,
  aggregateFailures,
  computeTrends,
  computeBenchmarks,
} from './aggregators.js';

const mockAction = (overrides: Partial<ProvenanceAction> = {}): ProvenanceAction => ({
  action_id: 'act-001',
  concept: 'story',
  action: 'create',
  status: 'completed',
  timestamp: '2026-01-28T10:00:00Z',
  model: 'sonnet',
  triggered_by: null,
  flow_id: 'story-001',
  sync_rule_id: null,
  ...overrides,
});

describe('aggregators', () => {
  describe('aggregateCosts', () => {
    it('should calculate total spend', () => {
      const actions: ProvenanceAction[] = [
        mockAction({ cost: { cost_usd: 0.001 } }),
        mockAction({ cost: { cost_usd: 0.002 } }),
        mockAction({ cost: { cost_usd: 0.003 } }),
      ];

      const result = aggregateCosts(actions);
      expect(result.total_spend).toBeCloseTo(0.006);
    });

    it('should group by concept', () => {
      const actions: ProvenanceAction[] = [
        mockAction({ concept: 'story', cost: { cost_usd: 0.001 } }),
        mockAction({ concept: 'story', cost: { cost_usd: 0.002 } }),
        mockAction({ concept: 'architecture', cost: { cost_usd: 0.003 } }),
      ];

      const result = aggregateCosts(actions);
      expect(result.by_concept).toHaveLength(2);

      const storyCost = result.by_concept.find(c => c.concept === 'story');
      expect(storyCost?.total).toBeCloseTo(0.003);
      expect(storyCost?.avg).toBeCloseTo(0.0015);
      expect(storyCost?.count).toBe(2);
    });

    it('should group by story', () => {
      const actions: ProvenanceAction[] = [
        mockAction({ flow_id: 'story-001', cost: { cost_usd: 0.001 } }),
        mockAction({ flow_id: 'story-001', cost: { cost_usd: 0.002 } }),
        mockAction({ flow_id: 'story-002', cost: { cost_usd: 0.003 } }),
      ];

      const result = aggregateCosts(actions);
      expect(result.by_story).toHaveLength(2);

      const story1 = result.by_story.find(s => s.story_id === 'story-001');
      expect(story1?.total).toBeCloseTo(0.003);
      expect(story1?.count).toBe(2);
    });

    it('should group by model', () => {
      const actions: ProvenanceAction[] = [
        mockAction({ model: 'sonnet', cost: { cost_usd: 0.001 } }),
        mockAction({ model: 'sonnet', cost: { cost_usd: 0.001 } }),
        mockAction({ model: 'opus', cost: { cost_usd: 0.005 } }),
      ];

      const result = aggregateCosts(actions);
      expect(result.by_model).toHaveLength(2);

      const sonnetCost = result.by_model.find(m => m.model === 'sonnet');
      expect(sonnetCost?.total).toBeCloseTo(0.002);
      expect(sonnetCost?.avg).toBeCloseTo(0.001);
    });

    it('should handle missing cost', () => {
      const actions: ProvenanceAction[] = [
        mockAction({}),
        mockAction({ cost: { cost_usd: 0.001 } }),
      ];

      const result = aggregateCosts(actions);
      expect(result.total_spend).toBeCloseTo(0.001);
    });
  });

  describe('aggregateDurations', () => {
    it('should calculate total duration', () => {
      const actions: ProvenanceAction[] = [
        mockAction({ duration_ms: 1000 }),
        mockAction({ duration_ms: 2000 }),
        mockAction({ duration_ms: 3000 }),
      ];

      const result = aggregateDurations(actions);
      expect(result.total_duration_ms).toBe(6000);
    });

    it('should calculate percentiles by concept', () => {
      const actions: ProvenanceAction[] = [
        mockAction({ concept: 'story', duration_ms: 100 }),
        mockAction({ concept: 'story', duration_ms: 200 }),
        mockAction({ concept: 'story', duration_ms: 300 }),
        mockAction({ concept: 'story', duration_ms: 400 }),
        mockAction({ concept: 'story', duration_ms: 500 }),
      ];

      const result = aggregateDurations(actions);
      const storyConcept = result.by_concept.find(c => c.concept === 'story');

      expect(storyConcept?.p50_ms).toBe(300);
      expect(storyConcept?.avg_ms).toBe(300);
    });

    it('should group by story', () => {
      const actions: ProvenanceAction[] = [
        mockAction({ flow_id: 'story-001', duration_ms: 1000 }),
        mockAction({ flow_id: 'story-001', duration_ms: 2000 }),
        mockAction({ flow_id: 'story-002', duration_ms: 3000 }),
      ];

      const result = aggregateDurations(actions);
      const story1 = result.by_story.find(s => s.story_id === 'story-001');

      expect(story1?.total_ms).toBe(3000);
      expect(story1?.count).toBe(2);
    });
  });

  describe('aggregateQuality', () => {
    it('should count quality reviews', () => {
      const actions: ProvenanceAction[] = [
        mockAction({ concept: 'quality', status: 'completed' }),
        mockAction({ concept: 'quality', status: 'completed' }),
        mockAction({ concept: 'verification', status: 'completed' }),
      ];

      const result = aggregateQuality(actions);
      expect(result.total_reviews).toBe(3);
    });

    it('should calculate approval rate', () => {
      const actions: ProvenanceAction[] = [
        mockAction({ concept: 'quality', status: 'completed' }),
        mockAction({ concept: 'quality', status: 'completed' }),
        mockAction({
          concept: 'quality',
          status: 'failed',
          error: { type: 'validation', message: 'Failed', recoverable: true },
        }),
      ];

      const result = aggregateQuality(actions);
      expect(result.approval_rate).toBeCloseTo(0.667, 2);
    });

    it('should calculate review cycles', () => {
      const actions: ProvenanceAction[] = [
        mockAction({ concept: 'quality', status: 'completed' }),
        mockAction({ concept: 'quality', status: 'completed', metadata: { retry: true } }),
        mockAction({ concept: 'quality', status: 'completed', metadata: { retry: true } }),
      ];

      const result = aggregateQuality(actions);
      expect(result.avg_review_cycles).toBeCloseTo(1.667, 2);
    });
  });

  describe('aggregateModelUsage', () => {
    it('should calculate model distribution', () => {
      const actions: ProvenanceAction[] = [
        mockAction({ model: 'sonnet' }),
        mockAction({ model: 'sonnet' }),
        mockAction({ model: 'sonnet' }),
        mockAction({ model: 'opus' }),
      ];

      const result = aggregateModelUsage(actions);
      expect(result.distribution).toHaveLength(2);

      const sonnet = result.distribution.find(d => d.model === 'sonnet');
      expect(sonnet?.count).toBe(3);
      expect(sonnet?.percentage).toBe(75);
    });

    it('should calculate cost distribution', () => {
      const actions: ProvenanceAction[] = [
        mockAction({ model: 'sonnet', cost: { cost_usd: 0.001 } }),
        mockAction({ model: 'sonnet', cost: { cost_usd: 0.001 } }),
        mockAction({ model: 'opus', cost: { cost_usd: 0.008 } }),
      ];

      const result = aggregateModelUsage(actions);
      const opusCost = result.cost_distribution.find(d => d.model === 'opus');

      expect(opusCost?.cost).toBeCloseTo(0.008);
      expect(opusCost?.percentage).toBe(80);
    });
  });

  describe('aggregateFailures', () => {
    it('should count failures', () => {
      const actions: ProvenanceAction[] = [
        mockAction({ status: 'completed' }),
        mockAction({ status: 'failed' }),
        mockAction({ status: 'failed' }),
      ];

      const result = aggregateFailures(actions);
      expect(result.total_failures).toBe(2);
      expect(result.failure_rate).toBeCloseTo(0.667, 2);
    });

    it('should count retries', () => {
      const actions: ProvenanceAction[] = [
        mockAction({ status: 'completed' }),
        mockAction({ status: 'completed', metadata: { retry: true } }),
        mockAction({ status: 'completed', metadata: { retry: true } }),
      ];

      const result = aggregateFailures(actions);
      expect(result.retry_count).toBe(2);
    });

    it('should group by error type', () => {
      const actions: ProvenanceAction[] = [
        mockAction({
          status: 'failed',
          error: { type: 'timeout', message: 'Timeout', recoverable: true },
        }),
        mockAction({
          status: 'failed',
          error: { type: 'timeout', message: 'Timeout', recoverable: true },
        }),
        mockAction({
          status: 'failed',
          error: { type: 'validation', message: 'Invalid', recoverable: false },
        }),
      ];

      const result = aggregateFailures(actions);
      expect(result.by_error_type).toHaveLength(2);

      const timeout = result.by_error_type.find(e => e.error_type === 'timeout');
      expect(timeout?.count).toBe(2);
    });
  });

  describe('computeTrends', () => {
    it('should return undefined if no window size', () => {
      const actions: ProvenanceAction[] = [mockAction()];
      const result = computeTrends(actions, 0);
      expect(result).toBeUndefined();
    });

    it('should compute cost trends', () => {
      const actions: ProvenanceAction[] = [
        mockAction({
          flow_id: 'story-001',
          cost: { cost_usd: 0.001 },
          timestamp: '2026-01-27T10:00:00Z',
        }),
        mockAction({
          flow_id: 'story-002',
          cost: { cost_usd: 0.002 },
          timestamp: '2026-01-28T10:00:00Z',
        }),
      ];

      const result = computeTrends(actions, 10);
      expect(result?.cost_trend).toHaveLength(2);
      expect(result?.cost_trend[0].cost).toBeCloseTo(0.001);
      expect(result?.cost_trend[1].cumulative).toBeCloseTo(0.003);
    });

    it('should limit to window size', () => {
      const actions: ProvenanceAction[] = Array.from({ length: 20 }, (_, i) =>
        mockAction({
          flow_id: `story-${String(i).padStart(3, '0')}`,
          timestamp: `2026-01-${String(i + 1).padStart(2, '0')}T10:00:00Z`,
        })
      );

      const result = computeTrends(actions, 5);
      expect(result?.window_size).toBe(5);
    });
  });

  describe('computeBenchmarks', () => {
    it('should compute all metrics', () => {
      const actions: ProvenanceAction[] = [
        mockAction({
          concept: 'story',
          model: 'sonnet',
          cost: { cost_usd: 0.001 },
          duration_ms: 1000,
        }),
        mockAction({
          concept: 'architecture',
          model: 'opus',
          cost: { cost_usd: 0.005 },
          duration_ms: 5000,
        }),
      ];

      const result = computeBenchmarks(actions);

      expect(result.action_count).toBe(2);
      expect(result.story_count).toBe(1);
      expect(result.cost.total_spend).toBeCloseTo(0.006);
      expect(result.duration.total_duration_ms).toBe(6000);
      expect(result.model_usage.distribution).toHaveLength(2);
    });

    it('should include trends if requested', () => {
      const actions: ProvenanceAction[] = [
        mockAction({ flow_id: 'story-001', timestamp: '2026-01-27T10:00:00Z' }),
        mockAction({ flow_id: 'story-002', timestamp: '2026-01-28T10:00:00Z' }),
      ];

      const result = computeBenchmarks(actions, { stories: 5 });
      expect(result.trends).toBeDefined();
      expect(result.trends?.window_size).toBe(2);
    });

    it('should not include trends if not requested', () => {
      const actions: ProvenanceAction[] = [mockAction()];
      const result = computeBenchmarks(actions);
      expect(result.trends).toBeUndefined();
    });
  });
});
