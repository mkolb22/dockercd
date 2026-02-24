import { Command } from 'commander';
import { basename } from 'path';
import { requireProjectRoot, wrapCliAction } from '@zen/koan-core';
import {
  exportMemories,
  importMemories,
  searchMemories,
  listMemories,
  renderExportResult,
  renderImportResult,
  renderSearchResults,
  renderMemoryList,
} from './bridge.js';

export function createBridgeCommand(): Command {
  const cmd = new Command('bridge')
    .description('Cross-project memory bridge — share learnings between projects')
    .version('1.0.0');

  cmd
    .command('export')
    .description('Export local memories to global store')
    .option('--name <name>', 'Project name (defaults to directory name)')
    .action(wrapCliAction(async (opts) => {
      const projectRoot = requireProjectRoot();
      const projectName = opts.name || basename(projectRoot);
      const result = exportMemories(projectRoot, projectName);
      console.log(renderExportResult(result, projectName));
    }));

  cmd
    .command('import')
    .description('Import relevant global memories into this project')
    .option('-q, --query <query>', 'Filter by keyword or tag')
    .option('-p, --project <project>', 'Filter by source project')
    .action(wrapCliAction(async (opts) => {
      const projectRoot = requireProjectRoot();
      const result = importMemories(projectRoot, undefined, opts.query, opts.project);
      console.log(renderImportResult(result));
    }));

  cmd
    .command('search <query>')
    .description('Search global memories by keyword or tag')
    .option('-p, --project <project>', 'Filter by source project')
    .action(wrapCliAction(async (query, opts) => {
      const results = searchMemories(undefined, query, opts.project);
      console.log(renderSearchResults(results, query));
    }));

  cmd
    .command('list')
    .description('List available global memories')
    .option('-p, --project <project>', 'Filter by source project')
    .action(wrapCliAction(async (opts) => {
      const memories = listMemories(undefined, opts.project);
      console.log(renderMemoryList(memories, opts.project));
    }));

  return cmd;
}
