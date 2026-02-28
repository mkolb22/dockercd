/**
 * Mutation operators for section-based genome evolution.
 *
 * Operators are categorized as:
 * - **Pure** (sync, deterministic): ablation, swap, replace, model, skill
 * - **LLM-dependent** (async, non-deterministic): section rewrite
 *
 * All operators are non-destructive: they return a new genome, never
 * modifying the input. When a mutation cannot be applied (e.g., target
 * section not found), the operator returns a no-op MutationResult
 * with `applied: false`.
 *
 * Design constraints:
 * - Zero external dependencies
 * - Input genomes are never mutated
 * - Pure operators are deterministic
 * - LLM operators use an injectable provider for testability
 */

import type {
  AgentFrontmatter,
  AgentGenome,
  CanonicalSectionId,
  GenomeSection,
  ModelTierOrInherit,
  SkillEntry,
} from '../genome/schema.js';
import { serializeFrontmatter } from './serializer.js';
import type { LLMCompleteFn, MutationResult } from './types.js';

// ---------------------------------------------------------------------------
// Genome helpers
// ---------------------------------------------------------------------------

/**
 * Creates a new genome with optional field overrides.
 *
 * When frontmatter is overridden, rawFrontmatter is automatically
 * regenerated via the serializer unless explicitly provided.
 */
function deriveGenome(
  base: AgentGenome,
  overrides: {
    frontmatter?: AgentFrontmatter;
    rawFrontmatter?: string;
    sections?: readonly GenomeSection[];
    title?: string;
  },
): AgentGenome {
  const fm = overrides.frontmatter ?? base.frontmatter;
  const raw = overrides.rawFrontmatter ??
    (overrides.frontmatter ? serializeFrontmatter(overrides.frontmatter) : base.rawFrontmatter);

  return {
    agentName: fm.name,
    frontmatter: fm,
    rawFrontmatter: raw,
    title: overrides.title ?? base.title,
    sections: overrides.sections ?? base.sections,
  };
}

/** Finds the first section matching a canonical ID. Returns -1 if not found. */
function findSectionIndex(
  sections: readonly GenomeSection[],
  sectionId: CanonicalSectionId | 'custom',
): number {
  for (let i = 0; i < sections.length; i++) {
    if (sections[i].id === sectionId) return i;
  }
  return -1;
}

/** Creates a no-op mutation result. */
function noOp(genome: AgentGenome, kind: MutationResult['kind'], reason: string): MutationResult {
  return {
    genome,
    applied: false,
    kind,
    description: reason,
    affectedSections: [],
  };
}

// ---------------------------------------------------------------------------
// Pure operators: Section-level
// ---------------------------------------------------------------------------

/**
 * Removes a section from the genome entirely.
 *
 * Used for ablation analysis: measuring the fitness impact of each
 * section type across the agent population.
 */
export function ablateSection(
  genome: AgentGenome,
  sectionId: CanonicalSectionId | 'custom',
): MutationResult {
  const idx = findSectionIndex(genome.sections, sectionId);
  if (idx === -1) {
    return noOp(genome, 'ablate_section', `Section '${sectionId}' not found`);
  }

  const sections = [...genome.sections];
  const removed = sections.splice(idx, 1)[0];

  return {
    genome: deriveGenome(genome, { sections }),
    applied: true,
    kind: 'ablate_section',
    description: `Removed section '${removed.heading}' (${sectionId})`,
    affectedSections: [sectionId],
  };
}

/**
 * Replaces a section in genomeA with the corresponding section from genomeB.
 *
 * If the section exists in genomeB but not genomeA, it is appended.
 * If the section doesn't exist in genomeB, this is a no-op.
 */
