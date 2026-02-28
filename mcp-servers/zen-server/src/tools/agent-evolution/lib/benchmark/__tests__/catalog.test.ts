import { describe, it, expect } from 'vitest';
import { BENCHMARK_CATALOG, validateCatalog } from '../catalog.js';
import { EVALUATION_DIMENSIONS, RUBRIC_LEVELS, validateTask } from '../schema.js';

describe('benchmark catalog', () => {
  it('contains 12 tasks', () => {
    expect(BENCHMARK_CATALOG).toHaveLength(12);
  });

  it('has no duplicate task IDs', () => {
    const ids = BENCHMARK_CATALOG.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers 4 agent types', () => {
    const agents = new Set(BENCHMARK_CATALOG.map(t => t.targetAgent));
    expect(agents.size).toBe(4);
    expect(agents.has('story-concept')).toBe(true);
    expect(agents.has('architecture-concept')).toBe(true);
    expect(agents.has('implementation-concept')).toBe(true);
    expect(agents.has('quality-concept')).toBe(true);
  });

  it('covers at least 3 difficulty levels', () => {
    const difficulties = new Set(BENCHMARK_CATALOG.map(t => t.difficulty));
    expect(difficulties.size).toBeGreaterThanOrEqual(3);
  });

  it('covers at least 3 task categories', () => {
    const categories = new Set(BENCHMARK_CATALOG.map(t => t.category));
    expect(categories.size).toBeGreaterThanOrEqual(3);
  });

  it('has 3 tasks per agent type', () => {
    const counts = new Map<string, number>();
    for (const task of BENCHMARK_CATALOG) {
      counts.set(task.targetAgent, (counts.get(task.targetAgent) ?? 0) + 1);
    }
    for (const [agent, count] of counts) {
      expect(count, `${agent} should have 3 tasks`).toBe(3);
    }
  });

  describe('individual task validation', () => {
    for (const task of BENCHMARK_CATALOG) {
      describe(task.id, () => {
        it('passes validation', () => {
          const result = validateTask(task);
          expect(result.errors, `Errors: ${result.errors.join(', ')}`).toHaveLength(0);
          expect(result.valid).toBe(true);
        });

        it('has non-empty prompt', () => {
          expect(task.prompt.length).toBeGreaterThan(10);
        });

        it('has non-empty context', () => {
          expect(task.context.projectDescription).toBeTruthy();
        });

        it('has at least 3 criteria', () => {
          expect(task.criteria.length).toBeGreaterThanOrEqual(3);
        });

        it('criteria weights sum to 1.0', () => {
          const sum = task.criteria.reduce((s, c) => s + c.weight, 0);
          expect(Math.abs(sum - 1.0)).toBeLessThan(0.001);
        });

        it('all criteria have complete rubrics', () => {
          for (const criterion of task.criteria) {
            expect(criterion.rubric).toHaveLength(RUBRIC_LEVELS.length);
          }
        });

        it('has at least 3 expected elements', () => {
          expect(task.expectedElements.length).toBeGreaterThanOrEqual(3);
        });

        it('has tags', () => {
          expect(task.tags.length).toBeGreaterThan(0);
        });
      });
    }
  });
});

describe('validateCatalog', () => {
  it('full catalog passes validation', () => {
    const result = validateCatalog();
    expect(result.errors, `Errors: ${result.errors.join(', ')}`).toHaveLength(0);
    expect(result.valid).toBe(true);
  });

  it('detects duplicate task IDs', () => {
    const duplicated = [BENCHMARK_CATALOG[0], BENCHMARK_CATALOG[0]];
    const result = validateCatalog(duplicated);
    expect(result.errors.some(e => e.includes('duplicate task id'))).toBe(true);
  });

  it('warns on insufficient agent coverage', () => {
    const singleAgent = BENCHMARK_CATALOG.filter(t => t.targetAgent === 'story-concept');
    const result = validateCatalog(singleAgent);
    expect(result.warnings.some(w => w.includes('agent type'))).toBe(true);
  });
});
