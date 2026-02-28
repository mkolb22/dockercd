/**
 * AST Index Store
 * SQLite-backed storage for symbols, references, and call relations
 */

import * as fs from "fs";
import { BaseStore } from "../../core/store.js";
import type { Symbol, Reference, CallRelation } from "../../core/types.js";
import { resolvePath } from "../../utils/project.js";

export interface IndexMetadata {
  lastUpdate: string;
  fileHashes: Record<string, string>;
  totalFiles: number;
  totalSymbols: number;
}

export class IndexStore extends BaseStore {
  constructor(indexPath: string) {
    super(`${indexPath}/index.db`);
    this.initTables();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS symbols (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        file TEXT NOT NULL,
        line INTEGER NOT NULL,
        column INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        end_column INTEGER NOT NULL,
        parent TEXT,
        signature TEXT,
        docstring TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
      CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file);
      CREATE INDEX IF NOT EXISTS idx_symbols_kind ON symbols(kind);

      CREATE TABLE IF NOT EXISTS references_ (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol_name TEXT NOT NULL,
        file TEXT NOT NULL,
        line INTEGER NOT NULL,
        column INTEGER NOT NULL,
        context TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_refs_symbol ON references_(symbol_name);
      CREATE INDEX IF NOT EXISTS idx_refs_file ON references_(file);

      CREATE TABLE IF NOT EXISTS calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        caller TEXT NOT NULL,
        caller_file TEXT NOT NULL,
        callee TEXT NOT NULL,
        line INTEGER NOT NULL,
        column INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_calls_caller ON calls(caller);
      CREATE INDEX IF NOT EXISTS idx_calls_callee ON calls(callee);

      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);
  }

