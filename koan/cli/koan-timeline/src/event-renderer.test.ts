/**
 * Tests for event-based timeline renderer.
 */

import { describe, it, expect } from 'vitest';
import { renderEventTimeline, renderEmptyState } from './event-renderer.js';
import type { TimelineAction, RenderOptions } from './types.js';

const createMockAction = (overrides: Partial<TimelineAction> = {}): TimelineAction => ({
  action_id: 'action-001',
  concept: 'story',
  action: 'create',
  status: 'completed',
  timestamp: '2026-01-30T10:00:00Z',
  ...overrides,
});

describe('Event Renderer', () => {
  describe('renderEventTimeline', () => {
    it('should render single action', () => {
      const actions: TimelineAction[] = [
        createMockAction({
          action_id: 'action-001',
          flow_id: 'flow-001',
          concept: 'story',
          action: 'create',
          duration_ms: 3200,
          cost: { cost_usd: 0.0002 },
        }),
      ];

      const options: RenderOptions = {
        verbose: false,
        redact: false,
      };

      const output = renderEventTimeline(actions, options);

      expect(output).toContain('Flow: flow-001');
      expect(output).toContain('1 actions');
      expect(output).toContain('story');
      expect(output).toContain('create');
      expect(output).toContain('3.2s');
      // Cost is formatted as <$0.001 since 0.0002 is below 0.001
      expect(output).toContain('<$0.001');
    });

    it('should render multiple actions in flow', () => {
      const actions: TimelineAction[] = [
        createMockAction({
          action_id: 'action-001',
          flow_id: 'flow-001',
          concept: 'story',
          timestamp: '2026-01-30T10:00:00Z',
        }),
        createMockAction({
          action_id: 'action-002',
          flow_id: 'flow-001',
          concept: 'architecture',
          timestamp: '2026-01-30T10:05:00Z',
        }),
      ];

      const options: RenderOptions = {
        verbose: false,
        redact: false,
      };

      const output = renderEventTimeline(actions, options);

      expect(output).toContain('2 actions');
      expect(output).toContain('story');
      expect(output).toContain('architecture');
    });

    it('should show triggered_by hierarchy', () => {
      const actions: TimelineAction[] = [
        createMockAction({
          action_id: 'action-001',
          flow_id: 'flow-001',
          concept: 'story',
        }),
        createMockAction({
          action_id: 'action-002',
          flow_id: 'flow-001',
          concept: 'architecture',
          triggered_by: 'action-001',
        }),
      ];

      const options: RenderOptions = {
        verbose: false,
        redact: false,
      };

      const output = renderEventTimeline(actions, options);

      // Second action should be indented
      expect(output).toContain('+-*');
    });

    it('should show verbose details', () => {
      const actions: TimelineAction[] = [
        createMockAction({
          action_id: 'action-001',
          flow_id: 'flow-001',
          cost: {
            input_tokens: 1000,
            output_tokens: 500,
            cost_usd: 0.001,
          },
          triggered_by: 'action-000',
        }),
      ];

      const options: RenderOptions = {
        verbose: true,
        redact: false,
      };

      const output = renderEventTimeline(actions, options);

      expect(output).toContain('tokens:');
      expect(output).toContain('1,000');
      expect(output).toContain('500');
      expect(output).toContain('triggered_by: action-000');
    });

    it('should redact sensitive data when requested', () => {
      const actions: TimelineAction[] = [
        createMockAction({
          action_id: 'action-12345678-full',
          flow_id: 'flow-12345678-full',
          outputs: {
            artifact_path: '/sensitive/path/file.yaml',
          },
        }),
      ];

      const options: RenderOptions = {
        verbose: false,
        redact: true,
      };

      const output = renderEventTimeline(actions, options);

      expect(output).not.toContain('action-12345678-full');
      expect(output).not.toContain('flow-12345678-full');
      expect(output).toContain('***');
    });

    it('should handle empty actions array', () => {
      const options: RenderOptions = {
        verbose: false,
        redact: false,
      };

      const output = renderEventTimeline([], options);
      expect(output).toBe('');
    });

    it('should group by flow correctly', () => {
      const actions: TimelineAction[] = [
        createMockAction({ action_id: 'a1', flow_id: 'flow-001' }),
        createMockAction({ action_id: 'a2', flow_id: 'flow-002' }),
        createMockAction({ action_id: 'a3', flow_id: 'flow-001' }),
      ];

      const options: RenderOptions = {
        verbose: false,
        redact: false,
      };

      const output = renderEventTimeline(actions, options);

      expect(output).toContain('Flow: flow-001');
      expect(output).toContain('Flow: flow-002');
    });

    it('should calculate flow totals correctly', () => {
      const actions: TimelineAction[] = [
        createMockAction({
          flow_id: 'flow-001',
          cost: { cost_usd: 0.001 },
          duration_ms: 1000,
        }),
        createMockAction({
          flow_id: 'flow-001',
          cost: { cost_usd: 0.002 },
          duration_ms: 2000,
        }),
      ];

      const options: RenderOptions = {
        verbose: false,
        redact: false,
      };

      const output = renderEventTimeline(actions, options);

      expect(output).toContain('$0.0030');
      expect(output).toContain('3.0s');
    });
  });

  describe('renderEmptyState', () => {
    it('should render empty state message', () => {
      const output = renderEmptyState();

      expect(output).toContain('Koan Timeline');
      expect(output).toContain('No provenance actions found');
      expect(output).toContain('/feature');
    });
  });
});
