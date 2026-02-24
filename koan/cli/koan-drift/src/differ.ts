/**
 * Unified diff generation
 */

import { readFile } from 'fs/promises';

/**
 * Generate unified diff between two files
 * @param templatePath - Path to template file
 * @param installedPath - Path to installed file
 * @param relativePath - Relative path for display
 * @returns Unified diff string
 */
export async function generateDiff(
  templatePath: string,
  installedPath: string,
  relativePath: string
): Promise<string> {
  const [templateContent, installedContent] = await Promise.all([
    readFile(templatePath, 'utf-8'),
    readFile(installedPath, 'utf-8'),
  ]);

  const templateLines = templateContent.split('\n');
  const installedLines = installedContent.split('\n');

  // Simple line-by-line diff
  const diffLines: string[] = [];
  diffLines.push(`--- a/${relativePath}`);
  diffLines.push(`+++ b/${relativePath}`);

  const maxLen = Math.max(templateLines.length, installedLines.length);
  let hunkStart = -1;
  let hunkLines: string[] = [];

  for (let i = 0; i < maxLen; i++) {
    const templateLine = templateLines[i];
    const installedLine = installedLines[i];

    if (templateLine !== installedLine) {
      if (hunkStart === -1) {
        hunkStart = i;
      }

      if (templateLine !== undefined) {
        hunkLines.push(`-${templateLine}`);
      }
      if (installedLine !== undefined) {
        hunkLines.push(`+${installedLine}`);
      }
    } else if (hunkStart !== -1) {
      // End of hunk
      const hunkEnd = i;
      diffLines.push(
        `@@ -${hunkStart + 1},${hunkEnd - hunkStart} +${hunkStart + 1},${
          hunkEnd - hunkStart
        } @@`
      );
      diffLines.push(...hunkLines);
      hunkStart = -1;
      hunkLines = [];
    }
  }

  // Flush remaining hunk
  if (hunkStart !== -1) {
    const hunkEnd = maxLen;
    diffLines.push(
      `@@ -${hunkStart + 1},${hunkEnd - hunkStart} +${hunkStart + 1},${
        hunkEnd - hunkStart
      } @@`
    );
    diffLines.push(...hunkLines);
  }

  return diffLines.join('\n');
}
