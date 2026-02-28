/**
 * Precondition definitions for pipeline steps.
 * Pure data — no I/O. Returns what needs to be true, not whether it is.
 */

import type { Pipeline, PreconditionSpec } from "./types.js";

// ─── Precondition Definitions ────────────────────────────────

const CONCEPT_PRECONDITIONS: Record<string, (storyId?: string) => PreconditionSpec[]> = {
  story: () => [],

  architecture: (storyId) => {
    if (!storyId) return [{ type: "field_not_empty", target: "story_id", description: "Story ID required for architecture" }];
    return [
      { type: "file_exists", target: `story-${storyId}`, description: `Story ${storyId} must exist` },
      { type: "status_equals", target: `story-${storyId}.status=ready`, description: `Story ${storyId} must be ready` },
    ];
  },

  implementation: (storyId) => {
    if (!storyId) return [{ type: "field_not_empty", target: "story_id", description: "Story ID required for implementation" }];
    return [
      { type: "file_exists", target: `architecture-${storyId}`, description: `Architecture for ${storyId} must exist` },
      { type: "status_equals", target: `architecture-${storyId}.status=completed`, description: `Architecture for ${storyId} must be completed` },
    ];
  },

  quality: (storyId) => {
    if (!storyId) return [{ type: "field_not_empty", target: "story_id", description: "Story ID required for quality" }];
    return [
      { type: "file_exists", target: `implementation-${storyId}`, description: `Implementation for ${storyId} must exist` },
      { type: "field_not_empty", target: `implementation-${storyId}.files_changed`, description: `Implementation must have changed files` },
    ];
  },

  version: (storyId) => {
    if (!storyId) return [{ type: "field_not_empty", target: "story_id", description: "Story ID required for version" }];
    return [
      { type: "file_exists", target: `review-${storyId}`, description: `Quality review for ${storyId} must exist` },
      { type: "status_equals", target: `review-${storyId}.status=approved`, description: `Quality review for ${storyId} must be approved` },
    ];
  },

  "code-analysis": () => [],
  verification: () => [],
  security: () => [],
  context: () => [],
  documentation: () => [],
  retrospective: () => [],
};

/**
 * Get precondition specs for all steps in a pipeline.
 */
export function getPreconditions(
  pipeline: Pipeline,
  storyId?: string,
): Array<{ step: number; concept: string; preconditions: PreconditionSpec[] }> {
  const results: Array<{ step: number; concept: string; preconditions: PreconditionSpec[] }> = [];
  let stepNumber = 1;

  for (const step of pipeline.steps) {
    for (const concept of step.concepts) {
      const checker = CONCEPT_PRECONDITIONS[concept];
      const preconditions = checker
        ? checker(storyId)
        : [{ type: "file_exists" as const, target: concept, description: `Unknown concept: ${concept}` }];

      results.push({ step: stepNumber, concept, preconditions });
      stepNumber++;
    }
  }

  return results;
}
