/**
 * Tests for koan-drift using real temporary directories
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { scanDirectory } from './scanner.js';
import { compareDirectories } from './comparator.js';
import { generateDiff } from './differ.js';
import { renderSummary, renderVerbose, renderJson } from './renderer.js';
import type { CliOptions } from './types.js';

describe('koan-drift', () => {
  let testDir: string;
  let templatesDir: string;
  let installedDir: string;

  beforeEach(async () => {
    // Create unique test directory
    testDir = join(tmpdir(), `koan-drift-test-${Date.now()}`);
    templatesDir = join(testDir, 'templates');
    installedDir = join(testDir, 'installed');

    await mkdir(templatesDir, { recursive: true });
    await mkdir(installedDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test directory
    await rm(testDir, { recursive: true, force: true });
  });

  describe('scanner', () => {
    it('should scan directory and hash files', async () => {
      // Create test files
      await mkdir(join(templatesDir, 'concepts'), { recursive: true });
      await writeFile(join(templatesDir, 'concepts', 'story.md.template'), 'Story concept');
      await writeFile(join(templatesDir, 'config.yaml.template'), 'Config file');

      const entries = await scanDirectory(templatesDir);
      entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

      expect(entries).toHaveLength(2);
      expect(entries[0].relativePath).toBe('concepts/story.md');
      expect(entries[0].category).toBe('concepts');
      expect(entries[0].hash).toBeTruthy();
      expect(entries[0].hash).toHaveLength(64); // SHA256 hex length
    });

    it('should strip .template suffix from relativePath', async () => {
      await writeFile(join(templatesDir, 'test.md.template'), 'Test content');

      const entries = await scanDirectory(templatesDir);

      expect(entries[0].relativePath).toBe('test.md');
      expect(entries[0].absolutePath).toContain('.template');
    });

    it('should categorize files by first directory segment', async () => {
      await mkdir(join(templatesDir, 'concepts'), { recursive: true });
      await mkdir(join(templatesDir, 'agents'), { recursive: true });
      await mkdir(join(templatesDir, 'commands'), { recursive: true });
      await mkdir(join(templatesDir, 'synchronizations'), { recursive: true });
      await mkdir(join(templatesDir, 'skills'), { recursive: true });
      await mkdir(join(templatesDir, 'hooks'), { recursive: true });

      await writeFile(join(templatesDir, 'concepts', 'story.md'), 'Story');
      await writeFile(join(templatesDir, 'agents', 'story.md'), 'Agent');
      await writeFile(join(templatesDir, 'commands', 'feature.md'), 'Command');
      await writeFile(join(templatesDir, 'synchronizations', 'story-arch.yaml'), 'Sync');
      await writeFile(join(templatesDir, 'skills', 'commit.md'), 'Skill');
      await writeFile(join(templatesDir, 'hooks', 'pre-commit.sh'), 'Hook');
      await writeFile(join(templatesDir, 'config.yaml'), 'Config');

      const entries = await scanDirectory(templatesDir);

      expect(entries.find((e) => e.relativePath === 'concepts/story.md')?.category).toBe('concepts');
      expect(entries.find((e) => e.relativePath === 'agents/story.md')?.category).toBe('agents');
      expect(entries.find((e) => e.relativePath === 'commands/feature.md')?.category).toBe('commands');
      expect(entries.find((e) => e.relativePath === 'synchronizations/story-arch.yaml')?.category).toBe('synchronizations');
      expect(entries.find((e) => e.relativePath === 'skills/commit.md')?.category).toBe('skills');
      expect(entries.find((e) => e.relativePath === 'hooks/pre-commit.sh')?.category).toBe('hooks');
      expect(entries.find((e) => e.relativePath === 'config.yaml')?.category).toBe('other');
    });

    it('should ignore default patterns', async () => {
      await writeFile(join(templatesDir, 'settings.local.json'), 'Local settings');
      await writeFile(join(templatesDir, 'mcp-config.json'), 'MCP config');
      await writeFile(join(templatesDir, '.DS_Store'), 'Mac metadata');
      await writeFile(join(templatesDir, 'test.local.yaml'), 'Local file');
      await writeFile(join(templatesDir, 'valid.yaml'), 'Valid file');

      const entries = await scanDirectory(templatesDir);

      expect(entries).toHaveLength(1);
      expect(entries[0].relativePath).toBe('valid.yaml');
    });

    it('should support custom ignore patterns', async () => {
      await writeFile(join(templatesDir, 'test.md'), 'Test');
      await writeFile(join(templatesDir, 'ignore.md'), 'Ignore');

      const entries = await scanDirectory(templatesDir, {
        ignorePatterns: ['ignore.md'],
      });

      expect(entries).toHaveLength(1);
      expect(entries[0].relativePath).toBe('test.md');
    });
  });

  describe('comparator', () => {
    it('should detect modified files', async () => {
      await mkdir(join(templatesDir, 'concepts'), { recursive: true });
      await mkdir(join(installedDir, 'concepts'), { recursive: true });

      await writeFile(join(templatesDir, 'concepts', 'story.md.template'), 'Template version');
      await writeFile(join(installedDir, 'concepts', 'story.md'), 'Installed version');

      const templateEntries = await scanDirectory(templatesDir);
      const installedEntries = await scanDirectory(installedDir);
      const report = compareDirectories(templateEntries, installedEntries);

      expect(report.modified).toHaveLength(1);
      expect(report.modified[0].relativePath).toBe('concepts/story.md');
      expect(report.modified[0].category).toBe('concepts');
      expect(report.modified[0].templatePath).toBeTruthy();
      expect(report.modified[0].installedPath).toBeTruthy();
      expect(report.missing).toHaveLength(0);
      expect(report.added).toHaveLength(0);
    });

    it('should detect missing files', async () => {
      await mkdir(join(templatesDir, 'commands'), { recursive: true });

      await writeFile(join(templatesDir, 'commands', 'feature.md.template'), 'Feature command');

      const templateEntries = await scanDirectory(templatesDir);
      const installedEntries = await scanDirectory(installedDir);
      const report = compareDirectories(templateEntries, installedEntries);

      expect(report.missing).toHaveLength(1);
      expect(report.missing[0].relativePath).toBe('commands/feature.md');
      expect(report.missing[0].category).toBe('commands');
      expect(report.missing[0].templatePath).toBeTruthy();
      expect(report.missing[0].installedPath).toBeUndefined();
      expect(report.modified).toHaveLength(0);
      expect(report.added).toHaveLength(0);
    });

    it('should detect added files', async () => {
      await mkdir(join(installedDir, 'agents'), { recursive: true });

      await writeFile(join(installedDir, 'agents', 'custom.md'), 'Custom agent');

      const templateEntries = await scanDirectory(templatesDir);
      const installedEntries = await scanDirectory(installedDir);
      const report = compareDirectories(templateEntries, installedEntries);

      expect(report.added).toHaveLength(1);
      expect(report.added[0].relativePath).toBe('agents/custom.md');
      expect(report.added[0].category).toBe('agents');
      expect(report.added[0].templatePath).toBeUndefined();
      expect(report.added[0].installedPath).toBeTruthy();
      expect(report.modified).toHaveLength(0);
      expect(report.missing).toHaveLength(0);
    });

    it('should handle files in sync', async () => {
      await writeFile(join(templatesDir, 'config.yaml.template'), 'Config content');
      await writeFile(join(installedDir, 'config.yaml'), 'Config content');

      const templateEntries = await scanDirectory(templatesDir);
      const installedEntries = await scanDirectory(installedDir);
      const report = compareDirectories(templateEntries, installedEntries);

      expect(report.modified).toHaveLength(0);
      expect(report.missing).toHaveLength(0);
      expect(report.added).toHaveLength(0);
    });

    it('should handle mixed drift scenarios', async () => {
      await mkdir(join(templatesDir, 'concepts'), { recursive: true });
      await mkdir(join(templatesDir, 'commands'), { recursive: true });
      await mkdir(join(installedDir, 'concepts'), { recursive: true });
      await mkdir(join(installedDir, 'agents'), { recursive: true });

      // Modified
      await writeFile(join(templatesDir, 'concepts', 'story.md.template'), 'Template v1');
      await writeFile(join(installedDir, 'concepts', 'story.md'), 'Modified v1');

      // Missing
      await writeFile(join(templatesDir, 'commands', 'feature.md.template'), 'Feature');

      // Added
      await writeFile(join(installedDir, 'agents', 'custom.md'), 'Custom');

      // In sync
      await writeFile(join(templatesDir, 'config.yaml.template'), 'Config');
      await writeFile(join(installedDir, 'config.yaml'), 'Config');

      const templateEntries = await scanDirectory(templatesDir);
      const installedEntries = await scanDirectory(installedDir);
      const report = compareDirectories(templateEntries, installedEntries);

      expect(report.modified).toHaveLength(1);
      expect(report.missing).toHaveLength(1);
      expect(report.added).toHaveLength(1);
    });
  });

  describe('differ', () => {
    it('should generate unified diff for modified files', async () => {
      const templatePath = join(templatesDir, 'test.md');
      const installedPath = join(installedDir, 'test.md');

      await writeFile(templatePath, 'Line 1\nLine 2\nLine 3');
      await writeFile(installedPath, 'Line 1\nModified Line 2\nLine 3');

      const diff = await generateDiff(templatePath, installedPath, 'test.md');

      expect(diff).toContain('--- a/test.md');
      expect(diff).toContain('+++ b/test.md');
      expect(diff).toContain('-Line 2');
      expect(diff).toContain('+Modified Line 2');
    });

    it('should handle completely different files', async () => {
      const templatePath = join(templatesDir, 'test.md');
      const installedPath = join(installedDir, 'test.md');

      await writeFile(templatePath, 'Original content');
      await writeFile(installedPath, 'Completely different');

      const diff = await generateDiff(templatePath, installedPath, 'test.md');

      expect(diff).toContain('-Original content');
      expect(diff).toContain('+Completely different');
    });
  });

  describe('renderer', () => {
    it('should render summary with no drift', () => {
      const report = { modified: [], missing: [], added: [] };

      const output = renderSummary(report);

      expect(output).toContain('No drift detected');
    });

    it('should render summary table with counts', () => {
      const report = {
        modified: [
          { relativePath: 'concepts/story.md', category: 'concepts' as const },
          { relativePath: 'concepts/arch.md', category: 'concepts' as const },
        ],
        missing: [
          { relativePath: 'commands/feature.md', category: 'commands' as const },
        ],
        added: [
          { relativePath: 'agents/custom.md', category: 'agents' as const },
        ],
      };

      const output = renderSummary(report);

      expect(output).toContain('Configuration Drift Summary');
      expect(output).toContain('concepts');
      expect(output).toContain('commands');
      expect(output).toContain('agents');
      expect(output).toContain('Total');
    });

    it('should render verbose output with file names', () => {
      const report = {
        modified: [
          { relativePath: 'concepts/story.md', category: 'concepts' as const },
        ],
        missing: [
          { relativePath: 'commands/feature.md', category: 'commands' as const },
        ],
        added: [
          { relativePath: 'agents/custom.md', category: 'agents' as const },
        ],
      };

      const options: CliOptions = { verbose: true };
      const output = renderVerbose(report, options);

      expect(output).toContain('Modified Files:');
      expect(output).toContain('concepts/story.md');
      expect(output).toContain('Missing Files:');
      expect(output).toContain('commands/feature.md');
      expect(output).toContain('Added Files:');
      expect(output).toContain('agents/custom.md');
    });

    it('should filter by category', () => {
      const report = {
        modified: [
          { relativePath: 'concepts/story.md', category: 'concepts' as const },
        ],
        missing: [
          { relativePath: 'commands/feature.md', category: 'commands' as const },
        ],
        added: [],
      };

      const options: CliOptions = { verbose: true, category: 'concepts' };
      const output = renderVerbose(report, options);

      expect(output).toContain('concepts/story.md');
      expect(output).not.toContain('commands/feature.md');
    });

    it('should ignore added files when requested', () => {
      const report = {
        modified: [],
        missing: [],
        added: [
          { relativePath: 'agents/custom.md', category: 'agents' as const },
        ],
      };

      const options: CliOptions = { verbose: true, ignoreAdded: true };
      const output = renderVerbose(report, options);

      expect(output).not.toContain('Added Files:');
      expect(output).not.toContain('agents/custom.md');
    });

    it('should render JSON output', () => {
      const report = {
        modified: [
          { relativePath: 'concepts/story.md', category: 'concepts' as const },
        ],
        missing: [
          { relativePath: 'commands/feature.md', category: 'commands' as const },
        ],
        added: [
          { relativePath: 'agents/custom.md', category: 'agents' as const },
        ],
      };

      const options: CliOptions = { json: true };
      const output = renderJson(report, options);

      const parsed = JSON.parse(output);
      expect(parsed.modified).toHaveLength(1);
      expect(parsed.missing).toHaveLength(1);
      expect(parsed.added).toHaveLength(1);
    });

    it('should filter JSON output by category', () => {
      const report = {
        modified: [
          { relativePath: 'concepts/story.md', category: 'concepts' as const },
        ],
        missing: [
          { relativePath: 'commands/feature.md', category: 'commands' as const },
        ],
        added: [],
      };

      const options: CliOptions = { json: true, category: 'concepts' };
      const output = renderJson(report, options);

      const parsed = JSON.parse(output);
      expect(parsed.modified).toHaveLength(1);
      expect(parsed.missing).toHaveLength(0);
    });

    it('should include diffs when requested', () => {
      const report = {
        modified: [
          {
            relativePath: 'concepts/story.md',
            category: 'concepts' as const,
            diff: '--- a/concepts/story.md\n+++ b/concepts/story.md\n@@ -1,1 +1,1 @@\n-Old\n+New',
          },
        ],
        missing: [],
        added: [],
      };

      const options: CliOptions = { verbose: true, showDiffs: true };
      const output = renderVerbose(report, options);

      expect(output).toContain('--- a/concepts/story.md');
      expect(output).toContain('+++ b/concepts/story.md');
      expect(output).toContain('-Old');
      expect(output).toContain('+New');
    });
  });
});
