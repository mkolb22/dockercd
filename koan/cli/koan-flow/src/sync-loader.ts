/**
 * Load and parse synchronization rules from .claude/synchronizations/
 *
 * Supports two formats:
 * 1. New: main.sync DSL file (compact, ~300 lines)
 * 2. Legacy: *.yaml files (20 files, ~11,000 lines)
 *
 * The loader checks for main.sync first and falls back to legacy YAML.
 */

import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import fg from 'fast-glob';
import * as yaml from 'js-yaml';
import type { SyncRule, SyncRuleSet, SloExpectations } from './types.js';
import { loadAndCompileSyncDSL, loadSloRegistry } from './dsl-compiler.js';

interface SyncFileContent {
  version?: string;
  slo_templates?: Record<string, SloExpectations>;
  synchronizations?: SyncRule[];
}

/**
 * Load synchronization rules (dual-format support).
 *
 * 1. Check for main.sync DSL file first
 * 2. Fall back to legacy *.yaml files
 */
export async function loadSyncRules(
  projectRoot: string
): Promise<SyncRuleSet> {
  const syncDir = join(projectRoot, '.claude', 'synchronizations');

  if (!existsSync(syncDir)) {
    return { rules: [], sloTemplates: {} };
  }

  // Try new DSL format first
  const mainSyncPath = join(syncDir, 'main.sync');
  if (existsSync(mainSyncPath)) {
    const result = await loadAndCompileSyncDSL(projectRoot);
    if (result && result.rules.length > 0) {
      return result;
    }
  }

  // Fall back to legacy YAML format
  return loadLegacySyncRules(projectRoot);
}

/**
 * Load legacy synchronization rules from .claude/synchronizations/*.yaml
 */
export async function loadLegacySyncRules(
  projectRoot: string
): Promise<SyncRuleSet> {
  const syncDir = join(projectRoot, '.claude', 'synchronizations');

  if (!existsSync(syncDir)) {
    return { rules: [], sloTemplates: {} };
  }

  const files = await fg.glob('*.yaml', { cwd: syncDir, absolute: true });
  const allRules: SyncRule[] = [];
  const allTemplates: Record<string, SloExpectations> = {};

  // Also load SLO registry if available (for legacy files that reference it)
  const sloRegistry = await loadSloRegistry(projectRoot);
  if (sloRegistry?.slos) {
    Object.assign(allTemplates, sloRegistry.slos);
  }

  for (const file of files) {
    // Skip registry files (not sync rules)
    if (file.endsWith('slo-registry.yaml') || file.endsWith('error-policy.yaml')) {
      continue;
    }

    try {
      const content = await readFile(file, 'utf-8');
      const parsed = yaml.load(content) as SyncFileContent;

      if (!parsed) continue;

      // Collect SLO templates
      if (parsed.slo_templates) {
        Object.assign(allTemplates, parsed.slo_templates);
      }

      // Collect sync rules
      if (Array.isArray(parsed.synchronizations)) {
        allRules.push(...parsed.synchronizations);
      }
    } catch (error) {
      // Skip files with YAML parsing errors
      // This is expected for some sync files with complex anchors/aliases
      console.warn(
        `Warning: Skipping ${file} due to YAML parsing error: ${error instanceof Error ? error.message : String(error)}`
      );
      continue;
    }
  }

  return { rules: allRules, sloTemplates: allTemplates };
}

/**
 * Check which format is being used.
 */
export function getSyncFormat(projectRoot: string): 'dsl' | 'legacy' | 'none' {
  const syncDir = join(projectRoot, '.claude', 'synchronizations');

  if (!existsSync(syncDir)) {
    return 'none';
  }

  const mainSyncPath = join(syncDir, 'main.sync');
  if (existsSync(mainSyncPath)) {
    return 'dsl';
  }

  return 'legacy';
}

/**
 * Find sync rules that match a transition from one concept to another.
 * For example: story -> architecture
 */
export function findRulesForTransition(
  rules: SyncRule[],
  fromConcept: string,
  toConcept: string
): SyncRule[] {
  return rules.filter((rule) => {
    // Match when.concept to fromConcept
    if (!rule.when || rule.when.concept !== fromConcept) return false;

    // Check if any of the then actions target toConcept
    // Handle case where then is not an array
    if (!rule.then || !Array.isArray(rule.then)) return false;
    return rule.then.some((action) => action.concept === toConcept);
  });
}

/**
 * Get SLO expectations for a concept, with fallback to defaults.
 */
export function getSloForConcept(
  concept: string,
  templates: Record<string, SloExpectations>
): SloExpectations | undefined {
  // Try direct match
  if (templates[concept]) {
    return templates[concept];
  }

  // Map concepts to template names
  const mapping: Record<string, string> = {
    architecture: 'architecture',
    verification: 'verification',
    implementation: 'implementation',
    quality: 'quality',
    version: 'quick',
    context: 'context',
    'code-analysis': 'mcp_analysis',
    security: 'verification',
    documentation: 'quick',
  };

  const templateName = mapping[concept];
  return templateName ? templates[templateName] : undefined;
}
