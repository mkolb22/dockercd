/**
 * Project and file utilities
 */

import * as fs from "fs";
import * as path from "path";
import fg from "fast-glob";

/**
 * Get project root from environment or current working directory
 */
export function getProjectRoot(): string {
  return process.env.PROJECT_ROOT || process.cwd();
}

/**
 * Read a file, returning null if it doesn't exist
 */
export async function readFileSafe(filePath: string): Promise<string | null> {
  try {
    return await fs.promises.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Check if a file exists
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get file hash based on size and modification time
 * Fast alternative to content hashing for change detection
 */
export async function getFileHash(filePath: string): Promise<string> {
  const stat = await fs.promises.stat(filePath);
  return `${stat.size}-${stat.mtime.getTime()}`;
}

/**
 * Resolve a path relative to project root
 */
export function resolvePath(projectRoot: string, filePath: string): string {
  return path.isAbsolute(filePath)
    ? filePath
    : path.join(projectRoot, filePath);
}

/**
 * Get relative path from project root
 */
export function getRelativePath(projectRoot: string, filePath: string): string {
  return path.relative(projectRoot, filePath);
}

/**
 * Find files matching glob patterns
 */
export async function findFiles(
  patterns: string[],
  cwd: string,
  ignore: string[] = ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.git/**"]
): Promise<string[]> {
  return fg(patterns, {
    cwd,
    absolute: true,
    ignore,
  });
}

/**
 * Get file extension
 */
export function getExtension(filePath: string): string {
  return path.extname(filePath).toLowerCase();
}

/**
 * Ensure a directory exists
 */
export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}
