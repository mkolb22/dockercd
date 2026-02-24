/**
 * Output formatting for koan-observe.
 */

import chalk from 'chalk';
import { formatDuration } from '@zen/koan-core';
import type { ObservabilityAnalysis, DailyStats } from './types.js';

/**
 * Format a number with comma separators.
 */
function formatNumber(n: number): string {
  return n.toLocaleString();
}

/**
 * Format the observability analysis as a table.
 */
export function formatAnalysis(analysis: ObservabilityAnalysis): string {
  const lines: string[] = [];

  // Header
  lines.push(chalk.cyan.bold('━'.repeat(60)));
  lines.push(chalk.cyan.bold('Prompt Observability Analysis'));
  lines.push(chalk.cyan.bold('━'.repeat(60)));
  lines.push('');

  // Summary
  lines.push(chalk.bold('Summary'));
  lines.push(chalk.gray('─'.repeat(40)));
  lines.push(`  Total Calls:     ${chalk.yellow(formatNumber(analysis.total_calls))}`);
  lines.push(`  Total Tokens:    ${chalk.yellow(formatNumber(analysis.total_tokens))}`);
  lines.push(`  Unique Sessions: ${chalk.yellow(formatNumber(analysis.unique_sessions))}`);

  if (analysis.date_range.from && analysis.date_range.to) {
    const from = new Date(analysis.date_range.from).toLocaleDateString();
    const to = new Date(analysis.date_range.to).toLocaleDateString();
    lines.push(`  Date Range:      ${chalk.gray(from)} → ${chalk.gray(to)}`);
  }

  lines.push('');

  // By Concept
  if (analysis.by_concept.length > 0) {
    lines.push(chalk.bold('Tokens by Concept'));
    lines.push(chalk.gray('─'.repeat(40)));
    lines.push(
      chalk.gray(
        `  ${'Concept'.padEnd(18)} ${'Calls'.padStart(8)} ${'Tokens'.padStart(10)} ${'Avg'.padStart(8)}`
      )
    );

    for (const stat of analysis.by_concept) {
      const concept = stat.concept.padEnd(18);
      const calls = formatNumber(stat.calls).padStart(8);
      const tokens = formatNumber(stat.tokens).padStart(10);
      const avg = formatNumber(stat.avg_tokens).padStart(8);
      lines.push(`  ${concept} ${calls} ${tokens} ${avg}`);
    }

    lines.push('');
  }

  // By Model
  const modelKeys = Object.keys(analysis.by_model);
  if (modelKeys.length > 0) {
    lines.push(chalk.bold('Tokens by Model'));
    lines.push(chalk.gray('─'.repeat(40)));

    for (const model of modelKeys.sort()) {
      const tokens = analysis.by_model[model];
      const pct = ((tokens / analysis.total_tokens) * 100).toFixed(1);
      lines.push(`  ${model.padEnd(15)} ${formatNumber(tokens).padStart(10)} (${pct}%)`);
    }

    lines.push('');
  }

  // Top Sessions
  if (analysis.top_sessions.length > 0) {
    lines.push(chalk.bold('Top Sessions by Token Usage'));
    lines.push(chalk.gray('─'.repeat(40)));

    for (const session of analysis.top_sessions) {
      const id = session.session_id.slice(0, 12);
      const tokens = formatNumber(session.tokens).padStart(8);
      const calls = session.calls;
      const duration = formatDuration(session.duration_ms);
      const concepts = session.concepts.slice(0, 3).join(', ');

      lines.push(`  ${chalk.yellow(id)} ${tokens} tokens, ${calls} calls, ${duration}`);
      lines.push(`    ${chalk.gray('Concepts:')} ${concepts}`);
    }

    lines.push('');
  }

  lines.push(chalk.cyan.bold('━'.repeat(60)));

  return lines.join('\n');
}

/**
 * Format daily stats.
 */
export function formatDailyStats(stats: DailyStats): string {
  const lines: string[] = [];

  lines.push(chalk.cyan.bold('Daily Stats'));
  lines.push(chalk.gray('─'.repeat(40)));
  lines.push(`  Date:         ${chalk.yellow(stats.date)}`);
  lines.push(`  Total Calls:  ${chalk.yellow(formatNumber(stats.total_calls))}`);
  lines.push(`  Total Tokens: ${chalk.yellow(formatNumber(stats.total_tokens))}`);
  lines.push(`  Last Updated: ${chalk.gray(stats.last_updated)}`);

  return lines.join('\n');
}

/**
 * Format empty state message.
 */
export function formatEmptyState(): string {
  const lines: string[] = [];

  lines.push(chalk.yellow('No prompt logs found.'));
  lines.push('');
  lines.push(chalk.gray('Prompt logging may not be enabled or no prompts have been logged yet.'));
  lines.push('');
  lines.push(chalk.gray('To enable logging:'));
  lines.push(chalk.gray('  1. Ensure post-prompt-observe.sh hook is registered'));
  lines.push(chalk.gray('  2. Set PROMPT_OBSERVABILITY_ENABLED=true'));
  lines.push('');
  lines.push(chalk.gray('Log location: koan/observability/prompts.jsonl'));

  return lines.join('\n');
}
