/**
 * CLI utilities for consistent error handling across koan tools.
 *
 * Provides standardized error formatting, action wrappers, and command
 * factory to eliminate duplicated boilerplate across CLI instances.
 */

import chalk from 'chalk';
import { Command } from 'commander';
import { requireProjectRoot } from './loader.js';

/**
 * Handles a CLI error by printing a formatted message and exiting.
 *
 * @param error - The error to handle (Error object or unknown value)
 * @param exitCode - The exit code to use (default: 1)
 * @returns Never returns (process.exit is called)
 *
 * @example
 * ```typescript
 * try {
 *   await riskyOperation();
 * } catch (error) {
 *   handleCliError(error);
 * }
 * ```
 */
export function handleCliError(error: unknown, exitCode = 1): never {
  const message = error instanceof Error ? error.message : String(error);
  console.error(chalk.red(`Error: ${message}`));
  process.exit(exitCode);
}

/**
 * Wraps an async action with automatic error handling.
 *
 * Use this to wrap command action handlers to eliminate try/catch boilerplate.
 * Any errors thrown by the action will be caught, formatted, and cause process exit.
 *
 * @param action - The async function to wrap
 * @returns A promise that resolves with the action's result or handles errors
 *
 * @example
 * ```typescript
 * program
 *   .command('analyze')
 *   .action(wrapCliAction(async (options) => {
 *     const data = await loadData();
 *     console.log(data);
 *   }));
 * ```
 */
export function wrapCliAction<T>(action: (...args: any[]) => Promise<T>): (...args: any[]) => Promise<T> {
  return (...args) => action(...args).catch(handleCliError);
}

/**
 * Create a CLI command with standard boilerplate (version, error wrapping, project root).
 *
 * The handler receives the parsed options object and the resolved project root,
 * eliminating the need for each tool to call `requireProjectRoot()` manually.
 *
 * @example
 * ```typescript
 * export function createCostsCommand(): Command {
 *   return createCommand('costs', 'Analyze cost analytics', async (options, projectRoot) => {
 *     const actions = await loadProvenanceActions(projectRoot);
 *     // ...
 *   })
 *     .option('--from <date>', 'Filter from date')
 *     .option('-j, --json', 'Output in JSON format');
 * }
 * ```
 */
export function createCommand(
  name: string,
  description: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Commander options are untyped; callers add their own types
  handler: (options: any, projectRoot: string) => Promise<void>,
): Command {
  return new Command(name)
    .description(description)
    .version('1.0.0')
    .action(wrapCliAction(async (...args: unknown[]) => {
      const projectRoot = requireProjectRoot();
      const options = args[0] ?? {};
      await handler(options, projectRoot);
    }));
}
