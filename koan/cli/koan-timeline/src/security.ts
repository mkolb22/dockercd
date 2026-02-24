/**
 * Security validation for koan-timeline CLI.
 *
 * Implements SEC-001 through SEC-005 from architecture specification.
 */

import { resolve, relative } from 'path';

// SEC-001: ID validation pattern
const ID_PATTERN = /^[a-zA-Z0-9-_]+$/;

// SEC-003: ANSI escape sequence pattern
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

// SEC-005: Large dataset threshold
const LARGE_DATASET_THRESHOLD = 1000;

/**
 * SEC-001: Validate flow_id/action_id format.
 *
 * @param id - ID to validate
 * @param fieldName - Name of field for error messages
 * @throws Error if ID contains invalid characters
 */
export function validateId(id: string, fieldName: string): void {
  if (!ID_PATTERN.test(id)) {
    throw new Error(
      `Invalid ${fieldName}: "${id}". ` +
      `Must contain only alphanumeric characters, hyphens, and underscores.`
    );
  }
}

/**
 * SEC-002: Validate paths stay within koan/ directory.
 *
 * @param filePath - Path to validate
 * @param projectRoot - Project root directory
 * @returns true if path is within koan/, false otherwise
 */
export function validatePathWithinKoan(
  filePath: string,
  projectRoot: string
): boolean {
  const koanDir = resolve(projectRoot, 'koan');
  const resolved = resolve(filePath);
  const rel = relative(koanDir, resolved);

  // Path is invalid if it escapes koan/ or starts with absolute path separator
  return !rel.startsWith('..') && !rel.startsWith('/');
}

/**
 * SEC-003: Sanitize YAML strings for terminal output.
 * Strips ANSI escape sequences to prevent terminal injection.
 *
 * @param text - Text to sanitize
 * @returns Sanitized text
 */
export function sanitizeForTerminal(text: string): string {
  if (typeof text !== 'string') return String(text);
  return text.replace(ANSI_PATTERN, '');
}

/**
 * SEC-004: Redact sensitive data when requested.
 *
 * @param action - Timeline action to redact
 * @returns Action with sensitive fields masked
 */
export function redactAction<T extends {
  action_id: string;
  flow_id?: string;
  outputs?: { artifact_path?: string };
}>(action: T): T {
  return {
    ...action,
    action_id: action.action_id.substring(0, 8) + '***',
    flow_id: action.flow_id ? action.flow_id.substring(0, 8) + '***' : undefined,
    outputs: action.outputs ? {
      ...action.outputs,
      artifact_path: '***REDACTED***'
    } : undefined,
  };
}

/**
 * SEC-005: Warn on large datasets.
 *
 * @param count - Number of actions
 * @param forceFlag - Whether --force was set
 * @throws Process exit if threshold exceeded without --force
 */
export function checkDatasetSize(
  count: number,
  forceFlag: boolean
): void {
  if (count > LARGE_DATASET_THRESHOLD && !forceFlag) {
    console.warn(
      `Warning: ${count} actions found (>${LARGE_DATASET_THRESHOLD}). ` +
      `Use --force to process or add --from/--to filters.`
    );
    process.exit(1);
  }
}
