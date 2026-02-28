import { describe, it, expect, vi } from 'vitest';
import { SkillMutationStrategy } from '../strategy.js';
import type { AgentGenome, SkillEntry } from '../../genome/schema.js';
import type { EvaluationDimension, PortfolioResult } from '../../benchmark/schema.js';
import { EVALUATION_DIMENSIONS } from '../../benchmark/schema.js';
import type { SkillEvolutionReport, SkillImpact } from '../types.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeSkill(name: string): SkillEntry {
  return { name, comment: '' };
}

function makeGenome(
  name: string,
  skills: SkillEntry[] = [],
): AgentGenome {
  return {
    agentName: name,
    frontmatter: {
      name,
      description: 'Test',
      model: 'sonnet',
      tools: '*',
      disallowedTools: [],
      mcpServers: [],
      color: '#888',
      hooks: {},
      skills,
      type: 'workflow',
      execution: 'task-tool',
      costPerAction: 0.01,
      optimizationLevel: 'baseline',
      expectedContextTokens: 1000,
      expectedDurationSeconds: 30,
    },
    rawFrontmatter: `name: ${name}`,
    title: `# ${name}`,
    sections: [],
  };
}

function zeroDimensions(): Readonly<Record<EvaluationDimension, number>> {
  const d = {} as Record<EvaluationDimension, number>;
  for (const dim of EVALUATION_DIMENSIONS) d[dim] = 0;
  return d;
}

function makePortfolio(fitness: number = 0.5): PortfolioResult {
  return {
    genomeId: 'test',
    dimensionMeans: zeroDimensions(),
    dimensionStdDevs: zeroDimensions(),
    fitness,
    totalUsage: { inputTokens: 0, outputTokens: 0, durationMs: 0, estimatedCostUsd: 0 },
    taskCount: 0,
    taskResults: [],
  };
}

function makeImpact(
  skillName: string,
  direction: 'add' | 'remove',
  fitnessDelta: number,
): SkillImpact {
  return {
    skill: makeSkill(skillName),
    presentInBaseline: direction === 'remove',
    direction,
    fitnessDelta,
    impactMagnitude: Math.abs(fitnessDelta),
    effectSize: null,
    significant: false,
    pValue: null,
    dimensionDeltas: zeroDimensions(),
    baselineFitness: 0.5,
    mutatedFitness: 0.5 + fitnessDelta,
    comparison: null,
  };
}

