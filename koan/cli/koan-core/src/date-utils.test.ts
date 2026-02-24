/**
 * Tests for date-utils module.
 */

import { describe, it, expect } from 'vitest';
import { parseRelativeDate, formatDuration, type RelativeUnit } from './date-utils.js';

describe('parseRelativeDate', () => {
  const baseDate = new Date('2026-01-30T12:00:00Z');

  it('should parse relative days', () => {
    const result = parseRelativeDate('7d', baseDate);
    expect(result.toISOString()).toBe('2026-01-23T12:00:00.000Z');
  });

  it('should parse relative weeks', () => {
    const result = parseRelativeDate('2w', baseDate);
    expect(result.toISOString()).toBe('2026-01-16T12:00:00.000Z');
  });

  it('should parse relative months', () => {
    const result = parseRelativeDate('1m', baseDate);
    expect(result.toISOString()).toBe('2025-12-30T12:00:00.000Z');
  });

  it('should parse relative years', () => {
    const result = parseRelativeDate('1y', baseDate);
    expect(result.toISOString()).toBe('2025-01-30T12:00:00.000Z');
  });

  it('should parse ISO date strings', () => {
    const result = parseRelativeDate('2026-01-15', baseDate);
    expect(result.toISOString().startsWith('2026-01-15')).toBe(true);
  });

  it('should parse ISO datetime strings', () => {
    const result = parseRelativeDate('2026-01-15T10:30:00Z', baseDate);
    expect(result.toISOString()).toBe('2026-01-15T10:30:00.000Z');
  });

  it('should throw error for invalid format', () => {
    expect(() => parseRelativeDate('invalid', baseDate)).toThrow(
      'Invalid date format: invalid'
    );
  });

  it('should throw error for invalid relative format', () => {
    expect(() => parseRelativeDate('7x', baseDate)).toThrow(
      'Invalid date format: 7x'
    );
  });

  it('should use current date as default baseDate', () => {
    const before = new Date();
    const result = parseRelativeDate('1d');
    const after = new Date();

    // Result should be approximately 1 day before now
    const dayAgo = new Date();
    dayAgo.setDate(dayAgo.getDate() - 1);

    expect(result.getTime()).toBeLessThanOrEqual(before.getTime());
    expect(result.getTime()).toBeGreaterThanOrEqual(after.getTime() - 24 * 60 * 60 * 1000);
  });

  it('should handle large relative values', () => {
    const result = parseRelativeDate('365d', baseDate);
    expect(result.toISOString()).toBe('2025-01-30T12:00:00.000Z');
  });

  it('should handle month edge cases', () => {
    const marchBase = new Date('2026-03-31T12:00:00Z');
    const result = parseRelativeDate('1m', marchBase);
    // Going back 1 month from March 31 will overflow to March 3 (Feb has 28 days)
    // This is expected JavaScript Date behavior: setMonth(2-1) on day 31 = Feb 31 = March 3
    expect(result.getMonth()).toBe(2); // March (0-indexed)
    expect(result.getDate()).toBe(3);
  });
});

describe('formatDuration', () => {
  it('should format milliseconds', () => {
    expect(formatDuration(150)).toBe('150ms');
    expect(formatDuration(999)).toBe('999ms');
  });

  it('should format seconds', () => {
    expect(formatDuration(1000)).toBe('1.0s');
    expect(formatDuration(2500)).toBe('2.5s');
    expect(formatDuration(59999)).toBe('60.0s');
  });

  it('should format minutes', () => {
    expect(formatDuration(60000)).toBe('1m');
    expect(formatDuration(90000)).toBe('1m 30s');
    expect(formatDuration(180000)).toBe('3m');
  });

  it('should handle zero', () => {
    expect(formatDuration(0)).toBe('0ms');
  });

  it('should handle large durations', () => {
    expect(formatDuration(3600000)).toBe('1.0h'); // 1 hour
  });

  it('should round to one decimal place', () => {
    expect(formatDuration(1234)).toBe('1.2s');
    expect(formatDuration(123456)).toBe('2m 3s');
  });
});
