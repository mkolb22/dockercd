/**
 * Sync Evaluator
 * Loads synchronization rules from .claude/synchronizations/ and matches by event type.
 *
 * Supports two formats:
 * 1. Compact DSL (main.sync): `story.create[ready]:completed -> architecture.design:opus @architecture`
 * 2. Legacy YAML (legacy/*.yaml): `synchronizations:` blocks with when/where/then
 *
 * Key constraint: Does NOT evaluate `where` conditions — returns them to Claude,
 * which has the runtime state context. Only matches by when.concept + when.action + when.status.
 */

import * as fs from "fs";
import * as path from "path";
import type { SyncRule, SyncAction, SyncEvalResult } from "./types.js";
import { createResettableLazyLoader } from "../../utils/lazy.js";
import { config } from "../../core/config.js";

/** Files to skip in synchronizations directory */
const SKIP_FILES = new Set(["slo-registry.yaml", "error-policy.yaml"]);

/**
 * Parse compact DSL rule lines from main.sync
 *
 * Format: `concept.action[qualifier]:status -> target_concept.target_action:model @slo [conditions]`
 *
 * Examples:
 *   - story.create[ready]:completed -> code-analysis.context:sonnet @mcp [parallel]
 *   - architecture.design:completed -> verification.verify[pass=1]:sonnet @verification [risk != low]
 *   - quality.test:failed -> quality.self_repair:sonnet @execution_loop [repair_attempts < 3, mcp]
 */
function parseDslRules(content: string, sourcePath: string): SyncRule[] {
  const rules: SyncRule[] = [];
  const lines = content.split("\n");

  let currentSection = "";
  let ruleIndex = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    // Track section headers
    const sectionMatch = trimmed.match(/^(\w+):$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      continue;
    }

    // Skip non-rule sections
    if (!["rules", "recovery", "learning", "context", "checkpoints", "fallback"].includes(currentSection)) {
      continue;
    }

    // Match rule lines: `- trigger -> action`
    const ruleMatch = trimmed.match(/^-\s+(.+?)\s+->\s+(.+)$/);
    if (!ruleMatch) continue;

    const triggerPart = ruleMatch[1].trim();
    const actionPart = ruleMatch[2].trim();

    // Parse trigger: concept.action[qualifier]:status
    const triggerRegex = /^([\w*-]+)\.([\w*|]+)(?:\[([^\]]*)\])?:(\w+)$/;
    const triggerMatch = triggerPart.match(triggerRegex);
    if (!triggerMatch) continue;

    const [, concept, action, qualifier, status] = triggerMatch;

    // Parse action: target_concept.target_action:model @slo [conditions]
    // Some actions are special (ask_user, inject_context, set_flag, etc.)
    const actionRegex = /^([\w-]+(?:\.[\w-]+)?)(?:\[([^\]]*)\])?(?::(\w+))?\s*(?:@(\w+))?\s*(?:\[([^\]]*)\])?$/;
    const actionMatch = actionPart.match(actionRegex);

    let targetConcept = "";
    let targetAction = "";
    let model: string | null = null;
    let conditions: string | null = null;

    if (actionMatch) {
      const fullTarget = actionMatch[1];
      const dotIdx = fullTarget.indexOf(".");
      if (dotIdx !== -1) {
        targetConcept = fullTarget.slice(0, dotIdx);
        targetAction = fullTarget.slice(dotIdx + 1);
      } else {
        targetConcept = fullTarget;
        targetAction = "";
      }
      model = actionMatch[3] || null;
      conditions = actionMatch[5] || null;
    } else {
      // Fallback: just use the whole thing as concept
      targetConcept = actionPart;
    }

    // Build where clause from qualifier and conditions
    const whereParts: string[] = [];
    if (qualifier) whereParts.push(qualifier);
    if (conditions) whereParts.push(conditions);
    const where = whereParts.length > 0 ? whereParts.join(" AND ") : null;

    ruleIndex++;
    rules.push({
      id: `dsl-${currentSection}-${ruleIndex}`,
      description: `${currentSection}: ${triggerPart} -> ${actionPart}`,
      source: path.basename(sourcePath),
      when: { concept, action, status },
      where,
      then: [
        {
          concept: targetConcept,
          action: targetAction,
          model,
          inputs: {},
        },
      ],
    });
  }

  return rules;
}

/**
 * Parse legacy YAML synchronization rules
 *
 * Extracts from `synchronizations:` blocks using regex-based parsing
 * (no js-yaml dependency, same approach as content-loader frontmatter parser)
 */
