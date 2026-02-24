import { Command } from 'commander';
import chalk from 'chalk';
import {
  createCommand,
  loadProvenanceActions,
  filterProvenanceActions,
} from '@zen/koan-core';
import type { ProvenanceFilter } from '@zen/koan-core';
import { computeAnalytics } from './analytics.js';
import { formatDefault, formatChart, formatJson, formatVerbose, formatEmpty, formatTokens } from './formatter.js';
import type { Concept, Model } from './types.js';

export function createCostsCommand(): Command {
  return createCommand('costs', 'Analyze and display cost analytics from Zen provenance records', async (options, projectRoot) => {
    let actions = await loadProvenanceActions(projectRoot);

    if (actions.length === 0) {
      formatEmpty();
      process.exit(0);
    }

    const filter: ProvenanceFilter = {};

    if (options.from || options.to) {
      filter.dateRange = {};
      if (options.from) filter.dateRange.from = new Date(options.from);
      if (options.to) filter.dateRange.to = new Date(options.to);
    }

    if (options.concept) filter.concepts = [options.concept as Concept];
    if (options.model) filter.models = [options.model as Model];
    if (options.flow) filter.flowId = options.flow;

    actions = filterProvenanceActions(actions, filter);

    if (actions.length === 0) {
      console.log(chalk.yellow('\nNo provenance records match the specified filters.\n'));
      process.exit(0);
    }

    const analytics = computeAnalytics(actions);

    if (options.json) {
      formatJson(analytics);
    } else if (options.verbose) {
      formatVerbose(analytics, actions);
    } else if (options.chart) {
      formatChart(analytics);
    } else if (options.tokens) {
      formatTokens(analytics);
    } else {
      formatDefault(analytics);
    }
  })
    .option('--from <date>', 'Filter from date (YYYY-MM-DD)')
    .option('--to <date>', 'Filter to date (YYYY-MM-DD)')
    .option('-c, --concept <concept>', 'Filter by concept (story, architecture, implementation, etc.)')
    .option('-m, --model <model>', 'Filter by model (opus, sonnet, haiku)')
    .option('--flow <flow_id>', 'Filter by workflow flow ID')
    .option('--chart', 'Show ASCII chart of cost over time')
    .option('--tokens', 'Show token usage dashboard')
    .option('-j, --json', 'Output in JSON format')
    .option('-v, --verbose', 'Show per-action breakdown');
}
