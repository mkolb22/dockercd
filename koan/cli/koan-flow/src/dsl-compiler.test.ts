import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseTrigger,
  parseAction,
  parseRuleLine,
  compileRule,
  compileRules,
  getSloFromRegistry,
  resetRuleCounter,
} from './dsl-compiler.js';
import type { SloRegistry } from './dsl-compiler.js';

beforeEach(() => {
  resetRuleCounter();
});

// --- parseTrigger ---

describe('parseTrigger', () => {
  it('parses simple trigger', () => {
    const t = parseTrigger('story.create:completed');
    expect(t).toEqual({
      concept: 'story',
      action: 'create',
      status: 'completed',
    });
  });

  it('parses trigger without action', () => {
    const t = parseTrigger('code-analysis:completed');
    expect(t).toEqual({
      concept: 'code-analysis',
      action: 'default',
      status: 'completed',
    });
  });

  it('parses trigger with params', () => {
    const t = parseTrigger('verification.verify[pass=1]:completed');
    expect(t).toEqual({
      concept: 'verification',
      action: 'verify',
      status: 'completed',
      params: { pass: '1' },
    });
  });

  it('parses trigger with multiple params', () => {
    const t = parseTrigger('quality.test[type=unit, coverage=80]:completed');
    expect(t).toEqual({
      concept: 'quality',
      action: 'test',
      status: 'completed',
      params: { type: 'unit', coverage: '80' },
    });
  });

  it('parses wildcard trigger', () => {
    const t = parseTrigger('quality.*:all_completed');
    expect(t).toEqual({
      concept: 'quality',
      action: '*',
      status: 'all_completed',
    });
  });
});

// --- parseAction ---

describe('parseAction', () => {
  it('parses simple action', () => {
    const a = parseAction('architecture.design');
    expect(a).toEqual({
      concept: 'architecture',
      action: 'design',
    });
  });

  it('parses action with model', () => {
    const a = parseAction('architecture.design:opus');
    expect(a).toEqual({
      concept: 'architecture',
      action: 'design',
      model: 'opus',
    });
  });

  it('parses action with SLO profile', () => {
    const a = parseAction('architecture.design:opus @architecture');
    expect(a).toEqual({
      concept: 'architecture',
      action: 'design',
      model: 'opus',
      sloProfile: 'architecture',
    });
  });

  it('parses action with only SLO profile', () => {
    const a = parseAction('quality.review @quick');
    expect(a).toEqual({
      concept: 'quality',
      action: 'review',
      sloProfile: 'quick',
    });
  });

  it('is case insensitive for model', () => {
    const a = parseAction('architecture.design:OPUS');
    expect(a.model).toBe('opus');
  });
});

// --- parseRuleLine ---

describe('parseRuleLine', () => {
  it('parses complete rule', () => {
    const r = parseRuleLine('story.create:completed -> architecture.design:opus @architecture');
    expect(r).not.toBeNull();
    expect(r!.trigger.concept).toBe('story');
    expect(r!.action.concept).toBe('architecture');
    expect(r!.action.model).toBe('opus');
    expect(r!.action.sloProfile).toBe('architecture');
  });

  it('parses rule with condition', () => {
    const r = parseRuleLine('implementation:completed -> quality.review @quick [parallel]');
    expect(r).not.toBeNull();
    expect(r!.condition).toEqual(['parallel']);
  });

  it('parses rule with multiple conditions', () => {
    const r = parseRuleLine('quality.*:all_completed -> version.commit @quick [review.approved, test.passed]');
    expect(r).not.toBeNull();
    expect(r!.condition).toEqual(['review.approved', 'test.passed']);
  });

  it('returns null for comment lines', () => {
    expect(parseRuleLine('# This is a comment')).toBeNull();
    expect(parseRuleLine('// Another comment')).toBeNull();
  });

  it('returns null for empty lines', () => {
    expect(parseRuleLine('')).toBeNull();
    expect(parseRuleLine('   ')).toBeNull();
  });

  it('returns null for lines without arrow', () => {
    expect(parseRuleLine('story.create:completed')).toBeNull();
  });
});

