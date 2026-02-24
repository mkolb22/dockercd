/**
 * DSL Compiler - Compiles compact sync rules to SyncRule objects
 *
 * Rule syntax:
 *   trigger -> action @slo [condition]
 *
 * Examples:
 *   story.create:completed -> architecture.design:opus @architecture
 *   code-analysis:completed -> architecture.design:opus @architecture [parallel]
 *   verification.verify[pass=1]:completed -> verification.verify[pass=2]:sonnet @verification
 *   quality.*:all_completed -> version.commit:sonnet @quick [review.approved, test.passed]
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';
import type { SyncRule, SyncAction, SloExpectations, SyncRuleSet } from './types.js';

// --- Types ---

export interface SloRegistry {
  defaults: SloExpectations;
  slos: Record<string, SloExpectations>;
  profiles: Record<string, Record<string, string>>;
}

export interface ErrorPolicy {
  transient: ErrorAction;
  permanent: ErrorAction;
  degraded: ErrorAction;
}

export interface ErrorAction {
  action: string;
  max_retries?: number;
  backoff?: string;
  backoff_base_ms?: number;
  on_exhausted?: string;
}

export interface ErrorPolicyRegistry {
  classifications: Record<string, { examples: string[] }>;
  policies: Record<string, ErrorPolicy>;
}

export interface ParsedTrigger {
  concept: string;
  action: string;
  status: string;
  params?: Record<string, string>;
}

export interface ParsedAction {
  concept: string;
  action: string;
  model?: string;
  sloProfile?: string;
  parallel?: boolean;
  condition?: string[];
}

export interface ParsedRule {
  trigger: ParsedTrigger;
  action: ParsedAction;
  condition?: string[];
}

// --- Loaders ---

export async function loadSloRegistry(projectRoot: string): Promise<SloRegistry | null> {
  const path = join(projectRoot, '.claude', 'synchronizations', 'slo-registry.yaml');

  if (!existsSync(path)) {
    return null;
  }

  try {
    const content = await readFile(path, 'utf-8');
    const parsed = yaml.load(content) as SloRegistry;
    return parsed;
  } catch {
    return null;
  }
}

export async function loadErrorPolicies(projectRoot: string): Promise<ErrorPolicyRegistry | null> {
  const path = join(projectRoot, '.claude', 'synchronizations', 'error-policy.yaml');

  if (!existsSync(path)) {
    return null;
  }

  try {
    const content = await readFile(path, 'utf-8');
    const parsed = yaml.load(content) as ErrorPolicyRegistry;
    return parsed;
  } catch {
    return null;
  }
}

// --- Parsers ---

/**
 * Parse a trigger expression.
 * Formats:
 *   - "story.create:completed"
 *   - "code-analysis:completed"
 *   - "verification.verify[pass=1]:completed"
 *   - "quality.*:all_completed"
 */
export function parseTrigger(input: string): ParsedTrigger {
  let remaining = input.trim();

  // Extract status (after last :)
  const colonIdx = remaining.lastIndexOf(':');
  let status = 'completed';
  if (colonIdx > 0) {
    status = remaining.slice(colonIdx + 1).trim();
    remaining = remaining.slice(0, colonIdx);
  }

  // Extract params (in [key=value])
  let params: Record<string, string> | undefined;
  const bracketMatch = remaining.match(/^(.+?)\[(.+)\]$/);
  if (bracketMatch) {
    remaining = bracketMatch[1];
    params = {};
    for (const pair of bracketMatch[2].split(',')) {
      const [key, value] = pair.split('=').map(s => s.trim());
      if (key && value) {
        params[key] = value;
      }
    }
  }

  // Extract action (after .)
  let action = 'default';
  const dotIdx = remaining.indexOf('.');
  if (dotIdx > 0) {
    action = remaining.slice(dotIdx + 1).trim();
    remaining = remaining.slice(0, dotIdx);
  }

  return {
    concept: remaining.trim(),
    action,
    status,
    params,
  };
}

/**
 * Parse an action expression.
 * Formats:
 *   - "architecture.design:opus"
 *   - "verification.verify[pass=2]:sonnet"
 *   - "ask_user(question_id)"
 */
export function parseAction(input: string): ParsedAction {
  let remaining = input.trim();

  // Extract SLO profile (after @)
  let sloProfile: string | undefined;
  const atIdx = remaining.indexOf('@');
  if (atIdx > 0) {
    sloProfile = remaining.slice(atIdx + 1).trim();
    remaining = remaining.slice(0, atIdx).trim();
  }

  // Extract model (after last :)
  let model: string | undefined;
  const colonIdx = remaining.lastIndexOf(':');
  if (colonIdx > 0) {
    const potentialModel = remaining.slice(colonIdx + 1).trim().toLowerCase();
    if (['opus', 'sonnet', 'haiku'].includes(potentialModel)) {
      model = potentialModel;
      remaining = remaining.slice(0, colonIdx);
    }
  }

  // Extract action (after .)
  let action = 'default';
  const dotIdx = remaining.indexOf('.');
  if (dotIdx > 0) {
    action = remaining.slice(dotIdx + 1).trim();
    remaining = remaining.slice(0, dotIdx);
  }

  return {
    concept: remaining.trim(),
    action,
    model,
    sloProfile,
  };
}