export function swapSection(
  recipient: AgentGenome,
  donor: AgentGenome,
  sectionId: CanonicalSectionId | 'custom',
): MutationResult {
  const donorIdx = findSectionIndex(donor.sections, sectionId);
  if (donorIdx === -1) {
    return noOp(recipient, 'swap_section', `Section '${sectionId}' not found in donor genome`);
  }

  const donorSection = donor.sections[donorIdx];
  const recipientIdx = findSectionIndex(recipient.sections, sectionId);
  const sections = [...recipient.sections];

  if (recipientIdx === -1) {
    // Section doesn't exist in recipient — append
    sections.push(donorSection);
  } else {
    // Replace existing section
    sections[recipientIdx] = donorSection;
  }

  return {
    genome: deriveGenome(recipient, { sections }),
    applied: true,
    kind: 'swap_section',
    description: `Swapped section '${sectionId}' from '${donor.agentName}' into '${recipient.agentName}'`,
    affectedSections: [sectionId],
  };
}

/**
 * Replaces the content of a specific section.
 *
 * Preserves the section's heading, level, and ID. Only the body
 * content is replaced. Used for direct injection of improved content.
 */
export function replaceSectionContent(
  genome: AgentGenome,
  sectionId: CanonicalSectionId | 'custom',
  newContent: string,
): MutationResult {
  const idx = findSectionIndex(genome.sections, sectionId);
  if (idx === -1) {
    return noOp(genome, 'replace_content', `Section '${sectionId}' not found`);
  }

  const original = genome.sections[idx];
  if (original.content === newContent) {
    return noOp(genome, 'replace_content', `Section '${sectionId}' content unchanged`);
  }

  const sections = [...genome.sections];
  sections[idx] = {
    id: original.id,
    heading: original.heading,
    level: original.level,
    content: newContent,
  };

  return {
    genome: deriveGenome(genome, { sections }),
    applied: true,
    kind: 'replace_content',
    description: `Replaced content of section '${original.heading}' (${sectionId})`,
    affectedSections: [sectionId],
  };
}

// ---------------------------------------------------------------------------
// Pure operators: Frontmatter-level
// ---------------------------------------------------------------------------

/**
 * Changes the model tier assignment.
 *
 * Regenerates rawFrontmatter to reflect the change.
 */
export function mutateModel(
  genome: AgentGenome,
  newModel: ModelTierOrInherit,
): MutationResult {
  if (genome.frontmatter.model === newModel) {
    return noOp(genome, 'mutate_model', `Model already '${newModel}'`);
  }

  const oldModel = genome.frontmatter.model;
  const frontmatter: AgentFrontmatter = { ...genome.frontmatter, model: newModel };

  return {
    genome: deriveGenome(genome, { frontmatter }),
    applied: true,
    kind: 'mutate_model',
    description: `Changed model from '${oldModel}' to '${newModel}'`,
    affectedSections: [],
  };
}

/**
 * Adds a skill to the genome's skill set.
 *
 * No-op if a skill with the same name already exists.
 */
export function addSkill(
  genome: AgentGenome,
  skill: SkillEntry,
): MutationResult {
  const existing = genome.frontmatter.skills.find(s => s.name === skill.name);
  if (existing) {
    return noOp(genome, 'add_skill', `Skill '${skill.name}' already present`);
  }

  const skills = [...genome.frontmatter.skills, skill];
  const frontmatter: AgentFrontmatter = { ...genome.frontmatter, skills };

  return {
    genome: deriveGenome(genome, { frontmatter }),
    applied: true,
    kind: 'add_skill',
    description: `Added skill '${skill.name}'`,
    affectedSections: [],
  };
}

/**
 * Removes a skill from the genome's skill set by name.
 *
 * No-op if the skill is not found.
 */
export function removeSkill(
  genome: AgentGenome,
  skillName: string,
): MutationResult {
  const idx = genome.frontmatter.skills.findIndex(s => s.name === skillName);
  if (idx === -1) {
    return noOp(genome, 'remove_skill', `Skill '${skillName}' not found`);
  }

  const skills = [...genome.frontmatter.skills];
  skills.splice(idx, 1);
  const frontmatter: AgentFrontmatter = { ...genome.frontmatter, skills };

  return {
    genome: deriveGenome(genome, { frontmatter }),
    applied: true,
    kind: 'remove_skill',
    description: `Removed skill '${skillName}'`,
    affectedSections: [],
  };
}

// ---------------------------------------------------------------------------
// LLM-dependent operator: Section rewrite
// ---------------------------------------------------------------------------

