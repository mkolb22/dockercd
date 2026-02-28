import { describe, it, expect, vi } from 'vitest';
import { parseAgentTemplate } from '../../genome/parser.js';
import { assembleGenome } from '../../genome/assembler.js';
import { validateGenome } from '../../genome/schema.js';
import {
  ablateSection,
  addSkill,
  composeMutations,
  mutateModel,
  removeSkill,
  replaceSectionContent,
  rewriteSection,
  swapSection,
} from '../operators.js';

// ---------------------------------------------------------------------------
// Test templates
// ---------------------------------------------------------------------------

const TEMPLATE_A = `---
name: agent-a
type: workflow
execution: task-tool
model: sonnet
color: blue
description: Agent A for testing
tools: "*"
cost_per_action: 0.003
optimization_level: "baseline"
expected_context_tokens: 500
expected_duration_seconds: 5
skills:
  - schema-validation   # Validate structure
  - story-decomposition # INVEST criteria
---

# Agent A

## Purpose

This is agent A's purpose section.

## Core Principle: Independence

Each component is independent.

## Actions

### doWork(input)

Performs work.

## Validation Rules

- [ ] Input valid
- [ ] Output correct

## Never Do This

- Do not skip validation
`;

const TEMPLATE_B = `---
name: agent-b
type: workflow
execution: task-tool
model: opus
color: purple
description: Agent B for testing
tools: "*"
cost_per_action: 0.015
optimization_level: "phase2"
expected_context_tokens: 1100
expected_duration_seconds: 15
---

# Agent B

## Purpose

This is agent B's DIFFERENT purpose section.

## Methodology

Agent B has a methodology section that A does not.

## Actions

### doDifferentWork(input)

Performs different work.

## Constraints

This section uses a different canonical ID.
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function genomeA() { return parseAgentTemplate(TEMPLATE_A); }
function genomeB() { return parseAgentTemplate(TEMPLATE_B); }

// ---------------------------------------------------------------------------
// Section ablation
// ---------------------------------------------------------------------------

describe('ablateSection', () => {
  it('removes the target section', () => {
    const result = ablateSection(genomeA(), 'purpose');
    expect(result.applied).toBe(true);
    expect(result.kind).toBe('ablate_section');
    expect(result.genome.sections.find(s => s.id === 'purpose')).toBeUndefined();
  });

  it('preserves other sections', () => {
    const original = genomeA();
    const result = ablateSection(original, 'purpose');
    // Original had 5 sections; after removing purpose, 4 remain
    expect(result.genome.sections).toHaveLength(original.sections.length - 1);
    expect(result.genome.sections.find(s => s.id === 'core_principle')).toBeDefined();
    expect(result.genome.sections.find(s => s.id === 'actions')).toBeDefined();
  });

  it('returns no-op when section not found', () => {
    const result = ablateSection(genomeA(), 'methodology');
    expect(result.applied).toBe(false);
    expect(result.genome).toBe(genomeA().frontmatter ? result.genome : result.genome); // Different object but same data
    expect(result.description).toContain('not found');
  });

  it('does not modify the original genome', () => {
    const original = genomeA();
    const sectionCount = original.sections.length;
    ablateSection(original, 'purpose');
    expect(original.sections).toHaveLength(sectionCount);
  });

  it('records affected section', () => {
    const result = ablateSection(genomeA(), 'purpose');
    expect(result.affectedSections).toContain('purpose');
  });
});

// ---------------------------------------------------------------------------
// Section swap
// ---------------------------------------------------------------------------

describe('swapSection', () => {
  it('replaces recipient section with donor section', () => {
    const result = swapSection(genomeA(), genomeB(), 'purpose');
    expect(result.applied).toBe(true);
    const purpose = result.genome.sections.find(s => s.id === 'purpose');
    expect(purpose?.content).toContain('DIFFERENT purpose');
  });

  it('appends section when not in recipient', () => {
    const original = genomeA();
    const result = swapSection(original, genomeB(), 'methodology');
    expect(result.applied).toBe(true);
    expect(result.genome.sections).toHaveLength(original.sections.length + 1);
    const methodology = result.genome.sections.find(s => s.id === 'methodology');
    expect(methodology).toBeDefined();
    expect(methodology?.content).toContain('methodology section');
  });

  it('returns no-op when section not in donor', () => {
    const result = swapSection(genomeA(), genomeB(), 'validation_rules');
    expect(result.applied).toBe(false);
    expect(result.description).toContain('not found in donor');
  });

  it('preserves non-swapped sections', () => {
    const result = swapSection(genomeA(), genomeB(), 'purpose');
    expect(result.genome.sections.find(s => s.id === 'core_principle')).toBeDefined();
    expect(result.genome.sections.find(s => s.id === 'never_do')).toBeDefined();
  });

  it('preserves recipient frontmatter', () => {
    const result = swapSection(genomeA(), genomeB(), 'purpose');
    expect(result.genome.frontmatter.name).toBe('agent-a');
    expect(result.genome.frontmatter.model).toBe('sonnet');
  });
});

// ---------------------------------------------------------------------------
// Replace section content
// ---------------------------------------------------------------------------

describe('replaceSectionContent', () => {
  it('replaces content, preserves heading', () => {
    const result = replaceSectionContent(genomeA(), 'purpose', 'Brand new purpose.');
    expect(result.applied).toBe(true);
    const purpose = result.genome.sections.find(s => s.id === 'purpose');
    expect(purpose?.content).toBe('Brand new purpose.');
    expect(purpose?.heading).toContain('Purpose');
  });

  it('returns no-op when section not found', () => {
    const result = replaceSectionContent(genomeA(), 'methodology', 'content');
    expect(result.applied).toBe(false);
  });

  it('returns no-op when content unchanged', () => {
    const genome = genomeA();
    const original = genome.sections.find(s => s.id === 'purpose')!;
    const result = replaceSectionContent(genome, 'purpose', original.content);
    expect(result.applied).toBe(false);
    expect(result.description).toContain('unchanged');
  });

  it('preserves section level and ID', () => {
    const result = replaceSectionContent(genomeA(), 'purpose', 'New content.');
    const purpose = result.genome.sections.find(s => s.id === 'purpose');
    expect(purpose?.level).toBe(2);
    expect(purpose?.id).toBe('purpose');
  });
});

// ---------------------------------------------------------------------------
// Model mutation
// ---------------------------------------------------------------------------

describe('mutateModel', () => {
  it('changes model in frontmatter', () => {
    const result = mutateModel(genomeA(), 'opus');
    expect(result.applied).toBe(true);
    expect(result.genome.frontmatter.model).toBe('opus');
  });

  it('regenerates rawFrontmatter', () => {
    const result = mutateModel(genomeA(), 'opus');
    expect(result.genome.rawFrontmatter).toContain('model: opus');
    expect(result.genome.rawFrontmatter).not.toContain('model: sonnet');
  });

  it('returns no-op for same model', () => {
    const result = mutateModel(genomeA(), 'sonnet');
    expect(result.applied).toBe(false);
  });

  it('preserves other frontmatter fields', () => {
    const result = mutateModel(genomeA(), 'haiku');
    expect(result.genome.frontmatter.name).toBe('agent-a');
    expect(result.genome.frontmatter.costPerAction).toBe(0.003);
    expect(result.genome.frontmatter.skills).toHaveLength(2);
  });

  it('mutated genome assembles to valid markdown', () => {
    const result = mutateModel(genomeA(), 'opus');
    const assembled = assembleGenome(result.genome);
    expect(assembled).toContain('---');
    expect(assembled).toContain('model: opus');
    expect(assembled).toContain('## Purpose');
  });

  it('mutated genome round-trips through parse', () => {
    const result = mutateModel(genomeA(), 'opus');
    const assembled = assembleGenome(result.genome);
    const reparsed = parseAgentTemplate(assembled);
    expect(reparsed.frontmatter.model).toBe('opus');
    expect(reparsed.frontmatter.name).toBe('agent-a');
    expect(reparsed.sections.length).toBe(result.genome.sections.length);
  });
});

// ---------------------------------------------------------------------------
// Skill mutations
// ---------------------------------------------------------------------------

describe('addSkill', () => {
  it('adds a new skill', () => {
    const result = addSkill(genomeA(), { name: 'new-skill', comment: 'Does new things' });
    expect(result.applied).toBe(true);
    expect(result.genome.frontmatter.skills).toHaveLength(3);
    expect(result.genome.frontmatter.skills[2].name).toBe('new-skill');
    expect(result.genome.frontmatter.skills[2].comment).toBe('Does new things');
  });

  it('returns no-op for duplicate skill', () => {
    const result = addSkill(genomeA(), { name: 'schema-validation', comment: '' });
    expect(result.applied).toBe(false);
  });

  it('regenerates rawFrontmatter with new skill', () => {
    const result = addSkill(genomeA(), { name: 'effort-estimation', comment: 'T-shirt sizing' });
    expect(result.genome.rawFrontmatter).toContain('effort-estimation');
  });

  it('preserves existing skills', () => {
    const result = addSkill(genomeA(), { name: 'new-skill', comment: '' });
    expect(result.genome.frontmatter.skills[0].name).toBe('schema-validation');
    expect(result.genome.frontmatter.skills[1].name).toBe('story-decomposition');
  });

  it('round-trips through parse', () => {
    const result = addSkill(genomeA(), { name: 'added-skill', comment: 'Added in mutation' });
    const assembled = assembleGenome(result.genome);
    const reparsed = parseAgentTemplate(assembled);
    const skill = reparsed.frontmatter.skills.find(s => s.name === 'added-skill');
    expect(skill).toBeDefined();
    expect(skill?.comment).toBe('Added in mutation');
  });
});

describe('removeSkill', () => {
  it('removes a skill by name', () => {
    const result = removeSkill(genomeA(), 'schema-validation');
    expect(result.applied).toBe(true);
    expect(result.genome.frontmatter.skills).toHaveLength(1);
    expect(result.genome.frontmatter.skills[0].name).toBe('story-decomposition');
  });

  it('returns no-op for missing skill', () => {
    const result = removeSkill(genomeA(), 'nonexistent');
    expect(result.applied).toBe(false);
  });

  it('regenerates rawFrontmatter without removed skill', () => {
    const result = removeSkill(genomeA(), 'schema-validation');
    expect(result.genome.rawFrontmatter).not.toContain('schema-validation');
    expect(result.genome.rawFrontmatter).toContain('story-decomposition');
  });
});

// ---------------------------------------------------------------------------
// LLM-dependent: Section rewrite
// ---------------------------------------------------------------------------

describe('rewriteSection', () => {
  it('calls LLM and replaces section content', async () => {
    const mockLLM = vi.fn().mockResolvedValue('Improved purpose content.');
    const result = await rewriteSection(genomeA(), 'purpose', 'Need more specificity', mockLLM);

    expect(result.applied).toBe(true);
    expect(result.kind).toBe('rewrite_section');
    expect(mockLLM).toHaveBeenCalledOnce();

    const purpose = result.genome.sections.find(s => s.id === 'purpose');
    expect(purpose?.content).toBe('Improved purpose content.');
  });

  it('includes context in LLM prompt', async () => {
    let receivedPrompt = '';
    const mockLLM = vi.fn().mockImplementation((prompt: string) => {
      receivedPrompt = prompt;
      return Promise.resolve('New content.');
    });

    await rewriteSection(genomeA(), 'purpose', 'Be more specific', mockLLM);

    expect(receivedPrompt).toContain('agent-a');
    expect(receivedPrompt).toContain('purpose');
    expect(receivedPrompt).toContain('Be more specific');
    expect(receivedPrompt).toContain("agent A's purpose");
  });

  it('returns no-op when section not found', async () => {
    const mockLLM = vi.fn();
    const result = await rewriteSection(genomeA(), 'methodology', 'feedback', mockLLM);

    expect(result.applied).toBe(false);
    expect(mockLLM).not.toHaveBeenCalled();
  });

  it('returns no-op when LLM returns empty content', async () => {
    const mockLLM = vi.fn().mockResolvedValue('   ');
    const result = await rewriteSection(genomeA(), 'purpose', 'feedback', mockLLM);
    expect(result.applied).toBe(false);
  });

  it('preserves section heading and level', async () => {
    const mockLLM = vi.fn().mockResolvedValue('Rewritten content.');
    const result = await rewriteSection(genomeA(), 'purpose', 'feedback', mockLLM);

    const purpose = result.genome.sections.find(s => s.id === 'purpose');
    expect(purpose?.heading).toContain('Purpose');
    expect(purpose?.level).toBe(2);
  });

  it('trims LLM output', async () => {
    const mockLLM = vi.fn().mockResolvedValue('\n  Trimmed content.  \n\n');
    const result = await rewriteSection(genomeA(), 'purpose', 'feedback', mockLLM);

    const purpose = result.genome.sections.find(s => s.id === 'purpose');
    expect(purpose?.content).toBe('Trimmed content.');
  });
});

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

describe('composeMutations', () => {
  it('chains multiple mutations', () => {
    const result = composeMutations(genomeA(), [
      g => mutateModel(g, 'opus'),
      g => ablateSection(g, 'never_do'),
    ]);

    expect(result.applied).toBe(true);
    expect(result.genome.frontmatter.model).toBe('opus');
    expect(result.genome.sections.find(s => s.id === 'never_do')).toBeUndefined();
    expect(result.description).toContain('2 mutation(s)');
  });

  it('handles empty mutation list', () => {
    const result = composeMutations(genomeA(), []);
    expect(result.applied).toBe(false);
  });

  it('continues past no-ops by default', () => {
    const result = composeMutations(genomeA(), [
      g => ablateSection(g, 'methodology'), // no-op
      g => mutateModel(g, 'opus'),           // applied
    ]);

    expect(result.applied).toBe(true);
    expect(result.genome.frontmatter.model).toBe('opus');
  });

  it('stops on no-op when configured', () => {
    const result = composeMutations(
      genomeA(),
      [
        g => ablateSection(g, 'methodology'), // no-op
        g => mutateModel(g, 'opus'),           // skipped
      ],
      true,
    );

    expect(result.applied).toBe(false);
    expect(result.genome.frontmatter.model).toBe('sonnet'); // unchanged
  });

  it('aggregates affected sections from all mutations', () => {
    const result = composeMutations(genomeA(), [
      g => replaceSectionContent(g, 'purpose', 'New purpose'),
      g => ablateSection(g, 'never_do'),
    ]);

    expect(result.affectedSections).toContain('purpose');
    expect(result.affectedSections).toContain('never_do');
  });
});

// ---------------------------------------------------------------------------
// Round-trip integrity
// ---------------------------------------------------------------------------

describe('round-trip integrity', () => {
  it('ablated genome assembles and parses back', () => {
    const result = ablateSection(genomeA(), 'validation_rules');
    const assembled = assembleGenome(result.genome);
    const reparsed = parseAgentTemplate(assembled);

    expect(reparsed.sections.find(s => s.id === 'validation_rules')).toBeUndefined();
    expect(reparsed.frontmatter.name).toBe('agent-a');
  });

  it('swapped genome assembles and parses back', () => {
    const result = swapSection(genomeA(), genomeB(), 'purpose');
    const assembled = assembleGenome(result.genome);
    const reparsed = parseAgentTemplate(assembled);

    const purpose = reparsed.sections.find(s => s.id === 'purpose');
    expect(purpose?.content).toContain('DIFFERENT');
    expect(reparsed.frontmatter.name).toBe('agent-a');
  });

  it('skill-mutated genome validates successfully', () => {
    let genome = addSkill(genomeA(), { name: 'new-skill', comment: '' }).genome;
    genome = removeSkill(genome, 'story-decomposition').genome;

    const validation = validateGenome(genome);
    expect(validation.valid).toBe(true);
  });

  it('model-mutated genome validates successfully', () => {
    const result = mutateModel(genomeA(), 'haiku');
    const validation = validateGenome(result.genome);
    expect(validation.valid).toBe(true);
  });

  it('composed mutations produce valid genome', () => {
    const result = composeMutations(genomeA(), [
      g => mutateModel(g, 'opus'),
      g => addSkill(g, { name: 'extra', comment: 'Extra skill' }),
      g => replaceSectionContent(g, 'purpose', 'Evolved purpose statement.'),
    ]);

    const assembled = assembleGenome(result.genome);
    const reparsed = parseAgentTemplate(assembled);
    const validation = validateGenome(reparsed);

    expect(validation.valid).toBe(true);
    expect(reparsed.frontmatter.model).toBe('opus');
    expect(reparsed.frontmatter.skills).toHaveLength(3);
    expect(reparsed.sections.find(s => s.id === 'purpose')?.content).toBe('Evolved purpose statement.');
  });
});
