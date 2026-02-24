/**
 * koan-bench: CLI tool to benchmark and analyze Zen workflow performance metrics.
 */

import { Command } from 'commander';
import {
  createCommand,
  loadProvenanceActions,
  parseRelativeDate,
  filterProvenanceActions,
} from '@zen/koan-core';
import type { ProvenanceFilter, Concept } from '@zen/koan-core';
import { computeBenchmarks } from './aggregators.js';
import { renderDashboard, renderVerbose, renderJson } from './renderer.js';
import type { CliOptions } from './types.js';

export function createBenchCommand(): Command {
  return createCommand('bench', 'Benchmark and analyze Zen workflow performance metrics', async (options: CliOptions, projectRoot) => {
    // Load provenance actions
    const allActions = await loadProvenanceActions(projectRoot);

    if (allActions.length === 0) {
      console.error('No provenance actions found.');
      process.exit(1);
    }

    // Apply filters
    const filter: ProvenanceFilter = {};

    if (options.since) {
      filter.dateRange = { from: parseRelativeDate(options.since) };
    }

    if (options.concept) {
      filter.concepts = [options.concept as Concept];
    }

    const filteredActions = filterProvenanceActions(allActions, filter);

    if (filteredActions.length === 0) {
      console.error('No actions match the specified filters.');
      process.exit(1);
    }

    // Compute benchmarks
    const metrics = computeBenchmarks(filteredActions, {
      stories: options.stories,
    });

    // Render output
    if (options.json) {
      console.log(renderJson(metrics));
    } else if (options.verbose) {
      console.log(renderDashboard(metrics));
      console.log(renderVerbose(metrics));
    } else {
      console.log(renderDashboard(metrics));
    }
  })
    .option('-v, --verbose', 'Show per-story breakdown')
    .option('-j, --json', 'Output as JSON')
    .option('-s, --since <date>', 'Filter actions since date (e.g., "7d", "2026-01-01")')
    .option('-c, --concept <name>', 'Filter by concept')
    .option('-n, --stories <number>', 'Number of stories for trend analysis', parseInt);
}
