/**
 * Format and display benchmark results.
 */

import chalk from 'chalk';
import Table from 'cli-table3';
import { formatDuration, formatCost, formatPercentage } from '@zen/koan-core';
import type { BenchmarkMetrics } from './types.js';

export function renderDashboard(metrics: BenchmarkMetrics): string {
  const output: string[] = [];

  // Header
  output.push('');
  output.push(chalk.bold.cyan('=================================================='));
  output.push(chalk.bold.cyan('  Koan Workflow Benchmark'));
  output.push(chalk.bold.cyan('=================================================='));
  output.push('');

  // Overview
  output.push(chalk.bold('Overview'));
  output.push(`  Total spend:     ${chalk.green(formatCost(metrics.cost.total_spend))}`);
  output.push(`  Total actions:   ${chalk.blue(metrics.action_count)}`);
  output.push(`  Total stories:   ${chalk.blue(metrics.story_count)}`);
  output.push(`  Total duration:  ${chalk.yellow(formatDuration(metrics.duration.total_duration_ms))}`);
  output.push(`  Failure rate:    ${metrics.failures.failure_rate > 0.1 ? chalk.red(formatPercentage(metrics.failures.failure_rate * 100)) : chalk.green(formatPercentage(metrics.failures.failure_rate * 100))}`);
  output.push('');

  // Cost by Concept
  if (metrics.cost.by_concept.length > 0) {
    output.push(chalk.bold('Cost by Concept'));
    const costTable = new Table({
      head: ['Concept', 'Total', 'Avg', 'Actions'].map(h => chalk.cyan(h)),
      style: { compact: true },
    });
    for (const item of metrics.cost.by_concept) {
      costTable.push([
        item.concept,
        formatCost(item.total),
        formatCost(item.avg),
        item.count.toString(),
      ]);
    }
    output.push(costTable.toString());
    output.push('');
  }

  // Duration by Concept
  if (metrics.duration.by_concept.length > 0) {
    output.push(chalk.bold('Duration by Concept'));
    const durationTable = new Table({
      head: ['Concept', 'Total', 'Avg', 'P50', 'P90', 'P99'].map(h => chalk.cyan(h)),
      style: { compact: true },
    });
    for (const item of metrics.duration.by_concept) {
      durationTable.push([
        item.concept,
        formatDuration(item.total_ms),
        formatDuration(item.avg_ms),
        formatDuration(item.p50_ms),
        formatDuration(item.p90_ms),
        formatDuration(item.p99_ms),
      ]);
    }
    output.push(durationTable.toString());
    output.push('');
  }

  // Model Distribution
  if (metrics.model_usage.distribution.length > 0) {
    output.push(chalk.bold('Model Distribution'));
    const modelTable = new Table({
      head: ['Model', 'Count', 'Percentage', 'Cost'].map(h => chalk.cyan(h)),
      style: { compact: true },
    });
    for (const item of metrics.model_usage.distribution) {
      const costItem = metrics.model_usage.cost_distribution.find(c => c.model === item.model);
      modelTable.push([
        item.model,
        item.count.toString(),
        formatPercentage(item.percentage),
        costItem ? formatCost(costItem.cost) : '$0.0000',
      ]);
    }
    output.push(modelTable.toString());
    output.push('');
  }

  // Quality Metrics
  if (metrics.quality.total_reviews > 0) {
    output.push(chalk.bold('Quality Metrics'));
    output.push(`  Total reviews:    ${metrics.quality.total_reviews}`);
    output.push(`  Approval rate:    ${chalk.green(formatPercentage(metrics.quality.approval_rate * 100))}`);
    output.push(`  Avg review cycles: ${metrics.quality.avg_review_cycles.toFixed(2)}`);
    output.push('');
  }

  // Failures
  if (metrics.failures.total_failures > 0 || metrics.failures.retry_count > 0) {
    output.push(chalk.bold('Failures'));
    output.push(`  Total failures:  ${chalk.red(metrics.failures.total_failures)}`);
    output.push(`  Retry count:     ${metrics.failures.retry_count}`);

    if (metrics.failures.by_error_type.length > 0) {
      output.push('  By type:');
      for (const item of metrics.failures.by_error_type) {
        output.push(`    - ${item.error_type}: ${item.count}`);
      }
    }
    output.push('');
  }

  // Trends
  if (metrics.trends) {
    output.push(chalk.bold('Trends') + chalk.gray(` (last ${metrics.trends.window_size} stories)`));

    if (metrics.trends.cost_trend.length > 0) {
      const recentCost = metrics.trends.cost_trend.slice(-5);
      output.push(`  Recent cost trend:`);
      for (const item of recentCost) {
        output.push(`    ${item.story_id}: ${formatCost(item.cost)} (cumulative: ${formatCost(item.cumulative)})`);
      }
    }
    output.push('');
  }

  return output.join('\n');
}

export function renderVerbose(metrics: BenchmarkMetrics): string {
  const output: string[] = [];

  output.push('');
  output.push(chalk.bold.cyan('=================================================='));
  output.push(chalk.bold.cyan('  Koan Workflow Benchmark (Verbose)'));
  output.push(chalk.bold.cyan('=================================================='));
  output.push('');

  // Cost by Story
  if (metrics.cost.by_story.length > 0) {
    output.push(chalk.bold('Cost by Story'));
    const storyTable = new Table({
      head: ['Story ID', 'Total Cost', 'Actions'].map(h => chalk.cyan(h)),
      style: { compact: true },
    });
    for (const item of metrics.cost.by_story.slice(0, 20)) {
      storyTable.push([
        item.story_id,
        formatCost(item.total),
        item.count.toString(),
      ]);
    }
    output.push(storyTable.toString());
    output.push('');
  }

  // Duration by Story
  if (metrics.duration.by_story.length > 0) {
    output.push(chalk.bold('Duration by Story'));
    const durationStoryTable = new Table({
      head: ['Story ID', 'Total Duration', 'Actions'].map(h => chalk.cyan(h)),
      style: { compact: true },
    });
    for (const item of metrics.duration.by_story.slice(0, 20)) {
      durationStoryTable.push([
        item.story_id,
        formatDuration(item.total_ms),
        item.count.toString(),
      ]);
    }
    output.push(durationStoryTable.toString());
    output.push('');
  }

  // Failures by Concept
  if (metrics.failures.by_concept.length > 0) {
    output.push(chalk.bold('Failures by Concept'));
    const failureTable = new Table({
      head: ['Concept', 'Failures', 'Retries'].map(h => chalk.cyan(h)),
      style: { compact: true },
    });
    for (const item of metrics.failures.by_concept) {
      failureTable.push([
        item.concept,
        item.failures.toString(),
        item.retries.toString(),
      ]);
    }
    output.push(failureTable.toString());
    output.push('');
  }

  // Quality by Concept
  if (metrics.quality.by_concept.length > 0) {
    output.push(chalk.bold('Quality by Concept'));
    const qualityTable = new Table({
      head: ['Concept', 'Reviews', 'Approvals', 'Rejections'].map(h => chalk.cyan(h)),
      style: { compact: true },
    });
    for (const item of metrics.quality.by_concept) {
      qualityTable.push([
        item.concept,
        item.reviews.toString(),
        item.approvals.toString(),
        item.rejections.toString(),
      ]);
    }
    output.push(qualityTable.toString());
    output.push('');
  }

  return output.join('\n');
}

export function renderJson(metrics: BenchmarkMetrics): string {
  return JSON.stringify(metrics, null, 2);
}
