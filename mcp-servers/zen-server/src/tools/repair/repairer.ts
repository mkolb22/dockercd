/**
 * Code Repairer - Strategies for fixing code based on errors
 */

import { BaseStore } from "../../core/store.js";

/**
 * Store for tracking repair attempts and learning from them
 */
export class RepairStore extends BaseStore {
  constructor(dbPath: string) {
    super(dbPath);
    this.initTables();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS repair_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code_hash TEXT NOT NULL,
        original_code TEXT NOT NULL,
        error_type TEXT NOT NULL,
        error_message TEXT NOT NULL,
        strategy TEXT NOT NULL,
        suggestion TEXT NOT NULL,
        fixed_code TEXT,
        resolved INTEGER DEFAULT 0,
        iteration INTEGER NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_repair_error_type
        ON repair_history(error_type);

      CREATE INDEX IF NOT EXISTS idx_repair_resolved
        ON repair_history(resolved);

      CREATE TABLE IF NOT EXISTS repair_patterns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        error_pattern TEXT NOT NULL UNIQUE,
        fix_pattern TEXT NOT NULL,
        success_count INTEGER DEFAULT 0,
        failure_count INTEGER DEFAULT 0,
        language TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
    `);
  }

  /**
   * Record a repair attempt
   */
  recordAttempt(
    codeHash: string,
    originalCode: string,
    errorType: string,
    errorMessage: string,
    strategy: string,
    suggestion: string,
    iteration: number
  ): number {
    const result = this.execute(
      `INSERT INTO repair_history
         (code_hash, original_code, error_type, error_message, strategy, suggestion, iteration)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [codeHash, originalCode, errorType, errorMessage, strategy, suggestion, iteration]
    );
    return result.lastInsertRowid as number;
  }

  /**
   * Mark a repair as resolved
   */
  markResolved(id: number, fixedCode: string): void {
    this.execute(`UPDATE repair_history SET resolved = 1, fixed_code = ? WHERE id = ?`, [
      fixedCode,
      id,
    ]);
  }

  /**
   * Find similar past repairs that worked
   */
  findSimilarRepairs(
    errorType: string,
    limit: number = 5
  ): Array<{
    errorMessage: string;
    strategy: string;
    suggestion: string;
    fixedCode: string;
  }> {
    return this.query<{
      errorMessage: string;
      strategy: string;
      suggestion: string;
      fixedCode: string;
    }>(
      `SELECT error_message as errorMessage, strategy, suggestion, fixed_code as fixedCode
       FROM repair_history
       WHERE error_type = ? AND resolved = 1
       ORDER BY created_at DESC
       LIMIT ?`,
      [errorType, limit]
    );
  }

  /**
   * Get or create a repair pattern
   */
  getRepairPattern(
    errorPattern: string
  ): { fixPattern: string; successRate: number } | null {
    const row = this.queryOne<{
      fix_pattern: string;
      success_count: number;
      failure_count: number;
    }>(`SELECT fix_pattern, success_count, failure_count FROM repair_patterns WHERE error_pattern = ?`, [
      errorPattern,
    ]);

    if (!row) return null;

    const total = row.success_count + row.failure_count;
    return {
      fixPattern: row.fix_pattern,
      successRate: total > 0 ? row.success_count / total : 0,
    };
  }

  /**
   * Update pattern success/failure
   */
  updatePatternOutcome(errorPattern: string, success: boolean): void {
    const column = success ? "success_count" : "failure_count";
    this.execute(
      `UPDATE repair_patterns SET ${column} = ${column} + 1, updated_at = datetime('now') WHERE error_pattern = ?`,
      [errorPattern]
    );
  }

  /**
   * Add a new repair pattern
   */
  addPattern(errorPattern: string, fixPattern: string, language: string): void {
    this.execute(
      `INSERT OR REPLACE INTO repair_patterns (error_pattern, fix_pattern, language, success_count) VALUES (?, ?, ?, 1)`,
      [errorPattern, fixPattern, language]
    );
  }
}

/**
 * Repair strategies based on error types
 */
export const REPAIR_STRATEGIES: Record<
  string,
  {
    name: string;
    description: string;
    prompt: string;
  }
