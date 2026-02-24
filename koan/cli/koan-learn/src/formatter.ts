import chalk from 'chalk';
import Table from 'cli-table3';
import { formatProgressBar as bar } from '@zen/koan-core';
import type { LearnedPattern, MemoryCalibration, SkillTemplate } from './types.js';

const confidenceColors = {
  high: chalk.green,
  medium: chalk.yellow,
  low: chalk.gray,
};

function pct(value: number): string {
  return (value * 100).toFixed(1) + '%';
}

export function formatPatterns(patterns: LearnedPattern[]): void {
  console.log(chalk.bold.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.bold.cyan('  Learned Patterns'));
  console.log(chalk.bold.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

  if (patterns.length === 0) {
    console.log(chalk.gray('  No patterns detected yet.'));
    console.log(chalk.gray('  Run more workflows to build pattern history.\n'));
    return;
  }

  const table = new Table({
    head: [chalk.bold('Pattern'), chalk.bold('Count'), chalk.bold('Success'), chalk.bold('Confidence'), chalk.bold('')],
    colWidths: [30, 10, 12, 14, 24],
  });

  for (const pattern of patterns) {
    const colorFn = confidenceColors[pattern.confidence];
    table.push([
      pattern.name,
      pattern.occurrences.toString(),
      pct(pattern.success_rate),
      colorFn(pattern.confidence),
      bar(pattern.success_rate),
    ]);
  }

  console.log(table.toString());
  console.log();

  // Summary
  const eligible = patterns.filter(p => p.occurrences >= 5 && p.success_rate >= 0.8);
  console.log(chalk.bold('Summary'));
  console.log(`  Total patterns: ${patterns.length}`);
  console.log(`  High confidence: ${patterns.filter(p => p.confidence === 'high').length}`);
  console.log(`  Eligible for skill generation: ${eligible.length}`);
  console.log();
}

export function formatCalibration(calibration: MemoryCalibration[]): void {
  console.log(chalk.bold.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.bold.cyan('  Memory Calibration'));
  console.log(chalk.bold.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

  if (calibration.length === 0) {
    console.log(chalk.gray('  No calibration data yet.'));
    console.log(chalk.gray('  Run workflows to measure memory effectiveness.\n'));
    return;
  }

  const table = new Table({
    head: [chalk.bold('Category'), chalk.bold('Injections'), chalk.bold('Success'), chalk.bold('Effectiveness'), chalk.bold('Confidence')],
    colWidths: [20, 14, 12, 16, 14],
  });

  for (const cal of calibration) {
    const colorFn = confidenceColors[cal.confidence];
    table.push([
      cal.category,
      cal.total_injections.toString(),
      cal.led_to_success.toString(),
      pct(cal.effectiveness),
      colorFn(cal.confidence),
    ]);
  }

  console.log(table.toString());
  console.log();

  // Recommendations
  const lowPerformers = calibration.filter(c => c.effectiveness < 0.7 && c.total_injections >= 5);
  if (lowPerformers.length > 0) {
    console.log(chalk.bold.yellow('Recommendations'));
    for (const low of lowPerformers) {
      console.log(chalk.yellow(`  ⚠ ${low.category}: ${pct(low.effectiveness)} effectiveness - review stored memories`));
    }
    console.log();
  }
}

export function formatSkill(skill: SkillTemplate): void {
  console.log(chalk.bold.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.bold.cyan('  Generated Skill'));
  console.log(chalk.bold.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

  console.log(chalk.bold(`Name: ${skill.name}`));
  console.log(`From pattern: ${skill.pattern_id}`);
  console.log(`Success rate: ${pct(skill.success_rate)}`);
  console.log();

  console.log(chalk.gray('─'.repeat(40)));
  console.log(skill.content);
  console.log(chalk.gray('─'.repeat(40)));
  console.log();
}

export function formatEmpty(): void {
  console.log(chalk.bold.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.bold.cyan('  Koan Learning System'));
  console.log(chalk.bold.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));
  console.log(chalk.gray('  No provenance data found.'));
  console.log(chalk.gray('  Run /feature or /workflow to generate learning data.\n'));
}
