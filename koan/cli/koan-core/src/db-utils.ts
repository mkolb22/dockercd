/**
 * Shared database accessor for CLI tools.
 * Lazy-loads better-sqlite3 to avoid hard dependency if not installed.
 */

let Database: any;

export function getDatabase(dbPath: string, readonly = false): any {
  if (!Database) {
    try {
      Database = require('better-sqlite3');
    } catch {
      return null;
    }
  }
  return new Database(dbPath, { readonly });
}
