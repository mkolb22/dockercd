import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import chalk from 'chalk';
import type { CostAnalytics, CostByDimension } from './types.js';
import { formatDefault, formatChart, formatJson, formatVerbose, formatEmpty } from './formatter.js';

beforeEach(() => {
  chalk.level = 0;
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function dim(overrides: Partial<CostByDimension> = {}): CostByDimension {
  return {
    dimension: 'story',
    total_cost: 0.01,
    count: 1,
    avg_cost: 0.01,
    input_tokens: 500,
    output_tokens: 200,
    ...overrides,
  };
}

function makeAnalytics(overrides: Partial<CostAnalytics> = {}): CostAnalytics {
  return {
    total_cost: 0.05,
    total_actions: 3,
    by_concept: [dim({ dimension: 'story', total_cost: 0.03, count: 2, avg_cost: 0.015 }), dim({ dimension: 'architecture', total_cost: 0.02 })],
    by_model: [dim({ dimension: 'sonnet', total_cost: 0.05, count: 3, avg_cost: 0.0167 })],
    by_flow: [],
    by_date: [],
    time_series: [],
    ...overrides,
  };
}

function allOutput(): string {
  return (console.log as ReturnType<typeof vi.fn>).mock.calls
    .map((c: unknown[]) => c.map(String).join(' '))
    .join('\n');
}

describe('formatDefault', () => {
  it('prints header and overview with total spend', () => {
    formatDefault(makeAnalytics());
    const output = allOutput();
    expect(output).toContain('Cost Analytics');
    expect(output).toContain('$0.0500');
    expect(output).toContain('3');
  });

  it('prints per-action average', () => {
    formatDefault(makeAnalytics({ total_cost: 0.09, total_actions: 3 }));
    const output = allOutput();
    expect(output).toContain('$0.0300');
  });

  it('skips by_flow section when only untracked', () => {
    formatDefault(makeAnalytics({
      by_flow: [dim({ dimension: 'untracked', total_cost: 0.05 })],
    }));
    const output = allOutput();
    expect(output).not.toContain('Cost by Workflow');
  });

  it('shows by_flow section when tracked flows exist', () => {
    formatDefault(makeAnalytics({
      by_flow: [dim({ dimension: 'flow-001', total_cost: 0.03 })],
    }));
    const output = allOutput();
    expect(output).toContain('Cost by Workflow');
  });

  it('handles zero total_actions (no per-action avg)', () => {
    formatDefault(makeAnalytics({ total_cost: 0, total_actions: 0, by_concept: [], by_model: [] }));
    const output = allOutput();
    expect(output).toContain('0');
    expect(output).not.toContain('Avg per action');
  });

  it('renders "No data" for empty dimension arrays', () => {
    formatDefault(makeAnalytics({ by_concept: [], by_model: [] }));
    const output = allOutput();
    expect(output).toContain('No data');
  });
});

describe('formatJson', () => {
  it('outputs valid JSON of analytics object', () => {
    const analytics = makeAnalytics();
    formatJson(analytics);
    const output = allOutput();
    const parsed = JSON.parse(output);
    expect(parsed.total_cost).toBe(0.05);
    expect(parsed.total_actions).toBe(3);
    expect(parsed.by_concept).toHaveLength(2);
  });
});

describe('formatVerbose', () => {
  it('includes per-action details table', () => {
    const analytics = makeAnalytics();
    const actions = [
      { action_id: 'act-001', concept: 'story', action: 'create', model: 'sonnet', cost: { cost_usd: 0.01 }, timestamp: '2026-01-15T12:00:00Z' },
      { action_id: 'act-002', concept: 'architecture', action: 'design', model: 'opus', cost: { cost_usd: 0.04 }, timestamp: '2026-01-15T13:00:00Z' },
    ];
    formatVerbose(analytics, actions);
    const output = allOutput();
    expect(output).toContain('Action Details');
    expect(output).toContain('act-001');
    expect(output).toContain('act-002');
  });

  it('handles missing model and cost in actions', () => {
    const analytics = makeAnalytics();
    const actions = [
      { action_id: 'act-003', concept: 'story', action: 'create', timestamp: '2026-01-15T12:00:00Z' },
    ];
    formatVerbose(analytics, actions);
    const output = allOutput();
    expect(output).toContain('act-003');
  });
});

describe('formatChart', () => {
  it('shows "not enough data" for fewer than 2 time series points', () => {
    formatChart(makeAnalytics({ time_series: [{ date: '2026-01-15', cost: 0.01 }] }));
    const output = allOutput();
    expect(output).toContain('Not enough data');
  });

  it('renders chart when 2+ data points exist', () => {
    formatChart(makeAnalytics({
      time_series: [
        { date: '2026-01-15', cost: 0.01 },
        { date: '2026-01-16', cost: 0.04 },
      ],
    }));
    const output = allOutput();
    expect(output).toContain('Cost Over Time');
  });
});

describe('formatEmpty', () => {
  it('shows empty state message with guidance', () => {
    formatEmpty();
    const output = allOutput();
    expect(output).toContain('No provenance records');
    expect(output).toContain('/feature');
  });
});
