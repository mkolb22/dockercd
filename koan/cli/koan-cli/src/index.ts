import { Command } from 'commander';
import chalk from 'chalk';

const program = new Command();
program
  .name('koan')
  .description('Zen workflow state management CLI')
  .version('1.0.0');

// Dynamic registration — missing tools (minimal profile) are silently skipped
const tools = [
  { module: '@zen/koan-validate', factory: 'createValidateCommand' },
  { module: '@zen/koan-costs', factory: 'createCostsCommand' },
  { module: '@zen/koan-bridge', factory: 'createBridgeCommand' },
  { module: '@zen/koan-compose', factory: 'createComposeCommand' },
  { module: '@zen/koan-drift', factory: 'createDriftCommand' },
  { module: '@zen/koan-flow', factory: 'createFlowCommand' },
  { module: '@zen/koan-bench', factory: 'createBenchCommand' },
  { module: '@zen/koan-timeline', factory: 'createTimelineCommand' },
  { module: '@zen/koan-evolve', factory: 'createEvolveCommand' },
  { module: '@zen/koan-learn', factory: 'createLearnCommand' },
  { module: '@zen/koan-observe', factory: 'createObserveCommand' },
  { module: '@zen/koan-migrate', factory: 'createMigrateCommand' },
];

for (const tool of tools) {
  try {
    const mod = await import(tool.module);
    if (typeof mod[tool.factory] === 'function') {
      program.addCommand(mod[tool.factory]());
    }
  } catch {
    // Tool not installed — skip silently
  }
}

program.addHelpText('after', `\nUse ${chalk.cyan('koan <command> --help')} for command-specific options.`);
program.parse();
