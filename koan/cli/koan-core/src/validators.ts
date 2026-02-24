/**
 * Type guards for validating YAML-loaded data matches expected schema.
 * Runtime validation with compile-time type narrowing.
 */

import type { Story, Architecture, Implementation, ProvenanceAction } from './types.js';

export function validateStory(data: unknown): data is Story {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.story_id === 'string' &&
    typeof d.status === 'string' &&
    typeof d.summary === 'string'
  );
}

export function validateArchitecture(data: unknown): data is Architecture {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.id === 'string' &&
    typeof d.status === 'string' &&
    typeof d.summary === 'string'
  );
}

export function validateImplementation(data: unknown): data is Implementation {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.impl_id === 'string' &&
    typeof d.status === 'string' &&
    typeof d.summary === 'string'
  );
}

export function validateProvenanceAction(data: unknown): data is ProvenanceAction {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.action_id === 'string' &&
    typeof d.concept === 'string' &&
    typeof d.action === 'string' &&
    typeof d.status === 'string' &&
    typeof d.timestamp === 'string'
  );
}
