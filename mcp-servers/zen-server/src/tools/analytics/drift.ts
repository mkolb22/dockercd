/**
 * Configuration drift detection between template and installed files.
 * Compares .zen/templates/ against .claude/ to detect modifications.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import type { FileEntry, DriftItem, DriftReport } from "./types.js";

const DEFAULT_IGNORE = [
  "node_modules",
  ".git",
  ".DS_Store",
  "*.db",
  "*.db-shm",
  "*.db-wal",
];

const CATEGORY_PATTERNS: [string, RegExp][] = [
  ["concepts", /concepts\//],
  ["agents", /agents\//],
  ["commands", /commands\//],
  ["synchronizations", /synchronizations\//],
  ["skills", /skills\//],
  ["hooks", /hooks\//],
  ["schemas", /schemas\//],
  ["prompts", /prompts\//],
];

function detectCategory(relativePath: string): string {
  for (const [cat, re] of CATEGORY_PATTERNS) {
    if (re.test(relativePath)) return cat;
  }
  return "other";
}

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content, "utf-8").digest("hex");
}

function shouldIgnore(name: string, ignorePatterns: string[]): boolean {
  for (const pat of ignorePatterns) {
    if (pat.startsWith("*")) {
      if (name.endsWith(pat.slice(1))) return true;
    } else if (name === pat) {
      return true;
    }
  }
  return false;
}

/**
 * Recursively scan a directory, returning file entries with SHA256 hashes.
 */
export function scanDirectory(
  dir: string,
  baseDir?: string,
  ignorePatterns: string[] = DEFAULT_IGNORE,
): FileEntry[] {
  if (!fs.existsSync(dir)) return [];
  const base = baseDir || dir;
  const entries: FileEntry[] = [];

  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    if (shouldIgnore(item.name, ignorePatterns)) continue;

    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      entries.push(...scanDirectory(fullPath, base, ignorePatterns));
    } else if (item.isFile()) {
      const content = fs.readFileSync(fullPath, "utf-8");
      let relativePath = path.relative(base, fullPath);
      // Strip .template suffix for comparison
      if (relativePath.endsWith(".template")) {
        relativePath = relativePath.slice(0, -".template".length);
      }
      entries.push({
        relativePath,
        fullPath,
        hash: sha256(content),
        category: detectCategory(relativePath),
      });
    }
  }

  return entries;
}

/**
 * Compare template directory against installed directory.
 * Returns drift report with modified, missing, and added files.
 */
export function compareDirectories(
  templateDir: string,
  installedDir: string,
  ignorePatterns?: string[],
): DriftReport {
  const templateEntries = scanDirectory(templateDir, templateDir, ignorePatterns);
  const installedEntries = scanDirectory(installedDir, installedDir, ignorePatterns);

  const templateMap = new Map<string, FileEntry>();
  for (const e of templateEntries) templateMap.set(e.relativePath, e);

  const installedMap = new Map<string, FileEntry>();
  for (const e of installedEntries) installedMap.set(e.relativePath, e);

  const modified: DriftItem[] = [];
  const missing: DriftItem[] = [];
  const added: DriftItem[] = [];

  // Check templates against installed
  for (const [relPath, tEntry] of templateMap) {
    const iEntry = installedMap.get(relPath);
    if (!iEntry) {
      missing.push({
        relativePath: relPath,
        category: tEntry.category,
        templatePath: tEntry.fullPath,
        installedPath: path.join(installedDir, relPath),
      });
    } else if (tEntry.hash !== iEntry.hash) {
      modified.push({
        relativePath: relPath,
        category: tEntry.category,
        templatePath: tEntry.fullPath,
        installedPath: iEntry.fullPath,
      });
    }
  }

  // Check for files in installed that aren't in templates
  for (const [relPath, iEntry] of installedMap) {
    if (!templateMap.has(relPath)) {
      added.push({
        relativePath: relPath,
        category: iEntry.category,
        templatePath: path.join(templateDir, relPath),
        installedPath: iEntry.fullPath,
      });
    }
  }

  return {
    modified: modified.sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
    missing: missing.sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
    added: added.sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
    scanned_at: new Date().toISOString(),
  };
}
