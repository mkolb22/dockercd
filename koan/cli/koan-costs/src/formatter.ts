import chalk from 'chalk';
import Table from 'cli-table3';
import asciichart from 'asciichart';
import { formatCost as usd, formatTokens as tokens, formatBar as bar, modelColors } from '@zen/koan-core';
import type { CostAnalytics, CostByDimension } from './types.js';

// Render dimension breakdown table
function renderBreakdownTable(title: string, data: CostByDimension[], colorFn?: (d: string) => string): void {
  if (data.length === 0) {
    console.log(chalk.gray('  No data\n'));
    return;
  }

  const maxCost = Math.max(...data.map(d => d.total_cost));

  const table = new Table({
    head: [chalk.bold('Name'), chalk.bold('Cost'), chalk.bold('Actions'), chalk.bold('Avg'), chalk.bold('Tokens'), chalk.bold('')],
    colWidths: [18, 12, 10, 12, 12, 34],
  });

  for (const row of data) {
    const name = colorFn ? colorFn(row.dimension) : row.dimension;
    table.push([
      name,
      usd(row.total_cost),
      row.count.toString(),
      usd(row.avg_cost),
      tokens(row.input_tokens + row.output_tokens),
      bar(row.total_cost, maxCost),
    ]);
  }

  console.log(chalk.bold(title));
  console.log(table.toString());
  console.log();
}

// Default formatted output
export function formatDefault(analytics: CostAnalytics): void {
  console.log(chalk.bold.cyan('\n\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501'));
  console.log(chalk.bold.cyan('  Koan Cost Analytics'));
  console.log(chalk.bold.cyan('\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n'));

  // Overview
  console.log(chalk.bold('Overview'));
  console.log('  Total spend: ' + chalk.bold.yellow(usd(analytics.total_cost)));
  console.log('  Total actions: ' + chalk.bold(analytics.total_actions.toString()));
  if (analytics.total_actions > 0) {
    console.log('  Avg per action: ' + usd(analytics.total_cost / analytics.total_actions));
  }
  console.log();

  // By concept
  renderBreakdownTable('Cost by Concept', analytics.by_concept);

  // By model
  renderBreakdownTable('Cost by Model', analytics.by_model, (d) => {
    const fn = modelColors[d] || chalk.white;
    return fn(d);
  });

  // By flow
  if (analytics.by_flow.length > 0 && analytics.by_flow[0].dimension !== 'untracked') {
    renderBreakdownTable('Cost by Workflow', analytics.by_flow);
  }

  console.log(chalk.bold.cyan('\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n'));
}

// Chart output with ASCII time series
export function formatChart(analytics: CostAnalytics): void {
  formatDefault(analytics);

  if (analytics.time_series.length < 2) {
    console.log(chalk.gray('  Not enough data points for chart (need >= 2 days)\n'));
    return;
  }

  console.log(chalk.bold('Cost Over Time'));
  console.log();

  const values = analytics.time_series.map(p => p.cost);
  const config = {
    height: 10,
    colors: [asciichart.cyan],
    format: (x: number) => ('$' + x.toFixed(3)).padStart(8),
  };

  console.log(asciichart.plot(values, config));
  console.log();

  // Date labels
  const dates = analytics.time_series.map(p => p.date.substring(5)); // MM-DD
  const first = dates[0];
  const last = dates[dates.length - 1];
  console.log('  ' + chalk.gray(first + ' '.repeat(Math.max(0, 40 - first.length - last.length)) + last));
  console.log();
}

// JSON output
export function formatJson(analytics: CostAnalytics): void {
  console.log(JSON.stringify(analytics, null, 2));
}

// Verbose output with per-action breakdown
export function formatVerbose(analytics: CostAnalytics, actions: Array<{ action_id: string; concept: string; action: string; model?: string; cost?: { cost_usd?: number }; timestamp: string }>): void {
  formatDefault(analytics);

  console.log(chalk.bold('Action Details'));
  const table = new Table({
    head: [chalk.bold('ID'), chalk.bold('Concept'), chalk.bold('Action'), chalk.bold('Model'), chalk.bold('Cost'), chalk.bold('Timestamp')],
    colWidths: [12, 16, 14, 10, 12, 22],
  });

  for (const a of actions) {
    const modelColor = modelColors[a.model || 'unknown'] || chalk.white;
    table.push([
      a.action_id,
      a.concept,
      a.action,
      modelColor(a.model || '-'),
      usd(a.cost?.cost_usd || 0),
      a.timestamp.substring(0, 19),
    ]);
  }

  console.log(table.toString());
  console.log();
}

