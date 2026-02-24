/**
 * Load and filter provenance actions for timeline visualization.
 */

import {
  loadProvenanceActions,
  parseRelativeDate,
  filterProvenanceActions,
} from '@zen/koan-core';
import type { ProvenanceFilter } from '@zen/koan-core';
import type { TimelineAction, LoaderOptions } from './types.js';

/**
 * Load timeline actions from provenance with optional filters.
 *
 * @param options - Loader options
 * @returns Filtered timeline actions
 */
export async function loadTimelineActions(
  options: LoaderOptions
): Promise<TimelineAction[]> {
  // Load all provenance actions
  const actions = await loadProvenanceActions(options.projectRoot);

  // Build filter
  const filter: ProvenanceFilter = {};

  if (options.flow) {
    filter.flowId = options.flow;
  }

  if (options.from || options.to) {
    filter.dateRange = {};
    if (options.from) filter.dateRange.from = options.from;
    if (options.to) filter.dateRange.to = options.to;
  }

  if (options.concept) {
    filter.concepts = [options.concept];
  }

  // Apply filters
  return filterProvenanceActions(actions, filter);
}

/**
 * Parse date string (ISO or relative).
 * Re-exports from koan-core for convenience.
 *
 * @param dateStr - Date string
 * @returns Parsed Date object
 */
export function parseDate(dateStr: string): Date {
  return parseRelativeDate(dateStr);
}

/**
 * Group actions by flow ID.
 *
 * @param actions - All actions
 * @returns Map of flow_id to actions
 */
export function groupByFlow(
  actions: TimelineAction[]
): Map<string, TimelineAction[]> {
  const groups = new Map<string, TimelineAction[]>();

  for (const action of actions) {
    const flowId = action.flow_id || 'untracked';

    if (!groups.has(flowId)) {
      groups.set(flowId, []);
    }

    groups.get(flowId)!.push(action);
  }

  return groups;
}
