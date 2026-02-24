/**
 * Evolution Algorithm Tests
 * Pure function tests — no DB needed
 */

import { describe, it, expect } from 'vitest';
import {
  tournamentSelect,
  getElites,
  checkConvergence,
  buildMutationInstructions,
} from './algorithm.js';
import type { EvolutionVariant } from './types.js';

function makeVariant(overrides: Partial<EvolutionVariant> = {}): EvolutionVariant {
  return {
    id: `var-${Math.random().toString(36).slice(2, 6)}`,
    sessionId: 'evo-test',
    generation: 0,
    prompt: 'Test prompt',
    fitnessScore: 0.5,
    notes: null,
    parentId: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('tournamentSelect', () => {
  it('should return the requested number of parents', () => {
    const variants = Array.from({ length: 10 }, (_, i) =>
      makeVariant({ fitnessScore: i * 0.1 }),
    );

    const parents = tournamentSelect(variants, 3);
    expect(parents).toHaveLength(3);
  });

  it('should return variants from the input pool', () => {
    const variants = [
      makeVariant({ prompt: 'A', fitnessScore: 0.9 }),
      makeVariant({ prompt: 'B', fitnessScore: 0.1 }),
      makeVariant({ prompt: 'C', fitnessScore: 0.5 }),
    ];

    const parents = tournamentSelect(variants, 2, 2);
    for (const p of parents) {
      expect(['A', 'B', 'C']).toContain(p.prompt);
    }
  });

  it('should bias toward higher-fitness variants', () => {
    const high = makeVariant({ prompt: 'high', fitnessScore: 1.0 });
    const low = makeVariant({ prompt: 'low', fitnessScore: 0.0 });
    const variants = [high, low, low, low]; // 3:1 ratio of low:high

    // With tournament k=3 from 4 variants (3 low, 1 high), the high should still win often
    const parents = tournamentSelect(variants, 50, 3);
    const highCount = parents.filter((p) => p.prompt === 'high').length;
    // High should appear more often than pure random (12.5 out of 50 = 25%)
    expect(highCount).toBeGreaterThan(15);
  });
});

describe('getElites', () => {
  it('should return top N variants sorted by fitness descending', () => {
    const variants = [
      makeVariant({ prompt: 'low', fitnessScore: 0.2 }),
      makeVariant({ prompt: 'high', fitnessScore: 0.9 }),
      makeVariant({ prompt: 'mid', fitnessScore: 0.5 }),
      makeVariant({ prompt: 'very-high', fitnessScore: 0.95 }),
    ];

    const elites = getElites(variants, 2);
    expect(elites).toHaveLength(2);
    expect(elites[0].prompt).toBe('very-high');
    expect(elites[1].prompt).toBe('high');
  });

  it('should handle count larger than variants', () => {
    const variants = [makeVariant({ fitnessScore: 0.5 })];
    const elites = getElites(variants, 5);
    expect(elites).toHaveLength(1);
  });

  it('should not mutate the original array', () => {
    const variants = [
      makeVariant({ fitnessScore: 0.1 }),
      makeVariant({ fitnessScore: 0.9 }),
    ];
    const originalFirst = variants[0];
    getElites(variants, 1);
    expect(variants[0]).toBe(originalFirst);
  });

  it('should handle null fitness scores as 0', () => {
    const variants = [
      makeVariant({ fitnessScore: null }),
      makeVariant({ fitnessScore: 0.5 }),
    ];

    const elites = getElites(variants, 1);
    expect(elites[0].fitnessScore).toBe(0.5);
  });
});

describe('checkConvergence', () => {
  it('should return false when history is too short', () => {
    expect(checkConvergence([0.5, 0.6])).toBe(false);
    expect(checkConvergence([0.5, 0.6, 0.7])).toBe(false);
  });

  it('should return true when fitness stagnates', () => {
    // window=3: need at least 4 entries
    // baseline = history[-4] = 0.8
    // recent 3 all <= 0.8 + 0.01
    const history = [0.5, 0.6, 0.7, 0.8, 0.8, 0.8, 0.8];
    expect(checkConvergence(history)).toBe(true);
  });

  it('should return false when fitness is still improving', () => {
    const history = [0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95];
    expect(checkConvergence(history)).toBe(false);
  });

  it('should respect custom window and threshold', () => {
    // window=2, threshold=0.05
    // baseline = history[-3] = 0.8
    // recent 2: [0.81, 0.82] — both < 0.8 + 0.05 = 0.85
    const history = [0.5, 0.7, 0.8, 0.81, 0.82];
    expect(checkConvergence(history, 2, 0.05)).toBe(true);
  });

  it('should return false when one recent value shows improvement', () => {
    // baseline = 0.8, one recent value exceeds threshold
    const history = [0.5, 0.7, 0.8, 0.8, 0.8, 0.82];
    expect(checkConvergence(history, 3, 0.01)).toBe(false);
  });
});

describe('buildMutationInstructions', () => {
  it('should include concept name in instructions', () => {
    const parents = [makeVariant({ prompt: 'Parent A', fitnessScore: 0.8 })];
    const result = buildMutationInstructions(parents, 'code-review', 5);
    expect(result.instructions).toContain('code-review');
  });

  it('should include parent fitness info', () => {
    const parents = [
      makeVariant({ prompt: 'Parent A', fitnessScore: 0.8, notes: 'Too verbose' }),
      makeVariant({ prompt: 'Parent B', fitnessScore: 0.6 }),
    ];
    const result = buildMutationInstructions(parents, 'summarizer', 3);

    expect(result.parents).toHaveLength(2);
    expect(result.parents[0].fitness).toBe(0.8);
    expect(result.parents[0].weaknesses).toBe('Too verbose');
    expect(result.parents[1].weaknesses).toBe('No specific weaknesses noted');
    expect(result.instructions).toContain('0.80');
    expect(result.instructions).toContain('Too verbose');
  });

  it('should mention population size', () => {
    const parents = [makeVariant({ fitnessScore: 0.5 })];
    const result = buildMutationInstructions(parents, 'test', 7);
    expect(result.instructions).toContain('7');
  });
});
