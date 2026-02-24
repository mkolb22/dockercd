/**
 * Render execution plans to console.
 */

import chalk from 'chalk';
import { formatCost, formatDuration } from '@zen/koan-core';
import type { ExecutionPlan, RenderOptions } from './types.js';

const RULE = '━'.repeat(50);

/**
 * Render execution plan with optional verbose details.
 */
export function renderPlan(
  plan: ExecutionPlan,
  options: RenderOptions = {}
): string {
  const lines: string[] = [];

  // Header
  lines.push(chalk.cyan(RULE));
  lines.push(
    chalk.bold.cyan(`  Execution Plan: ${plan.pipeline_dsl}`)
  );
  lines.push(chalk.cyan(RULE));
  lines.push('');

  // Metadata
  lines.push(`Plan ID: ${chalk.yellow(plan.plan_id)}`);
  if (plan.story_id) {
    lines.push(`Story: ${chalk.yellow(plan.story_id)}`);
  }
  lines.push(`Status: ${formatStatus(plan.status)}`);
  lines.push('');

  // Validation errors
  if (!plan.validation.valid) {
    lines.push(chalk.red('Validation Errors:'));
    for (const error of plan.validation.errors) {
      lines.push(chalk.red(`  Step ${error.step}: ${error.message}`));
    }
    lines.push('');
  }

  // Validation warnings
  if (plan.validation.warnings.length > 0) {
    for (const warning of plan.validation.warnings) {
      lines.push(chalk.yellow(`⚠ ${warning}`));
    }
    lines.push('');
  }

  // Steps
  if (options.verbose) {
    lines.push(chalk.bold('Steps:'));
    lines.push('');
    for (const step of plan.steps) {
      lines.push(
        chalk.bold(
          `Step ${step.step_number}: ${step.concept}.${step.action}`
        )
      );
      lines.push(`  Status: ${formatStepStatus(step.status)}`);

      if (step.blocked_by && step.blocked_by.length > 0) {
        lines.push(
          chalk.gray(
            `  Blocked by: step${step.blocked_by.length > 1 ? 's' : ''} ${step.blocked_by.join(', ')}`
          )
        );
      }

      if (step.parallel_with && step.parallel_with.length > 0) {
        lines.push(
          chalk.gray(
            `  Parallel with: step${step.parallel_with.length > 1 ? 's' : ''} ${step.parallel_with.join(', ')}`
          )
        );
      }

      if (options.showPreconditions && step.preconditions.length > 0) {
        lines.push(chalk.gray('  Preconditions:'));
        for (const check of step.preconditions) {
          const icon = check.passed ? chalk.green('✓') : chalk.red('✗');
          lines.push(chalk.gray(`    ${icon} ${check.message}`));
        }
      }

      if (options.showSyncRules && step.sync_rules.length > 0) {
        lines.push(
          chalk.gray(`  Sync Rules: ${step.sync_rules.join(', ')}`)
        );
      }

      if (step.slo_expectations) {
        const slo = step.slo_expectations;
        const cost = formatCost(slo.expected_cost_usd);
        const duration = formatDuration(slo.expected_duration_ms);
        lines.push(
          chalk.gray(`  SLO: ${cost} | ${duration} expected`)
        );
      }

      if (step.instructions) {
        lines.push(chalk.gray(`  Instruction: ${step.instructions}`));
      }

      lines.push('');
    }
  } else {
    lines.push(chalk.bold('Steps:'));
    for (const step of plan.steps) {
      const statusIcon = getStatusIcon(step.status);
      const blockedNote =
        step.blocked_by && step.blocked_by.length > 0
          ? chalk.gray(` <- depends on step ${step.blocked_by.join(', ')}`)
          : '';
      const parallelNote =
        step.parallel_with && step.parallel_with.length > 0
          ? chalk.gray(` || parallel with step ${step.parallel_with.join(', ')}`)
          : '';

      lines.push(
        `  ${step.step_number}. ${statusIcon}  ${step.concept}.${step.action}${blockedNote}${parallelNote}`
      );
    }
    lines.push('');
  }

  // Summary
  const cost = formatCost(plan.estimated_cost_usd);
  const duration = formatDuration(plan.estimated_duration_ms);
  lines.push(chalk.bold(`Estimated: ${cost} | ${duration}`));
  lines.push('');

  return lines.join('\n');
}

/**
 * Render plan as JSON.
 */
export function renderPlanJson(plan: ExecutionPlan): string {
  return JSON.stringify(plan, null, 2);
}

/**
 * Format status with color.
 */
function formatStatus(status: string): string {
  switch (status) {
    case 'valid':
    case 'ready':
      return chalk.green(status);
    case 'invalid':
      return chalk.red(status);
    case 'in_progress':
      return chalk.yellow(status);
    case 'completed':
      return chalk.green(status);
    default:
      return chalk.gray(status);
  }
}

/**
 * Format step status with color.
 */
function formatStepStatus(status: string): string {
  switch (status) {
    case 'ready':
      return chalk.green(status);
    case 'blocked':
      return chalk.red(status);
    case 'pending':
      return chalk.yellow(status);
    case 'completed':
      return chalk.green(status);
    case 'skipped':
      return chalk.gray(status);
    default:
      return chalk.gray(status);
  }
}

/**
 * Get status icon.
 */
function getStatusIcon(status: string): string {
  switch (status) {
    case 'ready':
      return chalk.green('[ready]   ');
    case 'blocked':
      return chalk.red('[blocked] ');
    case 'pending':
      return chalk.yellow('[pending] ');
    case 'completed':
      return chalk.green('[done]    ');
    case 'skipped':
      return chalk.gray('[skipped] ');
    default:
      return chalk.gray('[?]       ');
  }
}

