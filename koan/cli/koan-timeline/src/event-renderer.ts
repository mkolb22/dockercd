/**
 * Event-based timeline renderer (default view).
 *
 * Shows vertical list of events with timestamps, indentation showing hierarchy,
 * and triggered_by relationships.
 */

import chalk from 'chalk';
import type { TimelineAction, RenderOptions } from './types.js';
import {
  formatDuration,
  formatCost,
  formatTimestamp,
  formatConcept,
  formatModel
} from './formatters.js';
import { sanitizeForTerminal, redactAction } from './security.js';

/**
 * Render timeline as vertical event list.
 *
 * @param actions - Actions to render
 * @param options - Render options
 * @returns Formatted timeline string
 */
export function renderEventTimeline(
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
    const totalDuration = flowActions.reduce((sum, a) =>
      sum + (a.duration_ms || 0), 0
    );

    // Flow header
    lines.push('');
    lines.push(
      chalk.bold('Flow: ') +
      chalk.cyan(flowId) +
      chalk.gray(` (${flowActions.length} actions, `) +
      chalk.yellow(formatCost(totalCost)) +
      chalk.gray(', ') +
      chalk.blue(formatDuration(totalDuration)) +
      chalk.gray(')')
    );
    lines.push('');

    // Build triggered_by hierarchy
    const hierarchy = buildHierarchy(flowActions);

    // Render each action with proper indentation
    for (const node of hierarchy) {
      lines.push(...renderNode(node, 0, options));
    }
  }

  return lines.join('\n');
}

/**
 * Hierarchy node for triggered_by relationships.
 */
interface HierarchyNode {
  action: TimelineAction;
  children: HierarchyNode[];
}

/**
 * Build hierarchy from triggered_by relationships.
 *
 * @param actions - Actions to organize
 * @returns Root nodes
 */
function buildHierarchy(actions: TimelineAction[]): HierarchyNode[] {
  const nodeMap = new Map<string, HierarchyNode>();
  const roots: HierarchyNode[] = [];

  // Create nodes
  for (const action of actions) {
    nodeMap.set(action.action_id, { action, children: [] });
  }

  // Link children to parents
  for (const action of actions) {
    const node = nodeMap.get(action.action_id)!;

    if (action.triggered_by) {
      const parent = nodeMap.get(action.triggered_by);
      if (parent) {
        parent.children.push(node);
      } else {
        // Parent not in this flow, treat as root
        roots.push(node);
      }
    } else {
      // No parent, this is a root
      roots.push(node);
    }
  }

  return roots;
}

/**
 * Render a hierarchy node with indentation.
 *
 * @param node - Node to render
 * @param depth - Indentation depth
 * @param options - Render options
 * @returns Formatted lines
 */
function renderNode(
  node: HierarchyNode,
  depth: number,
  options: RenderOptions
): string[] {
  const lines: string[] = [];
  const action = node.action;

  // Indentation
  const indent = '  '.repeat(depth);
  const connector = depth > 0 ? '+-* ' : '* ';

  // Timestamp
  const time = chalk.gray(formatTimestamp(action.timestamp, 'time'));

  // Concept.action
  const conceptAction =
    formatConcept(action.concept) +
    chalk.gray('.') +
    chalk.white(action.action);

  // Model
  const model = action.model ? formatModel(action.model) : '';

  // Duration
  const duration = action.duration_ms
    ? chalk.blue(formatDuration(action.duration_ms))
    : chalk.gray('-');

  // Cost
  const cost = action.cost?.cost_usd
    ? chalk.yellow(formatCost(action.cost.cost_usd))
    : chalk.gray('-');

  // Main line
  lines.push(
    time + ' ' +
    indent + connector +
    conceptAction + ' ' +
    model + ' ' +
    duration + ' ' +
    cost
  );

  // Verbose details
  if (options.verbose) {
    const verboseIndent = '           ' + indent + '  ';

    // Tokens
    if (action.cost?.input_tokens || action.cost?.output_tokens) {
      const inTokens = action.cost.input_tokens || 0;
      const outTokens = action.cost.output_tokens || 0;
      lines.push(
        verboseIndent +
        chalk.gray(`tokens: ${inTokens.toLocaleString()} in, ${outTokens.toLocaleString()} out`)
      );
    }

    // Triggered by
    if (action.triggered_by) {
      lines.push(
        verboseIndent +
        chalk.gray(`triggered_by: ${action.triggered_by}`)
      );
    }

    // Error
    if (action.error) {
      lines.push(
        verboseIndent +
        chalk.red(`error: ${action.error.type} - ${action.error.message}`)
      );
    }
  }

  // Render children
  for (const child of node.children) {
    lines.push(...renderNode(child, depth + 1, options));
  }

  return lines;
}

/**
 * Render empty state message.
 *
 * @returns Formatted empty state
 */
export function renderEmptyState(): string {
  return `
${chalk.bold.cyan('━'.repeat(60))}
${chalk.bold.cyan('  Koan Timeline')}
${chalk.bold.cyan('━'.repeat(60))}

${chalk.gray('  No provenance actions found matching the specified filters.')}
${chalk.gray('  Run /feature or /workflow to generate workflow data.')}

`;
}
