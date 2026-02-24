/**
 * koan-timeline: Visualize workflow execution as a timeline.
 *
 * Shows temporal ordering, concept dependencies, duration, and cost.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { createCommand } from '@zen/koan-core';
import type { Concept } from '@zen/koan-core';
import { loadTimelineActions, parseDate } from './loader.js';
import { renderEventTimeline, renderEmptyState } from './event-renderer.js';
import { renderGanttTimeline } from './gantt-renderer.js';
import { validateId, checkDatasetSize } from './security.js';
import type { CliOptions, LoaderOptions, RenderOptions } from './types.js';

export function createTimelineCommand(): Command {
  return createCommand('timeline', 'Visualize workflow execution as a timeline', async (options: CliOptions, projectRoot) => {
    // Validate flow ID if provided (SEC-001)
    if (options.flow) {
      validateId(options.flow, 'flow_id');
    }

    // Parse date filters
    const loaderOptions: LoaderOptions = {
      projectRoot,
      flow: options.flow,
      concept: options.concept as Concept | undefined,
    };

    if (options.from) {
      loaderOptions.from = parseDate(options.from);
    }

    if (options.to) {
      loaderOptions.to = parseDate(options.to);
    }

    // Load timeline actions
    const actions = await loadTimelineActions(loaderOptions);

    // Check for empty result
    if (actions.length === 0) {
      console.log(renderEmptyState());
      process.exit(0);
    }

    // Check dataset size (SEC-005)
    checkDatasetSize(actions.length, options.force || false);

    // Render options
    const renderOptions: RenderOptions = {
      verbose: options.verbose || false,
      redact: options.redact || false,
    };

    // Render output
    if (options.format === 'json') {
      // JSON output
      console.log(JSON.stringify(actions, null, 2));
    } else if (options.gantt) {
      // Gantt view
      console.log(renderGanttTimeline(actions, renderOptions));
    } else {
      // Default event-based timeline
      console.log(renderEventTimeline(actions, renderOptions));
    }
  })
    .option('--flow <id>', 'Show timeline for specific flow ID')
    .option('--from <date>', 'Filter actions from date (ISO or relative like 7d)')
    .option('--to <date>', 'Filter actions until date')
    .option('-c, --concept <name>', 'Filter to specific concept (story, architecture, etc.)')
    .option('--gantt', 'Show Gantt-style duration bars instead of event list')
    .option('--format <type>', 'Output format: timeline (default), json', 'timeline')
    .option('--redact', 'Redact potentially sensitive data (paths, IDs)')
    .option('--force', 'Process large datasets without warning')
    .option('-v, --verbose', 'Show additional details (tokens, triggered_by chain)');
}