// --- compileRule ---

describe('compileRule', () => {
  it('compiles rule to SyncRule object', () => {
    const parsed = parseRuleLine('story.create:completed -> architecture.design:opus @architecture');
    const rule = compileRule(parsed!, null);

    expect(rule.id).toContain('story-to-architecture');
    expect(rule.when).toEqual({
      concept: 'story',
      action: 'create',
      status: 'completed',
    });
    expect(rule.then).toHaveLength(1);
    expect(rule.then[0].concept).toBe('architecture');
    expect(rule.then[0].action).toBe('design');
    expect(rule.then[0].model).toBe('opus');
  });

  it('sets parallel flag from condition', () => {
    const parsed = parseRuleLine('story:completed -> code-analysis.context @mcp [parallel]');
    const rule = compileRule(parsed!, null);

    expect(rule.then[0].parallel).toBe(true);
  });

  it('adds where clause for non-parallel conditions', () => {
    const parsed = parseRuleLine('quality.*:all_completed -> version.commit @quick [review.approved, test.passed]');
    const rule = compileRule(parsed!, null);

    expect(rule.where).toEqual({
      query: 'review.approved AND test.passed',
    });
  });

  it('does not add where clause for only parallel condition', () => {
    const parsed = parseRuleLine('story:completed -> security.threat @mcp [parallel]');
    const rule = compileRule(parsed!, null);

    expect(rule.where).toBeUndefined();
  });
});

// --- getSloFromRegistry ---

describe('getSloFromRegistry', () => {
  const mockRegistry: SloRegistry = {
    defaults: {
      expected_duration_ms: 5000,
      max_duration_ms: 60000,
      expected_cost_usd: 0.002,
      max_cost_usd: 0.02,
    },
    slos: {
      architecture: {
        expected_duration_ms: 15000,
        max_duration_ms: 90000,
        expected_cost_usd: 0.015,
        max_cost_usd: 0.05,
      },
      quick: {
        expected_duration_ms: 1000,
        max_duration_ms: 10000,
        expected_cost_usd: 0.000175,
        max_cost_usd: 0.0005,
      },
    },
    profiles: {
      standard: {
        story: 'quick',
        architecture: 'architecture',
      },
    },
  };

  it('returns SLO for direct profile match', () => {
    const slo = getSloFromRegistry('architecture', mockRegistry);
    expect(slo?.expected_duration_ms).toBe(15000);
  });

  it('returns defaults for unknown profile', () => {
    const slo = getSloFromRegistry('unknown', mockRegistry);
    expect(slo?.expected_duration_ms).toBe(5000);
  });

  it('returns undefined for null registry', () => {
    const slo = getSloFromRegistry('architecture', null);
    expect(slo).toBeUndefined();
  });

  it('returns undefined for undefined profile', () => {
    const slo = getSloFromRegistry(undefined, mockRegistry);
    expect(slo).toBeUndefined();
  });
});

// --- compileRules ---

describe('compileRules', () => {
  it('compiles multiple rules', () => {
    const lines = [
      'story.create:completed -> code-analysis.context @mcp [parallel]',
      'story.create:completed -> security.threat @mcp [parallel]',
      'code-analysis:completed -> architecture.design:opus @architecture',
    ];

    const rules = compileRules(lines, null);
    expect(rules).toHaveLength(3);
  });

  it('skips comments and empty lines', () => {
    const lines = [
      '# Comment',
      'story.create:completed -> architecture.design @architecture',
      '',
      '// Another comment',
    ];

    const rules = compileRules(lines, null);
    expect(rules).toHaveLength(1);
  });

  it('generates unique rule IDs', () => {
    const lines = [
      'story:completed -> architecture.design @architecture',
      'architecture:completed -> implementation.generate @implementation',
    ];

    const rules = compileRules(lines, null);
    expect(rules[0].id).not.toBe(rules[1].id);
  });
});
