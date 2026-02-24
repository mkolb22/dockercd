/**
 * Base Store for SQLite-backed data persistence
 * Common database patterns used by all tool modules
 */

import Database from "better-sqlite3";
import * as path from "path";
import * as fs from "fs";

/**
 * Abstract base class for SQLite-backed stores
 * Provides common CRUD operations and database management
 */
export abstract class BaseStore {
  protected db: Database.Database;
  protected dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;

    // Ensure directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Initialize database with WAL mode for better concurrency
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
  }

  /**
   * Execute a query that returns rows
   */
  protected query<T>(sql: string, params: unknown[] = []): T[] {
    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as T[];
  }

  /**
   * Execute a query that returns a single row
   */
  protected queryOne<T>(sql: string, params: unknown[] = []): T | undefined {
    const stmt = this.db.prepare(sql);
    return stmt.get(...params) as T | undefined;
  }

  /**
   * Execute a statement (INSERT, UPDATE, DELETE)
   */
  protected execute(sql: string, params: unknown[] = []): Database.RunResult {
    const stmt = this.db.prepare(sql);
    return stmt.run(...params);
  }

  /**
   * Execute multiple statements in a transaction
   */
  protected transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  /**
   * Batch insert with transaction
   */
  protected batchInsert<T>(
    sql: string,
    items: T[],
    mapper: (item: T) => unknown[]
  ): void {
    const stmt = this.db.prepare(sql);
    const insertMany = this.db.transaction((data: T[]) => {
      for (const item of data) {
        stmt.run(...mapper(item));
      }
    });
    insertMany(items);
  }

  /**
   * Create a table if it doesn't exist
   */
  protected ensureTable(name: string, schema: string): void {
    this.db.exec(`CREATE TABLE IF NOT EXISTS ${name} (${schema})`);
  }

  /**
   * Create an index if it doesn't exist
   */
  protected ensureIndex(
    indexName: string,
    tableName: string,
    columns: string,
    unique: boolean = false
  ): void {
    const uniqueClause = unique ? "UNIQUE" : "";
    this.db.exec(
      `CREATE ${uniqueClause} INDEX IF NOT EXISTS ${indexName} ON ${tableName} (${columns})`
    );
  }

  /**
   * Check if a table exists
   */
  protected tableExists(name: string): boolean {
    const result = this.queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name=?`,
      [name]
    );
    return result?.count === 1;
  }

  /**
   * Get row count for a table
   */
  protected getRowCount(tableName: string): number {
    const result = this.queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM ${tableName}`
    );
    return result?.count ?? 0;
  }

  /**
   * Clear all data from a table
   */
  protected clearTable(tableName: string): void {
    this.execute(`DELETE FROM ${tableName}`);
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }

  /**
   * Get database statistics
   */
  getStats(): { path: string; tables: string[]; rowCounts: Record<string, number> } {
    const tables = this.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
    ).map((t) => t.name);

    const rowCounts: Record<string, number> = {};
    for (const table of tables) {
      if (!table.startsWith("sqlite_")) {
        rowCounts[table] = this.getRowCount(table);
      }
    }

    return {
      path: this.dbPath,
      tables,
      rowCounts,
    };
  }
}
