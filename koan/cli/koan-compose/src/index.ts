import { Command } from 'commander';
import { wrapCliAction } from '@zen/koan-core';
import {
  parsePipeline,
  validatePipeline,
  renderPipeline,
  renderConceptList,
  renderPipelineJson,
} from './compose.js';

export function createComposeCommand(): Command {
  return new Command('compose')
    .description('Concept composition language — describe workflow pipelines with a DSL')
    .version('1.0.0')
    .argument('[pipeline]', 'Pipeline expression (e.g., "story | arch | impl")')
    .option('--validate', 'Validate only, do not render')
    .option('--json', 'Output as JSON')
    .option('--list', 'List available concepts and aliases')
    .action(wrapCliAction(async (pipelineStr, opts) => {
      if (opts.list) {
        console.log(renderConceptList());
        return;
      }

      if (!pipelineStr) {
        console.log(renderConceptList());
        return;
      }

      const pipeline = parsePipeline(pipelineStr);
      const validation = validatePipeline(pipeline);

      if (opts.json) {
        console.log(renderPipelineJson(pipeline, validation));
        return;
      }

      if (opts.validate) {
        if (validation.valid) {
          console.log('Pipeline is valid.');
          for (const warn of validation.warnings) {
            console.log('Warning: ' + warn);
          }
        } else {
          console.error('Pipeline has errors:');
          for (const err of validation.errors) {
            console.error('  Step ' + err.step + ': ' + err.message);
          }
          process.exit(1);
        }
        return;
      }

      console.log(renderPipeline(pipeline, validation));
    }));
}
