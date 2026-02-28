/**
 * Section-based genome schema for evolutionary subagent optimization.
 *
 * Decomposes agent markdown prompts into typed, independently evolvable
 * sections. Each section is a discrete unit that can be mutated, swapped,
 * or ablated without affecting other sections.
 *
 * This schema captures BOTH Claude Code native fields (recognized by
 * the runtime) and zen-specific fields (used by the framework but
 * silently ignored by Claude Code). The distinction matters for
 * evolution: native fields affect agent behavior directly, while
 * zen fields affect framework orchestration.
 *
 * Sources:
 * - Claude Code docs: https://code.claude.com/docs/en/sub-agents
 * - Claude Code CHANGELOG (v2.1.47–v2.1.50, Feb 2026)
 * - Zen agent templates: .zen/templates/agents/*.md
 */

// ---------------------------------------------------------------------------
// Frontmatter types
// ---------------------------------------------------------------------------

/** Model tiers available for agent assignment. */
export type ModelTier = 'haiku' | 'sonnet' | 'opus';

/** Model tier including 'inherit' (uses parent's model). */
export type ModelTierOrInherit = ModelTier | 'inherit';

/** Agent execution types (zen-specific). */
export type ExecutionType = 'task-tool';

/** Agent behavioral types (zen-specific). */
export type AgentType = 'workflow' | 'debate';

/**
 * Claude Code permission modes for agent execution.
 * Controls how the agent handles tool permission prompts.
 */
export type PermissionMode =
  | 'default'           // Normal permission prompting
  | 'acceptEdits'       // Auto-accept file edits, prompt for others
  | 'dontAsk'           // Skip permission prompts entirely
  | 'bypassPermissions' // Bypass all permission checks
  | 'plan';             // Plan-only mode (read-only tools)

/**
 * Memory scope for persistent cross-session agent memory.
 * Added to Claude Code in Feb 2026.
 */
export type MemoryScope = 'user' | 'project' | 'local';

/** Hook definition within frontmatter. */
export interface HookEntry {
  readonly type: string;
  readonly command: string;
}

/** Hooks organized by lifecycle event. */
export interface AgentHooks {
  readonly [event: string]: readonly HookEntry[];
}

/** Skill entry: the skill name plus any inline comment (documentation). */
export interface SkillEntry {
  readonly name: string;
  readonly comment: string;
}

/**
 * Structured YAML frontmatter extracted from agent templates.
 *
 * Fields are categorized as:
 * - NATIVE: Recognized by Claude Code runtime (affect agent behavior)
 * - ZEN: Framework-specific (silently ignored by Claude Code)
 *
 * For evolution, native fields are higher-value mutation targets because
 * they directly control agent capabilities and constraints.
 */
export interface AgentFrontmatter {
  // -- NATIVE: Required by Claude Code --
  readonly name: string;
  readonly description: string;

  // -- NATIVE: Optional, recognized by Claude Code --
  readonly model: ModelTierOrInherit;
  readonly tools: string | readonly string[];
  readonly disallowedTools: readonly string[];
  readonly permissionMode?: PermissionMode;
  readonly maxTurns?: number;
  readonly mcpServers: readonly string[];
  readonly memory?: MemoryScope;
  readonly background?: boolean;
  readonly isolation?: 'worktree';
  readonly color: string;

  // -- NATIVE: Component configuration --
  readonly hooks: AgentHooks;
  readonly skills: readonly SkillEntry[];

  // -- ZEN: Framework-specific metadata --
  readonly type: AgentType;
  readonly execution: ExecutionType;
  readonly costPerAction: number;
  readonly optimizationLevel: string;
  readonly expectedContextTokens: number;
  readonly expectedDurationSeconds: number;
  readonly baselineContextTokens?: number;
  readonly contextReduction?: string;
}

// ---------------------------------------------------------------------------
// Section types
// ---------------------------------------------------------------------------