/**
 * Constructs the prompt for LLM-based section rewriting.
 *
 * The prompt provides the agent context, current section content,
 * and fitness feedback to guide targeted improvements.
 */
function buildRewritePrompt(
  genome: AgentGenome,
  section: GenomeSection,
  feedback: string,
): string {
  return [
    'You are optimizing a section of an AI agent\'s system prompt to improve performance.',
    '',
    '## Agent Context',
    `Agent: ${genome.agentName}`,
    `Section type: ${section.id}`,
    `Section heading: ${section.heading}`,
    '',
    '## Current Section Content',
    section.content,
    '',
    '## Performance Feedback',
    feedback,
    '',
    '## Task',
    'Rewrite the section content to improve the agent\'s performance based on the feedback above.',
    '',
    'Rules:',
    `- Preserve the section's semantic purpose (it must still function as a "${section.id}" section)`,
    '- Address specific issues identified in the feedback',
    '- Maintain similar length (within 30% of original)',
    '- Return ONLY the section body content (no heading, no markdown fences, no commentary)',
  ].join('\n');
}

/**
 * Rewrites a section using an LLM, guided by fitness feedback.
 *
 * This is the core ELM (Evolution through Large Models) operator:
 * the LLM understands prompt semantics and produces targeted,
 * meaningful variations rather than random noise.
 *
 * @param genome - The genome containing the section to rewrite
 * @param sectionId - Which section to target
 * @param feedback - Fitness feedback explaining what to improve
 * @param llm - LLM completion function (injectable for testing)
 * @returns MutationResult with the rewritten section
 */
export async function rewriteSection(
  genome: AgentGenome,
  sectionId: CanonicalSectionId | 'custom',
  feedback: string,
  llm: LLMCompleteFn,
): Promise<MutationResult> {
  const idx = findSectionIndex(genome.sections, sectionId);
  if (idx === -1) {
    return noOp(genome, 'rewrite_section', `Section '${sectionId}' not found`);
  }

  const original = genome.sections[idx];
  const prompt = buildRewritePrompt(genome, original, feedback);
  const newContent = (await llm(prompt)).trim();

  if (!newContent || newContent === original.content) {
    return noOp(genome, 'rewrite_section', `LLM returned unchanged or empty content for '${sectionId}'`);
  }

  const sections = [...genome.sections];
  sections[idx] = {
    id: original.id,
    heading: original.heading,
    level: original.level,
    content: newContent,
  };

  return {
    genome: deriveGenome(genome, { sections }),
    applied: true,
    kind: 'rewrite_section',
    description: `LLM-rewritten section '${original.heading}' (${sectionId})`,
    affectedSections: [sectionId],
  };
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

/**
 * Applies a sequence of mutation results, chaining each genome
 * into the next mutation.
 *
 * Returns a combined MutationResult aggregating all changes.
 * Short-circuits on the first no-op if `stopOnNoOp` is true.
 */
export function composeMutations(
  genome: AgentGenome,
  mutations: readonly ((g: AgentGenome) => MutationResult)[],
  stopOnNoOp: boolean = false,
): MutationResult {
  let current = genome;
  const descriptions: string[] = [];
  const affectedSections: (CanonicalSectionId | 'custom')[] = [];
  let anyApplied = false;
  let lastKind: MutationResult['kind'] = 'replace_content';

  for (const mutate of mutations) {
    const result = mutate(current);
    lastKind = result.kind;

    if (result.applied) {
      anyApplied = true;
      current = result.genome;
      descriptions.push(result.description);
      for (const s of result.affectedSections) {
        if (!affectedSections.includes(s)) {
          affectedSections.push(s);
        }
      }
    } else if (stopOnNoOp) {
      break;
    }
  }

  return {
    genome: current,
    applied: anyApplied,
    kind: mutations.length === 1 ? lastKind : 'replace_content',
    description: anyApplied
      ? `Composed ${descriptions.length} mutation(s): ${descriptions.join('; ')}`
      : 'No mutations applied',
    affectedSections,
  };
}
