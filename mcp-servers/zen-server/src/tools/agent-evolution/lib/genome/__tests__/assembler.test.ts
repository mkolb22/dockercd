import { describe, it, expect } from 'vitest';
import { parseAgentTemplate } from '../parser.js';
import { assembleGenome } from '../assembler.js';
import { validateGenome } from '../schema.js';

// ---------------------------------------------------------------------------
// Test templates
// ---------------------------------------------------------------------------

const MINIMAL_TEMPLATE = `---
name: test-concept
type: workflow
execution: task-tool
model: sonnet
color: blue
description: Test concept
tools: "*"
cost_per_action: 0.003
optimization_level: "baseline"
expected_context_tokens: 500
expected_duration_seconds: 5
---

# Test Concept

## Purpose

This is a test concept.

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

const FULL_TEMPLATE = `---
name: story-concept
type: workflow
execution: task-tool
model: sonnet
color: blue
description: Story Concept - Captures requirements
tools: "*"
cost_per_action: 0.003
optimization_level: "baseline"
expected_context_tokens: 500
expected_duration_seconds: 5
hooks:
  Stop:
    - type: command
      command: "bash .claude/hooks/concept-complete.sh story"
skills:
  - schema-validation             # Validate story structure
  - story-decomposition           # INVEST criteria
---

# Story Concept

## Model Assignment

**Model**: Sonnet 4.5

## Purpose

Captures user requirements.

## Core Principle: Polymorphic Independence

Works for any requirements system.

## Actions

### create(title, description)

Creates a requirement.

## Validation Rules

- [ ] Title is clear
- [ ] Criteria defined

## Error Handling

Save partial state on failure.

## Never Do This

- Do not call other concepts

## Always Do This

- Use Sonnet exclusively
`;

describe('assembleGenome', () => {
  describe('basic assembly', () => {
    it('produces valid markdown', () => {
      const genome = parseAgentTemplate(MINIMAL_TEMPLATE);
      const output = assembleGenome(genome);

      expect(output).toContain('---');
      expect(output).toContain('name: test-concept');
      expect(output).toContain('# Test Concept');
      expect(output).toContain('## Purpose');
    });

    it('includes frontmatter delimiters', () => {
      const genome = parseAgentTemplate(MINIMAL_TEMPLATE);
      const output = assembleGenome(genome);

      const lines = output.split('\n');
      expect(lines[0]).toBe('---');
      // Frontmatter should end with ---
      const closingIdx = lines.indexOf('---', 1);
      expect(closingIdx).toBeGreaterThan(0);
    });

    it('preserves title', () => {
      const genome = parseAgentTemplate(MINIMAL_TEMPLATE);
      const output = assembleGenome(genome);
      expect(output).toContain('# Test Concept');
    });

    it('preserves all sections', () => {
      const genome = parseAgentTemplate(MINIMAL_TEMPLATE);
      const output = assembleGenome(genome);

      expect(output).toContain('## Purpose');
      expect(output).toContain('## Core Principle');
      expect(output).toContain('## Actions');
      expect(output).toContain('## Validation Rules');
      expect(output).toContain('## Never Do This');
    });

    it('preserves section content', () => {
      const genome = parseAgentTemplate(MINIMAL_TEMPLATE);
      const output = assembleGenome(genome);

      expect(output).toContain('This is a test concept.');
      expect(output).toContain('Each component is independent.');
      expect(output).toContain('Do not skip validation');
    });

    it('ends with trailing newline', () => {
      const genome = parseAgentTemplate(MINIMAL_TEMPLATE);
      const output = assembleGenome(genome);
      expect(output.endsWith('\n')).toBe(true);
    });
  });

  describe('round-trip fidelity', () => {
    it('round-trips minimal template', () => {
      const genome1 = parseAgentTemplate(MINIMAL_TEMPLATE);
      const output1 = assembleGenome(genome1);
      const genome2 = parseAgentTemplate(output1);

      // Structural equivalence
      expect(genome2.agentName).toBe(genome1.agentName);
      expect(genome2.frontmatter.name).toBe(genome1.frontmatter.name);
      expect(genome2.frontmatter.model).toBe(genome1.frontmatter.model);
      expect(genome2.frontmatter.costPerAction).toBe(genome1.frontmatter.costPerAction);
      expect(genome2.title).toBe(genome1.title);
      expect(genome2.sections.length).toBe(genome1.sections.length);
    });

    it('round-trips full template', () => {
      const genome1 = parseAgentTemplate(FULL_TEMPLATE);
      const output1 = assembleGenome(genome1);
      const genome2 = parseAgentTemplate(output1);

      expect(genome2.agentName).toBe(genome1.agentName);
      expect(genome2.frontmatter.skills.length).toBe(genome1.frontmatter.skills.length);
      expect(genome2.sections.length).toBe(genome1.sections.length);

      // Section IDs match
      const ids1 = genome1.sections.map(s => s.id);
      const ids2 = genome2.sections.map(s => s.id);
      expect(ids2).toEqual(ids1);
    });

    it('preserves section IDs through round-trip', () => {
      const genome1 = parseAgentTemplate(FULL_TEMPLATE);
      const output1 = assembleGenome(genome1);
      const genome2 = parseAgentTemplate(output1);

      for (let i = 0; i < genome1.sections.length; i++) {
        expect(genome2.sections[i].id).toBe(genome1.sections[i].id);
        expect(genome2.sections[i].level).toBe(genome1.sections[i].level);
      }
    });

    it('preserves frontmatter fields through round-trip', () => {
      const genome1 = parseAgentTemplate(FULL_TEMPLATE);
      const output1 = assembleGenome(genome1);
      const genome2 = parseAgentTemplate(output1);

      expect(genome2.frontmatter.costPerAction).toBe(genome1.frontmatter.costPerAction);
      expect(genome2.frontmatter.optimizationLevel).toBe(genome1.frontmatter.optimizationLevel);
      expect(genome2.frontmatter.expectedContextTokens).toBe(genome1.frontmatter.expectedContextTokens);
    });

    it('double round-trip produces identical genomes', () => {
      const genome1 = parseAgentTemplate(FULL_TEMPLATE);
      const output1 = assembleGenome(genome1);
      const genome2 = parseAgentTemplate(output1);
      const output2 = assembleGenome(genome2);
      const genome3 = parseAgentTemplate(output2);

      expect(genome3.sections.length).toBe(genome2.sections.length);
      expect(genome3.frontmatter).toEqual(genome2.frontmatter);
      expect(output2).toBe(output1);
    });
  });

  describe('genome validation', () => {
    it('validates a well-formed genome', () => {
      const genome = parseAgentTemplate(MINIMAL_TEMPLATE);
      const result = validateGenome(genome);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('validates full template genome', () => {
      const genome = parseAgentTemplate(FULL_TEMPLATE);
      const result = validateGenome(genome);
      expect(result.valid).toBe(true);
    });
  });
});