  addSymbols(symbols: Symbol[]): void {
    this.batchInsert(
      `INSERT OR REPLACE INTO symbols
       (id, name, kind, file, line, column, end_line, end_column, parent, signature, docstring)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      symbols,
      (s) => [
        s.id,
        s.name,
        s.kind,
        s.file,
        s.line,
        s.column,
        s.endLine,
        s.endColumn,
        s.parent || null,
        s.signature || null,
        s.docstring || null,
      ]
    );
  }

  addReferences(references: Reference[]): void {
    this.batchInsert(
      `INSERT INTO references_ (symbol_name, file, line, column, context)
       VALUES (?, ?, ?, ?, ?)`,
      references,
      (r) => [r.symbolName, r.file, r.line, r.column, r.context]
    );
  }

  addCalls(calls: CallRelation[]): void {
    this.batchInsert(
      `INSERT INTO calls (caller, caller_file, callee, line, column)
       VALUES (?, ?, ?, ?, ?)`,
      calls,
      (c) => [c.caller, c.callerFile, c.callee, c.line, c.column]
    );
  }

  findSymbol(options: { query: string; kind?: string; limit?: number }): Symbol[] {
    let sql = `SELECT * FROM symbols WHERE name LIKE ?`;
    const params: unknown[] = [`%${options.query}%`];

    if (options.kind) {
      sql += ` AND kind = ?`;
      params.push(options.kind);
    }

    sql += ` ORDER BY
      CASE WHEN name = ? THEN 0
           WHEN name LIKE ? THEN 1
           ELSE 2 END,
      name
      LIMIT ?
    `;
    params.push(options.query, `${options.query}%`, options.limit || 10);

    return this.query<Record<string, unknown>>(sql, params).map(this.mapSymbol);
  }

  getSymbolInfo(options: { file: string; symbol: string; includeBody?: boolean; projectRoot?: string }): Symbol & { body?: string } | null {
    const row = this.queryOne<Record<string, unknown>>(
      `SELECT * FROM symbols WHERE file = ? AND name = ? LIMIT 1`,
      [options.file, options.symbol]
    );
    if (!row) return null;

    const symbol = this.mapSymbol(row);

    if (options.includeBody && options.projectRoot) {
      try {
        const absPath = resolvePath(options.projectRoot, symbol.file);
        const content = fs.readFileSync(absPath, "utf-8");
        const lines = content.split("\n");
        // line numbers are 1-based
        const body = lines.slice(symbol.line - 1, symbol.endLine).join("\n");
        return { ...symbol, body };
      } catch {
        return symbol; // File not readable, return without body
      }
    }

    return symbol;
  }

  findReferences(options: {
    file: string;
    symbol: string;
    includeDefinition?: boolean;
  }): Reference[] {
    const rows = this.query<Record<string, unknown>>(
      `SELECT * FROM references_ WHERE symbol_name = ? ORDER BY file, line`,
      [options.symbol]
    );

    let refs = rows.map(this.mapReference);

    if (!options.includeDefinition) {
      refs = refs.filter((r) => r.file !== options.file);
    }

    return refs;
  }

  getCallGraph(options: {
    file: string;
    symbol: string;
    depth: number;
    direction: "callers" | "callees" | "both";
  }): {
    symbol: string;
    file: string;
    callers: Array<{ name: string; file: string; line: number }>;
    callees: Array<{ name: string; file: string; line: number }>;
  } {
    const result = {
      symbol: options.symbol,
      file: options.file,
      callers: [] as Array<{ name: string; file: string; line: number }>,
      callees: [] as Array<{ name: string; file: string; line: number }>,
    };

    if (options.direction === "callers" || options.direction === "both") {
      const callers = this.query<Record<string, unknown>>(
        `SELECT DISTINCT caller, caller_file, line FROM calls
         WHERE callee = ? ORDER BY caller_file, line`,
        [options.symbol]
      );
      result.callers = callers.map((row) => ({
        name: row.caller as string,
        file: row.caller_file as string,
        line: row.line as number,
      }));
    }

    if (options.direction === "callees" || options.direction === "both") {
      const callees = this.query<Record<string, unknown>>(
        `SELECT DISTINCT callee, line FROM calls
         WHERE caller = ? AND caller_file = ? ORDER BY line`,
        [options.symbol, options.file]
      );
      result.callees = callees.map((row) => ({
        name: row.callee as string,
        file: options.file,
        line: row.line as number,
      }));
    }

    return result;
  }

  findImplementations(options: { interface: string; file?: string }): Symbol[] {
    const rows = this.query<Record<string, unknown>>(
      `SELECT * FROM symbols
       WHERE kind = 'class'
       AND (signature LIKE ? OR signature LIKE ?)`,
      [`%implements ${options.interface}%`, `%extends ${options.interface}%`]
    );
    return rows.map(this.mapSymbol);
  }

  getFileSymbols(options: { file: string; depth: number }): Symbol[] {
    let sql = `SELECT * FROM symbols WHERE file = ?`;
    if (options.depth === 1) {
      sql += ` AND parent IS NULL`;
    }
    sql += ` ORDER BY line`;

    return this.query<Record<string, unknown>>(sql, [options.file]).map(this.mapSymbol);
  }

  searchBySignature(options: {
    params?: string[];
    returnType?: string;
    limit?: number;
  }): Symbol[] {
    let sql = `SELECT * FROM symbols WHERE (kind = 'function' OR kind = 'method')`;
    const params: unknown[] = [];

    if (options.params && options.params.length > 0) {
      for (const param of options.params) {
        sql += ` AND signature LIKE ?`;
        params.push(`%${param}%`);
      }
    }

    if (options.returnType) {
      sql += ` AND signature LIKE ?`;
      params.push(`%${options.returnType}%`);
    }

    sql += ` LIMIT ?`;
    params.push(options.limit || 10);

    return this.query<Record<string, unknown>>(sql, params).map(this.mapSymbol);
  }

  getMetadata(): IndexMetadata {
    const rows = this.query<{ key: string; value: string }>(
      `SELECT key, value FROM metadata`
    );

    const metadata: Record<string, string> = {};
    for (const row of rows) {
      metadata[row.key] = row.value;
    }

    return {
      lastUpdate: metadata.lastUpdate || "",
      fileHashes: metadata.fileHashes ? JSON.parse(metadata.fileHashes) : {},
      totalFiles: parseInt(metadata.totalFiles || "0", 10),
      totalSymbols: parseInt(metadata.totalSymbols || "0", 10),
    };
  }

  updateMetadata(metadata: Partial<IndexMetadata>): void {
    this.transaction(() => {
      if (metadata.lastUpdate) {
        this.execute(
          `INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)`,
          ["lastUpdate", metadata.lastUpdate]
        );
      }
      if (metadata.fileHashes) {
        this.execute(
          `INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)`,
          ["fileHashes", JSON.stringify(metadata.fileHashes)]
        );
      }
      if (metadata.totalFiles !== undefined) {
        this.execute(
          `INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)`,
          ["totalFiles", String(metadata.totalFiles)]
        );
      }
      if (metadata.totalSymbols !== undefined) {
        this.execute(
          `INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)`,
          ["totalSymbols", String(metadata.totalSymbols)]
        );
      }
    });
  }

  /**
   * Get all symbols (for bulk operations like KG ingestion)
   */
  getAllSymbols(kind?: string): Symbol[] {
    if (kind) {
      return this.query<Record<string, unknown>>(
        `SELECT * FROM symbols WHERE kind = ? ORDER BY file, line`,
        [kind]
      ).map(this.mapSymbol);
    }
    return this.query<Record<string, unknown>>(
      `SELECT * FROM symbols ORDER BY file, line`,
      []
    ).map(this.mapSymbol);
  }

  /**
   * Get all call relations (for bulk operations like KG ingestion)
   */
  getAllCalls(): CallRelation[] {
    return this.query<Record<string, unknown>>(
      `SELECT * FROM calls ORDER BY caller_file, line`,
      []
    ).map(row => ({
      caller: row.caller as string,
      callerFile: row.caller_file as string,
      callee: row.callee as string,
      line: row.line as number,
      column: row.column as number,
    }));
  }

  /**
   * Get all unique files in the index
   */
  getIndexedFiles(): string[] {
    return this.query<{ file: string }>(
      `SELECT DISTINCT file FROM symbols ORDER BY file`,
      []
    ).map(row => row.file);
  }

  clearIndex(): void {
    this.db.exec(`
      DELETE FROM symbols;
      DELETE FROM references_;
      DELETE FROM calls;
      DELETE FROM metadata;
    `);
  }

  private mapSymbol(row: Record<string, unknown>): Symbol {
    return {
      id: row.id as string,
      name: row.name as string,
      kind: row.kind as string,
      file: row.file as string,
      line: row.line as number,
      column: row.column as number,
      endLine: row.end_line as number,
      endColumn: row.end_column as number,
      parent: row.parent as string | undefined,
      signature: row.signature as string | undefined,
      docstring: row.docstring as string | undefined,
    };
  }

  private mapReference(row: Record<string, unknown>): Reference {
    return {
      symbolName: row.symbol_name as string,
      file: row.file as string,
      line: row.line as number,
      column: row.column as number,
      context: row.context as string,
    };
  }
}
