/**
 * Koan state loading utilities.
 * Finds project root, loads workflow items from koan/ directory.
 */

import { existsSync } from 'fs';
import { join, dirname } from 'path';
import fg from 'fast-glob';
import { parseYamlFile } from './parser.js';
import { validateStory, validateArchitecture, validateImplementation } from './validators.js';
import { stateDbAvailable, loadProvenanceFromDb } from './state-loader.js';
import type { Story, Architecture, Implementation, ProvenanceAction, WorkflowState } from './types.js';

const KOAN_DIR = 'koan';

/**
 * Promote arch_id and story_id from details to top level when missing.
 * Handles progressive disclosure format where agents may nest these fields.
 */
function normalizeImplementation(impl: Implementation): void {
  const details = impl.details;
  if (!impl.arch_id && typeof details?.arch_id === 'string') {
    impl.arch_id = details.arch_id;
  }
  if (!impl.story_id && typeof details?.story_id === 'string') {
    impl.story_id = details.story_id;
  }
}

/**
 * Find the project root by walking up the directory tree looking for koan/.
 * Returns the project root path, or null if not found within 10 levels.
 */
export function findProjectRoot(startDir: string = process.cwd()): string | null {
  let current = startDir;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(current, KOAN_DIR))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

/**
 * Find the project root or exit with an error.
 * Use this in CLI tools to avoid repeated null-check + process.exit boilerplate.
 */
export function requireProjectRoot(startDir?: string): string {
  const root = findProjectRoot(startDir);
  if (!root) {
    console.error('Error: Could not find project root (no koan/ directory found).');
    process.exit(1);
  }
  return root;
}

/**
 * Load stories from koan/stories/*.yaml
 */
export async function loadStories(projectRoot: string): Promise<Story[]> {
  const dir = join(projectRoot, KOAN_DIR, 'stories');
  if (!existsSync(dir)) return [];

  const files = await fg('*.yaml', { cwd: dir, absolute: true });
  const stories: Story[] = [];

  for (const file of files) {
    const data = await parseYamlFile<Story>(file);
    if (data && validateStory(data)) {
      stories.push(data);
    }
  }

  return stories;
}

/**
 * Load architectures from koan/architecture/*.yaml
 */
export async function loadArchitectures(projectRoot: string): Promise<Architecture[]> {
  const dir = join(projectRoot, KOAN_DIR, 'architecture');
  if (!existsSync(dir)) return [];

  const files = await fg('*.yaml', { cwd: dir, absolute: true });
  const architectures: Architecture[] = [];

  for (const file of files) {
    const data = await parseYamlFile<Architecture>(file);
    if (data && validateArchitecture(data)) {
      architectures.push(data);
    }
  }

  return architectures;
}

/**
 * Load implementations from koan/implementations/*.yaml
 */
export async function loadImplementations(projectRoot: string): Promise<Implementation[]> {
  const dir = join(projectRoot, KOAN_DIR, 'implementations');
  if (!existsSync(dir)) return [];

  const files = await fg('*.yaml', { cwd: dir, absolute: true });
  const implementations: Implementation[] = [];

  for (const file of files) {
    const data = await parseYamlFile<Implementation>(file);
    if (data && validateImplementation(data)) {
      normalizeImplementation(data);
      implementations.push(data);
    }
  }

  return implementations;
}

/**
 * Load provenance actions from SQLite state.db events table.
 */
export async function loadProvenanceActions(projectRoot: string): Promise<ProvenanceAction[]> {
  if (stateDbAvailable(projectRoot)) return loadProvenanceFromDb(projectRoot);
  return [];
}

/**
 * Load all workflow state (stories + architectures + implementations)
 */
export async function loadAllWorkflowState(projectRoot: string): Promise<WorkflowState> {
  const [stories, architectures, implementations] = await Promise.all([
    loadStories(projectRoot),
    loadArchitectures(projectRoot),
    loadImplementations(projectRoot),
  ]);

  return { stories, architectures, implementations };
}
