/**
 * Koan Validate CLI
 * Validates koan/ YAML files against JSON schemas in .claude/schemas/
 */

import { Command } from 'commander';
import { createCommand } from '@zen/koan-core';
import { Validator } from './validator.js';
import { formatDefault, formatVerbose, formatJson } from './formatter.js';
import type { ValidateOptions } from './types.js';

export function createValidateCommand(): Command {
  return createCommand('validate', 'Validate koan/ YAML files against JSON schemas', async (options: ValidateOptions, projectRoot) => {
    const validator = new Validator(projectRoot);
    await validator.loadSchemas();

    const results = await validator.validateAll(options.schema, options.file);

    if (options.json) {
      formatJson(results);
    } else if (options.verbose) {
      formatVerbose(results);
    } else {
      formatDefault(results);
    }

    // Exit code: 0=pass, 1=fail, 2=tool error
    const hasFailed = results.some((r) => !r.valid);
    process.exit(hasFailed ? 1 : 0);
  })
    .option('-v, --verbose', 'Detailed validation errors')
    .option('-j, --json', 'JSON output for CI')
    .option('-s, --schema <name>', 'Validate only one schema type (e.g., "story", "architecture")')
    .option('-f, --file <path>', 'Validate a single file');
}
