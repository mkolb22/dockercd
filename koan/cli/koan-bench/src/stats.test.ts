import { describe, it, expect } from 'vitest';
import { mean, median, percentile, stddev } from './stats.js';

describe('stats', () => {
  describe('mean', () => {
    it('should return 0 for empty array', () => {
      expect(mean([])).toBe(0);
    });

    it('should calculate mean of single value', () => {
      expect(mean([5])).toBe(5);
    });

    it('should calculate mean of multiple values', () => {
      expect(mean([1, 2, 3, 4, 5])).toBe(3);
    });

    it('should handle decimals', () => {
      expect(mean([1.5, 2.5, 3.5])).toBeCloseTo(2.5);
    });
  });

  describe('median', () => {
    it('should return 0 for empty array', () => {
      expect(median([])).toBe(0);
    });

    it('should return single value', () => {
      expect(median([5])).toBe(5);
    });

    it('should calculate median for odd length array', () => {
      expect(median([1, 3, 5])).toBe(3);
    });

    it('should calculate median for even length array', () => {
      expect(median([1, 2, 3, 4])).toBe(2.5);
    });

    it('should handle unsorted arrays', () => {
      expect(median([5, 1, 3])).toBe(3);
    });
  });

  describe('percentile', () => {
    it('should return 0 for empty array', () => {
      expect(percentile([], 50)).toBe(0);
    });

    it('should return single value', () => {
      expect(percentile([5], 50)).toBe(5);
    });

    it('should calculate p50 (median)', () => {
      expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
    });

    it('should calculate p90', () => {
      const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      expect(percentile(values, 90)).toBeCloseTo(9.1);
    });

    it('should calculate p99', () => {
      const values = Array.from({ length: 100 }, (_, i) => i + 1);
      expect(percentile(values, 99)).toBeCloseTo(99.01);
    });

    it('should interpolate between values', () => {
      expect(percentile([1, 2, 3, 4], 75)).toBe(3.25);
    });
  });

  describe('stddev', () => {
    it('should return 0 for empty array', () => {
      expect(stddev([])).toBe(0);
    });

    it('should return 0 for single value', () => {
      expect(stddev([5])).toBe(0);
    });

    it('should calculate standard deviation', () => {
      expect(stddev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.0);
    });

    it('should handle uniform values', () => {
      expect(stddev([5, 5, 5, 5])).toBe(0);
    });
  });
});
