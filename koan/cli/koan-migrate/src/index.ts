/**
 * Koan Migrate CLI
 * Migrate YAML state files from koan/ to SQLite state.db
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { createCommand } from '@zen/koan-core';
import * as path from 'path';
import { migrate, exportToYaml } from './migrator.js';

export function createMigrateCommand(): Command {
  return createCommand('migrate', 'Migrate koan/ YAML state files to SQLite state.db', async (options, projectRoot) => {
    const koanDir = path.join(projectRoot, 'koan');

    if (options.export) {
      console.log(chalk.blue('Exporting state.db to YAML...'));
      const { exported, outputDir } = exportToYaml(koanDir);
      console.log(chalk.green(`Exported ${exported} records to ${outputDir}`));
      return;
    }

    if (options.dryRun) {
      console.log(chalk.yellow('Dry run — no changes will be made\n'));
    }

    console.log(chalk.blue('Migrating koan/ YAML state to SQLite...\n'));

    const result = migrate(koanDir, {
      dryRun: options.dryRun,
      noArchive: options.noArchive,
    });

    // Health
    console.log(chalk.bold('Health:'));
    console.log(`  Migrated: ${result.health.migrated}`);
    if (result.health.errors.length > 0) {
      for (const err of result.health.errors) {
        console.log(chalk.red(`  Error: ${err}`));
      }
    }

    // Events
    console.log(chalk.bold('\nEvents:'));
    console.log(`  Migrated: ${result.events.migrated}`);
    console.log(`  Skipped:  ${result.events.skipped}`);
    if (result.events.errors.length > 0) {
      for (const err of result.events.errors) {
        console.log(chalk.red(`  Error: ${err}`));
      }
    }

    // Checkpoints
    console.log(chalk.bold('\nCheckpoints:'));
    console.log(`  Migrated: ${result.checkpoints.migrated}`);
    console.log(`  Skipped:  ${result.checkpoints.skipped}`);
    if (result.checkpoints.errors.length > 0) {
      for (const err of result.checkpoints.errors) {
        console.log(chalk.red(`  Error: ${err}`));
      }
    }

    // Archive
    if (result.archived.length > 0) {
      const verb = options.dryRun ? 'Would archive' : 'Archived';
      console.log(chalk.bold(`\n${verb}: ${result.archived.length} files to koan/.archive/`));
    }

    // Summary
    const total = result.health.migrated + result.events.migrated + result.checkpoints.migrated;
    const totalErrors = result.health.errors.length + result.events.errors.length + result.checkpoints.errors.length;

    console.log(chalk.bold('\n─────────────────────────────────'));
    console.log(chalk.green(`Total migrated: ${total}`));
    if (totalErrors > 0) {
      console.log(chalk.red(`Total errors:   ${totalErrors}`));
    }

    const dbPath = path.join(koanDir, 'state', 'state.db');
    console.log(chalk.dim(`Database: ${dbPath}`));
  })
    .option('--dry-run', 'Show what would be migrated without making changes')
    .option('--export', 'Export state.db back to YAML (for debugging)')
    .option('--no-archive', 'Skip archiving original YAML files');
}
