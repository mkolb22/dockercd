/**
 * @zen/koan-core — shared library for koan state access
 *
 * Provides project root discovery, YAML parsing, state loaders,
 * type guards, and shared type definitions for all koan CLI tools.
 */

// Types
export type {
  Status,
  Concept,
  Model,
  ActionStatus,
  Metadata,
  CostInfo,
  Story,
  Architecture,
  Implementation,
  ProvenanceAction,
  WorkflowState,
  BaseCliOptions,
} from './types.js';

// Parser
export { parseYamlFile, parseYamlFileSync } from './parser.js';

// Validators
export {
  validateStory,
  validateArchitecture,
  validateImplementation,
  validateProvenanceAction,
} from './validators.js';

// Loader
export {
  findProjectRoot,
  requireProjectRoot,
  loadStories,
  loadArchitectures,
  loadImplementations,
  loadProvenanceActions,
  loadAllWorkflowState,
} from './loader.js';

// State loader (SQLite)
export type {
  EventRecord,
  CheckpointRecord,
  HealthRecord,
} from './state-loader.js';
export {
  getStateDbPath,
  stateDbAvailable,
  loadEventsFromDb,
  loadProvenanceFromDb,
  loadCheckpointsFromDb,
  loadHealthFromDb,
} from './state-loader.js';

// Database utilities
export { getDatabase } from './db-utils.js';

// CLI utilities
export { handleCliError, wrapCliAction, createCommand } from './cli-utils.js';

// Date utilities
export type { RelativeUnit } from './date-utils.js';
export { parseRelativeDate, formatDuration } from './date-utils.js';

// Filters
export type { ProvenanceFilter } from './filters.js';
export { filterProvenanceActions } from './filters.js';

// Formatters
export {
  formatCost,
  formatTokens,
  formatBar,
  formatProgressBar,
  formatSectionHeader,
  formatEmpty,
  formatJson,
  formatModel,
  formatConcept,
  formatPercentage,
  modelColors,
} from './formatters.js';
