/**
 * Safe YAML parsing utilities.
 * Provides both async and sync variants.
 */

import { readFileSync } from 'fs';
import { readFile } from 'fs/promises';
import { parse as parseYaml } from 'yaml';

/**
 * Parse a YAML file asynchronously with graceful error handling.
 * Returns null on any failure (missing file, invalid YAML, etc.).
 */
export async function parseYamlFile<T>(filePath: string): Promise<T | null> {
  try {
    const content = await readFile(filePath, 'utf-8');
    return parseYaml(content) as T;
  } catch {
    return null;
  }
}

/**
 * Parse a YAML file synchronously with graceful error handling.
 * Returns null on any failure (missing file, invalid YAML, etc.).
 */
export function parseYamlFileSync<T>(filePath: string): T | null {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return parseYaml(content) as T;
  } catch {
    return null;
  }
}
