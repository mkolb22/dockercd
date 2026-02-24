/**
 * Tests for koan-observe analyzer.
 */

import { describe, it, expect } from 'vitest';
import { analyzePromptLogs, filterLogs } from './analyzer.js';
import { parseRelativeDate } from '@zen/koan-core';
import type { PromptLogEntry } from './types.js';

describe('analyzePromptLogs', () => {
  it('returns empty analysis for empty logs', () => {
    const result = analyzePromptLogs([]);

    expect(result.total_calls).toBe(0);
    expect(result.total_tokens).toBe(0);
    expect(result.unique_sessions).toBe(0);
    expect(result.by_concept).toEqual([]);
  });

  it('calculates totals correctly', () => {
    const logs: PromptLogEntry[] = [
      {
        timestamp: '2026-01-30T10:00:00Z',
        session_id: 'sess1',
        tool: 'Task',
        concept: 'story',
        action: 'create',
        model: 'sonnet',
        input_chars: 400,
        estimated_tokens: 100,
      },
      {
        timestamp: '2026-01-30T10:05:00Z',
        session_id: 'sess1',
        tool: 'Task',
        concept: 'architecture',
        action: 'design',
        model: 'opus',
        input_chars: 800,
        estimated_tokens: 200,
      },
    ];

    const result = analyzePromptLogs(logs);

    expect(result.total_calls).toBe(2);
    expect(result.total_tokens).toBe(300);
    expect(result.unique_sessions).toBe(1);
  });

  it('groups by concept correctly', () => {
    const logs: PromptLogEntry[] = [
      {
        timestamp: '2026-01-30T10:00:00Z',
        session_id: 'sess1',
        tool: 'Task',
        concept: 'story',
        action: 'create',
        model: 'sonnet',
        input_chars: 400,
        estimated_tokens: 100,
      },
      {
        timestamp: '2026-01-30T10:05:00Z',
        session_id: 'sess1',
        tool: 'Task',
        concept: 'story',
        action: 'clarify',
        model: 'sonnet',
        input_chars: 200,
        estimated_tokens: 50,
      },
      {
        timestamp: '2026-01-30T10:10:00Z',
        session_id: 'sess1',
        tool: 'Task',
        concept: 'architecture',
        action: 'design',
        model: 'opus',
        input_chars: 800,
        estimated_tokens: 200,
      },
    ];

    const result = analyzePromptLogs(logs);

    expect(result.by_concept).toHaveLength(2);

    const archStats = result.by_concept.find((c) => c.concept === 'architecture');
    expect(archStats).toBeDefined();
    expect(archStats!.calls).toBe(1);
    expect(archStats!.tokens).toBe(200);

    const storyStats = result.by_concept.find((c) => c.concept === 'story');
    expect(storyStats).toBeDefined();
    expect(storyStats!.calls).toBe(2);
    expect(storyStats!.tokens).toBe(150);
  });

  it('groups by model correctly', () => {
    const logs: PromptLogEntry[] = [
      {
        timestamp: '2026-01-30T10:00:00Z',
        session_id: 'sess1',
        tool: 'Task',
        concept: 'story',
        action: 'create',
        model: 'sonnet',
        input_chars: 400,
        estimated_tokens: 100,
      },
      {
        timestamp: '2026-01-30T10:05:00Z',
        session_id: 'sess1',
        tool: 'Task',
        concept: 'architecture',
        action: 'design',
        model: 'opus',
        input_chars: 800,
        estimated_tokens: 200,
      },
    ];

    const result = analyzePromptLogs(logs);

    expect(result.by_model).toEqual({
      sonnet: 100,
      opus: 200,
    });
  });

  it('counts unique sessions', () => {
    const logs: PromptLogEntry[] = [
      {
        timestamp: '2026-01-30T10:00:00Z',
        session_id: 'sess1',
        tool: 'Task',
        concept: 'story',
        action: 'create',
        model: 'sonnet',
        input_chars: 400,
        estimated_tokens: 100,
      },
      {
        timestamp: '2026-01-30T10:05:00Z',
        session_id: 'sess2',
        tool: 'Task',
        concept: 'architecture',
        action: 'design',
        model: 'opus',
        input_chars: 800,
        estimated_tokens: 200,
      },
      {
        timestamp: '2026-01-30T10:10:00Z',
        session_id: 'sess1',
        tool: 'Task',
        concept: 'implementation',
        action: 'generate',
        model: 'sonnet',
        input_chars: 600,
        estimated_tokens: 150,
      },
    ];

    const result = analyzePromptLogs(logs);

    expect(result.unique_sessions).toBe(2);
  });
});

describe('filterLogs', () => {
  const logs: PromptLogEntry[] = [
    {
      timestamp: '2026-01-28T10:00:00Z',
      session_id: 'sess1',
      tool: 'Task',
      concept: 'story',
      action: 'create',
      model: 'sonnet',
      input_chars: 400,
      estimated_tokens: 100,
    },
    {
      timestamp: '2026-01-30T10:00:00Z',
      session_id: 'sess1',
      tool: 'Task',
      concept: 'architecture',
      action: 'design',
      model: 'opus',
      input_chars: 800,
      estimated_tokens: 200,
    },
  ];

  it('filters by concept', () => {
    const filtered = filterLogs(logs, { concept: 'story' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].concept).toBe('story');
  });

  it('filters by date range', () => {
    const filtered = filterLogs(logs, {
      from: new Date('2026-01-29T00:00:00Z'),
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].concept).toBe('architecture');
  });

  it('returns all when no filters', () => {
    const filtered = filterLogs(logs, {});
    expect(filtered).toHaveLength(2);
  });
});

describe('parseRelativeDate', () => {
  it('parses days', () => {
    const now = Date.now();
    const result = parseRelativeDate('7d');
    const expected = now - 7 * 24 * 60 * 60 * 1000;

    // Allow 1 second tolerance
    expect(Math.abs(result.getTime() - expected)).toBeLessThan(1000);
  });

  it('parses weeks', () => {
    const now = Date.now();
    const result = parseRelativeDate('1w');
    const expected = now - 7 * 24 * 60 * 60 * 1000;

    expect(Math.abs(result.getTime() - expected)).toBeLessThan(1000);
  });

  it('parses ISO date', () => {
    const result = parseRelativeDate('2026-01-30T12:00:00Z');
    expect(result.getUTCFullYear()).toBe(2026);
    expect(result.getUTCMonth()).toBe(0); // January
    expect(result.getUTCDate()).toBe(30);
  });

  it('throws on invalid format', () => {
    expect(() => parseRelativeDate('invalid')).toThrow();
  });
});
