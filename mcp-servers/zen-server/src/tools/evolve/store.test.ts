/**
 * EvolveStore Tests
 * Tests for evolution session and variant CRUD operations
 */

import { describe, it, expect } from 'vitest';
import { EvolveStore } from './store.js';
import { useStoreHarness } from '../../test-utils/store-harness.js';
import type { EvolutionConfig, TestCase } from './types.js';

const TEST_CONFIG: EvolutionConfig = {
  populationSize: 5,
  maxGenerations: 10,
  mutationRate: 0.7,
};

const TEST_CASES: TestCase[] = [
  { input: 'Summarize this text', expected: 'A concise summary' },
  { input: 'Translate to French', expected: 'French translation' },
];

describe('EvolveStore', () => {
  const t = useStoreHarness('evolve', (p) => new EvolveStore(p));

  describe('createSession', () => {
    it('should create a session with valid fields', () => {
      const session = t.store.createSession('code-review', 'Review this code', TEST_CASES, TEST_CONFIG);

      expect(session.id).toMatch(/^evo-/);
      expect(session.conceptName).toBe('code-review');
      expect(session.initialPrompt).toBe('Review this code');
      expect(session.status).toBe('active');
      expect(session.currentGeneration).toBe(0);
      expect(session.bestFitness).toBe(0);
      expect(session.bestVariantId).toBeNull();
      expect(session.testCases).toHaveLength(2);
      expect(session.config.populationSize).toBe(5);
    });

    it('should preserve test cases and config through serialization', () => {
      const session = t.store.createSession('prompt-opt', 'Optimize', TEST_CASES, TEST_CONFIG);
      const retrieved = t.store.getSession(session.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.testCases).toEqual(TEST_CASES);
      expect(retrieved!.config).toEqual(TEST_CONFIG);
    });
  });

  describe('getSession', () => {
    it('should retrieve a session by ID', () => {
      const created = t.store.createSession('test', 'Test prompt', TEST_CASES, TEST_CONFIG);
      const retrieved = t.store.getSession(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(created.id);
      expect(retrieved!.conceptName).toBe('test');
      expect(retrieved!.initialPrompt).toBe('Test prompt');
    });

    it('should return null for missing session', () => {
      const result = t.store.getSession('evo-nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('updateSession', () => {
    it('should update currentGeneration', () => {
      const session = t.store.createSession('test', 'prompt', TEST_CASES, TEST_CONFIG);
      t.store.updateSession(session.id, { currentGeneration: 3 });

      const updated = t.store.getSession(session.id);
      expect(updated!.currentGeneration).toBe(3);
    });

    it('should update status', () => {
      const session = t.store.createSession('test', 'prompt', TEST_CASES, TEST_CONFIG);
      t.store.updateSession(session.id, { status: 'converged' });

      const updated = t.store.getSession(session.id);
      expect(updated!.status).toBe('converged');
    });

    it('should update bestFitness and bestVariantId', () => {
      const session = t.store.createSession('test', 'prompt', TEST_CASES, TEST_CONFIG);
      t.store.updateSession(session.id, { bestFitness: 0.95, bestVariantId: 'var-123' });

      const updated = t.store.getSession(session.id);
      expect(updated!.bestFitness).toBe(0.95);
      expect(updated!.bestVariantId).toBe('var-123');
    });

    it('should set updatedAt on update', () => {
      const session = t.store.createSession('test', 'prompt', TEST_CASES, TEST_CONFIG);
      t.store.updateSession(session.id, { currentGeneration: 1 });

      const updated = t.store.getSession(session.id);
      // updatedAt should be a valid ISO timestamp
      expect(updated!.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('insertVariants', () => {
    it('should batch insert variants and return them', () => {
      const session = t.store.createSession('test', 'prompt', TEST_CASES, TEST_CONFIG);
      const variants = t.store.insertVariants(session.id, 1, [
        { prompt: 'Variant A', fitnessScore: 0.8, notes: 'Good clarity' },
        { prompt: 'Variant B', fitnessScore: 0.6 },
        { prompt: 'Variant C', fitnessScore: 0.9, parentId: 'parent-1' },
      ]);

      expect(variants).toHaveLength(3);
      expect(variants[0].id).toMatch(/^var-/);
      expect(variants[0].prompt).toBe('Variant A');
      expect(variants[0].fitnessScore).toBe(0.8);
      expect(variants[0].notes).toBe('Good clarity');
      expect(variants[1].notes).toBeNull();
      expect(variants[2].parentId).toBe('parent-1');
    });
  });

  describe('getVariants', () => {
    it('should return all variants for a session', () => {
      const session = t.store.createSession('test', 'prompt', TEST_CASES, TEST_CONFIG);
      t.store.insertVariants(session.id, 0, [
        { prompt: 'Gen0-A', fitnessScore: 0.5 },
        { prompt: 'Gen0-B', fitnessScore: 0.7 },
      ]);
      t.store.insertVariants(session.id, 1, [
        { prompt: 'Gen1-A', fitnessScore: 0.8 },
      ]);

      const all = t.store.getVariants(session.id);
      expect(all).toHaveLength(3);
    });

    it('should filter variants by generation', () => {
      const session = t.store.createSession('test', 'prompt', TEST_CASES, TEST_CONFIG);
      t.store.insertVariants(session.id, 0, [
        { prompt: 'Gen0', fitnessScore: 0.5 },
      ]);
      t.store.insertVariants(session.id, 1, [
        { prompt: 'Gen1-A', fitnessScore: 0.8 },
        { prompt: 'Gen1-B', fitnessScore: 0.6 },
      ]);

      const gen1 = t.store.getVariants(session.id, 1);
      expect(gen1).toHaveLength(2);
      // Should be sorted by fitness DESC
      expect(gen1[0].fitnessScore).toBe(0.8);
    });
  });

  describe('getBestVariant', () => {
    it('should return the highest-fitness variant', () => {
      const session = t.store.createSession('test', 'prompt', TEST_CASES, TEST_CONFIG);
      t.store.insertVariants(session.id, 0, [
        { prompt: 'Low', fitnessScore: 0.3 },
        { prompt: 'High', fitnessScore: 0.95 },
        { prompt: 'Mid', fitnessScore: 0.6 },
      ]);

      const best = t.store.getBestVariant(session.id);
      expect(best).not.toBeNull();
      expect(best!.prompt).toBe('High');
      expect(best!.fitnessScore).toBe(0.95);
    });

    it('should return null for session with no variants', () => {
      const session = t.store.createSession('test', 'prompt', TEST_CASES, TEST_CONFIG);
      const best = t.store.getBestVariant(session.id);
      expect(best).toBeNull();
    });
  });

  describe('getVariantCount', () => {
    it('should return correct count', () => {
      const session = t.store.createSession('test', 'prompt', TEST_CASES, TEST_CONFIG);
      expect(t.store.getVariantCount(session.id)).toBe(0);

      t.store.insertVariants(session.id, 0, [
        { prompt: 'A', fitnessScore: 0.5 },
        { prompt: 'B', fitnessScore: 0.6 },
      ]);
      expect(t.store.getVariantCount(session.id)).toBe(2);

      t.store.insertVariants(session.id, 1, [
        { prompt: 'C', fitnessScore: 0.7 },
      ]);
      expect(t.store.getVariantCount(session.id)).toBe(3);
    });
  });
});
