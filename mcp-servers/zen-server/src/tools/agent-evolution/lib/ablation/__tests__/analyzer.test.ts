import { describe, it, expect, vi } from 'vitest';
import { AblationAnalyzer } from '../analyzer.js';
import { EvaluationHarness } from '../../harness/harness.js';
import type { AgentExecutor, ExecutionOutput, Scorer } from '../../harness/types.js';
import type { AgentGenome, CanonicalSectionId } from '../../genome/schema.js';
import type {
  BenchmarkTask,
  RubricScore,
} from '../../benchmark/schema.js';
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

function makeGenome(
  name: string,
  sections: { id: CanonicalSectionId | 'custom'; content: string }[],
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
      skills: [],
      type: 'workflow',
      execution: 'task-tool',
      costPerAction: 0.01,
      optimizationLevel: 'baseline',
      expectedContextTokens: 1000,
      expectedDurationSeconds: 30,
    },
    rawFrontmatter: `name: ${name}`,
    title: `# ${name}`,
    sections: sections.map(s => ({
      id: s.id,
      heading: s.id === 'custom' ? 'Custom' : s.id.replace(/_/g, ' '),
      level: 2,
      content: s.content,
    })),
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
 * Creates a harness where the scorer returns different scores based on
 * whether certain sections are present in the assembled prompt.
 *
 * This simulates the real scenario: removing a high-impact section
 * causes lower scores, while removing a low-impact section has
 * minimal effect.
 */
