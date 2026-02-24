/**
 * Type definitions for koan-validate CLI
 */

export interface SchemaRegistryEntry {
  dir: string;          // koan/ subdirectory name
  schemaFile: string;   // JSON schema filename in .claude/schemas/
  glob?: string;        // Override glob pattern (e.g., provenance/actions/*.yaml)
}

export interface ValidationResult {
  file: string;         // Relative file path
  schema: string;       // Schema name
  valid: boolean;
  errors?: ValidationError[];
  parseError?: string;
}

export interface ValidationError {
  path: string;         // JSON pointer path
  message: string;
  expected?: string;
  actual?: string;
}

export interface ValidationSummary {
  total: number;
  passed: number;
  failed: number;
  parseErrors: number;
}

export interface ValidateOptions {
  verbose?: boolean;
  json?: boolean;
  schema?: string;
  file?: string;
}
