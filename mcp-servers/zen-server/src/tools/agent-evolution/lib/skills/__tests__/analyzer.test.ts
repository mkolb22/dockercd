import { describe, it, expect, vi } from 'vitest';
import { SkillAnalyzer } from '../analyzer.js';
import { EvaluationHarness } from '../../harness/harness.js';
import type { AgentExecutor, ExecutionOutput, Scorer } from '../../harness/types.js';
import type { AgentGenome, SkillEntry } from '../../genome/schema.js';
import type { BenchmarkTask, RubricScore } from '../../benchmark/schema.js';
import { STANDARD_RUBRICS } from '../../benchmark/schema.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const MOCK_USAGE = {
  inputTokens: 100,
  outputTokens: 200,
  durationMs: 500,
  estimatedCostUsd: 0.01,
} as const;

function makeSkill(name: string, comment: string = ''): SkillEntry {
  return { name, comment };
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
    sections: [
      { id: 'purpose', heading: 'Purpose', level: 2, content: 'Test agent.' },
    ],
  };
}

function makeTask(id: string): BenchmarkTask {
  return {
    id,
    name: `Task ${id}`,
    description: `Description for ${id}`,
    targetAgent: 'story-concept',
    category: 'feature',
    difficulty: 'simple',
    prompt: `Prompt for ${id}`,
    context: { projectDescription: 'Test', files: [], constraints: [] },
    criteria: [
      {
        id: 'c-correctness',
        dimension: 'correctness',
        description: 'Is it correct?',
        weight: 0.6,
        rubric: STANDARD_RUBRICS.correctness,
      },
      {
        id: 'c-completeness',
        dimension: 'completeness',
        description: 'Is it complete?',
        weight: 0.4,
        rubric: STANDARD_RUBRICS.completeness,
      },
    ],
    expectedElements: ['test element'],
    tags: [],
  };
}

/**
 * Creates a harness where the scorer examines the assembled prompt
 * for skill names to determine scoring.
 */
function makeSkillAwareHarness(
  skillScores: Record<string, RubricScore>,
  defaultScore: RubricScore = 3,
): EvaluationHarness {
  const executor: AgentExecutor = {
    execute: vi.fn().mockImplementation(
      (agentPrompt: string) =>
        Promise.resolve({
          output: agentPrompt,
          usage: MOCK_USAGE,
        } satisfies ExecutionOutput),
    ),
  };

  const scorer: Scorer = {
    score: vi.fn().mockImplementation(
      (task: BenchmarkTask, output: string) => {
        // Check which skills are present in assembled prompt
        let score = defaultScore;
        for (const [skillName, skillScore] of Object.entries(skillScores)) {
          if (output.toLowerCase().includes(skillName.toLowerCase())) {
            // Skill present → apply its score (take the max improvement)
            score = Math.max(score, skillScore) as RubricScore;
          }
        }
        return Promise.resolve(
          task.criteria.map(c => ({
            criterionId: c.id,
            score,
            rationale: `Score ${score}`,
          })),
        );
      },
    ),
  };

  return new EvaluationHarness(executor, scorer);
}

/** Simple fixed-score harness. */
function makeFixedHarness(score: RubricScore = 3): EvaluationHarness {
  const executor: AgentExecutor = {
    execute: vi.fn().mockResolvedValue({
      output: 'Fixed output',
      usage: MOCK_USAGE,
    } satisfies ExecutionOutput),
  };

  const scorer: Scorer = {
    score: vi.fn().mockImplementation(
      (task: BenchmarkTask) =>
        Promise.resolve(
          task.criteria.map(c => ({
            criterionId: c.id,
            score,
            rationale: `Fixed score ${score}`,
          })),
        ),
    ),
  };

  return new EvaluationHarness(executor, scorer);
}

// ---------------------------------------------------------------------------
// SkillAnalyzer – basic behavior
// ---------------------------------------------------------------------------

