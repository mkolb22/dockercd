/**
 * Frontmatter serializer: converts structured AgentFrontmatter back to
 * raw YAML strings for mutated genomes.
 *
 * When mutation operators modify frontmatter fields (model, skills, etc.),
 * the rawFrontmatter must be regenerated to stay in sync. This serializer
 * produces valid YAML that round-trips through the parser.
 *
 * Design constraints:
 * - Output must parse back to semantically identical AgentFrontmatter
 * - Strings with special YAML characters are quoted
 * - Empty optional collections are omitted
 * - Field order matches the parser's expectations
 */

import type { AgentFrontmatter } from '../genome/schema.js';

// ---------------------------------------------------------------------------
// YAML value formatting
// ---------------------------------------------------------------------------

/** Characters that require quoting in YAML values. */
const NEEDS_QUOTING = /[^a-zA-Z0-9_-]|^$/;

/** Formats a string as a YAML scalar, quoting when necessary. */
function yamlString(value: string): string {
  if (NEEDS_QUOTING.test(value)) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return value;
}

/** Formats a scalar value (string, number, boolean) for YAML output. */
function yamlScalar(value: string | number | boolean): string {
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return String(value);
  return yamlString(value);
}

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

/**
 * Serializes an AgentFrontmatter into a raw YAML string.
 *
 * Produces output that round-trips through parseFrontmatter.
 * Field ordering: required native → optional native → zen metadata →
 * hooks → skills.
 */
export function serializeFrontmatter(fm: AgentFrontmatter): string {
  const lines: string[] = [];

  // -- Required native fields --
  lines.push(`name: ${fm.name}`);
  lines.push(`description: ${yamlString(fm.description)}`);

  // -- Core native fields (guard against undefined from partial genomes) --
  if (fm.type !== undefined) lines.push(`type: ${fm.type}`);
  if (fm.execution !== undefined) lines.push(`execution: ${fm.execution}`);
  if (fm.model !== undefined) lines.push(`model: ${fm.model}`);
  if (fm.color !== undefined) lines.push(`color: ${fm.color}`);

  // -- Tools --
  if (Array.isArray(fm.tools)) {
    lines.push('tools:');
    for (const tool of fm.tools) {
      lines.push(`  - ${tool}`);
    }
  } else {
    lines.push(`tools: ${yamlScalar(fm.tools as string)}`);
  }

  // -- Optional native collections --
  if (fm.disallowedTools.length > 0) {
    lines.push('disallowedTools:');
    for (const tool of fm.disallowedTools) {
      lines.push(`  - ${tool}`);
    }
  }

  if (fm.mcpServers.length > 0) {
    lines.push('mcpServers:');
    for (const server of fm.mcpServers) {
      lines.push(`  - ${server}`);
    }
  }

  // -- Optional native scalars --
  if (fm.permissionMode !== undefined) {
    lines.push(`permissionMode: ${fm.permissionMode}`);
  }
  if (fm.maxTurns !== undefined) {
    lines.push(`maxTurns: ${fm.maxTurns}`);
  }
  if (fm.memory !== undefined) {
    lines.push(`memory: ${fm.memory}`);
  }
  if (fm.background !== undefined) {
    lines.push(`background: ${fm.background}`);
  }
  if (fm.isolation !== undefined) {
    lines.push(`isolation: ${fm.isolation}`);
  }

  // -- Zen metadata (guard against undefined from partial genomes) --
  if (fm.costPerAction !== undefined) lines.push(`cost_per_action: ${fm.costPerAction}`);
  if (fm.optimizationLevel !== undefined) lines.push(`optimization_level: ${yamlScalar(fm.optimizationLevel)}`);
  if (fm.expectedContextTokens !== undefined) lines.push(`expected_context_tokens: ${fm.expectedContextTokens}`);
  if (fm.expectedDurationSeconds !== undefined) lines.push(`expected_duration_seconds: ${fm.expectedDurationSeconds}`);

  if (fm.baselineContextTokens !== undefined) {
    lines.push(`baseline_context_tokens: ${fm.baselineContextTokens}`);
  }
  if (fm.contextReduction !== undefined) {
    lines.push(`context_reduction: ${yamlScalar(fm.contextReduction)}`);
  }

  // -- Hooks --
  const hookEvents = Object.entries(fm.hooks);
  if (hookEvents.length > 0) {
    lines.push('hooks:');
    for (const [event, entries] of hookEvents) {
      lines.push(`  ${event}:`);
      for (const entry of entries) {
        lines.push(`    - type: ${entry.type}`);
        lines.push(`      command: "${entry.command}"`);
      }
    }
  }

  // -- Skills --
  if (fm.skills.length > 0) {
    lines.push('skills:');
    for (const skill of fm.skills) {
      if (skill.comment) {
        const padding = Math.max(1, 30 - skill.name.length);
        lines.push(`  - ${skill.name}${' '.repeat(padding)}# ${skill.comment}`);
      } else {
        lines.push(`  - ${skill.name}`);
      }
    }
  }

  return lines.join('\n');
}
