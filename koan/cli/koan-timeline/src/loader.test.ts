/**
 * Tests for timeline action loading and filtering.
 * Note: Core filtering logic is now tested in koan-core/filters.test.ts
 * These tests only cover timeline-specific utilities.
 */

import { describe, it, expect } from 'vitest';
import type { TimelineAction } from './types.js';
import { groupByFlow, parseDate } from './loader.js';

const createMockAction = (overrides: Partial<TimelineAction> = {}): TimelineAction => ({
  action_id: 'action-001',
  concept: 'story',
  action: 'create',
  status: 'completed',
  timestamp: '2026-01-30T10:00:00Z',
  ...overrides,
});

describe('Timeline Loader', () => {
  describe('groupByFlow', () => {
    it('should group actions by flow ID', () => {
      const actions: TimelineAction[] = [
        createMockAction({ action_id: 'a1', flow_id: 'flow-001' }),
        createMockAction({ action_id: 'a2', flow_id: 'flow-002' }),
        createMockAction({ action_id: 'a3', flow_id: 'flow-001' }),
      ];

      const groups = groupByFlow(actions);

      expect(groups.size).toBe(2);
      expect(groups.get('flow-001')).toHaveLength(2);
      expect(groups.get('flow-002')).toHaveLength(1);
    });

    it('should handle actions without flow_id as "untracked"', () => {
      const actions: TimelineAction[] = [
        createMockAction({ action_id: 'a1', flow_id: 'flow-001' }),
        createMockAction({ action_id: 'a2' }),
        createMockAction({ action_id: 'a3' }),
      ];

      const groups = groupByFlow(actions);

      expect(groups.size).toBe(2);
      expect(groups.get('flow-001')).toHaveLength(1);
      expect(groups.get('untracked')).toHaveLength(2);
    });

    it('should handle empty array', () => {
      const groups = groupByFlow([]);
      expect(groups.size).toBe(0);
    });
  });

  describe('parseDate', () => {
    it('should parse relative dates', () => {
      const now = new Date();

      const sevenDaysAgo = parseDate('7d');
      const expectedDays = new Date(now);
      expectedDays.setDate(expectedDays.getDate() - 7);

      expect(sevenDaysAgo.getDate()).toBe(expectedDays.getDate());
    });

    it('should parse ISO dates', () => {
      const date = parseDate('2026-01-30T00:00:00Z');
      expect(date.getFullYear()).toBe(2026);
      expect(date.getMonth()).toBe(0); // January
      expect(date.getUTCDate()).toBe(30);
    });

    it('should throw on invalid dates', () => {
      expect(() => parseDate('invalid-date')).toThrow(/Invalid date format/);
    });
  });
});
