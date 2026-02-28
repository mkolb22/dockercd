import { describe, it, expect } from 'vitest';
import { serializeFrontmatter } from '../serializer.js';
import { parseAgentTemplate } from '../../genome/parser.js';
import type { AgentFrontmatter } from '../../genome/schema.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const MINIMAL_FM: AgentFrontmatter = {
  name: 'test-concept',
  description: 'Test concept for validation',
  type: 'workflow',
  execution: 'task-tool',
  model: 'sonnet',
  color: 'blue',
  tools: '*',
  disallowedTools: [],
  mcpServers: [],
  hooks: {},
  skills: [],
  costPerAction: 0.003,
  optimizationLevel: 'baseline',
  expectedContextTokens: 500,
  expectedDurationSeconds: 5,
};

const FULL_FM: AgentFrontmatter = {
  ...MINIMAL_FM,
  name: 'story-concept',
  description: 'Story Concept - Captures requirements',
  permissionMode: 'acceptEdits',
  maxTurns: 25,
  memory: 'project',
  background: false,
  isolation: 'worktree',
  baselineContextTokens: 100000,
  contextReduction: '99%',
  disallowedTools: ['Write', 'Bash'],
  mcpServers: ['zen-server'],
  hooks: {
    Stop: [{ type: 'command', command: 'bash .claude/hooks/concept-complete.sh story' }],
  },
  skills: [
    { name: 'schema-validation', comment: 'Validate story structure' },
    { name: 'story-decomposition', comment: 'INVEST criteria' },
    { name: 'bare-skill', comment: '' },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('serializeFrontmatter', () => {
  describe('basic output', () => {
    it('includes required fields', () => {
      const raw = serializeFrontmatter(MINIMAL_FM);
      expect(raw).toContain('name: test-concept');
      expect(raw).toContain('model: sonnet');
      expect(raw).toContain('type: workflow');
      expect(raw).toContain('execution: task-tool');
    });

    it('quotes description with special characters', () => {
      const raw = serializeFrontmatter(FULL_FM);
      expect(raw).toContain('description: "Story Concept - Captures requirements"');
    });

    it('does not quote simple identifiers', () => {
      const raw = serializeFrontmatter(MINIMAL_FM);
      expect(raw).toContain('name: test-concept');
      expect(raw).toContain('color: blue');
    });

    it('includes numeric zen metadata', () => {
      const raw = serializeFrontmatter(MINIMAL_FM);
      expect(raw).toContain('cost_per_action: 0.003');
      expect(raw).toContain('expected_context_tokens: 500');
      expect(raw).toContain('expected_duration_seconds: 5');
    });

    it('serializes optimization_level', () => {
      const raw = serializeFrontmatter(MINIMAL_FM);
      // "baseline" is a simple identifier — no quoting needed
      expect(raw).toContain('optimization_level: baseline');
    });
  });

  describe('tools handling', () => {
    it('serializes string tools with quotes', () => {
      const raw = serializeFrontmatter(MINIMAL_FM);
      expect(raw).toContain('tools: "*"');
    });

    it('serializes array tools as list', () => {
      const fm = { ...MINIMAL_FM, tools: ['Read', 'Write', 'Bash'] as readonly string[] };
      const raw = serializeFrontmatter(fm);
      expect(raw).toContain('tools:\n  - Read\n  - Write\n  - Bash');
    });
  });

  describe('optional collections', () => {
    it('omits empty disallowedTools', () => {
      const raw = serializeFrontmatter(MINIMAL_FM);
      expect(raw).not.toContain('disallowedTools');
    });

    it('includes non-empty disallowedTools', () => {
      const raw = serializeFrontmatter(FULL_FM);
      expect(raw).toContain('disallowedTools:');
      expect(raw).toContain('  - Write');
      expect(raw).toContain('  - Bash');
    });

    it('omits empty mcpServers', () => {
      const raw = serializeFrontmatter(MINIMAL_FM);
      expect(raw).not.toContain('mcpServers');
    });

    it('includes non-empty mcpServers', () => {
      const raw = serializeFrontmatter(FULL_FM);
      expect(raw).toContain('mcpServers:');
      expect(raw).toContain('  - zen-server');
    });
  });

  describe('optional scalars', () => {
    it('omits undefined optional fields', () => {
      const raw = serializeFrontmatter(MINIMAL_FM);
      expect(raw).not.toContain('permissionMode');
      expect(raw).not.toContain('maxTurns');
      expect(raw).not.toContain('memory');
      expect(raw).not.toContain('background');
      expect(raw).not.toContain('isolation');
    });

    it('includes present optional fields', () => {
      const raw = serializeFrontmatter(FULL_FM);
      expect(raw).toContain('permissionMode: acceptEdits');
      expect(raw).toContain('maxTurns: 25');
      expect(raw).toContain('memory: project');
      expect(raw).toContain('background: false');
      expect(raw).toContain('isolation: worktree');
    });

    it('includes baseline_context_tokens when present', () => {
      const raw = serializeFrontmatter(FULL_FM);
      expect(raw).toContain('baseline_context_tokens: 100000');
    });

    it('includes context_reduction when present', () => {
      const raw = serializeFrontmatter(FULL_FM);
      expect(raw).toContain('context_reduction: "99%"');
    });
  });

  describe('hooks', () => {
    it('omits empty hooks', () => {
      const raw = serializeFrontmatter(MINIMAL_FM);
      expect(raw).not.toContain('hooks');
    });

    it('serializes hooks with event grouping', () => {
      const raw = serializeFrontmatter(FULL_FM);
      expect(raw).toContain('hooks:');
      expect(raw).toContain('  Stop:');
      expect(raw).toContain('    - type: command');
      expect(raw).toContain('      command: "bash .claude/hooks/concept-complete.sh story"');
    });
  });

  describe('skills', () => {
    it('omits empty skills', () => {
      const raw = serializeFrontmatter(MINIMAL_FM);
      expect(raw).not.toContain('skills');
    });

    it('serializes skills with inline comments', () => {
      const raw = serializeFrontmatter(FULL_FM);
      expect(raw).toContain('skills:');
      expect(raw).toMatch(/- schema-validation\s+# Validate story structure/);
      expect(raw).toMatch(/- story-decomposition\s+# INVEST criteria/);
    });

    it('serializes skills without comments', () => {
      const raw = serializeFrontmatter(FULL_FM);
      expect(raw).toContain('  - bare-skill');
    });
  });

  describe('round-trip', () => {
    it('minimal frontmatter round-trips through parse', () => {
      const raw = serializeFrontmatter(MINIMAL_FM);
      const template = `---\n${raw}\n---\n\n# Test\n\n## Purpose\n\nTest.`;
      const genome = parseAgentTemplate(template);

      expect(genome.frontmatter.name).toBe(MINIMAL_FM.name);
      expect(genome.frontmatter.model).toBe(MINIMAL_FM.model);
      expect(genome.frontmatter.costPerAction).toBe(MINIMAL_FM.costPerAction);
      expect(genome.frontmatter.optimizationLevel).toBe(MINIMAL_FM.optimizationLevel);
    });

    it('full frontmatter round-trips through parse', () => {
      const raw = serializeFrontmatter(FULL_FM);
      const template = `---\n${raw}\n---\n\n# Test\n\n## Purpose\n\nTest.`;
      const genome = parseAgentTemplate(template);

      expect(genome.frontmatter.name).toBe(FULL_FM.name);
      expect(genome.frontmatter.description).toBe(FULL_FM.description);
      expect(genome.frontmatter.permissionMode).toBe(FULL_FM.permissionMode);
      expect(genome.frontmatter.maxTurns).toBe(FULL_FM.maxTurns);
      expect(genome.frontmatter.memory).toBe(FULL_FM.memory);
      expect(genome.frontmatter.skills).toHaveLength(3);
      expect(genome.frontmatter.skills[0].name).toBe('schema-validation');
      expect(genome.frontmatter.skills[0].comment).toBe('Validate story structure');
      expect(genome.frontmatter.disallowedTools).toEqual(['Write', 'Bash']);
      expect(genome.frontmatter.mcpServers).toEqual(['zen-server']);
    });

    it('hooks round-trip through parse', () => {
      const raw = serializeFrontmatter(FULL_FM);
      const template = `---\n${raw}\n---\n\n# Test\n\n## Purpose\n\nTest.`;
      const genome = parseAgentTemplate(template);

      const stopHooks = genome.frontmatter.hooks['Stop'];
      expect(stopHooks).toHaveLength(1);
      expect(stopHooks[0].type).toBe('command');
      expect(stopHooks[0].command).toBe('bash .claude/hooks/concept-complete.sh story');
    });
  });
});
