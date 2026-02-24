/**
 * Configuration drift detection types
 */

/**
 * Category of file based on first directory segment
 */
export type Category =
  | 'concepts'
  | 'agents'
  | 'commands'
  | 'synchronizations'
  | 'skills'
  | 'hooks'
  | 'other';

/**
 * File entry with hash and metadata
 */
export interface FileEntry {
  /** Absolute path to the file */
  absolutePath: string;
  /** Relative path from directory root (without .template suffix) */
  relativePath: string;
  /** SHA256 hash of file contents */
  hash: string;
  /** Category based on first directory segment */
  category: Category;
}

/**
 * File that has drifted
 */
export interface DriftFile {
  /** Relative path (comparison key) */
  relativePath: string;
  /** Category */
  category: Category;
  /** Path in templates directory (if exists) */
  templatePath?: string;
  /** Path in installed directory (if exists) */
  installedPath?: string;
  /** Unified diff (only for modified files when requested) */
  diff?: string;
}

/**
 * Complete drift report
 */
export interface DriftReport {
  /** Files that exist in both but have different hashes */
  modified: DriftFile[];
  /** Files that exist in templates but not in installed */
  missing: DriftFile[];
  /** Files that exist in installed but not in templates */
  added: DriftFile[];
}

/**
 * Options for directory comparison
 */
export interface CompareOptions {
  /** Patterns to ignore (glob patterns) */
  ignorePatterns?: string[];
}

/**
 * CLI options
 */
export interface CliOptions {
  /** Output format */
  json?: boolean;
  /** Filter to specific category */
  category?: Category;
  /** Show diffs for modified files */
  showDiffs?: boolean;
  /** Ignore added files */
  ignoreAdded?: boolean;
  /** Verbose output (show file names) */
  verbose?: boolean;
}