function makeImpactHarness(
  sectionScores: Record<string, RubricScore>,
  defaultScore: RubricScore = 3,
): EvaluationHarness {
  const executor: AgentExecutor = {
    execute: vi.fn().mockImplementation(
      (agentPrompt: string) =>
        Promise.resolve({
          output: agentPrompt, // Pass prompt as output so scorer can inspect it
          usage: MOCK_USAGE,
        } satisfies ExecutionOutput),
    ),
  };

  const scorer: Scorer = {
    score: vi.fn().mockImplementation(
      (task: BenchmarkTask, output: string) => {
        // Determine score based on which sections are missing
        let score = defaultScore;
        for (const [sectionKeyword, sectionScore] of Object.entries(sectionScores)) {
          if (!output.toLowerCase().includes(sectionKeyword.toLowerCase())) {
            // Section missing → apply its impact
            score = Math.min(score, sectionScore) as RubricScore;
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

/** Simple harness that always returns a fixed score. */
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
// AblationAnalyzer – basic behavior
// ---------------------------------------------------------------------------

describe('AblationAnalyzer – basic behavior', () => {
  it('analyzes all sections in a genome', async () => {
    const harness = makeFixedHarness(3);
    const analyzer = new AblationAnalyzer(harness);

    const genome = makeGenome('story-concept', [
      { id: 'purpose', content: 'Agent purpose' },
      { id: 'methodology', content: 'Agent methodology' },
      { id: 'output_format', content: 'Output format' },
    ]);

    const tasks = [makeTask('t1')];
    const report = await analyzer.analyze(genome, tasks);

    expect(report.genomeId).toBe('story-concept');
    expect(report.agentName).toBe('story-concept');
    expect(report.sectionsAnalyzed).toBe(3);
    expect(report.impacts).toHaveLength(3);
    // 1 baseline + 3 ablations
    expect(report.totalEvaluations).toBe(4);
    expect(report.analyzedAt).toBeTruthy();
  });

  it('returns baseline portfolio', async () => {
    const harness = makeFixedHarness(3);
    const analyzer = new AblationAnalyzer(harness);

    const genome = makeGenome('story-concept', [
      { id: 'purpose', content: 'Purpose' },
    ]);

    const report = await analyzer.analyze(genome, [makeTask('t1')]);

    expect(report.baseline).toBeDefined();
    expect(report.baseline.fitness).toBeGreaterThan(0);
  });

  it('uses custom genomeId when provided', async () => {
    const harness = makeFixedHarness(3);
    const analyzer = new AblationAnalyzer(harness);

    const genome = makeGenome('story-concept', [
      { id: 'purpose', content: 'Purpose' },
    ]);

    const report = await analyzer.analyze(genome, [makeTask('t1')], 'custom-id');

    expect(report.genomeId).toBe('custom-id');
  });
});

// ---------------------------------------------------------------------------
// AblationAnalyzer – impact measurement
// ---------------------------------------------------------------------------

describe('AblationAnalyzer – impact measurement', () => {
  it('detects high-impact section removal', async () => {
    // purpose is high-impact: removing it drops score from 3 to 0
    const harness = makeImpactHarness({ 'purpose': 0 as RubricScore }, 3);
    const analyzer = new AblationAnalyzer(harness);

    const genome = makeGenome('story-concept', [
      { id: 'purpose', content: 'Critical purpose section' },
      { id: 'methodology', content: 'Methodology content' },
    ]);

    const report = await analyzer.analyze(genome, [makeTask('t1')]);

    const purposeImpact = report.impacts.find(i => i.sectionId === 'purpose');
    expect(purposeImpact).toBeDefined();
    expect(purposeImpact!.present).toBe(true);
    expect(purposeImpact!.fitnessDelta).toBeLessThan(0); // Removing hurts fitness
    expect(purposeImpact!.impactMagnitude).toBeGreaterThan(0);
  });

  it('detects zero-impact section removal', async () => {
    // All sections score the same whether present or not
    const harness = makeFixedHarness(3);
    const analyzer = new AblationAnalyzer(harness);

    const genome = makeGenome('story-concept', [
      { id: 'purpose', content: 'Purpose' },
      { id: 'footer', content: 'Footer' },
    ]);

    const report = await analyzer.analyze(genome, [makeTask('t1')]);

    for (const impact of report.impacts) {
      expect(impact.present).toBe(true);
      expect(impact.fitnessDelta).toBe(0);
      expect(impact.impactMagnitude).toBe(0);
    }
  });

  it('computes per-dimension deltas', async () => {
    const harness = makeImpactHarness({ 'purpose': 0 as RubricScore }, 3);
    const analyzer = new AblationAnalyzer(harness);

    const genome = makeGenome('story-concept', [
      { id: 'purpose', content: 'Critical purpose section' },
    ]);

    const report = await analyzer.analyze(genome, [makeTask('t1')]);

    const impact = report.impacts[0];
    expect(impact.dimensionDeltas).not.toBeNull();
    // Correctness should drop when purpose is removed
    expect(impact.dimensionDeltas!.correctness).toBeLessThanOrEqual(0);
  });

  it('records baseline and ablated fitness', async () => {
    const harness = makeImpactHarness({ 'purpose': 1 as RubricScore }, 3);
    const analyzer = new AblationAnalyzer(harness);

    const genome = makeGenome('story-concept', [
      { id: 'purpose', content: 'Purpose content' },
    ]);

    const report = await analyzer.analyze(genome, [makeTask('t1')]);

    const impact = report.impacts[0];
    expect(impact.baselineFitness).toBeGreaterThan(0);
    expect(impact.ablatedFitness).not.toBeNull();
    expect(impact.ablatedFitness!).toBeLessThan(impact.baselineFitness);
  });
});

// ---------------------------------------------------------------------------
// AblationAnalyzer – ranking
// ---------------------------------------------------------------------------

describe('AblationAnalyzer – ranking', () => {
  it('ranks sections by impact magnitude (highest first)', async () => {
    // purpose: removing drops to 0 (high impact)
    // methodology: removing drops to 2 (medium impact)
    // footer: removing has no impact (stays at 3)
    const harness = makeImpactHarness(
      {
        'purpose': 0 as RubricScore,
        'methodology': 2 as RubricScore,
      },
      3,
    );
    const analyzer = new AblationAnalyzer(harness);

    const genome = makeGenome('story-concept', [
      { id: 'purpose', content: 'Critical purpose' },
      { id: 'methodology', content: 'Important methodology' },
      { id: 'footer', content: 'Optional footer' },
    ]);

    const report = await analyzer.analyze(genome, [makeTask('t1')]);

    // Should be ranked: purpose > methodology > footer
    expect(report.impacts[0].sectionId).toBe('purpose');
    expect(report.impacts[1].sectionId).toBe('methodology');
    expect(report.impacts[2].sectionId).toBe('footer');

    // Impact magnitudes should be descending
    for (let i = 0; i < report.impacts.length - 1; i++) {
      const a = report.impacts[i].impactMagnitude ?? 0;
      const b = report.impacts[i + 1].impactMagnitude ?? 0;
      expect(a).toBeGreaterThanOrEqual(b);
    }
  });
});

// ---------------------------------------------------------------------------
// AblationAnalyzer – mutation weights
// ---------------------------------------------------------------------------

describe('AblationAnalyzer – mutation weights', () => {
  it('assigns higher weight to higher-impact sections', async () => {
    const harness = makeImpactHarness(
      {
        'purpose': 0 as RubricScore,
        'methodology': 2 as RubricScore,
      },
      3,
    );
    const analyzer = new AblationAnalyzer(harness);

    const genome = makeGenome('story-concept', [
      { id: 'purpose', content: 'Critical purpose' },
      { id: 'methodology', content: 'Important methodology' },
      { id: 'footer', content: 'Optional footer' },
    ]);

    const report = await analyzer.analyze(genome, [makeTask('t1')]);

    const purposeWeight = report.mutationWeights.get('purpose') ?? 0;
    const methodologyWeight = report.mutationWeights.get('methodology') ?? 0;

    expect(purposeWeight).toBeGreaterThan(methodologyWeight);
  });

  it('weights sum to 1.0', async () => {
    const harness = makeImpactHarness(
      { 'purpose': 0 as RubricScore },
      3,
    );
    const analyzer = new AblationAnalyzer(harness);

    const genome = makeGenome('story-concept', [
      { id: 'purpose', content: 'Purpose' },
      { id: 'methodology', content: 'Methodology' },
      { id: 'footer', content: 'Footer' },
    ]);

    const report = await analyzer.analyze(genome, [makeTask('t1')]);

    let sum = 0;
    for (const weight of report.mutationWeights.values()) {
      sum += weight;
    }
    expect(sum).toBeCloseTo(1.0, 10);
  });

  it('assigns uniform weights when all impacts are zero', async () => {
    const harness = makeFixedHarness(3);
    const analyzer = new AblationAnalyzer(harness);

    const genome = makeGenome('story-concept', [
      { id: 'purpose', content: 'Purpose' },
      { id: 'methodology', content: 'Methodology' },
    ]);

    const report = await analyzer.analyze(genome, [makeTask('t1')]);

    // All impacts are zero → uniform weights
    const purposeWeight = report.mutationWeights.get('purpose') ?? 0;
    const methodologyWeight = report.mutationWeights.get('methodology') ?? 0;
    expect(purposeWeight).toBeCloseTo(0.5, 10);
    expect(methodologyWeight).toBeCloseTo(0.5, 10);
  });

  it('respects minImpactThreshold', async () => {
    const harness = makeImpactHarness(
      { 'purpose': 0 as RubricScore },
      3,
    );
    // Purpose impact magnitude is ~0.375 (fitness drops from ~0.375 to 0).
    // Set threshold between purpose's impact and footer's zero impact.
    const analyzer = new AblationAnalyzer(harness, {
      minImpactThreshold: 0.1,
    });

    const genome = makeGenome('story-concept', [
      { id: 'purpose', content: 'Critical purpose' },
      { id: 'footer', content: 'Optional footer' },
    ]);

    const report = await analyzer.analyze(genome, [makeTask('t1')]);

    const purposeImpact = report.impacts.find(i => i.sectionId === 'purpose');
    const footerImpact = report.impacts.find(i => i.sectionId === 'footer');

    // purpose has impact > 0.1 threshold → gets weight
    expect(purposeImpact!.impactMagnitude).toBeGreaterThan(0.1);
    expect(report.mutationWeights.get('purpose')).toBeGreaterThan(0);

    // footer has zero impact (below 0.1 threshold) → no weight
    expect(footerImpact!.impactMagnitude).toBe(0);
    expect(report.mutationWeights.get('footer')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// AblationAnalyzer – configuration
// ---------------------------------------------------------------------------

describe('AblationAnalyzer – configuration', () => {
  it('canonicalOnly=true skips custom sections', async () => {
    const harness = makeFixedHarness(3);
    const analyzer = new AblationAnalyzer(harness, { canonicalOnly: true });

    const genome = makeGenome('story-concept', [
      { id: 'purpose', content: 'Purpose' },
      { id: 'custom', content: 'Custom section' },
    ]);

    const report = await analyzer.analyze(genome, [makeTask('t1')]);

    expect(report.sectionsAnalyzed).toBe(1);
    expect(report.impacts).toHaveLength(1);
    expect(report.impacts[0].sectionId).toBe('purpose');
  });

  it('canonicalOnly=false includes custom sections', async () => {
    const harness = makeFixedHarness(3);
    const analyzer = new AblationAnalyzer(harness, { canonicalOnly: false });

    const genome = makeGenome('story-concept', [
      { id: 'purpose', content: 'Purpose' },
      { id: 'custom', content: 'Custom section' },
    ]);

    const report = await analyzer.analyze(genome, [makeTask('t1')]);

    expect(report.sectionsAnalyzed).toBe(2);
  });

  it('custom alpha affects significance reporting', async () => {
    const harness = makeImpactHarness({ 'purpose': 1 as RubricScore }, 3);

    // Very strict alpha — almost nothing is significant
    const strictAnalyzer = new AblationAnalyzer(harness, { alpha: 0.001 });
    // Very lenient alpha
    const lenientAnalyzer = new AblationAnalyzer(harness, { alpha: 0.99 });

    const genome = makeGenome('story-concept', [
      { id: 'purpose', content: 'Purpose' },
    ]);
    // Need ≥2 tasks for significance testing
    const tasks = [makeTask('t1'), makeTask('t2')];

    const strictReport = await strictAnalyzer.analyze(genome, tasks);
    const lenientReport = await lenientAnalyzer.analyze(genome, tasks);

    // Lenient should find at least as many significant sections as strict
    expect(lenientReport.significantCount).toBeGreaterThanOrEqual(
      strictReport.significantCount,
    );
  });
});

// ---------------------------------------------------------------------------
// AblationAnalyzer – edge cases
// ---------------------------------------------------------------------------

describe('AblationAnalyzer – edge cases', () => {
  it('handles genome with no sections', async () => {
    const harness = makeFixedHarness(3);
    const analyzer = new AblationAnalyzer(harness);

    const genome = makeGenome('story-concept', []);

    const report = await analyzer.analyze(genome, [makeTask('t1')]);

    expect(report.sectionsAnalyzed).toBe(0);
    expect(report.impacts).toHaveLength(0);
    expect(report.totalEvaluations).toBe(1); // Just baseline
  });

  it('handles genome with single section', async () => {
    const harness = makeFixedHarness(3);
    const analyzer = new AblationAnalyzer(harness);

    const genome = makeGenome('story-concept', [
      { id: 'purpose', content: 'Purpose' },
    ]);

    const report = await analyzer.analyze(genome, [makeTask('t1')]);

    expect(report.sectionsAnalyzed).toBe(1);
    expect(report.impacts).toHaveLength(1);
    expect(report.totalEvaluations).toBe(2);
  });

  it('deduplicates sections with same ID', async () => {
    const harness = makeFixedHarness(3);
    const analyzer = new AblationAnalyzer(harness);

    // Two 'custom' sections — should only analyze once
    const genome = makeGenome('story-concept', [
      { id: 'custom', content: 'Custom A' },
      { id: 'custom', content: 'Custom B' },
    ]);

    const report = await analyzer.analyze(genome, [makeTask('t1')]);

    // Only one unique section ID
    expect(report.sectionsAnalyzed).toBe(1);
    expect(report.impacts).toHaveLength(1);
  });

  it('reports significantCount correctly', async () => {
    const harness = makeImpactHarness(
      { 'purpose': 0 as RubricScore },
      3,
    );
    const analyzer = new AblationAnalyzer(harness);

    const genome = makeGenome('story-concept', [
      { id: 'purpose', content: 'Critical purpose' },
      { id: 'footer', content: 'Optional footer' },
    ]);

    const report = await analyzer.analyze(genome, [makeTask('t1')]);

    // At least footer should not be significant (zero impact)
    expect(report.significantCount).toBeLessThanOrEqual(report.sectionsAnalyzed);
  });

  it('includes comparison result when enough tasks for t-test', async () => {
    const harness = makeFixedHarness(3);
    const analyzer = new AblationAnalyzer(harness);

    const genome = makeGenome('story-concept', [
      { id: 'purpose', content: 'Purpose' },
    ]);

    // Need ≥2 tasks for Welch's t-test
    const report = await analyzer.analyze(genome, [makeTask('t1'), makeTask('t2')]);

    const impact = report.impacts[0];
    expect(impact.comparison).not.toBeNull();
    expect(impact.comparison!.genomeA).toBeTruthy();
    expect(impact.comparison!.genomeB).toBeTruthy();
    expect(typeof impact.comparison!.pValue).toBe('number');
  });

  it('skips comparison with single task (not enough samples)', async () => {
    const harness = makeFixedHarness(3);
    const analyzer = new AblationAnalyzer(harness);

    const genome = makeGenome('story-concept', [
      { id: 'purpose', content: 'Purpose' },
    ]);

    const report = await analyzer.analyze(genome, [makeTask('t1')]);

    const impact = report.impacts[0];
    // Still has fitness delta
    expect(impact.present).toBe(true);
    expect(impact.fitnessDelta).toBeDefined();
    // But no statistical comparison
    expect(impact.comparison).toBeNull();
    expect(impact.pValue).toBeNull();
    expect(impact.significant).toBe(false);
  });
});
