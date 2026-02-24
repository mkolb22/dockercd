import { Command } from 'commander';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import { requireProjectRoot, loadProvenanceActions, wrapCliAction } from '@zen/koan-core';
import {
  loadLearningState,
  saveLearningState,
  extractPatterns,
  computeCalibration,
  generateSkill,
  getEligiblePatterns,
} from './learner.js';
import { formatPatterns, formatCalibration, formatSkill, formatEmpty } from './formatter.js';

export function createLearnCommand(): Command {
  const cmd = new Command('learn')
    .description('Advanced learning system for pattern recognition and skill generation')
    .version('1.0.0');

  cmd
    .command('patterns')
    .description('Show learned patterns from provenance history')
    .option('--update', 'Update patterns from latest provenance data')
    .action(wrapCliAction(async (options: Record<string, unknown>) => {
      const projectRoot = requireProjectRoot();

      const state = await loadLearningState(projectRoot);

      if (options.update) {
        const actions = await loadProvenanceActions(projectRoot);
        if (actions.length === 0) {
          formatEmpty();
          return;
        }
        state.patterns = extractPatterns(actions);
        await saveLearningState(projectRoot, state);
        console.log(chalk.green('✓ Patterns updated from provenance data\n'));
      }

      formatPatterns(state.patterns);
    }));

  cmd
    .command('calibration')
    .description('Show memory effectiveness calibration')
    .option('--update', 'Update calibration from latest provenance data')
    .action(wrapCliAction(async (options: Record<string, unknown>) => {
      const projectRoot = requireProjectRoot();

      const state = await loadLearningState(projectRoot);

      if (options.update) {
        const actions = await loadProvenanceActions(projectRoot);
        if (actions.length === 0) {
          formatEmpty();
          return;
        }
        state.calibration = computeCalibration(actions);
        await saveLearningState(projectRoot, state);
        console.log(chalk.green('✓ Calibration updated from provenance data\n'));
      }

      formatCalibration(state.calibration);
    }));

  cmd
    .command('generate-skill <pattern-id>')
    .description('Generate a skill from a learned pattern')
    .option('--save', 'Save skill to .claude/skills/auto-generated/')
    .action(wrapCliAction(async (patternId: string, options: Record<string, unknown>) => {
      const projectRoot = requireProjectRoot();

      const state = await loadLearningState(projectRoot);
      const pattern = state.patterns.find(p => p.id === patternId);

      if (!pattern) {
        console.error(chalk.red(`Error: Pattern '${patternId}' not found.`));
        console.log(chalk.gray('Available patterns:'));
        for (const p of state.patterns) {
          console.log(chalk.gray(`  - ${p.id}`));
        }
        process.exit(1);
      }

      const skill = generateSkill(pattern);
      formatSkill(skill);

      if (options.save) {
        const skillDir = join(projectRoot, '.claude/skills/auto-generated');
        if (!existsSync(skillDir)) {
          await mkdir(skillDir, { recursive: true });
        }
        const skillPath = join(skillDir, `${skill.name}.md`);
        await writeFile(skillPath, skill.content);
        console.log(chalk.green(`✓ Skill saved to ${skillPath}`));
      }
    }));

  cmd
    .command('eligible')
    .description('List patterns eligible for skill generation (5+ occurrences, 80%+ success)')
    .action(wrapCliAction(async () => {
      const projectRoot = requireProjectRoot();

      const state = await loadLearningState(projectRoot);
      const eligible = getEligiblePatterns(state.patterns);

      if (eligible.length === 0) {
        console.log(chalk.yellow('\nNo patterns eligible for skill generation yet.'));
        console.log(chalk.gray('Patterns need 5+ occurrences and 80%+ success rate.\n'));
        return;
      }

      console.log(chalk.bold.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
      console.log(chalk.bold.cyan('  Eligible for Skill Generation'));
      console.log(chalk.bold.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

      for (const pattern of eligible) {
        console.log(chalk.green(`  ✓ ${pattern.id}`));
        console.log(chalk.gray(`    ${pattern.occurrences} occurrences, ${(pattern.success_rate * 100).toFixed(1)}% success`));
      }
      console.log();

      console.log(chalk.bold('Generate skills with:'));
      for (const pattern of eligible) {
        console.log(chalk.cyan(`  koan learn generate-skill ${pattern.id} --save`));
      }
      console.log();
    }));

  cmd
    .command('update')
    .description('Update all learning data from provenance')
    .action(wrapCliAction(async () => {
      const projectRoot = requireProjectRoot();

      const actions = await loadProvenanceActions(projectRoot);
      if (actions.length === 0) {
        formatEmpty();
        return;
      }

      const state = await loadLearningState(projectRoot);
      state.patterns = extractPatterns(actions);
      state.calibration = computeCalibration(actions);
      await saveLearningState(projectRoot, state);

      console.log(chalk.green('✓ Learning state updated'));
      console.log(`  Patterns: ${state.patterns.length}`);
      console.log(`  Calibration categories: ${state.calibration.length}`);
      console.log();
    }));

  return cmd;
}
