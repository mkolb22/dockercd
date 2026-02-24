/**
 * Validation engine using Ajv
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { ValidateFunction, ErrorObject } from 'ajv';
import { parse as parseYaml } from 'yaml';
import fg from 'fast-glob';
import type { SchemaRegistryEntry, ValidationResult, ValidationError } from './types.js';
import { SCHEMA_REGISTRY } from './registry.js';

// Lazy import better-sqlite3
let BetterSqlite3: any;
function getSqliteDb(dbPath: string): any {
  if (!BetterSqlite3) {
    try {
      BetterSqlite3 = require('better-sqlite3');
    } catch {
      return null;
    }
  }
  return new BetterSqlite3(dbPath, { readonly: true });
}

// Dynamic imports to handle ESM/CJS compatibility
let Ajv: any;
let addFormats: any;

export class Validator {
  private ajv: any;
  private compiledSchemas = new Map<string, ValidateFunction>();
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  async initialize(): Promise<void> {
    if (!Ajv) {
      const ajvModule = await import('ajv');
      Ajv = ajvModule.default;
      const formatsModule = await import('ajv-formats');
      addFormats = formatsModule.default;
    }

    this.ajv = new Ajv({
      allErrors: true,
      verbose: true,
      strict: false,
    });
    addFormats(this.ajv);
  }

  /**
   * Load and compile all schemas from .claude/schemas/
   */
  async loadSchemas(): Promise<void> {
    await this.initialize();
    const schemasDir = join(this.projectRoot, '.claude', 'schemas');

    for (const entry of SCHEMA_REGISTRY) {
      const schemaPath = join(schemasDir, entry.schemaFile);
      try {
        const schemaContent = readFileSync(schemaPath, 'utf-8');
        const schema = JSON.parse(schemaContent);
        const validate = this.ajv.compile(schema);
        this.compiledSchemas.set(entry.schemaFile, validate);
      } catch (error) {
        throw new Error(
          `Failed to load schema ${entry.schemaFile}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  /**
   * Validate SQLite state databases alongside YAML files.
   */
  validateStateDb(): ValidationResult[] {
    const results: ValidationResult[] = [];
    const koanDir = join(this.projectRoot, 'koan');

    // Validate state.db
    const stateDb = join(koanDir, 'state', 'state.db');
    if (existsSync(stateDb)) {
      const db = getSqliteDb(stateDb);
      if (db) {
        try {
          const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
            .map((r: any) => r.name);
          const required = ['health', 'events', 'checkpoints'];
          for (const t of required) {
            if (!tables.includes(t)) {
              results.push({
                file: 'koan/state/state.db',
                schema: 'sqlite-state',
                valid: false,
                errors: [{ path: '/', message: `Missing required table: ${t}` }],
              });
            }
          }
          // Validate JSON data integrity in events
          const badEvents = db.prepare(
            "SELECT id FROM events WHERE json_valid(data) = 0"
          ).all();
          if (badEvents.length > 0) {
            results.push({
              file: 'koan/state/state.db',
              schema: 'sqlite-state',
              valid: false,
              errors: [{ path: '/events', message: `${badEvents.length} events with invalid JSON data` }],
            });
          }
          if (results.length === 0) {
            results.push({
              file: 'koan/state/state.db',
              schema: 'sqlite-state',
              valid: true,
            });
          }
        } catch (err) {
          results.push({
            file: 'koan/state/state.db',
            schema: 'sqlite-state',
            valid: false,
            parseError: err instanceof Error ? err.message : String(err),
          });
        } finally {
          db.close();
        }
      }
    }

    // Validate memory.db
    const memDb = join(koanDir, 'memory', 'memory.db');
    if (existsSync(memDb)) {
      const db = getSqliteDb(memDb);
      if (db) {
        try {
          const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
            .map((r: any) => r.name);
          if (!tables.includes('memories')) {
            results.push({
              file: 'koan/memory/memory.db',
              schema: 'sqlite-memory',
              valid: false,
              errors: [{ path: '/', message: 'Missing required table: memories' }],
            });
          } else {
            results.push({
              file: 'koan/memory/memory.db',
              schema: 'sqlite-memory',
              valid: true,
            });
          }
        } catch (err) {
          results.push({
            file: 'koan/memory/memory.db',
            schema: 'sqlite-memory',
            valid: false,
            parseError: err instanceof Error ? err.message : String(err),
          });
        } finally {
          db.close();
        }
      }
    }

    return results;
  }

  /**
   * Validate all koan/ YAML files, optionally filtered
   */
  async validateAll(filterSchema?: string, filterFile?: string): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];
    const koanDir = join(this.projectRoot, 'koan');

    // Include SQLite validation unless filtering to a specific YAML schema
    if (!filterSchema && !filterFile) {
      results.push(...this.validateStateDb());
    }

    for (const entry of SCHEMA_REGISTRY) {
      // Skip if filtering by schema and this isn't it
      if (filterSchema && entry.schemaFile !== `${filterSchema}.schema.json`) {
        continue;
      }

      const validate = this.compiledSchemas.get(entry.schemaFile);
      if (!validate) {
        throw new Error(`Schema ${entry.schemaFile} not loaded`);
      }

      // Determine glob pattern
      const pattern = entry.glob || `${entry.dir}/*.yaml`;
      const fullPattern = join(koanDir, pattern);

      // Find matching files
      const files = await fg(fullPattern, { onlyFiles: true });

      for (const file of files) {
        // Skip if filtering by file and this isn't it
        if (filterFile && !file.endsWith(filterFile)) {
          continue;
        }

        const relativePath = file.replace(this.projectRoot + '/', '');
        const result = this.validateFile(file, entry.schemaFile, validate);
        results.push({
          ...result,
          file: relativePath,
        });
      }
    }

    return results;
  }

  /**
   * Validate a single file
   */
  private validateFile(
    filePath: string,
    schemaFile: string,
    validate: ValidateFunction
  ): Omit<ValidationResult, 'file'> {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const data = parseYaml(content);

      const valid = validate(data);

      if (valid) {
        return {
          schema: schemaFile.replace('.schema.json', ''),
          valid: true,
        };
      } else {
        const errors: ValidationError[] = (validate.errors || []).map((err: ErrorObject) => ({
          path: err.instancePath || '/',
          message: err.message || 'Unknown error',
          expected: err.params ? JSON.stringify(err.params) : undefined,
          actual: err.data ? JSON.stringify(err.data) : undefined,
        }));

        return {
          schema: schemaFile.replace('.schema.json', ''),
          valid: false,
          errors,
        };
      }
    } catch (error) {
      // YAML parse error
      return {
        schema: schemaFile.replace('.schema.json', ''),
        valid: false,
        parseError: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
