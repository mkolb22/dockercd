/**
 * Unified filtering for ProvenanceAction records.
 * Consolidates duplicated logic from koan-costs, koan-bench, koan-timeline.
 */

import type { ProvenanceAction, Concept, Model } from './types.js';

/**
 * Filter configuration for provenance actions.
 */
export interface ProvenanceFilter {
  /** Filter by date range */
  dateRange?: {
    from?: Date;
    to?: Date;
  };
  /** Filter by concepts (OR logic if multiple) */
  concepts?: Concept[];
  /** Filter by models (OR logic if multiple) */
  models?: Model[];
  /** Filter by flow ID (exact match) */
  flowId?: string;
  /** Filter by story ID (exact match) */
  storyId?: string;
}

/**
 * Filter provenance actions based on provided criteria.
 * All filter conditions are ANDed together.
 *
 * @param actions - Array of provenance actions to filter
 * @param filter - Filter criteria
 * @returns Filtered array of provenance actions
 */
export function filterProvenanceActions(
  actions: ProvenanceAction[],
  filter: ProvenanceFilter
): ProvenanceAction[] {
  return actions.filter(action => {
    // Date range filter
    if (filter.dateRange) {
      const actionDate = new Date(action.timestamp);
      if (filter.dateRange.from && actionDate < filter.dateRange.from) {
        return false;
      }
      if (filter.dateRange.to && actionDate > filter.dateRange.to) {
        return false;
      }
    }

    // Concept filter (OR logic if multiple concepts)
    if (filter.concepts && filter.concepts.length > 0) {
      if (!filter.concepts.includes(action.concept)) {
        return false;
      }
    }

    // Model filter (OR logic if multiple models)
    if (filter.models && filter.models.length > 0) {
      if (!action.model || !filter.models.includes(action.model)) {
        return false;
      }
    }

    // Flow ID filter (exact match)
    if (filter.flowId && action.flow_id !== filter.flowId) {
      return false;
    }

    // Story ID filter (exact match)
    if (filter.storyId) {
      const storyId = (action.inputs?.story_id as string | undefined) ||
                      ((action.outputs as Record<string, unknown> | undefined)?.story_id as string | undefined);
      if (storyId !== filter.storyId) {
        return false;
      }
    }

    return true;
  });
}