/**
 * Canonical section identifiers.
 *
 * These sections appear across most/all concept agents and form the
 * primary targets for evolutionary optimization. Ordered by typical
 * document position.
 *
 * Derived from analysis of:
 * - 10 zen concept agents (workflow type)
 * - 3 zen debate agents (debate type)
 * - 3 zen compete agents
 * - Claude Code recommended prompt structure (role, process, output, constraints)
 *
 * Claude Code's recommended body structure maps to:
 *   Role declaration      → purpose, core_principle
 *   When invoked           → activation_sequence
 *   Domain checklist       → actions, methodology
 *   Output structure       → output_format
 *   Constraints/boundaries → constraints, never_do, always_do
 */
export const CANONICAL_SECTIONS = [
  'model_assignment',
  'activation_sequence',
  'purpose',
  'core_principle',
  'actions',
  'methodology',
  'tool_usage',
  'output_format',
  'state_management',
  'integration',
  'constraints',
  'cost_optimization',
  'example_usage',
  'validation_rules',
  'error_handling',
  'never_do',
  'always_do',
  'yaml_safety',
  'footer',
] as const;

export type CanonicalSectionId = typeof CANONICAL_SECTIONS[number];

/**
 * Maps markdown heading text patterns to canonical section identifiers.
 * Multiple heading patterns can map to the same section ID.
 * Patterns are matched case-insensitively against normalized heading text.
 */
export const HEADING_TO_SECTION: ReadonlyMap<string, CanonicalSectionId> = new Map([
  // Model & activation
  ['model assignment', 'model_assignment'],
  ['activation sequence', 'activation_sequence'],

  // Identity & purpose
  ['purpose', 'purpose'],
  ['role', 'purpose'],
  ['core principle', 'core_principle'],

  // Process & methodology
  ['actions', 'actions'],
  ['methodology', 'methodology'],
  ['process', 'methodology'],
  ['when invoked', 'methodology'],
  ['domain checklist', 'methodology'],
  ['recommended', 'methodology'],

  // Tool usage (Claude Code agents can specify tool guidance)
  ['tool usage', 'tool_usage'],
  ['available tools', 'tool_usage'],
  ['mcp tools', 'tool_usage'],
  ['understanding existing code with mcp tools', 'tool_usage'],
  ['available mcp tools', 'tool_usage'],
  ['incremental context loading', 'tool_usage'],

  // Output
  ['output format', 'output_format'],
  ['output', 'output_format'],

  // State
  ['state management', 'state_management'],
  ['state location', 'state_management'],
  ['progressive disclosure pattern', 'state_management'],
  ['status values', 'state_management'],

  // Integration & orchestration
  ['integration with synchronizations', 'integration'],
  ['integration', 'integration'],
  ['parallel execution', 'integration'],

  // Constraints & boundaries
  ['constraints', 'constraints'],
  ['boundaries', 'constraints'],
  ['scope', 'constraints'],
  ['limitations', 'constraints'],

  // Cost
  ['cost optimization', 'cost_optimization'],
  ['cumulative impact', 'cost_optimization'],

  // Examples
  ['example usage', 'example_usage'],
  ['example', 'example_usage'],
  ['examples', 'example_usage'],

  // Validation
  ['validation rules', 'validation_rules'],
  ['validation', 'validation_rules'],

  // Error handling
  ['error handling', 'error_handling'],

  // Behavioral constraints
  ['never do this', 'never_do'],
  ['never do', 'never_do'],
  ['always do this', 'always_do'],
  ['always do', 'always_do'],

  // Safety
  ['yaml safety rules', 'yaml_safety'],
  ['yaml safety', 'yaml_safety'],
  ['safety rules', 'yaml_safety'],

  // Structure/documentation checks (quality-concept specific but common pattern)
  ['structure validation checks', 'validation_rules'],
  ['documentation validation checks', 'validation_rules'],
  ['ide diagnostics check', 'validation_rules'],
  ['ide diagnostics', 'validation_rules'],
]);

/** A single section within an agent genome. */
export interface GenomeSection {
  /** Canonical ID if recognized, or 'custom' for concept-specific sections. */
  readonly id: CanonicalSectionId | 'custom';

