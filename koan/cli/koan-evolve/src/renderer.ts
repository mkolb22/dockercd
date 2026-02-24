/**
 * Output formatting with chalk.
 */

import chalk from 'chalk';
import type { FitnessState, FitnessScore, ConceptFitness } from './types.js';

/**
 * Render fitness status for all concepts.
 */
export function renderStatus(concepts: ConceptFitness[]): string {
  if (concepts.length === 0) {
    return chalk.yellow('No fitness data available yet.');
  }

  const lines: string[] = [];
  lines.push(chalk.bold.cyan('\nEvolution Status'));
  lines.push(chalk.dim('─'.repeat(80)));
  lines.push('');

  for (const concept of concepts) {
    const trendIcon = getTrendIcon(concept.trend);
    const fitnessColor = getFitnessColor(concept.current_fitness);

    lines.push(
      `${chalk.bold(concept.concept.padEnd(20))} ` +
      `${chalk.dim('variant:')} ${concept.current_variant.padEnd(12)} ` +
      `${chalk.dim('fitness:')} ${fitnessColor(concept.current_fitness.toFixed(2))} ${trendIcon} ` +
      `${chalk.dim('runs:')} ${concept.runs} ` +
      `${chalk.dim('variants:')} ${concept.variant_count}`
    );
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Render detailed fitness information for a concept.
 */
export function renderFitness(state: FitnessState, verbose: boolean): string {
  const lines: string[] = [];
  lines.push(chalk.bold.cyan(`\nFitness: ${state.concept}`));
  lines.push(chalk.dim('─'.repeat(80)));
  lines.push('');

  lines.push(`${chalk.dim('Current Variant:')} ${chalk.bold(state.current_variant)}`);
  lines.push(`${chalk.dim('Total Variants:')} ${state.variants.length}`);
  lines.push(`${chalk.dim('Promotion Threshold:')} +${(state.promotion_threshold * 100).toFixed(0)}%`);
  lines.push(`${chalk.dim('Minimum Runs:')} ${state.minimum_runs}`);
  lines.push('');

  // Render each variant
  for (const variant of state.variants) {
    lines.push(renderVariant(variant, variant.variant_id === state.current_variant, verbose));
  }

  return lines.join('\n');
}

/**
 * Render a single variant.
 */
function renderVariant(variant: FitnessScore, isCurrent: boolean, verbose: boolean): string {
  const lines: string[] = [];
  const prefix = isCurrent ? chalk.green('') : '  ';
  const label = isCurrent ? chalk.bold.green(variant.variant_id) : chalk.dim(variant.variant_id);
  const trendIcon = getTrendIcon(variant.fitness.trend);
  const fitnessColor = getFitnessColor(variant.fitness.current);

  lines.push(
    `${prefix}${label} ` +
    `${chalk.dim('fitness:')} ${fitnessColor(variant.fitness.current.toFixed(2))} ${trendIcon} ` +
    `${chalk.dim('runs:')} ${variant.runs}`
  );

  if (verbose) {
    lines.push(`  ${chalk.dim('├─ test_pass_rate:')} ${variant.metrics.test_pass_rate.toFixed(2)}`);
    lines.push(`  ${chalk.dim('├─ quality_score:')} ${variant.metrics.quality_score.toFixed(2)}`);
    lines.push(`  ${chalk.dim('├─ user_acceptance:')} ${variant.metrics.user_acceptance.toFixed(2)}`);
    lines.push(`  ${chalk.dim('└─ rolling_avg_10:')} ${variant.fitness.rolling_avg_10.toFixed(2)}`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Render as JSON.
 */
export function renderJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

/**
 * Get trend icon.
 */
function getTrendIcon(trend: 'improving' | 'stable' | 'degrading'): string {
  switch (trend) {
    case 'improving':
      return chalk.green('▲');
    case 'degrading':
      return chalk.red('▼');
    default:
      return chalk.yellow('─');
  }
}

/**
 * Get color for fitness score.
 */
function getFitnessColor(fitness: number): (text: string) => string {
  if (fitness >= 0.8) return chalk.green;
  if (fitness >= 0.6) return chalk.yellow;
  return chalk.red;
}

/**
 * Render debate result (Phase 5.4).
 */
export function renderDebate(debate: any): string {
  const lines: string[] = [];

  lines.push(chalk.bold(`\nDebate: ${debate.arch_id}`));
  lines.push(chalk.gray('='.repeat(60)));

  // Advocate section
  lines.push(chalk.green('\nAdvocate Position:'));
  lines.push(`  Approach: ${debate.advocate.proposed_approach}`);
  lines.push(`  Confidence: ${(debate.advocate.confidence * 100).toFixed(0)}%`);
  if (debate.advocate.key_arguments && debate.advocate.key_arguments.length > 0) {
    lines.push('  Arguments:');
    for (const arg of debate.advocate.key_arguments) {
      lines.push(`    - ${arg}`);
    }
  }

  // Critic section
  lines.push(chalk.red('\nCritic Concerns:'));
  lines.push(`  Confidence: ${(debate.critic.confidence * 100).toFixed(0)}%`);
  lines.push(`  Risk: ${debate.critic.risk_assessment}`);
  if (debate.critic.concerns && debate.critic.concerns.length > 0) {
    lines.push('  Issues:');
    for (const concern of debate.critic.concerns) {
      const severityColor = concern.severity === 'high' ? chalk.red : concern.severity === 'medium' ? chalk.yellow : chalk.gray;
      lines.push(`    ${severityColor(`[${concern.severity.toUpperCase()}]`)} ${concern.concern}`);
      if (concern.suggestion) {
        lines.push(`      → ${concern.suggestion}`);
      }
    }
  }

  // Synthesis section
  lines.push(chalk.cyan('\nSynthesis Decision:'));
  lines.push(`  Final: ${debate.synthesis.final_decision}`);
  lines.push(`  Confidence: ${(debate.synthesis.confidence * 100).toFixed(0)}%`);
  lines.push(`  Recommendation: ${debate.synthesis.recommendation.toUpperCase()}`);

  if (debate.synthesis.incorporated_concerns && debate.synthesis.incorporated_concerns.length > 0) {
    lines.push('  Addressed:');
    for (const concern of debate.synthesis.incorporated_concerns) {
      lines.push(`    ✓ ${concern}`);
    }
  }

  if (debate.synthesis.remaining_risks && debate.synthesis.remaining_risks.length > 0) {
    lines.push('  Remaining Risks:');
    for (const risk of debate.synthesis.remaining_risks) {
      lines.push(`    ! ${risk}`);
    }
  }

  // Metadata
  lines.push(chalk.gray('\nMetadata:'));
  lines.push(chalk.gray(`  Duration: ${debate.duration_ms}ms`));
  lines.push(chalk.gray(`  Cost: $${debate.metadata.cost.toFixed(4)}`));
  lines.push(chalk.gray(`  Sanitized: ${debate.metadata.sanitization_applied ? 'Yes' : 'No'}`));

  return lines.join('\n');
}