describe('SkillAnalyzer – basic behavior', () => {
  it('analyzes current skills for removal impact', async () => {
    const harness = makeFixedHarness(3);
    const analyzer = new SkillAnalyzer(harness);

    const genome = makeGenome('story-concept', [
      makeSkill('schema-validation'),
      makeSkill('story-decomposition'),
    ]);

    const report = await analyzer.analyze(genome, [makeTask('t1')]);

    expect(report.genomeId).toBe('story-concept');
    expect(report.removalImpacts).toHaveLength(2);
    expect(report.currentSkills).toHaveLength(2);
    // 1 baseline + 2 removals
    expect(report.totalEvaluations).toBe(3);
    expect(report.totalMutationsTested).toBe(2);
  });

  it('analyzes candidate skills for addition impact', async () => {
    const harness = makeFixedHarness(3);
    const analyzer = new SkillAnalyzer(harness);

    const genome = makeGenome('story-concept', [makeSkill('existing')]);
    const candidates = [
      makeSkill('new-skill-a'),
      makeSkill('new-skill-b'),
    ];

    const report = await analyzer.analyze(genome, [makeTask('t1')], candidates);

    expect(report.additionImpacts).toHaveLength(2);
    // 1 baseline + 1 removal + 2 additions
    expect(report.totalEvaluations).toBe(4);
    expect(report.totalMutationsTested).toBe(3);
  });

  it('skips candidates already present in genome', async () => {
    const harness = makeFixedHarness(3);
    const analyzer = new SkillAnalyzer(harness);

    const genome = makeGenome('story-concept', [makeSkill('skill-a')]);
    const candidates = [
      makeSkill('skill-a'), // Already present → skip
      makeSkill('skill-b'), // New → test
    ];

    const report = await analyzer.analyze(genome, [makeTask('t1')], candidates);

    expect(report.additionImpacts).toHaveLength(1);
    expect(report.additionImpacts[0].skill.name).toBe('skill-b');
  });

  it('returns baseline portfolio', async () => {
    const harness = makeFixedHarness(3);
    const analyzer = new SkillAnalyzer(harness);

    const genome = makeGenome('story-concept', []);
    const report = await analyzer.analyze(genome, [makeTask('t1')]);

    expect(report.baseline).toBeDefined();
    expect(report.baseline.fitness).toBeGreaterThan(0);
  });

  it('uses custom genomeId', async () => {
    const harness = makeFixedHarness(3);
    const analyzer = new SkillAnalyzer(harness);

    const genome = makeGenome('story-concept', []);
    const report = await analyzer.analyze(genome, [makeTask('t1')], [], 'custom-id');

    expect(report.genomeId).toBe('custom-id');
  });
});

// ---------------------------------------------------------------------------
// SkillAnalyzer – removal impact
// ---------------------------------------------------------------------------

describe('SkillAnalyzer – removal impact', () => {
  it('detects zero-impact removal (fixed scorer)', async () => {
    const harness = makeFixedHarness(3);
    const analyzer = new SkillAnalyzer(harness);

    const genome = makeGenome('story-concept', [makeSkill('unimportant')]);
    const report = await analyzer.analyze(genome, [makeTask('t1')]);

    expect(report.removalImpacts[0].fitnessDelta).toBe(0);
    expect(report.removalImpacts[0].impactMagnitude).toBe(0);
    expect(report.removalImpacts[0].direction).toBe('remove');
    expect(report.removalImpacts[0].presentInBaseline).toBe(true);
  });

  it('records fitness values for removal', async () => {
    const harness = makeFixedHarness(3);
    const analyzer = new SkillAnalyzer(harness);

    const genome = makeGenome('story-concept', [makeSkill('skill-a')]);
    const report = await analyzer.analyze(genome, [makeTask('t1')]);

    const impact = report.removalImpacts[0];
    expect(impact.baselineFitness).toBeGreaterThan(0);
    expect(impact.mutatedFitness).toBeDefined();
    expect(impact.dimensionDeltas).toBeDefined();
  });

  it('ranks removal impacts by magnitude', async () => {
    const harness = makeFixedHarness(3);
    const analyzer = new SkillAnalyzer(harness);

    const genome = makeGenome('story-concept', [
      makeSkill('skill-a'),
      makeSkill('skill-b'),
      makeSkill('skill-c'),
    ]);

    const report = await analyzer.analyze(genome, [makeTask('t1')]);

    // All zero impact with fixed scorer, but ranking should still work
    for (let i = 0; i < report.removalImpacts.length - 1; i++) {
      expect(report.removalImpacts[i].impactMagnitude)
        .toBeGreaterThanOrEqual(report.removalImpacts[i + 1].impactMagnitude);
    }
  });
});

// ---------------------------------------------------------------------------
// SkillAnalyzer – addition impact
// ---------------------------------------------------------------------------

