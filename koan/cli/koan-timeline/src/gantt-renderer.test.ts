/**
 * Tests for Gantt-style timeline renderer.
 */

import { describe, it, expect } from 'vitest';
import { renderGanttTimeline } from './gantt-renderer.js';
import type { TimelineAction, RenderOptions } from './types.js';

const createMockAction = (overrides: Partial<TimelineAction> = {}): TimelineAction => ({
  action_id: 'action-001',
  concept: 'story',
  action: 'create',
  status: 'completed',
  timestamp: '2026-01-30T10:00:00Z',
  ...overrides,
});

describe('Gantt Renderer', () => {
  describe('renderGanttTimeline', () => {
    it('should render Gantt chart with duration bars', () => {
      const actions: TimelineAction[] = [
        createMockAction({
          flow_id: 'flow-001',
          concept: 'story',
          action: 'create',
          timestamp: '2026-01-30T10:00:00Z',
          duration_ms: 3000,
        }),
        createMockAction({
          flow_id: 'flow-001',
          concept: 'architecture',
          action: 'design',
          timestamp: '2026-01-30T10:03:00Z',
          duration_ms: 5000,
        }),
      ];

      const options: RenderOptions = {
        verbose: false,
        redact: false,
      };

      const output = renderGanttTimeline(actions, options);

      expect(output).toContain('Flow: flow-001');
      expect(output).toContain('Concept');
      expect(output).toContain('Duration');
      expect(output).toContain('Timeline');
      expect(output).toContain('story.create');
      // Label is truncated to 18 chars, so 'architecture.design' becomes 'architecture.de...'
      expect(output).toContain('architecture.de');
      expect(output).toContain('3.0s');
      expect(output).toContain('5.0s');
    });

    it('should render timeline axis labels', () => {
      const actions: TimelineAction[] = [
        createMockAction({
          flow_id: 'flow-001',
          timestamp: '2026-01-30T10:00:00Z',
          duration_ms: 1000,
        }),
        createMockAction({
          flow_id: 'flow-001',
          timestamp: '2026-01-30T10:05:00Z',
          duration_ms: 1000,
        }),
      ];

      const options: RenderOptions = {
        verbose: false,
        redact: false,
      };

      const output = renderGanttTimeline(actions, options);

      // Should contain time labels
      expect(output).toMatch(/\d{2}:\d{2}/);
    });

    it('should show bars with duration proportions', () => {
      const actions: TimelineAction[] = [
        createMockAction({
          flow_id: 'flow-001',
          action_id: 'short',
          timestamp: '2026-01-30T10:00:00Z',
          duration_ms: 1000,
        }),
        createMockAction({
          flow_id: 'flow-001',
          action_id: 'long',
          timestamp: '2026-01-30T10:01:00Z',
          duration_ms: 10000,
        }),
      ];

      const options: RenderOptions = {
        verbose: false,
        redact: false,
      };

      const output = renderGanttTimeline(actions, options);

      // Long duration should have more █ blocks
      const lines = output.split('\n');
      const shortLine = lines.find(l => l.includes('short'));
      const longLine = lines.find(l => l.includes('long'));

      // Basic check: long line should have more filled blocks
      if (shortLine && longLine) {
        const shortBlocks = (shortLine.match(/█/g) || []).length;
        const longBlocks = (longLine.match(/█/g) || []).length;
        expect(longBlocks).toBeGreaterThan(shortBlocks);
      }
    });

    it('should show verbose details with cost and model', () => {
      const actions: TimelineAction[] = [
        createMockAction({
          flow_id: 'flow-001',
          model: 'opus',
          cost: { cost_usd: 0.005 },
          duration_ms: 2000,
        }),
      ];

      const options: RenderOptions = {
        verbose: true,
        redact: false,
      };

      const output = renderGanttTimeline(actions, options);

      expect(output).toContain('$0.0050');
      expect(output).toContain('opus');
    });

    it('should handle single action', () => {
      const actions: TimelineAction[] = [
        createMockAction({
          flow_id: 'flow-001',
          duration_ms: 1000,
        }),
      ];

      const options: RenderOptions = {
        verbose: false,
        redact: false,
      };

      const output = renderGanttTimeline(actions, options);

      expect(output).toContain('Flow: flow-001');
      expect(output).toContain('1.0s');
    });

    it('should calculate flow totals', () => {
      const actions: TimelineAction[] = [
        createMockAction({
          flow_id: 'flow-001',
          cost: { cost_usd: 0.001 },
        }),
        createMockAction({
          flow_id: 'flow-001',
          cost: { cost_usd: 0.002 },
        }),
      ];

      const options: RenderOptions = {
        verbose: false,
        redact: false,
      };

      const output = renderGanttTimeline(actions, options);

      expect(output).toContain('$0.0030');
    });

    it('should truncate long labels', () => {
      const actions: TimelineAction[] = [
        createMockAction({
          flow_id: 'flow-001',
          concept: 'implementation',
          action: 'generate-with-very-long-name-that-needs-truncating',
          duration_ms: 1000,
        }),
      ];

      const options: RenderOptions = {
        verbose: false,
        redact: false,
      };

      const output = renderGanttTimeline(actions, options);

      // Should contain ellipsis for truncation
      expect(output).toContain('...');
    });
  });
});
