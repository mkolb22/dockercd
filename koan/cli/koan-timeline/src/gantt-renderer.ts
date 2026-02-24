/**
 * Gantt-style timeline renderer (--gantt flag).
 *
 * Shows duration bars with timeline axis for visual comparison.
 */

import chalk from 'chalk';
import type { TimelineAction, RenderOptions } from './types.js';
import { formatDuration, formatCost } from './formatters.js';
import { sanitizeForTerminal, redactAction } from './security.js';

/**
 * Render timeline as Gantt-style duration bars.
 *
 * @param actions - Actions to render
 * @param options - Render options
 * @returns Formatted Gantt chart string
 */
export function renderGanttTimeline(
  actions: TimelineAction[],
  options: RenderOptions
): string {
  const lines: string[] = [];

  // Sanitize and optionally redact
  let processedActions = actions.map(a => ({
    ...a,
    action: sanitizeForTerminal(a.action),
  }));

  if (options.redact) {
    processedActions = processedActions.map(a => redactAction(a));
  }

  // Group by flow
  const flowGroups = new Map<string, TimelineAction[]>();
  for (const action of processedActions) {
    const flowId = action.flow_id || 'untracked';
    if (!flowGroups.has(flowId)) {
      flowGroups.set(flowId, []);
    }
    flowGroups.get(flowId)!.push(action);
  }

  // Render each flow
  for (const [flowId, flowActions] of flowGroups) {
    // Sort by timestamp
    flowActions.sort((a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    // Calculate flow totals
    const totalCost = flowActions.reduce((sum, a) =>
      sum + (a.cost?.cost_usd || 0), 0
    );

    // Flow header
    lines.push('');
    lines.push(
      chalk.bold('Flow: ') +
      chalk.cyan(flowId) +
      chalk.gray(` (${flowActions.length} actions, `) +
      chalk.yellow(formatCost(totalCost)) +
      chalk.gray(')')
    );
    lines.push('');

    // Render Gantt chart
    lines.push(...renderGanttChart(flowActions, options));
  }

  return lines.join('\n');
}

/**
 * Render Gantt chart for a set of actions.
 *
 * @param actions - Actions to chart
 * @param options - Render options
 * @returns Formatted chart lines
 */
function renderGanttChart(
  actions: TimelineAction[],
  options: RenderOptions
): string[] {
  const lines: string[] = [];

  if (actions.length === 0) return lines;

  // Get time bounds
  const timestamps = actions.map(a => new Date(a.timestamp).getTime());
  const minTime = Math.min(...timestamps);
  const maxTime = Math.max(
    ...actions.map(a => {
      const start = new Date(a.timestamp).getTime();
      const duration = a.duration_ms || 0;
      return start + duration;
    })
  );

  const timeRange = maxTime - minTime;

  // Terminal width for bars (leave room for labels)
  const terminalWidth = process.stdout.columns || 80;
  const barWidth = Math.min(50, Math.max(30, terminalWidth - 40));

  // Table header
  lines.push(
    chalk.bold('Concept').padEnd(20) +
    chalk.bold('Duration').padEnd(12) +
    chalk.bold('Timeline')
  );
  lines.push('─'.repeat(Math.min(terminalWidth, 80)));

  // Render each action
  for (const action of actions) {
    const label = `${action.concept}.${action.action}`;
    const truncated = label.length > 18 ? label.substring(0, 15) + '...' : label;

    const duration = action.duration_ms || 0;
    const durationStr = formatDuration(duration);

    // Calculate bar position and length
    const startTime = new Date(action.timestamp).getTime();
    const startOffset = timeRange > 0 ? (startTime - minTime) / timeRange : 0;
    const durationRatio = timeRange > 0 ? duration / timeRange : 0;

    const barStart = Math.floor(startOffset * barWidth);
    const barLength = Math.max(1, Math.floor(durationRatio * barWidth));

    // Build bar with Unicode blocks
    const bar = renderBar(barStart, barLength, barWidth);

    lines.push(
      truncated.padEnd(20) +
      durationStr.padEnd(12) +
      bar
    );

    // Verbose details
    if (options.verbose && action.cost?.cost_usd) {
      lines.push(
        ' '.repeat(20) +
        chalk.gray(formatCost(action.cost.cost_usd)).padEnd(12) +
        chalk.gray(` (${action.model || 'unknown'})`)
      );
    }
  }

  lines.push('─'.repeat(Math.min(terminalWidth, 80)));

  // Time axis labels
  const startDate = new Date(minTime);
  const endDate = new Date(maxTime);

  const startLabel = startDate.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });

  const endLabel = endDate.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });

  const axisLabel =
    ' '.repeat(32) +
    chalk.gray(startLabel) +
    ' '.repeat(Math.max(0, barWidth - startLabel.length - endLabel.length)) +
    chalk.gray(endLabel);

  lines.push(axisLabel);
  lines.push('');

  return lines;
}

/**
 * Render a horizontal bar with Unicode blocks.
 * Adapted from koan-costs bar() function.
 *
 * @param start - Starting position
 * @param length - Bar length
 * @param totalWidth - Total width
 * @returns Formatted bar string
 */
function renderBar(start: number, length: number, totalWidth: number): string {
  const emptyBefore = '.'.repeat(start);
  const filled = chalk.cyan('█'.repeat(length));
  const emptyAfter = '.'.repeat(Math.max(0, totalWidth - start - length));

  return emptyBefore + filled + emptyAfter;
}