function makeReport(
  removalImpacts: SkillImpact[] = [],
  additionImpacts: SkillImpact[] = [],
): SkillEvolutionReport {
  return {
    genomeId: 'test',
    agentName: 'test',
    baseline: makePortfolio(),
    currentSkills: removalImpacts.map(i => i.skill),
    removalImpacts,
    additionImpacts,
    recommendedSkills: [],
    totalMutationsTested: removalImpacts.length + additionImpacts.length,
    totalEvaluations: 1 + removalImpacts.length + additionImpacts.length,
    analyzedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// SkillMutationStrategy – basic behavior
// ---------------------------------------------------------------------------

describe('SkillMutationStrategy – basic behavior', () => {
  it('adds a skill from candidates', async () => {
    const candidates = [makeSkill('new-skill')];
    const strategy = new SkillMutationStrategy(candidates);

    const genome = makeGenome('agent', []);
    const result = await strategy.mutate(genome, makePortfolio(), 1, () => 0.0);

    expect(result.applied).toBe(true);
    expect(result.kind).toBe('add_skill');
    expect(result.genome.frontmatter.skills).toHaveLength(1);
    expect(result.genome.frontmatter.skills[0].name).toBe('new-skill');
  });

  it('removes a skill from genome', async () => {
    const candidates: SkillEntry[] = [];
    const strategy = new SkillMutationStrategy(candidates);

    const genome = makeGenome('agent', [makeSkill('existing')]);
    const result = await strategy.mutate(genome, makePortfolio(), 1, () => 0.0);

    expect(result.applied).toBe(true);
    expect(result.kind).toBe('remove_skill');
    expect(result.genome.frontmatter.skills).toHaveLength(0);
  });

  it('returns no-op when no mutations possible', async () => {
    const strategy = new SkillMutationStrategy([]);
    const genome = makeGenome('agent', []);

    const result = await strategy.mutate(genome, makePortfolio(), 1, () => 0.5);

    expect(result.applied).toBe(false);
  });

  it('does not add skill already present', async () => {
    const candidates = [makeSkill('existing')];
    const strategy = new SkillMutationStrategy(candidates);

    // Genome already has the only candidate → can only remove
    const genome = makeGenome('agent', [makeSkill('existing')]);
    const result = await strategy.mutate(genome, makePortfolio(), 1, () => 0.0);

    // Should remove since add isn't possible
    expect(result.kind).toBe('remove_skill');
  });
});

// ---------------------------------------------------------------------------
// SkillMutationStrategy – add/remove ratio
// ---------------------------------------------------------------------------

describe('SkillMutationStrategy – add/remove ratio', () => {
  it('ratio 1.0 always adds when possible', async () => {
    const candidates = [makeSkill('new-a'), makeSkill('new-b')];
    const strategy = new SkillMutationStrategy(candidates, 1.0);

    const genome = makeGenome('agent', [makeSkill('existing')]);

    for (let i = 0; i < 10; i++) {
      const result = await strategy.mutate(genome, makePortfolio(), i, () => Math.random());
      expect(result.kind).toBe('add_skill');
    }
  });

  it('ratio 0.0 always removes when possible', async () => {
    const candidates = [makeSkill('new-a')];
    const strategy = new SkillMutationStrategy(candidates, 0.0);

    const genome = makeGenome('agent', [makeSkill('existing')]);

    for (let i = 0; i < 10; i++) {
      const result = await strategy.mutate(genome, makePortfolio(), i, () => Math.random());
      expect(result.kind).toBe('remove_skill');
    }
  });

  it('ratio 0.5 produces both adds and removes', async () => {
    const candidates = [makeSkill('new-a'), makeSkill('new-b')];
    const strategy = new SkillMutationStrategy(candidates, 0.5);

    const genome = makeGenome('agent', [makeSkill('existing')]);
    const kinds = new Set<string>();

    // With enough calls, both should appear
    for (let i = 0; i < 20; i++) {
      const rng = () => (i % 2 === 0 ? 0.3 : 0.7);
      const result = await strategy.mutate(genome, makePortfolio(), i, rng);
      kinds.add(result.kind);
    }

    expect(kinds.has('add_skill')).toBe(true);
    expect(kinds.has('remove_skill')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SkillMutationStrategy – impact-weighted selection
// ---------------------------------------------------------------------------

describe('SkillMutationStrategy – impact-weighted selection', () => {
  it('biases additions toward high-impact candidates', async () => {
    const candidates = [
      makeSkill('low-impact'),
      makeSkill('high-impact'),
    ];
    const strategy = new SkillMutationStrategy(candidates, 1.0);

    // High-impact skill has much higher positive delta
    const report = makeReport([], [
      makeImpact('low-impact', 'add', 0.01),
      makeImpact('high-impact', 'add', 0.50),
    ]);
    strategy.loadImpactReport(report);

    const genome = makeGenome('agent', []);
    const addCounts: Record<string, number> = { 'low-impact': 0, 'high-impact': 0 };

    // Run many iterations with varying RNG
    for (let i = 0; i < 100; i++) {
      const rng = () => (i / 100); // Sweep through [0, 1)
      const result = await strategy.mutate(genome, makePortfolio(), i, rng);
      if (result.applied) {
        const added = result.genome.frontmatter.skills[0]?.name;
        if (added) addCounts[added] = (addCounts[added] ?? 0) + 1;
      }
    }

    // high-impact should be selected much more often
    expect(addCounts['high-impact']).toBeGreaterThan(addCounts['low-impact']);
  });

  it('biases removals toward low-impact skills', async () => {
    const candidates: SkillEntry[] = [];
    const strategy = new SkillMutationStrategy(candidates, 0.0);

    // essential-skill has high removal impact → should be preserved
    // wasteful-skill has low removal impact → should be removed more
    const report = makeReport([
      makeImpact('essential-skill', 'remove', -0.30),
      makeImpact('wasteful-skill', 'remove', -0.01),
    ]);
    strategy.loadImpactReport(report);

    const genome = makeGenome('agent', [
      makeSkill('essential-skill'),
      makeSkill('wasteful-skill'),
    ]);

    const removeCounts: Record<string, number> = {
      'essential-skill': 0,
      'wasteful-skill': 0,
    };

    for (let i = 0; i < 100; i++) {
      const rng = () => (i / 100);
      const result = await strategy.mutate(genome, makePortfolio(), i, rng);
      if (result.applied && result.kind === 'remove_skill') {
        const removed = genome.frontmatter.skills.find(
          s => !result.genome.frontmatter.skills.some(rs => rs.name === s.name),
        );
        if (removed) removeCounts[removed.name] = (removeCounts[removed.name] ?? 0) + 1;
      }
    }

    // wasteful-skill should be removed more often than essential-skill
    expect(removeCounts['wasteful-skill']).toBeGreaterThan(removeCounts['essential-skill']);
  });

  it('falls back to uniform without impact report', async () => {
    const candidates = [makeSkill('a'), makeSkill('b')];
    const strategy = new SkillMutationStrategy(candidates, 1.0);

    const genome = makeGenome('agent', []);
    const addCounts: Record<string, number> = { a: 0, b: 0 };

    for (let i = 0; i < 100; i++) {
      const rng = () => (i / 100);
      const result = await strategy.mutate(genome, makePortfolio(), i, rng);
      if (result.applied) {
        const name = result.genome.frontmatter.skills[0]?.name;
        if (name) addCounts[name] = (addCounts[name] ?? 0) + 1;
      }
    }

    // Without impact data, should be roughly uniform
    expect(addCounts['a']).toBeGreaterThan(30);
    expect(addCounts['b']).toBeGreaterThan(30);
  });
});

// ---------------------------------------------------------------------------
// SkillMutationStrategy – determinism
// ---------------------------------------------------------------------------

describe('SkillMutationStrategy – determinism', () => {
  it('produces same result with same RNG', async () => {
    const candidates = [makeSkill('a'), makeSkill('b'), makeSkill('c')];
    const strategy = new SkillMutationStrategy(candidates, 0.5);

    const genome = makeGenome('agent', [makeSkill('existing')]);

    const rng1 = () => 0.42;
    const rng2 = () => 0.42;

    const r1 = await strategy.mutate(genome, makePortfolio(), 1, rng1);
    const r2 = await strategy.mutate(genome, makePortfolio(), 1, rng2);

    expect(r1.kind).toBe(r2.kind);
    expect(r1.applied).toBe(r2.applied);
    if (r1.applied && r2.applied) {
      expect(r1.genome.frontmatter.skills.length).toBe(r2.genome.frontmatter.skills.length);
    }
  });
});
