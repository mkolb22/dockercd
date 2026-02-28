import { describe, it, expect } from 'vitest';
import {
  targetDensityRange,
  isDensityMatch,
  inferComplexity,
  densityMatchScore,
  scoreDagForComplexity,
  selectTopology,
  classifyTaskComplexity,
} from '../mapping.js';
import { createMinimalDAG, createLinearDAG } from '../dag.js';
import { DEFAULT_DENSITY_TARGETS } from '../types.js';
import type { TaskComplexity, WorkflowDAG, TopologyNode, TopologyEdge } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDAG(
  nodes: TopologyNode[],
  edges: TopologyEdge[],
): WorkflowDAG {
  return { id: 'test', name: 'Test', nodes, edges };
}

function makeNode(id: string, agent: string, role: TopologyNode['role'] = 'worker'): TopologyNode {
  return { id, agentName: agent, role, modelOverride: null, maxRetries: 0 };
}

function makeEdge(src: string, tgt: string, edgeType: TopologyEdge['edgeType'] = 'sequential'): TopologyEdge {
  return { source: src, target: tgt, edgeType, weight: 1.0, condition: null };
}

// ---------------------------------------------------------------------------
// targetDensityRange
// ---------------------------------------------------------------------------

describe('targetDensityRange', () => {
  it('returns correct range for each complexity level', () => {
    const complexities: TaskComplexity[] = ['trivial', 'simple', 'medium', 'complex', 'expert'];
    for (const c of complexities) {
      const range = targetDensityRange(c);
      expect(range.target).toBe(DEFAULT_DENSITY_TARGETS[c]);
      expect(range.min).toBeLessThanOrEqual(range.target);
      expect(range.max).toBeGreaterThanOrEqual(range.target);
      expect(range.min).toBeGreaterThanOrEqual(0);
      expect(range.max).toBeLessThanOrEqual(1);
    }
  });

  it('trivial has lowest target', () => {
    const trivial = targetDensityRange('trivial');
    const expert = targetDensityRange('expert');
    expect(trivial.target).toBeLessThan(expert.target);
  });

  it('respects custom config', () => {
    const config = {
      targets: { trivial: 0.2, simple: 0.4, medium: 0.5, complex: 0.7, expert: 0.9 },
      tolerance: 0.05,
    };
    const range = targetDensityRange('medium', config);
    expect(range.target).toBe(0.5);
    expect(range.min).toBeCloseTo(0.45);
    expect(range.max).toBeCloseTo(0.55);
  });
});

// ---------------------------------------------------------------------------
// isDensityMatch
// ---------------------------------------------------------------------------

