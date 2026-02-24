/**
 * Display formatting for validation results
 * Supports default (tables), verbose, and JSON output
 */

import chalk from 'chalk';
import Table from 'cli-table3';
import type { ValidationResult, ValidationSummary } from './types.js';

function calculateSummary(results: ValidationResult[]): ValidationSummary {
  return {
    total: results.length,
    passed: results.filter((r) => r.valid).length,
    failed: results.filter((r) => !r.valid && !r.parseError).length,
    parseErrors: results.filter((r) => r.parseError).length,
  };
}

export function formatDefault(results: ValidationResult[]): void {
  const timestamp = new Date().toLocaleString();
  console.log(chalk.bold.cyan('\n=== Koan Validation Results ==='));
  console.log(chalk.gray('Generated: ' + timestamp + '\n'));

  if (results.length === 0) {
    console.log(chalk.yellow('No files found to validate.\n'));
    return;
  }

  // Group by schema
  const bySchema = new Map<string, ValidationResult[]>();
  for (const result of results) {
    const existing = bySchema.get(result.schema) || [];
    existing.push(result);
    bySchema.set(result.schema, existing);
  }

  // Display table per schema
  for (const [schema, schemaResults] of bySchema.entries()) {
    const passed = schemaResults.filter((r) => r.valid).length;
    const failed = schemaResults.filter((r) => !r.valid).length;

    console.log(chalk.bold.white(`Schema: ${schema}`));

    const table = new Table({
      head: ['Status', 'Count'].map((h) => chalk.bold(h)),
      style: { head: [], border: ['gray'] },
      colWidths: [20, 10],
    });

    table.push(
      [chalk.green('Passed'), passed.toString()],
      [chalk.red('Failed'), failed.toString()]
    );

    console.log(table.toString());

    // List failed files
    const failedFiles = schemaResults.filter((r) => !r.valid);
    if (failedFiles.length > 0) {
      console.log(chalk.red('\n  Failed files:'));
      for (const file of failedFiles) {
        if (file.parseError) {
          console.log(chalk.red(`    - ${file.file} (parse error)`));
        } else {
          console.log(chalk.red(`    - ${file.file} (${file.errors?.length || 0} errors)`));
        }
      }
    }

    console.log('');
  }

  // Overall summary
  const summary = calculateSummary(results);
  console.log(chalk.bold.white('Overall Summary:'));
  console.log('  Total files: ' + chalk.bold(summary.total.toString()));
  console.log('  ' + chalk.green('Passed') + ': ' + summary.passed);
  console.log('  ' + chalk.red('Failed') + ': ' + summary.failed);
  if (summary.parseErrors > 0) {
    console.log('  ' + chalk.yellow('Parse errors') + ': ' + summary.parseErrors);
  }
  console.log('');
}

export function formatVerbose(results: ValidationResult[]): void {
  const timestamp = new Date().toLocaleString();
  console.log(chalk.bold.cyan('\n=== Koan Validation Results (Verbose) ==='));
  console.log(chalk.gray('Generated: ' + timestamp + '\n'));

  if (results.length === 0) {
    console.log(chalk.yellow('No files found to validate.\n'));
    return;
  }

  for (const result of results) {
    if (result.valid) {
      console.log(chalk.green('✓ ' + result.file));
      console.log(chalk.gray('  Schema: ' + result.schema));
    } else {
      console.log(chalk.red('✗ ' + result.file));
      console.log(chalk.gray('  Schema: ' + result.schema));

      if (result.parseError) {
        console.log(chalk.red('  Parse Error:'));
        console.log(chalk.red('    ' + result.parseError));
      } else if (result.errors) {
        console.log(chalk.red(`  Validation Errors (${result.errors.length}):`));
        for (const error of result.errors) {
          console.log(chalk.red(`    Path: ${error.path}`));
          console.log(chalk.red(`    Message: ${error.message}`));
          if (error.expected) {
            console.log(chalk.gray(`    Expected: ${error.expected}`));
          }
          if (error.actual) {
            console.log(chalk.gray(`    Actual: ${error.actual}`));
          }
        }
      }
    }
    console.log('');
  }

  // Overall summary
  const summary = calculateSummary(results);
  console.log(chalk.bold.white('=== Summary ==='));
  console.log('Total files: ' + summary.total);
  console.log(chalk.green('Passed') + ': ' + summary.passed + ' | ' + chalk.red('Failed') + ': ' + summary.failed + ' | ' + chalk.yellow('Parse errors') + ': ' + summary.parseErrors);
  console.log('');
}

export function formatJson(results: ValidationResult[]): void {
  const summary = calculateSummary(results);
  const output = {
    results,
    summary,
  };
  console.log(JSON.stringify(output, null, 2));
}