  /** Original markdown heading text (preserved for reassembly). */
  readonly heading: string;

  /** Heading level: 1 = #, 2 = ##, 3 = ###, etc. */
  readonly level: number;

  /** Section body content (everything after the heading line). */
  readonly content: string;
}

// ---------------------------------------------------------------------------
// Genome
// ---------------------------------------------------------------------------

/**
 * Complete genome for an agent, decomposed into independently evolvable units.
 *
 * Invariant: assembling frontmatter + sections must produce a valid agent
 * template that round-trips through parse → assemble without semantic loss.
 */
export interface AgentGenome {
  /** Unique identifier derived from frontmatter name. */
  readonly agentName: string;

  /** Structured frontmatter (tunable parameters). */
  readonly frontmatter: AgentFrontmatter;

  /** Raw frontmatter YAML string (for lossless round-trip). */
  readonly rawFrontmatter: string;

  /**
   * Title line immediately after frontmatter (e.g., "# 📋 Story Concept").
   * Preserved verbatim for round-trip fidelity.
   */
  readonly title: string;

  /** Ordered list of decomposed sections. */
  readonly sections: readonly GenomeSection[];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Result of genome validation. */
export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

/** Valid permission modes. */
const VALID_PERMISSION_MODES: readonly PermissionMode[] = [
  'default', 'acceptEdits', 'dontAsk', 'bypassPermissions', 'plan',
];

/** Valid memory scopes. */
const VALID_MEMORY_SCOPES: readonly MemoryScope[] = ['user', 'project', 'local'];

/**
 * Validates an AgentGenome for structural integrity.
 *
 * Checks:
 * - Required frontmatter fields present and correctly typed
 * - At least one section exists
 * - No duplicate canonical section IDs
 * - Model tier is valid
 * - Cost and token values are non-negative
 * - Claude Code native fields have valid values when present
 */
export function validateGenome(genome: AgentGenome): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const fm = genome.frontmatter;

  // Required fields
  if (!fm.name) errors.push('frontmatter.name is required');
  if (!fm.description) warnings.push('frontmatter.description is empty (required by Claude Code)');

  // Model tier validation
  const validModels: readonly string[] = ['haiku', 'sonnet', 'opus', 'inherit'];
  if (fm.model && !validModels.includes(fm.model)) {
    errors.push(`frontmatter.model must be one of: ${validModels.join(', ')}`);
  }

  // Permission mode validation
  if (fm.permissionMode && !VALID_PERMISSION_MODES.includes(fm.permissionMode)) {
    errors.push(`frontmatter.permissionMode must be one of: ${VALID_PERMISSION_MODES.join(', ')}`);
  }

  // Memory scope validation
  if (fm.memory && !VALID_MEMORY_SCOPES.includes(fm.memory)) {
    errors.push(`frontmatter.memory must be one of: ${VALID_MEMORY_SCOPES.join(', ')}`);
  }

  // maxTurns validation
  if (fm.maxTurns !== undefined && (fm.maxTurns < 1 || !Number.isInteger(fm.maxTurns))) {
    errors.push('frontmatter.maxTurns must be a positive integer');
  }

  // Numeric bounds (zen-specific)
  if (fm.costPerAction < 0) errors.push('frontmatter.costPerAction must be >= 0');
  if (fm.expectedContextTokens < 0) errors.push('frontmatter.expectedContextTokens must be >= 0');
  if (fm.expectedDurationSeconds < 0) errors.push('frontmatter.expectedDurationSeconds must be >= 0');

  // Sections
  if (genome.sections.length === 0) {
    errors.push('genome must have at least one section');
  }

  // Duplicate canonical section check
  const seen = new Set<string>();
  for (const section of genome.sections) {
    if (section.id !== 'custom') {
      if (seen.has(section.id)) {
        warnings.push(`duplicate canonical section: ${section.id}`);
      }
      seen.add(section.id);
    }
  }

  // Warn on zen-specific fields missing type
  if (!fm.type) warnings.push('frontmatter.type not set (zen-specific)');

  return { valid: errors.length === 0, errors, warnings };
}
