/**
 * Integration tests: parse real agent templates from .zen/templates/agents/
 * and verify round-trip fidelity.
 *
 * These tests require agent template files to be present.
 * They skip gracefully when the templates directory doesn't exist
 * (e.g., in the zen repo where templates aren't deployed).
 */
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseAgentTemplate } from '../parser.js';
import { assembleGenome } from '../assembler.js';
import { validateGenome } from '../schema.js';
import type { CanonicalSectionId } from '../schema.js';

// Try multiple locations: bodhi repo (.zen/templates/agents/) and zen repo (templates/agents/)
const BODHI_TEMPLATES = join(
  import.meta.dirname,
  '..', '..', '..', '..', '..', '.zen', 'templates', 'agents',
);
const ZEN_TEMPLATES = join(
  import.meta.dirname,
  '..', '..', '..', '..', '..', '..', '..', '..', '..', 'templates', 'agents',
);
const TEMPLATES_DIR = existsSync(BODHI_TEMPLATES) ? BODHI_TEMPLATES
  : existsSync(ZEN_TEMPLATES) ? ZEN_TEMPLATES
  : BODHI_TEMPLATES; // fallback for error message

const TEMPLATES_AVAILABLE = existsSync(TEMPLATES_DIR);

/** Concept agents that follow the full 16-section structure. */
const CONCEPT_AGENTS = [
  'story-concept.md',
  'architecture-concept.md',
  'quality-concept.md',
  'implementation-concept.md',
  'verification-concept.md',
  'version-concept.md',
  'context-concept.md',
  'documentation-concept.md',
  'code-analysis-concept.md',
  'security-concept.md',
];

async function loadTemplate(filename: string): Promise<string> {
  return readFile(join(TEMPLATES_DIR, filename), 'utf-8');
}

describe.skipIf(!TEMPLATES_AVAILABLE)('real agent template integration', () => {
  it('templates directory exists and contains agent files', async () => {
    const files = await readdir(TEMPLATES_DIR);
    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain('story-concept.md');
  });

  describe('concept agent parsing', () => {
    for (const filename of CONCEPT_AGENTS) {
      describe(filename, () => {
        it('parses without error', async () => {
          const content = await loadTemplate(filename);
          const genome = parseAgentTemplate(content);
          expect(genome.agentName).toBeTruthy();
        });

        it('extracts valid frontmatter', async () => {
          const content = await loadTemplate(filename);
          const genome = parseAgentTemplate(content);

          expect(genome.frontmatter.name).toBeTruthy();
          expect(genome.frontmatter.type).toBe('workflow');
          expect(['haiku', 'sonnet', 'opus']).toContain(genome.frontmatter.model);
          expect(genome.frontmatter.costPerAction).toBeGreaterThan(0);
        });

        it('extracts title', async () => {
          const content = await loadTemplate(filename);
          const genome = parseAgentTemplate(content);
          expect(genome.title).toBeTruthy();
        });

        it('identifies canonical sections', async () => {
          const content = await loadTemplate(filename);
          const genome = parseAgentTemplate(content);
          const canonicalIds = genome.sections
            .filter(s => s.id !== 'custom')
            .map(s => s.id);

          // Every concept agent should have at least purpose and actions
          expect(canonicalIds).toContain('purpose');
        });

        it('has at least 5 sections', async () => {
          const content = await loadTemplate(filename);
          const genome = parseAgentTemplate(content);
          expect(genome.sections.length).toBeGreaterThanOrEqual(5);
        });

        it('validates successfully', async () => {
          const content = await loadTemplate(filename);
          const genome = parseAgentTemplate(content);
          const result = validateGenome(genome);
          expect(result.valid).toBe(true);
        });

        it('round-trips through parse → assemble → parse', async () => {
          const content = await loadTemplate(filename);
          const genome1 = parseAgentTemplate(content);
          const assembled = assembleGenome(genome1);
          const genome2 = parseAgentTemplate(assembled);

          // Structural equivalence
          expect(genome2.agentName).toBe(genome1.agentName);
          expect(genome2.frontmatter.name).toBe(genome1.frontmatter.name);
          expect(genome2.frontmatter.model).toBe(genome1.frontmatter.model);
          expect(genome2.frontmatter.costPerAction).toBe(genome1.frontmatter.costPerAction);
          expect(genome2.sections.length).toBe(genome1.sections.length);

          // Section IDs preserved
          for (let i = 0; i < genome1.sections.length; i++) {
            expect(genome2.sections[i].id).toBe(genome1.sections[i].id);
          }
        });

        it('double round-trip is stable', async () => {
          const content = await loadTemplate(filename);
          const genome1 = parseAgentTemplate(content);
          const out1 = assembleGenome(genome1);
          const genome2 = parseAgentTemplate(out1);
          const out2 = assembleGenome(genome2);

          // Second round-trip produces identical output
          expect(out2).toBe(out1);
        });
      });
    }
  });

  describe('debate agent parsing', () => {
    const DEBATE_AGENTS = ['debate-advocate.md', 'debate-critic.md', 'debate-synthesis.md'];

    for (const filename of DEBATE_AGENTS) {
      it(`parses ${filename} without error`, async () => {
        const content = await loadTemplate(filename);
        const genome = parseAgentTemplate(content);
        expect(genome.agentName).toBeTruthy();
        expect(genome.frontmatter.type).toBe('debate');
      });
    }
  });

  describe('cross-agent analysis', () => {
    it('all concept agents share common canonical sections', async () => {
      const commonSections = new Set<string>();
      let first = true;

      for (const filename of CONCEPT_AGENTS) {
        const content = await loadTemplate(filename);
        const genome = parseAgentTemplate(content);
        const ids = new Set(genome.sections.filter(s => s.id !== 'custom').map(s => s.id));

        if (first) {
          for (const id of ids) commonSections.add(id);
          first = false;
        } else {
          for (const id of commonSections) {
            if (!ids.has(id as CanonicalSectionId)) commonSections.delete(id);
          }
        }
      }

      // At minimum, all agents should share purpose
      expect(commonSections.has('purpose')).toBe(true);
    });

    it('reports section coverage across all agents', async () => {
      const sectionCounts = new Map<string, number>();

      for (const filename of CONCEPT_AGENTS) {
        const content = await loadTemplate(filename);
        const genome = parseAgentTemplate(content);
        const seen = new Set<string>();

        for (const section of genome.sections) {
          if (section.id !== 'custom' && !seen.has(section.id)) {
            sectionCounts.set(section.id, (sectionCounts.get(section.id) ?? 0) + 1);
            seen.add(section.id);
          }
        }
      }

      // Purpose should be in all agents
      expect(sectionCounts.get('purpose')).toBe(CONCEPT_AGENTS.length);
    });
  });
});