function parseLegacyYamlRules(content: string, sourcePath: string): SyncRule[] {
  const rules: SyncRule[] = [];

  // Find the synchronizations block
  const syncBlockStart = content.indexOf("\nsynchronizations:");
  if (syncBlockStart === -1) return rules;

  const afterSync = content.slice(syncBlockStart + "\nsynchronizations:".length);

  // Split into individual rule blocks (each starts with `  - id:`)
  const ruleBlocks = afterSync.split(/\n  - id:\s*/);

  for (let i = 1; i < ruleBlocks.length; i++) {
    const block = ruleBlocks[i];

    // Extract id
    const idMatch = block.match(/^"([^"]+)"/);
    if (!idMatch) continue;
    const id = idMatch[1];

    // Extract description
    const descMatch = block.match(/description:\s*"([^"]+)"/);
    const description = descMatch ? descMatch[1] : id;

    // Extract when block
    const conceptMatch = block.match(/when:\s*\n\s+concept:\s*"([^"]+)"/);
    const actionMatch = block.match(/action:\s*"([^"]+)"/);
    const statusMatch = block.match(/status:\s*"([^"]+)"/);

    if (!conceptMatch || !statusMatch) continue;

    const concept = conceptMatch[1];
    const action = actionMatch ? actionMatch[1] : "*";
    const status = statusMatch[1];

    // Extract where query
    const whereMatch = block.match(/where:\s*\n\s+query:\s*"([^"]+)"/);
    const where = whereMatch ? whereMatch[1] : null;

    // Extract then actions
    const thenActions: SyncAction[] = [];
    const thenMatch = block.match(/then:\s*\n([\s\S]*?)(?=\n\s{4}\w|\n\s{2}-\s+id:|\n[a-z]|$)/);
    if (thenMatch) {
      const thenBlock = thenMatch[1];

      // Find concept-based actions using a global regex
      const conceptActionRegex = /- concept:\s*"([^"]+)"[\s\S]*?action:\s*"([^"]+)"(?:[\s\S]*?model:\s*"([^"]+)")?/g;
      let match;
      while ((match = conceptActionRegex.exec(thenBlock)) !== null) {
        thenActions.push({
          concept: match[1],
          action: match[2],
          model: match[3] || null,
          inputs: {},
        });
      }

      // Also handle special actions (ask_user, inject_context, etc.)
      if (thenActions.length === 0) {
        const specialAction = thenBlock.match(/- action:\s*"([^"]+)"/);
        if (specialAction) {
          thenActions.push({
            concept: "",
            action: specialAction[1],
            model: null,
            inputs: {},
          });
        }
      }
    }

    if (thenActions.length === 0) continue;

    rules.push({
      id,
      description,
      source: path.basename(sourcePath),
      when: { concept, action, status },
      where,
      then: thenActions,
    });
  }

  return rules;
}

/**
 * SyncEvaluator loads and matches synchronization rules
 */
export class SyncEvaluator {
  private rules: SyncRule[] = [];
  private loaded = false;
  private syncRoot: string;

  constructor(contentRoot: string) {
    this.syncRoot = path.join(contentRoot, "synchronizations");
  }

  /**
   * Evaluate an event against loaded sync rules.
   * Returns matching rules with their actions and unevaluated where conditions.
   */
  evaluate(concept: string, action: string, status: string): SyncEvalResult {
    this.ensureLoaded();

    const matched: SyncEvalResult["matchedRules"] = [];

    for (const rule of this.rules) {
      if (!this.matchesEvent(rule, concept, action, status)) continue;
      matched.push({
        rule,
        actions: rule.then,
        where: rule.where,
      });
    }

    return {
      event: { concept, action, status },
      matchedRules: matched,
      noMatch: matched.length === 0,
    };
  }

  /**
   * Get all loaded rules count
   */
  getRuleCount(): number {
    this.ensureLoaded();
    return this.rules.length;
  }

  /**
   * Check if event matches a rule's when clause
   */
  private matchesEvent(rule: SyncRule, concept: string, action: string, status: string): boolean {
    // Concept matching (supports *)
    if (rule.when.concept !== "*" && rule.when.concept !== concept) return false;

    // Action matching (supports * and pipe-separated alternatives)
    if (rule.when.action !== "*") {
      const allowedActions = rule.when.action.split("|");
      if (!allowedActions.includes(action)) return false;
    }

    // Status matching
    if (rule.when.status !== status) return false;

    return true;
  }

  /**
   * Lazy load all sync rules from disk
   */
  private ensureLoaded(): void {
    if (this.loaded) return;

    if (!fs.existsSync(this.syncRoot)) {
      this.loaded = true;
      return;
    }

    // Load main.sync (compact DSL) — check both installed and template forms
    const mainSyncPath = path.join(this.syncRoot, "main.sync");
    const mainSyncTemplatePath = path.join(this.syncRoot, "main.sync.template");
    const syncPath = fs.existsSync(mainSyncPath) ? mainSyncPath : fs.existsSync(mainSyncTemplatePath) ? mainSyncTemplatePath : null;
    if (syncPath) {
      try {
        const content = fs.readFileSync(syncPath, "utf-8");
        this.rules.push(...parseDslRules(content, syncPath));
      } catch {
        // Skip on read error
      }
    }

    // Load legacy YAML files — check both installed and template forms
    const legacyDir = path.join(this.syncRoot, "legacy");
    const archiveDir = path.join(this.syncRoot, "archive");
    const legacyDirs = [legacyDir, archiveDir].filter((d) => fs.existsSync(d));
    for (const dir of legacyDirs) {
      try {
        const files = fs.readdirSync(dir).filter(
          (f) => (f.endsWith(".yaml") || f.endsWith(".yaml.template")) && !SKIP_FILES.has(f) && !SKIP_FILES.has(f.replace(".template", "")),
        );
        for (const file of files) {
          try {
            const content = fs.readFileSync(path.join(dir, file), "utf-8");
            this.rules.push(...parseLegacyYamlRules(content, file));
          } catch {
            // Skip files that can't be parsed
          }
        }
      } catch {
        // Skip if directory can't be read
      }
    }

    this.loaded = true;
  }
}

/**
 * Singleton sync evaluator (resettable for testing)
 */
const syncEvaluatorLoader = createResettableLazyLoader(
  () => new SyncEvaluator(config().frameworkContentRoot),
);
export const getSyncEvaluator = syncEvaluatorLoader.get;
export const resetSyncEvaluator = syncEvaluatorLoader.reset;
