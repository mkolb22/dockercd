/**
 * Output rendering
 */

import chalk from 'chalk';
import type { DriftReport, Category, CliOptions } from './types.js';

/**
 * Count files by category
 */
function countByCategory(
  files: Array<{ category: Category }>
): Map<Category, number> {
  const counts = new Map<Category, number>();

  for (const file of files) {
    counts.set(file.category, (counts.get(file.category) || 0) + 1);
  }

  return counts;
}

/**
 * Render summary table with counts by category
 */
export function renderSummary(report: DriftReport, categoryFilter?: Category): string {
  const lines: string[] = [];

  lines.push(chalk.bold('\nConfiguration Drift Summary\n'));

  // Apply category filter if provided
  const modified = categoryFilter
    ? report.modified.filter((f) => f.category === categoryFilter)
    : report.modified;
  const missing = categoryFilter
    ? report.missing.filter((f) => f.category === categoryFilter)
    : report.missing;
  const added = categoryFilter
    ? report.added.filter((f) => f.category === categoryFilter)
    : report.added;

  // Calculate totals
  const totalModified = modified.length;
  const totalMissing = missing.length;
  const totalAdded = added.length;
  const totalDrift = totalModified + totalMissing + totalAdded;

  if (totalDrift === 0) {
    lines.push(chalk.green('✓ No drift detected - all files in sync\n'));
    return lines.join('\n');
  }

  // Header
  lines.push(
    `${chalk.bold('Category').padEnd(20)} ${chalk.red('Modified').padEnd(12)} ${chalk.yellow('Missing').padEnd(12)} ${chalk.green('Added')}`
  );
  lines.push('─'.repeat(60));

  // Get all categories
  const categories = new Set<Category>([
    ...modified.map((f) => f.category),
    ...missing.map((f) => f.category),
    ...added.map((f) => f.category),
  ]);

  const modifiedCounts = countByCategory(modified);
  const missingCounts = countByCategory(missing);
  const addedCounts = countByCategory(added);

  // Rows by category
  for (const category of Array.from(categories).sort()) {
    const modified = modifiedCounts.get(category) || 0;
    const missing = missingCounts.get(category) || 0;
    const added = addedCounts.get(category) || 0;

    lines.push(
      `${category.padEnd(20)} ${chalk.red(String(modified).padEnd(12))} ${chalk.yellow(String(missing).padEnd(12))} ${chalk.green(String(added))}`
    );
  }

  lines.push('─'.repeat(60));
  lines.push(
    `${chalk.bold('Total').padEnd(20)} ${chalk.red(String(totalModified).padEnd(12))} ${chalk.yellow(String(totalMissing).padEnd(12))} ${chalk.green(String(totalAdded))}\n`
  );

  return lines.join('\n');
}

/**
 * Render verbose output with individual file names
 */
export function renderVerbose(report: DriftReport, options: CliOptions): string {
  const lines: string[] = [];

  const categoryFilter = options.category;
  lines.push(renderSummary(report, categoryFilter));

  // Modified files
  if (report.modified.length > 0) {
    lines.push(chalk.red.bold('\nModified Files:'));
    for (const file of report.modified) {
      if (categoryFilter && file.category !== categoryFilter) continue;
      lines.push(chalk.red(`  ${file.relativePath}`));
      if (options.showDiffs && file.diff) {
        lines.push(chalk.gray(file.diff));
      }
    }
  }

  // Missing files
  if (report.missing.length > 0) {
    lines.push(chalk.yellow.bold('\nMissing Files:'));
    for (const file of report.missing) {
      if (categoryFilter && file.category !== categoryFilter) continue;
      lines.push(chalk.yellow(`  ${file.relativePath}`));
    }
  }

  // Added files
  if (!options.ignoreAdded && report.added.length > 0) {
    lines.push(chalk.green.bold('\nAdded Files:'));
    for (const file of report.added) {
      if (categoryFilter && file.category !== categoryFilter) continue;
      lines.push(chalk.green(`  ${file.relativePath}`));
    }
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Render JSON output
 */
export function renderJson(report: DriftReport, options: CliOptions): string {
  let filteredReport = report;

  // Apply filters
  if (options.category) {
    filteredReport = {
      modified: report.modified.filter((f) => f.category === options.category),
      missing: report.missing.filter((f) => f.category === options.category),
      added: report.added.filter((f) => f.category === options.category),
    };
  }

  if (options.ignoreAdded) {
    filteredReport = {
      ...filteredReport,
      added: [],
    };
  }

  return JSON.stringify(filteredReport, null, 2);
}
