/**
 * Population Manager: Manages prompt variant populations with fitness-based selection.
 * Phase 5.2: Prompt Population
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import yaml from 'js-yaml';
import type { Concept } from '@zen/koan-core';
import type { FitnessState } from '../types.js';
import { loadFitnessState } from '../fitness/loader.js';

export interface PromptVariant {
  variant_id: string;
  parent?: string;
  created_at: string;
  mutation_type?: 'targeted' | 'crossover';
  mutation_focus?: string;
  fitness_at_creation: number | null;
  status: 'active' | 'archived' | 'quarantined';
  checksum: string;
  content: string;
}

export interface VariantMetadata {
  variants: {
    variant_id: string;
    parent?: string;
    created_at: string;
    mutation_type?: 'targeted' | 'crossover';
    parents?: string[]; // For crossover
    status: 'active' | 'archived' | 'quarantined';
  }[];
  current_default: string;
}

export interface Population {
  concept: Concept;
  variants: PromptVariant[];
  metadata: VariantMetadata;
  fitnessState: FitnessState | null;
}

export interface PromotionResult {
  promoted: boolean;
  variant_id?: string;
  reason: string;
  old_default?: string;
  new_default?: string;
}

/**
 * Initialize population for a concept
 */
export async function initializePopulation(
  projectRoot: string,
  concept: Concept
): Promise<Population> {
  const promptsDir = path.join(projectRoot, '.claude', 'prompts', concept);
  await fs.mkdir(promptsDir, { recursive: true });

  // Load metadata if exists
  const metadataPath = path.join(promptsDir, 'metadata.yaml');
  let metadata: VariantMetadata;

  try {
    const content = await fs.readFile(metadataPath, 'utf-8');
    metadata = yaml.load(content) as VariantMetadata;
  } catch (error) {
    // Initialize with baseline variant
    metadata = {
      variants: [
        {
          variant_id: 'variant-00',
          created_at: new Date().toISOString(),
          status: 'active',
        },
      ],
      current_default: 'variant-00',
    };
  }

  // Load all variants
  const variants: PromptVariant[] = [];
  for (const variantMeta of metadata.variants) {
    const variantPath = path.join(promptsDir, `${variantMeta.variant_id}.md`);
    try {
      const content = await fs.readFile(variantPath, 'utf-8');
      const { frontmatter, body } = parseFrontmatter(content);

      variants.push({
        variant_id: variantMeta.variant_id,
        parent: frontmatter.parent || variantMeta.parent,
        created_at: frontmatter.created_at || variantMeta.created_at,
        mutation_type: frontmatter.mutation_type,
        mutation_focus: frontmatter.mutation_focus,
        fitness_at_creation: frontmatter.fitness_at_creation || null,
        status: variantMeta.status,
        checksum: frontmatter.checksum || '',
        content: body,
      });
    } catch (error) {
      // Variant file missing, skip
      console.warn(`Warning: Variant file not found: ${variantPath}`);
    }
  }

  // Load fitness state
  const fitnessState = await loadFitnessState(projectRoot, concept);

  return {
    concept,
    variants,
    metadata,
    fitnessState,
  };
}

/**
 * Select a variant using fitness-weighted random selection (roulette wheel)
 */
export function selectVariant(population: Population): PromptVariant {
  // If no fitness data, return default variant
  if (!population.fitnessState) {
    const defaultVariant = population.variants.find(
      v => v.variant_id === population.metadata.current_default
    );
    if (!defaultVariant) {
      throw new Error('No default variant found');
    }
    return defaultVariant;
  }

  // Filter to active variants only
  const activeVariants = population.variants.filter(v => v.status === 'active');
  if (activeVariants.length === 0) {
    throw new Error('No active variants available');
  }

  // Build fitness mapping
  const fitnessMap = new Map<string, number>();
  for (const fitnessScore of population.fitnessState.variants) {
    fitnessMap.set(fitnessScore.variant_id, fitnessScore.fitness.current);
  }

  // Calculate total fitness (for roulette wheel)
  let totalFitness = 0;
  for (const variant of activeVariants) {
    const fitness = fitnessMap.get(variant.variant_id) || 0.5; // Default fitness
    totalFitness += fitness;
  }

  // Roulette wheel selection
  const spin = Math.random() * totalFitness;
  let accumulated = 0;

  for (const variant of activeVariants) {
    const fitness = fitnessMap.get(variant.variant_id) || 0.5;
    accumulated += fitness;
    if (spin <= accumulated) {
      return variant;
    }
  }

  // Fallback to last variant (should not happen)
  return activeVariants[activeVariants.length - 1];
}

/**
 * Check if promotion should occur based on fitness thresholds
 */