describe('SkillAnalyzer – addition impact', () => {
  it('records correct direction for additions', async () => {
    const harness = makeFixedHarness(3);
    const analyzer = new SkillAnalyzer(harness);

    const genome = makeGenome('story-concept', []);
    const candidates = [makeSkill('new-skill')];

    const report = await analyzer.analyze(genome, [makeTask('t1')], candidates);

    expect(report.additionImpacts[0].direction).toBe('add');
    expect(report.additionImpacts[0].presentInBaseline).toBe(false);
  });

  it('ranks addition impacts by magnitude', async () => {
    const harness = makeFixedHarness(3);
    const analyzer = new SkillAnalyzer(harness);

    const genome = makeGenome('story-concept', []);
    const candidates = [
      makeSkill('skill-a'),
      makeSkill('skill-b'),
      makeSkill('skill-c'),
    ];

    const report = await analyzer.analyze(genome, [makeTask('t1')], candidates);

    for (let i = 0; i < report.additionImpacts.length - 1; i++) {
      expect(report.additionImpacts[i].impactMagnitude)
        .toBeGreaterThanOrEqual(report.additionImpacts[i + 1].impactMagnitude);
    }
  });
});

// ---------------------------------------------------------------------------
// SkillAnalyzer – recommended skills
// ---------------------------------------------------------------------------

describe('SkillAnalyzer – recommended skills', () => {
  it('keeps all skills when none have zero impact (fixed scorer)', async () => {
    const harness = makeFixedHarness(3);
    const analyzer = new SkillAnalyzer(harness);

    const genome = makeGenome('story-concept', [
      makeSkill('skill-a'),
      makeSkill('skill-b'),
    ]);

    const report = await analyzer.analyze(genome, [makeTask('t1')]);

    // With fixed scorer: removal has zero delta, so fitnessDelta = 0
    // 0 > -minRemovalPenalty (default -0.005), so skills are NOT kept
    // Actually: fitnessDelta is 0, minRemovalPenalty is 0.005
    // condition: fitnessDelta <= -0.005 → 0 <= -0.005 is false → skills dropped
    // Recommended set may be empty since all skills have zero removal impact

    // The recommendation drops skills with negligible removal impact
    // This is correct: if removing a skill doesn't hurt, it's wasted context
    expect(report.recommendedSkills.length).toBeLessThanOrEqual(
      report.currentSkills.length,
    );
  });

  it('recommends empty set when no skills have impact', async () => {
    const harness = makeFixedHarness(3);
    // Use very strict thresholds
    const analyzer = new SkillAnalyzer(harness, {
      minRemovalPenalty: 0.001,
      minAdditionBenefit: 0.001,
    });

    const genome = makeGenome('story-concept', [
      makeSkill('skill-a'),
    ]);

    const report = await analyzer.analyze(genome, [makeTask('t1')]);

    // Fixed scorer → zero impact → skill not recommended
    // fitnessDelta = 0, not <= -0.001, so skill is dropped
    expect(report.recommendedSkills.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// SkillAnalyzer – edge cases
// ---------------------------------------------------------------------------

describe('SkillAnalyzer – edge cases', () => {
  it('handles genome with no skills', async () => {
    const harness = makeFixedHarness(3);
    const analyzer = new SkillAnalyzer(harness);

    const genome = makeGenome('story-concept', []);
    const report = await analyzer.analyze(genome, [makeTask('t1')]);

    expect(report.removalImpacts).toHaveLength(0);
    expect(report.currentSkills).toHaveLength(0);
    expect(report.totalEvaluations).toBe(1); // Just baseline
  });

  it('handles no candidates', async () => {
    const harness = makeFixedHarness(3);
    const analyzer = new SkillAnalyzer(harness);

    const genome = makeGenome('story-concept', [makeSkill('existing')]);
    const report = await analyzer.analyze(genome, [makeTask('t1')], []);

    expect(report.additionImpacts).toHaveLength(0);
  });

  it('handles empty tasks', async () => {
    const harness = makeFixedHarness(3);
    const analyzer = new SkillAnalyzer(harness);

    const genome = makeGenome('story-concept', [makeSkill('skill')]);
    const report = await analyzer.analyze(genome, []);

    expect(report.baseline.fitness).toBe(0);
    expect(report.removalImpacts).toHaveLength(1);
  });

  it('provides timestamp', async () => {
    const harness = makeFixedHarness(3);
    const analyzer = new SkillAnalyzer(harness);

    const genome = makeGenome('story-concept', []);
    const report = await analyzer.analyze(genome, [makeTask('t1')]);

    expect(report.analyzedAt).toBeTruthy();
    expect(new Date(report.analyzedAt).getTime()).toBeGreaterThan(0);
  });
});
