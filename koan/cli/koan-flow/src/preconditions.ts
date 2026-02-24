/**
 * Check preconditions for each pipeline step.
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { parseYamlFile } from '@zen/koan-core';
import type { Pipeline } from '@zen/koan-compose/dist/compose.js';
import type {
  PreconditionCheck,
  PreconditionResult,
  Story,
  Architecture,
  Implementation,
} from './types.js';

/**
 * Define preconditions for each concept.
 */
const CONCEPT_PRECONDITIONS: Record<
  string,
  (projectRoot: string, storyId?: string) => Promise<PreconditionCheck[]>
> = {
  story: async () => {
    // Story has no preconditions
    return [];
  },

  architecture: async (projectRoot: string, storyId?: string) => {
    const checks: PreconditionCheck[] = [];

    if (!storyId) {
      checks.push({
        type: 'file_exists',
        target: 'story-id',
        passed: false,
        message: 'Story ID required for architecture (use --story-id)',
      });
      return checks;
    }

    const storyPath = join(
      projectRoot,
      'koan',
      'stories',
      `story-${storyId}.yaml`
    );

    // Check story file exists
    const exists = existsSync(storyPath);
    checks.push({
      type: 'file_exists',
      target: storyPath,
      passed: exists,
      message: exists
        ? `Story file exists: ${storyPath}`
        : `Story file not found: ${storyPath}`,
    });

    // Check story status
    if (exists) {
      const story = await parseYamlFile<Story>(storyPath);
      const statusReady = story?.status === 'ready';
      checks.push({
        type: 'status_equals',
        target: `story-${storyId}.status`,
        passed: statusReady,
        message: statusReady
          ? `Story status is 'ready'`
          : `Story status is '${story?.status}' (expected 'ready')`,
      });
    }

    return checks;
  },

  implementation: async (projectRoot: string, storyId?: string) => {
    const checks: PreconditionCheck[] = [];

    if (!storyId) {
      checks.push({
        type: 'file_exists',
        target: 'story-id',
        passed: false,
        message: 'Story ID required for implementation (use --story-id)',
      });
      return checks;
    }

    const archPath = join(
      projectRoot,
      'koan',
      'architecture',
      `arch-${storyId}.yaml`
    );

    // Check architecture file exists
    const exists = existsSync(archPath);
    checks.push({
      type: 'file_exists',
      target: archPath,
      passed: exists,
      message: exists
        ? `Architecture file exists: ${archPath}`
        : `Architecture file not found: ${archPath}`,
    });

    // Check architecture status
    if (exists) {
      const arch = await parseYamlFile<Architecture>(archPath);
      const statusCompleted = arch?.status === 'completed';
      checks.push({
        type: 'status_equals',
        target: `arch-${storyId}.status`,
        passed: statusCompleted,
        message: statusCompleted
          ? `Architecture status is 'completed'`
          : `Architecture status is '${arch?.status}' (expected 'completed')`,
      });
    }

    return checks;
  },

  quality: async (projectRoot: string, storyId?: string) => {
    const checks: PreconditionCheck[] = [];

    if (!storyId) {
      checks.push({
        type: 'file_exists',
        target: 'story-id',
        passed: false,
        message: 'Story ID required for quality (use --story-id)',
      });
      return checks;
    }

    const implPath = join(
      projectRoot,
      'koan',
      'implementations',
      `impl-${storyId}.yaml`
    );

    // Check implementation file exists
    const exists = existsSync(implPath);
    checks.push({
      type: 'file_exists',
      target: implPath,
      passed: exists,
      message: exists
        ? `Implementation file exists: ${implPath}`
        : `Implementation file not found: ${implPath}`,
    });

    // Check implementation has files changed
    if (exists) {
      const impl = await parseYamlFile<Implementation>(implPath);
      const hasChanges = (impl?.files_changed ?? 0) > 0;
      checks.push({
        type: 'field_not_empty',
        target: `impl-${storyId}.files_changed`,
        passed: hasChanges,
        message: hasChanges
          ? `Implementation has ${impl?.files_changed} files changed`
          : `Implementation has no files changed`,
      });
    }

    return checks;
  },

  version: async (projectRoot: string, storyId?: string) => {
    const checks: PreconditionCheck[] = [];

    if (!storyId) {
      checks.push({
        type: 'file_exists',
        target: 'story-id',
        passed: false,
        message: 'Story ID required for version (use --story-id)',
      });
      return checks;
    }

    const reviewPath = join(
      projectRoot,
      'koan',
      'reviews',
      `review-${storyId}.yaml`
    );

    // Check review file exists
    const exists = existsSync(reviewPath);
    checks.push({
      type: 'file_exists',
      target: reviewPath,
      passed: exists,
      message: exists
        ? `Quality review exists: ${reviewPath}`
        : `Quality review not found: ${reviewPath}`,
    });

    // Check review status
    if (exists) {
      const review = await parseYamlFile<{ status?: string }>(reviewPath);
      const statusApproved = review?.status === 'approved';
      checks.push({
        type: 'status_equals',
        target: `review-${storyId}.status`,
        passed: statusApproved,
        message: statusApproved
          ? `Quality review is 'approved'`
          : `Quality review status is '${review?.status}' (expected 'approved')`,
      });
    }

    return checks;
  },

  // Concepts with no preconditions
  'code-analysis': async () => [],
  verification: async () => [],
  security: async () => [],
  context: async () => [],
  documentation: async () => [],
  retrospective: async () => [],
};

/**
 * Check preconditions for all steps in a pipeline.
 */
export async function checkPreconditions(
  pipeline: Pipeline,
  projectRoot: string,
  storyId?: string
): Promise<PreconditionResult[]> {
  const results: PreconditionResult[] = [];

  let stepNumber = 1;
  for (const step of pipeline.steps) {
    for (const concept of step.concepts) {
      const checker = CONCEPT_PRECONDITIONS[concept];
      const checks = checker
        ? await checker(projectRoot, storyId)
        : [
            {
              type: 'file_exists' as const,
              target: concept,
              passed: false,
              message: `Unknown concept: ${concept} (no precondition checker)`,
            },
          ];

      const passed = checks.every((c) => c.passed);

      results.push({
        step: stepNumber,
        concept,
        passed,
        checks,
      });

      stepNumber++;
    }
  }

  return results;
}