// Token usage dashboard
export function formatTokens(analytics: CostAnalytics): void {
  console.log(chalk.bold.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.bold.cyan('  Token Usage Dashboard'));
  console.log(chalk.bold.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

  // Calculate totals
  const totalInput = analytics.by_concept.reduce((sum, c) => sum + c.input_tokens, 0);
  const totalOutput = analytics.by_concept.reduce((sum, c) => sum + c.output_tokens, 0);
  const totalTokens = totalInput + totalOutput;

  // Overview
  console.log(chalk.bold('Token Overview'));
  console.log('  Total tokens: ' + chalk.bold.yellow(tokens(totalTokens)));
  console.log('  Input tokens: ' + chalk.cyan(tokens(totalInput)) + chalk.gray(` (${((totalInput / totalTokens) * 100).toFixed(1)}%)`));
  console.log('  Output tokens: ' + chalk.magenta(tokens(totalOutput)) + chalk.gray(` (${((totalOutput / totalTokens) * 100).toFixed(1)}%)`));
  console.log('  Input/Output ratio: ' + chalk.bold((totalInput / totalOutput).toFixed(2) + ':1'));
  console.log();

  // Token breakdown by concept
  console.log(chalk.bold('Tokens by Concept'));
  const maxTokens = Math.max(...analytics.by_concept.map(c => c.input_tokens + c.output_tokens));

  const table = new Table({
    head: [chalk.bold('Concept'), chalk.bold('Input'), chalk.bold('Output'), chalk.bold('Total'), chalk.bold('% of Total'), chalk.bold('')],
    colWidths: [16, 12, 12, 12, 12, 34],
  });

  for (const row of analytics.by_concept) {
    const rowTotal = row.input_tokens + row.output_tokens;
    const pct = totalTokens > 0 ? ((rowTotal / totalTokens) * 100).toFixed(1) : '0.0';
    table.push([
      row.dimension,
      chalk.cyan(tokens(row.input_tokens)),
      chalk.magenta(tokens(row.output_tokens)),
      tokens(rowTotal),
      pct + '%',
      bar(rowTotal, maxTokens),
    ]);
  }

  console.log(table.toString());
  console.log();

  // Token breakdown by model
  console.log(chalk.bold('Tokens by Model'));
  const modelTable = new Table({
    head: [chalk.bold('Model'), chalk.bold('Input'), chalk.bold('Output'), chalk.bold('Total'), chalk.bold('Cost/1K')],
    colWidths: [16, 14, 14, 14, 14],
  });

  for (const row of analytics.by_model) {
    const modelColor = modelColors[row.dimension] || chalk.white;
    const rowTotal = row.input_tokens + row.output_tokens;
    const costPerK = rowTotal > 0 ? (row.total_cost / rowTotal) * 1000 : 0;
    modelTable.push([
      modelColor(row.dimension),
      chalk.cyan(tokens(row.input_tokens)),
      chalk.magenta(tokens(row.output_tokens)),
      tokens(rowTotal),
      usd(costPerK),
    ]);
  }

  console.log(modelTable.toString());
  console.log();

  // Efficiency metrics
  console.log(chalk.bold('Efficiency Metrics'));
  const avgTokensPerAction = analytics.total_actions > 0 ? totalTokens / analytics.total_actions : 0;
  const avgCostPerToken = totalTokens > 0 ? (analytics.total_cost / totalTokens) * 1000 : 0;
  console.log('  Avg tokens/action: ' + chalk.bold(tokens(avgTokensPerAction)));
  console.log('  Avg cost per 1K tokens: ' + chalk.bold(usd(avgCostPerToken)));
  console.log();

  console.log(chalk.bold.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));
}

// Empty state message
export function formatEmpty(): void {
  console.log(chalk.bold.cyan('\n\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501'));
  console.log(chalk.bold.cyan('  Koan Cost Analytics'));
  console.log(chalk.bold.cyan('\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n'));
  console.log(chalk.gray('  No provenance records found in koan/provenance/actions/'));
  console.log(chalk.gray('  Run a /feature or /workflow to generate provenance data.\n'));
}
