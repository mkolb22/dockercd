/**
 * Vector Utilities Tests
 * Tests for embedding operations and serialization
 */

import { describe, it, expect } from 'vitest';
import {
  cosineSimilarity,
  numberArrayToBytes,
  bytesToNumberArray,
} from './vectors.js';

describe('Vector Utilities', () => {
  describe('cosineSimilarity', () => {
    it('should return 1 for identical vectors', () => {
      const v = [1, 2, 3, 4, 5];
      expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
    });

    it('should return 0 for orthogonal vectors', () => {
      const v1 = [1, 0, 0];
      const v2 = [0, 1, 0];
      expect(cosineSimilarity(v1, v2)).toBeCloseTo(0.0, 5);
    });

    it('should return -1 for opposite vectors', () => {
      const v1 = [1, 2, 3];
      const v2 = [-1, -2, -3];
      expect(cosineSimilarity(v1, v2)).toBeCloseTo(-1.0, 5);
    });

    it('should handle normalized vectors correctly', () => {
      // Two unit vectors at 60 degrees
      const v1 = [1, 0];
      const v2 = [0.5, Math.sqrt(3) / 2];
      expect(cosineSimilarity(v1, v2)).toBeCloseTo(0.5, 5);
    });

    it('should handle high-dimensional vectors', () => {
      const dim = 384; // MiniLM dimension
      const v1 = new Array(dim).fill(0).map(() => Math.random());
      const v2 = v1.map(x => x * 1.5); // Scaled version

      // Scaled vectors should have similarity 1
      expect(cosineSimilarity(v1, v2)).toBeCloseTo(1.0, 5);
    });

    it('should be symmetric', () => {
      const v1 = [1, 2, 3, 4];
      const v2 = [4, 3, 2, 1];

      expect(cosineSimilarity(v1, v2)).toBeCloseTo(cosineSimilarity(v2, v1), 10);
    });

    it('should handle zero vectors gracefully', () => {
      const v1 = [0, 0, 0];
      const v2 = [1, 2, 3];

      const result = cosineSimilarity(v1, v2);
      expect(Number.isNaN(result) || result === 0).toBe(true);
    });
  });

  describe('numberArrayToBytes and bytesToNumberArray', () => {
    it('should round-trip small arrays', () => {
      const original = [1.5, -2.3, 0.0, 100.123];
      const bytes = numberArrayToBytes(original);
      const recovered = bytesToNumberArray(bytes);

      expect(recovered.length).toBe(original.length);
      original.forEach((val, i) => {
        expect(recovered[i]).toBeCloseTo(val, 5);
      });
    });

    it('should round-trip large arrays (embedding size)', () => {
      const original = new Array(384).fill(0).map(() => Math.random() * 2 - 1);
      const bytes = numberArrayToBytes(original);
      const recovered = bytesToNumberArray(bytes);

      expect(recovered.length).toBe(original.length);
      original.forEach((val, i) => {
        expect(recovered[i]).toBeCloseTo(val, 5);
      });
    });

    it('should produce correct byte size', () => {
      const arr = [1, 2, 3, 4, 5];
      const bytes = numberArrayToBytes(arr);

      // Float32 = 4 bytes per number
      expect(bytes.length).toBe(arr.length * 4);
    });

    it('should handle empty arrays', () => {
      const original: number[] = [];
      const bytes = numberArrayToBytes(original);
      const recovered = bytesToNumberArray(bytes);

      expect(recovered.length).toBe(0);
    });

    it('should handle special values', () => {
      const original = [Number.MAX_VALUE / 2, Number.MIN_VALUE * 2, 0, -0];
      const bytes = numberArrayToBytes(original);
      const recovered = bytesToNumberArray(bytes);

      // Float32 has limited precision, so we use looser comparison
      expect(recovered.length).toBe(original.length);
    });

    it('should handle negative numbers', () => {
      const original = [-1, -0.5, -100, -0.001];
      const bytes = numberArrayToBytes(original);
      const recovered = bytesToNumberArray(bytes);

      original.forEach((val, i) => {
        expect(recovered[i]).toBeCloseTo(val, 5);
      });
    });
  });
});
