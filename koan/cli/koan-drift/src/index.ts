/**
 * koan-drift CLI entry point
 */

import { Command } from 'commander';
import { join } from 'path';
import { createCommand } from '@zen/koan-core';
import { scanDirectory } from './scanner.js';
import { compareDirectories } from './comparator.js';
import { generateDiff } from './differ.js';
import { renderSummary, renderVerbose, renderJson } from './renderer.js';
import type { CliOptions, Category } from './types.js';

export function createDriftCommand(): Command {
  return createCommand('drift', 'Detect configuration drift between Zen framework templates and installed project files', async (options: CliOptions, projectRoot) => {
    // Define paths
    const templatesDir = join(projectRoot, '.zen', 'templates');
    const installedDir = join(projectRoot, '.claude');

    // Scan both directories
    const [templateEntries, installedEntries] = await Promise.all([
      scanDirectory(templatesDir),
      scanDirectory(installedDir),
    ]);

    // Compare directories
    let report = compareDirectories(templateEntries, installedEntries);

    // Generate diffs if requested
    if (options.showDiffs) {
      for (const file of report.modified) {
        if (file.templatePath && file.installedPath) {
          file.diff = await generateDiff(
            file.templatePath,
            file.installedPath,
            file.relativePath
          );
        }
      }
    }

    // Render output
    if (options.json) {
      console.log(renderJson(report, options));
    } else if (options.verbose) {
      console.log(renderVerbose(report, options));
    } else {
      console.log(renderSummary(report, options.category as any));
    }

    // Exit with error code if drift detected
    const hasDrift = report.modified.length > 0 ||
                     report.missing.length > 0 ||
                     report.added.length > 0;
    process.exit(hasDrift ? 1 : 0);
  })
    .option('--json', 'Output in JSON format')
    .option('--category <category>', 'Filter to specific category')
    .option('--show-diffs', 'Include diffs for modified files')
    .option('--ignore-added', 'Skip added files in output')
    .option('-v, --verbose', 'Show individual file names');
}
