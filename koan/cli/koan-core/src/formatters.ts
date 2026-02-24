/**
 * Shared formatting utilities for koan CLI tools.
 * Consolidates duplicate formatters from koan-costs, koan-bench,
 * koan-observe, koan-learn, koan-timeline, and koan-flow.
 */

import chalk from 'chalk';

/**
 * Format a USD cost amount.
 */
export function formatCost(amount: number): string {
  if (amount < 0.001) return '<$0.001';
  return '$' + amount.toFixed(4);
}

/**
 * Format a token count with K/M suffixes.
 */
export function formatTokens(count: number): string {
  if (count >= 1_000_000) return (count / 1_000_000).toFixed(1) + 'M';
  if (count >= 1_000) return (count / 1_000).toFixed(1) + 'K';
  return count.toString();
}

/**
 * Render a horizontal bar chart element.
 */
export function formatBar(value: number, maxValue: number, width: number = 30): string {
  if (maxValue === 0) return '';
  const filled = Math.round((value / maxValue) * width);
  return chalk.cyan('\u2588'.repeat(filled)) + chalk.gray('\u2591'.repeat(width - filled));
}

/**
 * Render a progress bar from a 0-1 ratio.
 */
export function formatProgressBar(ratio: number, width: number = 20): string {
  const filled = Math.round(ratio * width);
  return chalk.cyan('\u2588'.repeat(filled)) + chalk.gray('\u2591'.repeat(width - filled));
}

/**
 * Format a section header with a horizontal rule.
 */
export function formatSectionHeader(title: string, width: number = 40): string {
  return [
    chalk.bold.cyan('\u2501'.repeat(width)),
    chalk.bold.cyan(`  ${title}`),
    chalk.bold.cyan('\u2501'.repeat(width)),
  ].join('\n');
}

/**
 * Print empty state message with consistent styling.
 */
export function formatEmpty(title: string, message: string, hint?: string): string {
  const lines: string[] = [];
  lines.push(formatSectionHeader(title));
  lines.push('');
  lines.push(chalk.gray(`  ${message}`));
  if (hint) {
    lines.push(chalk.gray(`  ${hint}`));
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Format data as pretty-printed JSON.
 */
export function formatJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

/**
 * Format a model name with color coding.
 */
export function formatModel(model: string): string {
  const colors: Record<string, (s: string) => string> = {
    opus: chalk.magenta,
    sonnet: chalk.blue,
    haiku: chalk.green,
  };
  const colorFn = colors[model] || chalk.gray;
  return colorFn(`[${model}]`);
}

/**
 * Format a concept name with color coding.
 */
export function formatConcept(concept: string): string {
  const colors: Record<string, (s: string) => string> = {
    story: chalk.cyan,
    architecture: chalk.magenta,
    implementation: chalk.blue,
    quality: chalk.green,
    security: chalk.red,
    version: chalk.yellow,
    documentation: chalk.gray,
    verification: chalk.green,
  };
  const colorFn = colors[concept] || chalk.white;
  return colorFn(concept);
}

/**
 * Format a percentage value.
 */
export function formatPercentage(value: number): string {
  return `${value.toFixed(1)}%`;
}

/**
 * Model color map for tables that need direct access.
 */
export const modelColors: Record<string, (t: string) => string> = {
  opus: chalk.magenta,
  sonnet: chalk.blue,
  haiku: chalk.green,
  unknown: chalk.gray,
};
