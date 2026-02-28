import { describe, it, expect } from 'vitest';
import {
  type BenchmarkTask,
  type TaskResult,
  DEFAULT_DIMENSION_WEIGHTS,
  EVALUATION_DIMENSIONS,
  RUBRIC_LEVELS,
  STANDARD_RUBRICS,
  validateDimensionWeights,
  validateResult,
  validateTask,
} from '../schema.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function validTask(overrides: Partial<BenchmarkTask> = {}): BenchmarkTask {
  return {
    id: 'test-task',
    name: 'Test Task',
    description: 'A test task',
    targetAgent: 'story-concept',
    category: 'feature',
    difficulty: 'simple',
    prompt: 'Do the thing.',
    context: {
      projectDescription: 'Test project',
      files: [],
      constraints: [],
    },
    criteria: [
      {
        id: 'c1',
        dimension: 'correctness',
        description: 'Is it correct?',
        weight: 0.5,
        rubric: STANDARD_RUBRICS.correctness,
      },
      {
        id: 'c2',
        dimension: 'completeness',
        description: 'Is it complete?',
        weight: 0.5,
        rubric: STANDARD_RUBRICS.completeness,
      },
    ],
    expectedElements: ['element-1'],
    tags: ['test'],
    ...overrides,
  };
}

function validResult(task: BenchmarkTask): TaskResult {
  return {
    taskId: task.id,
    genomeId: 'genome-1',
    criterionScores: task.criteria.map(c => ({
      criterionId: c.id,
      score: 3 as const,
      rationale: 'Good',
    })),
    dimensionScores: {
      correctness: 0.75,
      completeness: 0.75,
      quality: 0,
      efficiency: 0,
      safety: 0,
      speed: 0,
    },
    fitness: 0.6,
    usage: { inputTokens: 100, outputTokens: 200, durationMs: 500, estimatedCostUsd: 0.01 },
    output: 'agent output',
    evaluatedAt: '2026-02-25T00:00:00Z',
    evaluator: 'automated',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('constants', () => {
  it('dimension weights sum to 1.0', () => {
    const sum = EVALUATION_DIMENSIONS.reduce((s, d) => s + DEFAULT_DIMENSION_WEIGHTS[d], 0);
    expect(Math.abs(sum - 1.0)).toBeLessThan(0.001);
  });

  it('every dimension has a standard rubric with 5 levels', () => {
    for (const dim of EVALUATION_DIMENSIONS) {
      expect(STANDARD_RUBRICS[dim]).toHaveLength(RUBRIC_LEVELS.length);
      for (let i = 0; i < RUBRIC_LEVELS.length; i++) {
        expect(STANDARD_RUBRICS[dim][i].score).toBe(RUBRIC_LEVELS[i]);
      }
    }
  });

  it('rubric levels are 0-4', () => {
    expect([...RUBRIC_LEVELS]).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('validateTask', () => {
  it('valid task passes', () => {
    const result = validateTask(validTask());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('missing id fails', () => {
    const result = validateTask(validTask({ id: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('task.id is required');
  });

  it('missing name fails', () => {
    const result = validateTask(validTask({ name: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('task.name is required');
  });

  it('missing prompt fails', () => {
    const result = validateTask(validTask({ prompt: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('task.prompt is required');
  });

  it('invalid target agent fails', () => {
    const result = validateTask(validTask({ targetAgent: 'bogus' as any }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('targetAgent'))).toBe(true);
  });

  it('invalid category fails', () => {
    const result = validateTask(validTask({ category: 'bogus' as any }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('category'))).toBe(true);
  });

  it('invalid difficulty fails', () => {
    const result = validateTask(validTask({ difficulty: 'bogus' as any }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('difficulty'))).toBe(true);
  });

  it('empty criteria fails', () => {
    const result = validateTask(validTask({ criteria: [] }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('at least one'))).toBe(true);
  });

  it('criteria weights not summing to 1.0 fails', () => {
    const task = validTask({
      criteria: [
        {
          id: 'c1',
          dimension: 'correctness',
          description: 'test',
          weight: 0.3,
          rubric: STANDARD_RUBRICS.correctness,
        },
      ],
    });
    const result = validateTask(task);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('sum to 1.0'))).toBe(true);
  });

  it('duplicate criterion ids fail', () => {
    const task = validTask({
      criteria: [
        { id: 'same', dimension: 'correctness', description: 'a', weight: 0.5, rubric: STANDARD_RUBRICS.correctness },
        { id: 'same', dimension: 'completeness', description: 'b', weight: 0.5, rubric: STANDARD_RUBRICS.completeness },
      ],
    });
    const result = validateTask(task);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('duplicate criterion id'))).toBe(true);
  });

  it('warns on uncovered dimensions', () => {
    const result = validateTask(validTask());
    // Only correctness and completeness are covered
    expect(result.warnings.some(w => w.includes("dimension 'quality'"))).toBe(true);
    expect(result.warnings.some(w => w.includes("dimension 'safety'"))).toBe(true);
  });

  it('warns on empty project description', () => {
    const task = validTask({
      context: { projectDescription: '', files: [], constraints: [] },
    });
    const result = validateTask(task);
    expect(result.warnings.some(w => w.includes('projectDescription'))).toBe(true);
  });

  it('warns on empty expected elements', () => {
    const task = validTask({ expectedElements: [] });
    const result = validateTask(task);
    expect(result.warnings.some(w => w.includes('expectedElements'))).toBe(true);
  });
});

describe('validateResult', () => {
  it('valid result passes', () => {
    const task = validTask();
    const result = validateResult(validResult(task), task);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('mismatched taskId fails', () => {
    const task = validTask();
    const res = { ...validResult(task), taskId: 'wrong-id' };
    const result = validateResult(res, task);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('does not match'))).toBe(true);
  });

  it('missing genomeId fails', () => {
    const task = validTask();
    const res = { ...validResult(task), genomeId: '' };
    const result = validateResult(res, task);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('genomeId'))).toBe(true);
  });

  it('missing criterion score fails', () => {
    const task = validTask();
    const res = { ...validResult(task), criterionScores: [] };
    const result = validateResult(res, task);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("missing score for criterion 'c1'"))).toBe(true);
  });

  it('out-of-range fitness fails', () => {
    const task = validTask();
    const res = { ...validResult(task), fitness: 1.5 };
    const result = validateResult(res, task);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('out of range'))).toBe(true);
  });

  it('negative usage fails', () => {
    const task = validTask();
    const res = {
      ...validResult(task),
      usage: { inputTokens: -1, outputTokens: 0, durationMs: 0, estimatedCostUsd: 0 },
    };
    const result = validateResult(res, task);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('inputTokens'))).toBe(true);
  });

  it('warns on empty output', () => {
    const task = validTask();
    const res = { ...validResult(task), output: '' };
    const result = validateResult(res, task);
    expect(result.warnings.some(w => w.includes('output is empty'))).toBe(true);
  });
});

describe('validateDimensionWeights', () => {
  it('default weights pass', () => {
    const result = validateDimensionWeights(DEFAULT_DIMENSION_WEIGHTS);
    expect(result.valid).toBe(true);
  });

  it('missing dimension fails', () => {
    const weights = { ...DEFAULT_DIMENSION_WEIGHTS } as any;
    delete weights.safety;
    const result = validateDimensionWeights(weights);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("'safety'"))).toBe(true);
  });

  it('weights not summing to 1.0 fails', () => {
    const weights = { ...DEFAULT_DIMENSION_WEIGHTS, correctness: 0.9 };
    const result = validateDimensionWeights(weights);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('sum to 1.0'))).toBe(true);
  });

  it('negative weight fails', () => {
    const weights = { ...DEFAULT_DIMENSION_WEIGHTS, safety: -0.1, correctness: 0.4 };
    const result = validateDimensionWeights(weights);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('>= 0'))).toBe(true);
  });
});
