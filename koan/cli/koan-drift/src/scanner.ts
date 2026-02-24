/**
 * Directory scanner with file hashing
 */

import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import fg from 'fast-glob';
import { relative } from 'path';
import type { Category, FileEntry, CompareOptions } from './types.js';

/**
 * Default ignore patterns
 */
const DEFAULT_IGNORE_PATTERNS = [
  'settings.local.json',
  'mcp-config.json',
  '.DS_Store',
  '*.local.*',
];

/**
 * Determine category from relative path
 */
function getCategory(relativePath: string): Category {
  const firstSegment = relativePath.split('/')[0];

  switch (firstSegment) {
    case 'concepts':
      return 'concepts';
    case 'agents':
      return 'agents';
    case 'commands':
      return 'commands';
    case 'synchronizations':
      return 'synchronizations';
    case 'skills':
      return 'skills';
    case 'hooks':
      return 'hooks';
    default:
      return 'other';
  }
}

/**
 * Compute SHA256 hash of file contents
 */
async function hashFile(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Scan a directory and collect all files with hashes
 * @param directory - Absolute path to directory to scan
 * @param options - Optional compare options
 * @returns Array of file entries with hashes and metadata
 */
export async function scanDirectory(
  directory: string,
  options?: CompareOptions
): Promise<FileEntry[]> {
  const ignorePatterns = [
    ...DEFAULT_IGNORE_PATTERNS,
    ...(options?.ignorePatterns || []),
  ];

  // Find all files, excluding ignore patterns
  const files = await fg('**/*', {
    cwd: directory,
    absolute: true,
    onlyFiles: true,
    dot: true,
    ignore: ignorePatterns,
  });

  // Process each file
  const entries: FileEntry[] = [];

  for (const absolutePath of files) {
    const hash = await hashFile(absolutePath);
    let relativePath = relative(directory, absolutePath);

    // Strip .template suffix for comparison key
    if (relativePath.endsWith('.template')) {
      relativePath = relativePath.slice(0, -'.template'.length);
    }

    const category = getCategory(relativePath);

    entries.push({
      absolutePath,
      relativePath,
      hash,
      category,
    });
  }

  return entries;
}