/**
 * Parse a complete rule line.
 * Format: "trigger -> action @slo [condition1, condition2]"
 */
export function parseRuleLine(line: string): ParsedRule | null {
  const trimmed = line.trim();

  // Skip comments and empty lines
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) {
    return null;
  }

  // Split on ->
  const arrowIdx = trimmed.indexOf('->');
  if (arrowIdx < 0) {
    return null;
  }

  let triggerPart = trimmed.slice(0, arrowIdx).trim();
  let actionPart = trimmed.slice(arrowIdx + 2).trim();

  // Extract condition [...]
  let condition: string[] | undefined;
  const conditionMatch = actionPart.match(/\[([^\]]+)\]$/);
  if (conditionMatch) {
    condition = conditionMatch[1].split(',').map(c => c.trim());
    actionPart = actionPart.slice(0, conditionMatch.index).trim();
  }

  // Also check trigger for condition
  const triggerConditionMatch = triggerPart.match(/\[([^\]]+)\]$/);
  if (triggerConditionMatch) {
    // This is params like [pass=1], not condition
  }

  const trigger = parseTrigger(triggerPart);
  const action = parseAction(actionPart);

  if (condition) {
    action.condition = condition;
  }

  return { trigger, action, condition };
}

// --- Compiler ---

let ruleCounter = 0;

/**
 * Generate a unique rule ID.
 */
function generateRuleId(trigger: ParsedTrigger, action: ParsedAction): string {
  ruleCounter++;
  return `${trigger.concept}-to-${action.concept}-${ruleCounter}`;
}

/**
 * Get SLO expectations for a profile.
 */
export function getSloFromRegistry(
  profile: string | undefined,
  registry: SloRegistry | null
): SloExpectations | undefined {
  if (!registry || !profile) {
    return undefined;
  }

  // Try direct lookup
  if (registry.slos[profile]) {
    return registry.slos[profile];
  }

  // Try in profiles
  for (const [_, mapping] of Object.entries(registry.profiles)) {
    if (mapping[profile]) {
      const targetProfile = mapping[profile];
      if (registry.slos[targetProfile]) {
        return registry.slos[targetProfile];
      }
    }
  }

  return registry.defaults;
}

/**
 * Compile a parsed rule to a SyncRule object.
 */
export function compileRule(
  parsed: ParsedRule,
  sloRegistry: SloRegistry | null
): SyncRule {
  const { trigger, action, condition } = parsed;

  const syncAction: SyncAction = {
    concept: action.concept,
    action: action.action,
    model: action.model,
    parallel: action.condition?.includes('parallel'),
  };

  const rule: SyncRule = {
    id: generateRuleId(trigger, action),
    description: `${trigger.concept}.${trigger.action}:${trigger.status} -> ${action.concept}.${action.action}`,
    when: {
      concept: trigger.concept,
      action: trigger.action,
      status: trigger.status,
    },
    then: [syncAction],
    slo_expectations: getSloFromRegistry(action.sloProfile, sloRegistry),
    provenance: {
      category: 'core',
      reason: `Transition from ${trigger.concept} to ${action.concept}`,
    },
  };

  // Add condition as where clause
  if (condition && condition.length > 0 && !condition.every(c => c === 'parallel')) {
    const nonParallelConditions = condition.filter(c => c !== 'parallel');
    if (nonParallelConditions.length > 0) {
      rule.where = {
        query: nonParallelConditions.join(' AND '),
      };
    }
  }

  return rule;
}

/**
 * Compile multiple rule lines to SyncRule objects.
 */
export function compileRules(
  lines: string[],
  sloRegistry: SloRegistry | null
): SyncRule[] {
  const rules: SyncRule[] = [];

  for (const line of lines) {
    const parsed = parseRuleLine(line);
    if (parsed) {
      rules.push(compileRule(parsed, sloRegistry));
    }
  }

  return rules;
}

/**
 * Load and compile the main.sync DSL file.
 */
export async function loadAndCompileSyncDSL(
  projectRoot: string
): Promise<SyncRuleSet | null> {
  const mainSyncPath = join(projectRoot, '.claude', 'synchronizations', 'main.sync');

  if (!existsSync(mainSyncPath)) {
    return null;
  }

  const sloRegistry = await loadSloRegistry(projectRoot);
  const content = await readFile(mainSyncPath, 'utf-8');

  // Parse the DSL file
  const lines = content.split('\n');
  const ruleLines: string[] = [];
  let inRulesSection = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect rules section
    if (trimmed === 'rules:') {
      inRulesSection = true;
      continue;
    }

    // Exit rules section on new section header
    if (inRulesSection && trimmed.endsWith(':') && !trimmed.startsWith('-')) {
      inRulesSection = false;
    }

    // Collect rule lines (lines starting with -)
    if (inRulesSection && trimmed.startsWith('-')) {
      ruleLines.push(trimmed.slice(1).trim());
    }
  }

  const rules = compileRules(ruleLines, sloRegistry);

  return {
    rules,
    sloTemplates: sloRegistry?.slos || {},
  };
}

/**
 * Reset the rule counter (useful for testing).
 */
export function resetRuleCounter(): void {
  ruleCounter = 0;
}
