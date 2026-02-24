/**
 * Directory comparison logic
 */

import type { FileEntry, DriftFile, DriftReport } from './types.js';

/**
 * Compare two directory scans and categorize drift
 * @param templateEntries - Files from .zen/templates/
 * @param installedEntries - Files from .claude/
 * @returns Drift report with modified, missing, and added files
 */
export function compareDirectories(
  templateEntries: FileEntry[],
  installedEntries: FileEntry[]
): DriftReport {
  // Create maps keyed by relativePath for fast lookup
  const templateMap = new Map(
    templateEntries.map((entry) => [entry.relativePath, entry])
  );
  const installedMap = new Map(
    installedEntries.map((entry) => [entry.relativePath, entry])
  );

  const modified: DriftFile[] = [];
  const missing: DriftFile[] = [];
  const added: DriftFile[] = [];

  // Check for modified and missing files
  for (const [relativePath, templateEntry] of templateMap) {
    const installedEntry = installedMap.get(relativePath);

    if (!installedEntry) {
      // File exists in template but not installed
      missing.push({
        relativePath,
        category: templateEntry.category,
        templatePath: templateEntry.absolutePath,
      });
    } else if (templateEntry.hash !== installedEntry.hash) {
      // File exists in both but hashes differ
      modified.push({
        relativePath,
        category: templateEntry.category,
        templatePath: templateEntry.absolutePath,
        installedPath: installedEntry.absolutePath,
      });
    }
  }

  // Check for added files
  for (const [relativePath, installedEntry] of installedMap) {
    if (!templateMap.has(relativePath)) {
      // File exists in installed but not in template
      added.push({
        relativePath,
        category: installedEntry.category,
        installedPath: installedEntry.absolutePath,
      });
    }
  }

  return { modified, missing, added };
}
