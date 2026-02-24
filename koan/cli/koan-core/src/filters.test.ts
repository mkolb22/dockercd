/**
 * Tests for provenance action filtering.
 */

import { describe, it, expect } from 'vitest';
import { filterProvenanceActions } from './filters.js';
import type { ProvenanceAction } from './types.js';

// Helper to create a test action
function createAction(overrides: Partial<ProvenanceAction> = {}): ProvenanceAction {
  return {
    action_id: 'action-001',
    concept: 'story',
    action: 'create',
    status: 'completed',
    timestamp: '2026-01-30T10:00:00Z',
    model: 'sonnet',
    triggered_by: null,
    flow_id: 'flow-001',
    sync_rule_id: null,
    ...overrides,
  };
}

describe('filterProvenanceActions', () => {
  describe('date range filtering', () => {
    it('filters by from date', () => {
      const actions: ProvenanceAction[] = [
        createAction({ timestamp: '2026-01-25T10:00:00Z' }),
        createAction({ timestamp: '2026-01-30T10:00:00Z' }),
        createAction({ timestamp: '2026-02-05T10:00:00Z' }),
      ];

      const result = filterProvenanceActions(actions, {
        dateRange: { from: new Date('2026-01-28') },
      });

      expect(result).toHaveLength(2);
      expect(result[0].timestamp).toBe('2026-01-30T10:00:00Z');
      expect(result[1].timestamp).toBe('2026-02-05T10:00:00Z');
    });

    it('filters by to date', () => {
      const actions: ProvenanceAction[] = [
        createAction({ timestamp: '2026-01-25T10:00:00Z' }),
        createAction({ timestamp: '2026-01-30T10:00:00Z' }),
        createAction({ timestamp: '2026-02-05T10:00:00Z' }),
      ];

      const result = filterProvenanceActions(actions, {
        dateRange: { to: new Date('2026-02-01') },
      });

      expect(result).toHaveLength(2);
      expect(result[0].timestamp).toBe('2026-01-25T10:00:00Z');
      expect(result[1].timestamp).toBe('2026-01-30T10:00:00Z');
    });

    it('filters by date range', () => {
      const actions: ProvenanceAction[] = [
        createAction({ timestamp: '2026-01-25T10:00:00Z' }),
        createAction({ timestamp: '2026-01-30T10:00:00Z' }),
        createAction({ timestamp: '2026-02-05T10:00:00Z' }),
      ];

      const result = filterProvenanceActions(actions, {
        dateRange: {
          from: new Date('2026-01-28'),
          to: new Date('2026-02-01'),
        },
      });

      expect(result).toHaveLength(1);
      expect(result[0].timestamp).toBe('2026-01-30T10:00:00Z');
    });
  });

  describe('concept filtering', () => {
    it('filters by single concept', () => {
      const actions: ProvenanceAction[] = [
        createAction({ concept: 'story' }),
        createAction({ concept: 'architecture' }),
        createAction({ concept: 'implementation' }),
      ];

      const result = filterProvenanceActions(actions, {
        concepts: ['architecture'],
      });

      expect(result).toHaveLength(1);
      expect(result[0].concept).toBe('architecture');
    });

    it('filters by multiple concepts (OR logic)', () => {
      const actions: ProvenanceAction[] = [
        createAction({ concept: 'story' }),
        createAction({ concept: 'architecture' }),
        createAction({ concept: 'implementation' }),
        createAction({ concept: 'quality' }),
      ];

      const result = filterProvenanceActions(actions, {
        concepts: ['story', 'quality'],
      });

      expect(result).toHaveLength(2);
      expect(result.map(a => a.concept)).toEqual(['story', 'quality']);
    });
  });

  describe('model filtering', () => {
    it('filters by single model', () => {
      const actions: ProvenanceAction[] = [
        createAction({ model: 'haiku' }),
        createAction({ model: 'sonnet' }),
        createAction({ model: 'opus' }),
      ];

      const result = filterProvenanceActions(actions, {
        models: ['opus'],
      });

      expect(result).toHaveLength(1);
      expect(result[0].model).toBe('opus');
    });

    it('filters by multiple models (OR logic)', () => {
      const actions: ProvenanceAction[] = [
        createAction({ model: 'haiku' }),
        createAction({ model: 'sonnet' }),
        createAction({ model: 'opus' }),
      ];

      const result = filterProvenanceActions(actions, {
        models: ['haiku', 'opus'],
      });

      expect(result).toHaveLength(2);
      expect(result.map(a => a.model)).toEqual(['haiku', 'opus']);
    });

    it('excludes actions without model when filtering by model', () => {
      const actions: ProvenanceAction[] = [
        createAction({ model: 'sonnet' }),
        createAction({ model: undefined }),
      ];

      const result = filterProvenanceActions(actions, {
        models: ['sonnet'],
      });

      expect(result).toHaveLength(1);
      expect(result[0].model).toBe('sonnet');
    });
  });

  describe('flow ID filtering', () => {
    it('filters by flow ID', () => {
      const actions: ProvenanceAction[] = [
        createAction({ flow_id: 'flow-001' }),
        createAction({ flow_id: 'flow-002' }),
        createAction({ flow_id: 'flow-001' }),
      ];

      const result = filterProvenanceActions(actions, {
        flowId: 'flow-001',
      });

      expect(result).toHaveLength(2);
      expect(result.every(a => a.flow_id === 'flow-001')).toBe(true);
    });
  });

  describe('story ID filtering', () => {
    it('filters by story ID in inputs', () => {
      const actions: ProvenanceAction[] = [
        createAction({ inputs: { story_id: 'story-001' } }),
        createAction({ inputs: { story_id: 'story-002' } }),
        createAction({ inputs: { story_id: 'story-001' } }),
      ];

      const result = filterProvenanceActions(actions, {
        storyId: 'story-001',
      });

      expect(result).toHaveLength(2);
    });

    it('filters by story ID in outputs', () => {
      const actions: ProvenanceAction[] = [
        createAction({ outputs: { story_id: 'story-001' } }),
        createAction({ outputs: { story_id: 'story-002' } }),
      ];

      const result = filterProvenanceActions(actions, {
        storyId: 'story-001',
      });

      expect(result).toHaveLength(1);
    });
  });

  describe('combined filtering', () => {
    it('applies multiple filters with AND logic', () => {
      const actions: ProvenanceAction[] = [
        createAction({
          concept: 'story',
          model: 'sonnet',
          timestamp: '2026-01-30T10:00:00Z',
          flow_id: 'flow-001',
        }),
        createAction({
          concept: 'architecture',
          model: 'opus',
          timestamp: '2026-01-30T11:00:00Z',
          flow_id: 'flow-001',
        }),
        createAction({
          concept: 'story',
          model: 'sonnet',
          timestamp: '2026-01-30T12:00:00Z',
          flow_id: 'flow-002',
        }),
      ];

      const result = filterProvenanceActions(actions, {
        concepts: ['story'],
        models: ['sonnet'],
        flowId: 'flow-001',
        dateRange: { from: new Date('2026-01-30') },
      });

      expect(result).toHaveLength(1);
      expect(result[0].concept).toBe('story');
      expect(result[0].model).toBe('sonnet');
      expect(result[0].flow_id).toBe('flow-001');
    });
  });

  describe('empty filters', () => {
    it('returns all actions when no filters applied', () => {
      const actions: ProvenanceAction[] = [
        createAction(),
        createAction(),
        createAction(),
      ];

      const result = filterProvenanceActions(actions, {});

      expect(result).toHaveLength(3);
    });

    it('returns all actions when empty filter arrays provided', () => {
      const actions: ProvenanceAction[] = [
        createAction(),
        createAction(),
      ];

      const result = filterProvenanceActions(actions, {
        concepts: [],
        models: [],
      });

      expect(result).toHaveLength(2);
    });
  });
});