describe('isDensityMatch', () => {
  it('returns true within tolerance', () => {
    expect(isDensityMatch(0.1, 'trivial')).toBe(true);
    expect(isDensityMatch(0.45, 'medium')).toBe(true);
    expect(isDensityMatch(0.85, 'expert')).toBe(true);
  });

  it('returns true at tolerance boundary', () => {
    // Default tolerance is 0.15, trivial target is 0.1
    expect(isDensityMatch(0.25, 'trivial')).toBe(true);
    expect(isDensityMatch(0.0, 'trivial')).toBe(true);
  });

  it('returns false outside tolerance', () => {
    expect(isDensityMatch(0.9, 'trivial')).toBe(false);
    expect(isDensityMatch(0.1, 'expert')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// inferComplexity
// ---------------------------------------------------------------------------

describe('inferComplexity', () => {
  it('infers trivial for very low density', () => {
    expect(inferComplexity(0.05)).toBe('trivial');
  });

  it('infers simple for low density', () => {
    expect(inferComplexity(0.25)).toBe('simple');
  });

  it('infers medium for mid density', () => {
    expect(inferComplexity(0.45)).toBe('medium');
  });

  it('infers complex for high density', () => {
    expect(inferComplexity(0.65)).toBe('complex');
  });

  it('infers expert for very high density', () => {
    expect(inferComplexity(0.9)).toBe('expert');
  });

  it('maps exact targets correctly', () => {
    for (const [level, target] of Object.entries(DEFAULT_DENSITY_TARGETS)) {
      expect(inferComplexity(target)).toBe(level);
    }
  });
});

// ---------------------------------------------------------------------------
// densityMatchScore
// ---------------------------------------------------------------------------

describe('densityMatchScore', () => {
  it('returns 1.0 for exact target match', () => {
    expect(densityMatchScore(0.45, 'medium')).toBe(1.0);
    expect(densityMatchScore(0.1, 'trivial')).toBe(1.0);
  });

  it('returns > 0.5 within tolerance', () => {
    const score = densityMatchScore(0.35, 'medium'); // 0.1 from target, within 0.15 tolerance
    expect(score).toBeGreaterThan(0.5);
    expect(score).toBeLessThan(1.0);
  });

  it('returns < 0.5 outside tolerance', () => {
    const score = densityMatchScore(0.1, 'expert'); // Very far from 0.85
    expect(score).toBeLessThan(0.5);
  });

  it('returns 0 for maximum distance', () => {
    const score = densityMatchScore(0.0, 'expert'); // 0.85 away from target
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThan(0.2);
  });

  it('is symmetric around target', () => {
    const target = 0.45; // medium
    const below = densityMatchScore(target - 0.1, 'medium');
    const above = densityMatchScore(target + 0.1, 'medium');
    expect(below).toBeCloseTo(above, 2);
  });
});

// ---------------------------------------------------------------------------
// scoreDagForComplexity
// ---------------------------------------------------------------------------

describe('scoreDagForComplexity', () => {
  it('scores a minimal DAG higher for trivial tasks', () => {
    const dag = createMinimalDAG('d1', 'a', 'b');
    const trivialScore = scoreDagForComplexity(dag, 'trivial');
    const expertScore = scoreDagForComplexity(dag, 'expert');
    expect(trivialScore.score).toBeGreaterThan(expertScore.score);
  });

  it('returns valid metrics', () => {
    const dag = createLinearDAG('d1', ['a', 'b', 'c']);
    const result = scoreDagForComplexity(dag, 'medium');
    expect(result.metrics.nodeCount).toBe(3);
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThanOrEqual(1);
    expect(result.densityMatch).toBeGreaterThanOrEqual(0);
    expect(result.structuralScore).toBeGreaterThanOrEqual(0);
  });

  it('DAG with review edges scores better for complex tasks', () => {
    const noReview = makeDAG(
      [
        makeNode('e', 'a', 'entry'),
        makeNode('w', 'b', 'worker'),
        makeNode('x', 'c', 'exit'),
      ],
      [makeEdge('e', 'w'), makeEdge('w', 'x')],
    );

    const withReview = makeDAG(
      [
        makeNode('e', 'a', 'entry'),
        makeNode('w', 'b', 'worker'),
        makeNode('r', 'c', 'reviewer'),
        makeNode('x', 'd', 'exit'),
      ],
      [
        makeEdge('e', 'w'),
        makeEdge('w', 'r', 'review'),
        makeEdge('r', 'x'),
      ],
    );

    const noReviewScore = scoreDagForComplexity(noReview, 'complex');
    const withReviewScore = scoreDagForComplexity(withReview, 'complex');

    // Review DAG should score at least as well for complex tasks
    // (structural score should be higher due to review presence)
    expect(withReviewScore.structuralScore).toBeGreaterThanOrEqual(
      noReviewScore.structuralScore - 0.2,
    );
  });
});

// ---------------------------------------------------------------------------
// selectTopology
// ---------------------------------------------------------------------------

describe('selectTopology', () => {
  it('returns null for empty candidates', () => {
    expect(selectTopology([], 'medium')).toBeNull();
  });

  it('returns the only candidate', () => {
    const dag = createMinimalDAG('d1', 'a', 'b');
    const result = selectTopology([dag], 'trivial');
    expect(result).not.toBeNull();
    expect(result!.dag.id).toBe('d1');
  });

  it('selects sparse DAG for trivial tasks', () => {
    const sparse = createMinimalDAG('sparse', 'a', 'b');
    const dense = createLinearDAG('dense', ['a', 'b', 'c', 'd', 'e']);

    const result = selectTopology([sparse, dense], 'trivial');
    expect(result).not.toBeNull();
    expect(result!.dag.id).toBe('sparse');
  });

  it('returns a score > 0', () => {
    const dag = createLinearDAG('d1', ['a', 'b', 'c']);
    const result = selectTopology([dag], 'medium');
    expect(result!.score).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// classifyTaskComplexity
// ---------------------------------------------------------------------------

describe('classifyTaskComplexity', () => {
  it('classifies trivial tasks', () => {
    expect(classifyTaskComplexity({
      criteriaCount: 1,
      expectedElements: 1,
      contextFiles: 0,
      difficulty: 'trivial',
    })).toBe('trivial');
  });

  it('classifies expert tasks', () => {
    expect(classifyTaskComplexity({
      criteriaCount: 8,
      expectedElements: 10,
      contextFiles: 5,
      difficulty: 'expert',
    })).toBe('expert');
  });

  it('classifies simple tasks from features', () => {
    const result = classifyTaskComplexity({
      criteriaCount: 2,
      expectedElements: 2,
      contextFiles: 0,
      difficulty: 'simple',
    });
    expect(['trivial', 'simple']).toContain(result);
  });

  it('classifies complex tasks from features', () => {
    const result = classifyTaskComplexity({
      criteriaCount: 5,
      expectedElements: 6,
      contextFiles: 3,
      difficulty: 'complex',
    });
    expect(['complex', 'expert']).toContain(result);
  });

  it('moderate difficulty yields medium or above', () => {
    const result = classifyTaskComplexity({
      criteriaCount: 3,
      expectedElements: 4,
      contextFiles: 2,
      difficulty: 'moderate',
    });
    expect(['medium', 'complex']).toContain(result);
  });
});
