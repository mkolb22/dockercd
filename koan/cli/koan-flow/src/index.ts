/**
 * koan-flow CLI — generate execution plans from pipeline DSL.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { requireProjectRoot, wrapCliAction } from '@zen/koan-core';
import { parsePipeline, validatePipeline } from '@zen/koan-compose/dist/compose.js';
import { loadSyncRules } from './sync-loader.js';
import { checkPreconditions } from './preconditions.js';
import { generatePlan } from './plan-generator.js';
import { recordPlanGeneration, savePlan } from './provenance.js';
import { renderPlan, renderPlanJson } from './renderer.js';

export function createFlowCommand(): Command {
  return new Command('flow')
    .description(
      'Live workflow execution engine — generates executable plans from pipeline DSL'
    )
    .version('1.0.0')
    .argument('[pipeline]', 'Pipeline DSL (e.g., "story | arch | impl")')
    .option('--story-id <id>', 'Story ID for precondition checks')
    .option('--from <step>', 'Start from specific step number (skip earlier)')
    .option('--dry-run', 'Validate and display plan without saving')
    .option('--verbose, -v', 'Show full details including sync rules and SLOs')
    .option('--json', 'Output plan as JSON')
    .option('--save <path>', 'Save plan to custom path')
    .action(wrapCliAction(async (pipelineStr: string | undefined, opts: {
      storyId?: string; from?: string; dryRun?: boolean;
      verbose?: boolean; json?: boolean; save?: string;
    }) => {
      if (!pipelineStr) {
        console.error('Error: pipeline argument is required');
        console.error(
          'Example: koan-flow "story | arch | impl | quality | ship"'
        );
        process.exit(1);
      }

      const projectRoot = requireProjectRoot();

      // Parse pipeline
      const pipeline = parsePipeline(pipelineStr);

      // Validate pipeline
      const validation = validatePipeline(pipeline);

      // Load sync rules
      const syncRules = await loadSyncRules(projectRoot);

      // Check preconditions
      const preconditionResults = await checkPreconditions(
        pipeline,
        projectRoot,
        opts.storyId
      );

      // Generate plan
      const plan = await generatePlan(
        pipeline,
        validation,
        preconditionResults,
        syncRules,
        {
          storyId: opts.storyId,
          fromStep: opts.from ? parseInt(opts.from, 10) : undefined,
          dryRun: opts.dryRun,
          verbose: opts.verbose,
          projectRoot,
        }
      );

      // Output
      if (opts.json) {
        console.log(renderPlanJson(plan));
      } else {
        console.log(
          renderPlan(plan, {
            verbose: opts.verbose,
            showPreconditions: opts.verbose,
            showSyncRules: opts.verbose,
          })
        );
      }

      // Save plan (unless dry-run)
      if (!opts.dryRun) {
        const planPath = opts.save
          ? opts.save
          : await savePlan(plan, projectRoot);

        if (!opts.save) {
          await recordPlanGeneration(plan, projectRoot);
        }

        if (!opts.json) {
          console.log(chalk.green(`Saved: ${planPath}`));
        }
      } else {
        if (!opts.json) {
          console.log(chalk.yellow('(Dry run — plan not saved)'));
        }
      }

      // Exit with error code if plan is invalid
      if (!validation.valid) {
        process.exit(1);
      }
    }));
}