export function checkPromotion(population: Population): PromotionResult {
  if (!population.fitnessState) {
    return {
      promoted: false,
      reason: 'No fitness data available',
    };
  }

  const currentDefault = population.metadata.current_default;
  const threshold = population.fitnessState.promotion_threshold;
  const minimumRuns = population.fitnessState.minimum_runs;

  // Find current default fitness
  const defaultFitness = population.fitnessState.variants.find(
    v => v.variant_id === currentDefault
  );
  if (!defaultFitness) {
    return {
      promoted: false,
      reason: 'Current default variant has no fitness data',
    };
  }

  // Find best challenger (excluding current default)
  let bestChallenger: typeof population.fitnessState.variants[0] | null = null;
  for (const variant of population.fitnessState.variants) {
    if (variant.variant_id === currentDefault) continue;
    if (variant.runs < minimumRuns) continue;
    if (!bestChallenger || variant.fitness.current > bestChallenger.fitness.current) {
      bestChallenger = variant;
    }
  }

  if (!bestChallenger) {
    return {
      promoted: false,
      reason: 'No challenger variants with sufficient runs',
    };
  }

  // Check if challenger exceeds threshold
  const improvement = bestChallenger.fitness.current - defaultFitness.fitness.current;
  if (improvement > threshold) {
    // Check for 5 consecutive runs with improvement (using rolling average)
    const isConsistent = bestChallenger.fitness.trend === 'improving' ||
                        bestChallenger.fitness.trend === 'stable';

    if (isConsistent && bestChallenger.runs >= minimumRuns) {
      return {
        promoted: true,
        variant_id: bestChallenger.variant_id,
        reason: `Fitness improvement: +${(improvement * 100).toFixed(1)}% over ${minimumRuns} runs`,
        old_default: currentDefault,
        new_default: bestChallenger.variant_id,
      };
    }
  }

  return {
    promoted: false,
    reason: `Best challenger (${bestChallenger.variant_id}) not consistent enough`,
  };
}

/**
 * Archive a variant to koan/evolution/archive/
 */
export async function archiveVariant(
  projectRoot: string,
  population: Population,
  variantId: string,
  reason: string
): Promise<void> {
  const variant = population.variants.find(v => v.variant_id === variantId);
  if (!variant) {
    throw new Error(`Variant ${variantId} not found`);
  }

  // Create archive directory
  const archiveDir = path.join(projectRoot, 'koan', 'evolution', 'archive');
  await fs.mkdir(archiveDir, { recursive: true });

  // Find final fitness
  const finalFitness = population.fitnessState?.variants.find(
    v => v.variant_id === variantId
  );

  // Create archive file with metadata
  const archiveContent = `---
variant_id: ${variantId}
concept: ${population.concept}
archived_at: ${new Date().toISOString()}
archived_reason: ${reason}
final_fitness: ${finalFitness?.fitness.current || null}
final_runs: ${finalFitness?.runs || 0}
parent: ${variant.parent || null}
mutation_type: ${variant.mutation_type || null}
---

${variant.content}
`;

  const archivePath = path.join(archiveDir, `${population.concept}-${variantId}.md`);
  await fs.writeFile(archivePath, archiveContent, 'utf-8');

  // Update metadata to mark as archived
  const metadataDir = path.join(
    projectRoot,
    '.claude',
    'prompts',
    population.concept
  );
  await fs.mkdir(metadataDir, { recursive: true });

  const metadataPath = path.join(metadataDir, 'metadata.yaml');

  const variantIndex = population.metadata.variants.findIndex(
    v => v.variant_id === variantId
  );
  if (variantIndex >= 0) {
    population.metadata.variants[variantIndex].status = 'archived';
  }

  await fs.writeFile(metadataPath, yaml.dump(population.metadata), 'utf-8');
}

/**
 * Get next variant ID
 */
export function getNextVariantId(population: Population): string {
  const existingIds = population.metadata.variants.map(v => v.variant_id);
  let nextId = 1;

  while (existingIds.includes(`variant-${String(nextId).padStart(2, '0')}`)) {
    nextId++;
  }

  return `variant-${String(nextId).padStart(2, '0')}`;
}

/**
 * Save variant to disk
 */
export async function saveVariant(
  projectRoot: string,
  concept: Concept,
  variant: PromptVariant
): Promise<void> {
  const promptsDir = path.join(projectRoot, '.claude', 'prompts', concept);
  await fs.mkdir(promptsDir, { recursive: true });

  // Create frontmatter
  const frontmatter = {
    variant_id: variant.variant_id,
    parent: variant.parent,
    created_at: variant.created_at,
    mutation_type: variant.mutation_type,
    mutation_focus: variant.mutation_focus,
    fitness_at_creation: variant.fitness_at_creation,
    status: variant.status,
    checksum: variant.checksum,
  };

  const content = `---
${yaml.dump(frontmatter).trim()}
---

${variant.content}
`;

  const variantPath = path.join(promptsDir, `${variant.variant_id}.md`);
  await fs.writeFile(variantPath, content, 'utf-8');
}

/**
 * Update metadata file
 */
export async function updateMetadata(
  projectRoot: string,
  concept: Concept,
  metadata: VariantMetadata
): Promise<void> {
  const metadataPath = path.join(
    projectRoot,
    '.claude',
    'prompts',
    concept,
    'metadata.yaml'
  );

  await fs.writeFile(metadataPath, yaml.dump(metadata), 'utf-8');
}

/**
 * Parse frontmatter from markdown content
 */
function parseFrontmatter(content: string): {
  frontmatter: Record<string, any>;
  body: string;
} {
  const lines = content.split('\n');

  if (lines[0] === '---') {
    const endIndex = lines.slice(1).findIndex(line => line === '---');
    if (endIndex >= 0) {
      const frontmatterText = lines.slice(1, endIndex + 1).join('\n');
      const body = lines.slice(endIndex + 2).join('\n');
      return {
        frontmatter: yaml.load(frontmatterText) as Record<string, any>,
        body,
      };
    }
  }

  return {
    frontmatter: {},
    body: content,
  };
}
