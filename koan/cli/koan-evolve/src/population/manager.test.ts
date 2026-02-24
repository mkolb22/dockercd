/**
 * Tests for Population Manager
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  initializePopulation,
  selectVariant,
  checkPromotion,
  archiveVariant,
  getNextVariantId,
  saveVariant,
  type Population,
} from './manager.js';
import type { FitnessState } from '../types.js';

describe('Population Manager', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'koan-evolve-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should initialize population with baseline variant', async () => {
    const population = await initializePopulation(tempDir, 'story');

    expect(population.concept).toBe('story');
    expect(population.metadata.current_default).toBe('variant-00');
    expect(population.metadata.variants).toHaveLength(1);
    expect(population.metadata.variants[0].variant_id).toBe('variant-00');
  });

  it('should select default variant when no fitness data exists', async () => {
    const population = await initializePopulation(tempDir, 'story');

    // Add a variant manually
    population.variants.push({
      variant_id: 'variant-00',
      created_at: new Date().toISOString(),
      fitness_at_creation: null,
      status: 'active',
      checksum: 'abc123',
      content: '# Test Variant',
    });

    const selected = selectVariant(population);
    expect(selected.variant_id).toBe('variant-00');
  });

  it('should select variant using fitness-weighted probability', async () => {
    const population: Population = {
      concept: 'story',
      variants: [
        {
          variant_id: 'variant-00',
          created_at: new Date().toISOString(),
          fitness_at_creation: null,
          status: 'active',
          checksum: 'abc',
          content: 'V0',
        },
        {
          variant_id: 'variant-01',
          created_at: new Date().toISOString(),
          fitness_at_creation: null,
          status: 'active',
          checksum: 'def',
          content: 'V1',
        },
      ],
      metadata: {
        variants: [
          { variant_id: 'variant-00', created_at: new Date().toISOString(), status: 'active' },
          { variant_id: 'variant-01', created_at: new Date().toISOString(), status: 'active' },
        ],
        current_default: 'variant-00',
      },
      fitnessState: {
        concept: 'story',
        current_variant: 'variant-00',
        variants: [
          {
            variant_id: 'variant-00',
            runs: 20,
            fitness: { current: 0.7, rolling_avg_10: 0.69, trend: 'stable' },
            metrics: { test_pass_rate: 0.8, quality_score: 0.65, user_acceptance: 0.65 },
            history: [],
          },
          {
            variant_id: 'variant-01',
            runs: 15,
            fitness: { current: 0.9, rolling_avg_10: 0.88, trend: 'improving' },
            metrics: { test_pass_rate: 0.95, quality_score: 0.88, user_acceptance: 0.87 },
            history: [],
          },
        ],
        promotion_threshold: 0.1,
        minimum_runs: 10,
        metadata: { last_updated: new Date().toISOString(), checksum: 'xyz' },
      },
    };

    // Run selection multiple times to check probability distribution
    const selections = new Map<string, number>();
    for (let i = 0; i < 100; i++) {
      const selected = selectVariant(population);
      selections.set(selected.variant_id, (selections.get(selected.variant_id) || 0) + 1);
    }

    // Variant-01 should be selected more often due to higher fitness (0.9 vs 0.7)
    const v01Count = selections.get('variant-01') || 0;
    expect(v01Count).toBeGreaterThan(50); // Should be > 50% due to higher fitness
  });

  it('should detect promotion when challenger exceeds threshold', () => {
    const population: Population = {
      concept: 'story',
      variants: [],
      metadata: {
        variants: [],
        current_default: 'variant-00',
      },
      fitnessState: {
        concept: 'story',
        current_variant: 'variant-00',
        variants: [
          {
            variant_id: 'variant-00',
            runs: 20,
            fitness: { current: 0.7, rolling_avg_10: 0.69, trend: 'stable' },
            metrics: { test_pass_rate: 0.8, quality_score: 0.65, user_acceptance: 0.65 },
            history: [],
          },
          {
            variant_id: 'variant-01',
            runs: 15,
            fitness: { current: 0.85, rolling_avg_10: 0.84, trend: 'improving' },
            metrics: { test_pass_rate: 0.92, quality_score: 0.80, user_acceptance: 0.83 },
            history: [],
          },
        ],
        promotion_threshold: 0.1,
        minimum_runs: 10,
        metadata: { last_updated: new Date().toISOString(), checksum: 'xyz' },
      },
    };

    const result = checkPromotion(population);

    expect(result.promoted).toBe(true);
    expect(result.variant_id).toBe('variant-01');
    expect(result.old_default).toBe('variant-00');
    expect(result.new_default).toBe('variant-01');
  });

  it('should not promote if improvement below threshold', () => {
    const population: Population = {
      concept: 'story',
      variants: [],
      metadata: {
        variants: [],
        current_default: 'variant-00',
      },
      fitnessState: {
        concept: 'story',
        current_variant: 'variant-00',
        variants: [
          {
            variant_id: 'variant-00',
            runs: 20,
            fitness: { current: 0.75, rolling_avg_10: 0.74, trend: 'stable' },
            metrics: { test_pass_rate: 0.85, quality_score: 0.70, user_acceptance: 0.70 },
            history: [],
          },
          {
            variant_id: 'variant-01',
            runs: 15,
            fitness: { current: 0.78, rolling_avg_10: 0.77, trend: 'stable' },
            metrics: { test_pass_rate: 0.87, quality_score: 0.72, user_acceptance: 0.73 },
            history: [],
          },
        ],
        promotion_threshold: 0.1,
        minimum_runs: 10,
        metadata: { last_updated: new Date().toISOString(), checksum: 'xyz' },
      },
    };

    const result = checkPromotion(population);

    expect(result.promoted).toBe(false);
    expect(result.reason).toContain('not consistent enough');
  });

  it('should archive variant with metadata', async () => {
    const population: Population = {
      concept: 'story',
      variants: [
        {
          variant_id: 'variant-02',
          created_at: new Date().toISOString(),
          fitness_at_creation: 0.65,
          status: 'active',
          checksum: 'abc',
          content: '# Old Variant\nThis variant is being retired.',
        },
      ],
      metadata: {
        variants: [
          { variant_id: 'variant-02', created_at: new Date().toISOString(), status: 'active' },
        ],
        current_default: 'variant-00',
      },
      fitnessState: {
        concept: 'story',
        current_variant: 'variant-00',
        variants: [
          {
            variant_id: 'variant-02',
            runs: 25,
            fitness: { current: 0.55, rolling_avg_10: 0.54, trend: 'degrading' },
            metrics: { test_pass_rate: 0.60, quality_score: 0.50, user_acceptance: 0.55 },
            history: [],
          },
        ],
        promotion_threshold: 0.1,
        minimum_runs: 10,
        metadata: { last_updated: new Date().toISOString(), checksum: 'xyz' },
      },
    };

    await archiveVariant(tempDir, population, 'variant-02', 'Low fitness for 10+ runs');

    const archivePath = path.join(tempDir, 'koan', 'evolution', 'archive', 'story-variant-02.md');
    const archived = await fs.readFile(archivePath, 'utf-8');

    expect(archived).toContain('variant-02');
    expect(archived).toContain('Low fitness for 10+ runs');
    expect(archived).toContain('final_fitness: 0.55');
    expect(archived).toContain('# Old Variant');
  });

  it('should get next variant ID correctly', async () => {
    const population = await initializePopulation(tempDir, 'story');

    // Add some variants
    population.metadata.variants.push(
      { variant_id: 'variant-01', created_at: new Date().toISOString(), status: 'active' },
      { variant_id: 'variant-02', created_at: new Date().toISOString(), status: 'active' }
    );

    const nextId = getNextVariantId(population);
    expect(nextId).toBe('variant-03');
  });

  it('should save variant with frontmatter', async () => {
    const variant = {
      variant_id: 'variant-01',
      parent: 'variant-00',
      created_at: new Date().toISOString(),
      mutation_type: 'targeted' as const,
      mutation_focus: 'improve clarity',
      fitness_at_creation: null,
      status: 'active' as const,
      checksum: 'abc123',
      content: '# Improved Variant\nThis is better.',
    };

    await saveVariant(tempDir, 'story', variant);

    const variantPath = path.join(tempDir, '.claude', 'prompts', 'story', 'variant-01.md');
    const content = await fs.readFile(variantPath, 'utf-8');

    expect(content).toContain('---');
    expect(content).toContain('variant_id: variant-01');
    expect(content).toContain('parent: variant-00');
    expect(content).toContain('mutation_focus: improve clarity');
    expect(content).toContain('# Improved Variant');
  });
});