> = {
  type_error: {
    name: "Type Correction",
    description: "Fix type mismatches and type-related errors",
    prompt: `The code has a type error. Analyze the error and fix the type mismatch.
Common fixes:
- Add proper type annotations
- Cast values to correct types
- Fix function signatures
- Handle null/undefined properly`,
  },

  syntax_error: {
    name: "Syntax Fix",
    description: "Fix syntax errors like missing brackets, semicolons",
    prompt: `The code has a syntax error. Fix the syntax issue.
Common fixes:
- Add missing brackets, parentheses, or braces
- Fix string quotes
- Add missing semicolons (if required)
- Fix indentation (Python)`,
  },

  import_error: {
    name: "Import Resolution",
    description: "Fix missing or incorrect imports",
    prompt: `The code has an import error. Fix the import statement.
Common fixes:
- Add missing import statements
- Fix import paths
- Use correct export/import syntax
- Check for typos in module names`,
  },

  reference_error: {
    name: "Reference Fix",
    description: "Fix undefined variable or function references",
    prompt: `The code references something that doesn't exist. Fix the reference.
Common fixes:
- Define the missing variable or function
- Fix typos in variable names
- Import the missing dependency
- Check scope issues`,
  },

  runtime_error: {
    name: "Runtime Fix",
    description: "Fix errors that occur during execution",
    prompt: `The code has a runtime error. Fix the issue.
Common fixes:
- Add null/undefined checks
- Fix array index bounds
- Handle edge cases
- Add error handling`,
  },

  logic_error: {
    name: "Logic Correction",
    description: "Fix logical errors where code runs but produces wrong results",
    prompt: `The code has a logic error - it runs but produces incorrect results.
Common fixes:
- Review and fix conditional logic
- Check loop bounds and conditions
- Verify mathematical operations
- Fix off-by-one errors`,
  },

  test_failure: {
    name: "Test Fix",
    description: "Fix code to pass failing tests",
    prompt: `The code fails one or more tests. Fix the implementation to pass the tests.
Approach:
- Analyze the test expectations
- Understand what the test is checking
- Fix the implementation to match expected behavior
- Don't modify the tests unless they are clearly wrong`,
  },
};

/**
 * Determine the best repair strategy based on error
 */
export function selectStrategy(
  errorType: string,
  errorMessage: string,
  _language: string
): { strategy: string; prompt: string } {
  const normalizedType = errorType.toLowerCase();

  if (
    normalizedType.includes("type") ||
    normalizedType.includes("ts2") ||
    errorMessage.toLowerCase().includes("type")
  ) {
    return {
      strategy: "type_error",
      prompt: REPAIR_STRATEGIES.type_error.prompt,
    };
  }

  if (
    normalizedType.includes("syntax") ||
    normalizedType.includes("parse") ||
    errorMessage.toLowerCase().includes("unexpected token")
  ) {
    return {
      strategy: "syntax_error",
      prompt: REPAIR_STRATEGIES.syntax_error.prompt,
    };
  }

  if (
    normalizedType.includes("import") ||
    normalizedType.includes("module") ||
    errorMessage.toLowerCase().includes("cannot find module")
  ) {
    return {
      strategy: "import_error",
      prompt: REPAIR_STRATEGIES.import_error.prompt,
    };
  }

  if (
    normalizedType.includes("reference") ||
    normalizedType.includes("undefined") ||
    normalizedType.includes("not defined")
  ) {
    return {
      strategy: "reference_error",
      prompt: REPAIR_STRATEGIES.reference_error.prompt,
    };
  }

  if (
    normalizedType.includes("assert") ||
    normalizedType.includes("expect") ||
    errorMessage.toLowerCase().includes("expected")
  ) {
    return {
      strategy: "test_failure",
      prompt: REPAIR_STRATEGIES.test_failure.prompt,
    };
  }

  return {
    strategy: "runtime_error",
    prompt: REPAIR_STRATEGIES.runtime_error.prompt,
  };
}

/**
 * Generate a repair suggestion based on error context
 */
export function generateRepairSuggestion(
  code: string,
  errorType: string,
  errorMessage: string,
  file?: string,
  line?: number,
  language?: string
): string {
  const { strategy, prompt } = selectStrategy(errorType, errorMessage, language || "unknown");

  let suggestion = `## Repair Strategy: ${REPAIR_STRATEGIES[strategy]?.name || strategy}\n\n`;
  suggestion += `${prompt}\n\n`;
  suggestion += `## Error Details\n`;
  suggestion += `- Type: ${errorType}\n`;
  suggestion += `- Message: ${errorMessage}\n`;

  if (file && line) {
    suggestion += `- Location: ${file}:${line}\n`;
  }

  suggestion += `\n## Code to Fix\n\`\`\`\n${code}\n\`\`\`\n`;

  return suggestion;
}

/**
 * Create a simple hash of code for tracking
 */
export function hashCode(code: string): string {
  let hash = 0;
  for (let i = 0; i < code.length; i++) {
    const char = code.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return hash.toString(16);
}
