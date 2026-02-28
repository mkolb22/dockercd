import { describe, it, expect } from 'vitest';
import {
  createMinimalDAG,
  createLinearDAG,
  validateDAG,
  topologicalSort,
  computeDensity,
  getPredecessors,
  getSuccessors,
  getEntryNode,
  getExitNode,
  getNode,
  getOutgoingEdges,
  getIncomingEdges,
} from '../dag.js';
import type {
  WorkflowDAG,
  TopologyNode,
  TopologyEdge,
} from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(
  id: string,
  agent: string,
  role: TopologyNode['role'] = 'worker',
): TopologyNode {
  return { id, agentName: agent, role, modelOverride: null, maxRetries: 0 };
}

function makeEdge(
  source: string,
  target: string,
  edgeType: TopologyEdge['edgeType'] = 'sequential',
): TopologyEdge {
  return { source, target, edgeType, weight: 1.0, condition: null };
}

function makeDAG(
  nodes: TopologyNode[],
  edges: TopologyEdge[],
  id: string = 'test-dag',
): WorkflowDAG {
  return { id, name: 'Test DAG', nodes, edges };
}

// ---------------------------------------------------------------------------
// createMinimalDAG
// ---------------------------------------------------------------------------

describe('createMinimalDAG', () => {
  it('creates a 2-node DAG', () => {
    const dag = createMinimalDAG('d1', 'story', 'quality');
    expect(dag.nodes).toHaveLength(2);
    expect(dag.edges).toHaveLength(1);
    expect(dag.nodes[0].role).toBe('entry');
    expect(dag.nodes[1].role).toBe('exit');
    expect(dag.edges[0].source).toBe('entry');
    expect(dag.edges[0].target).toBe('exit');
  });

  it('validates successfully', () => {
    const dag = createMinimalDAG('d1', 'story', 'quality');
    const result = validateDAG(dag);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// createLinearDAG
// ---------------------------------------------------------------------------

describe('createLinearDAG', () => {
  it('creates a pipeline from multiple agents', () => {
    const dag = createLinearDAG('d1', ['story', 'arch', 'impl', 'quality']);
    expect(dag.nodes).toHaveLength(4);
    expect(dag.edges).toHaveLength(3);
    expect(dag.nodes[0].role).toBe('entry');
    expect(dag.nodes[1].role).toBe('worker');
    expect(dag.nodes[2].role).toBe('worker');
    expect(dag.nodes[3].role).toBe('exit');
  });

  it('handles single agent', () => {
    const dag = createLinearDAG('d1', ['solo']);
    expect(dag.nodes).toHaveLength(2);
    expect(dag.nodes[0].agentName).toBe('solo');
    expect(dag.nodes[1].agentName).toBe('solo');
  });

  it('throws on empty agents', () => {
    expect(() => createLinearDAG('d1', [])).toThrow('zero agents');
  });

  it('validates successfully', () => {
    const dag = createLinearDAG('d1', ['a', 'b', 'c', 'd', 'e']);
    const result = validateDAG(dag);
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateDAG — valid DAGs
// ---------------------------------------------------------------------------

describe('validateDAG — valid DAGs', () => {
  it('accepts minimal DAG', () => {
    const dag = makeDAG(
      [makeNode('e', 'a', 'entry'), makeNode('x', 'b', 'exit')],
      [makeEdge('e', 'x')],
    );
    const result = validateDAG(dag);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts diamond DAG', () => {
    const dag = makeDAG(
      [
        makeNode('e', 'a', 'entry'),
        makeNode('w1', 'b', 'worker'),
        makeNode('w2', 'c', 'worker'),
        makeNode('x', 'd', 'exit'),
      ],
      [
        makeEdge('e', 'w1'),
        makeEdge('e', 'w2'),
        makeEdge('w1', 'x'),
        makeEdge('w2', 'x'),
      ],
    );
    const result = validateDAG(dag);
    expect(result.valid).toBe(true);
  });

  it('accepts DAG with review edges', () => {
    const dag = makeDAG(
      [
        makeNode('e', 'story', 'entry'),
        makeNode('w', 'impl', 'worker'),
        makeNode('r', 'quality', 'reviewer'),
        makeNode('x', 'version', 'exit'),
      ],
      [
        makeEdge('e', 'w'),
        makeEdge('w', 'r', 'review'),
        makeEdge('r', 'x'),
      ],
    );
    const result = validateDAG(dag);
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateDAG — invalid DAGs
// ---------------------------------------------------------------------------

describe('validateDAG — invalid DAGs', () => {
  it('rejects DAG with < 2 nodes', () => {
    const dag = makeDAG([makeNode('e', 'a', 'entry')], []);
    const result = validateDAG(dag);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('at least 2 nodes'));
  });

  it('rejects duplicate node IDs', () => {
    const dag = makeDAG(
      [makeNode('n', 'a', 'entry'), makeNode('n', 'b', 'exit')],
      [makeEdge('n', 'n')],
    );
    const result = validateDAG(dag);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('Duplicate node ID'));
  });

  it('rejects no entry node', () => {
    const dag = makeDAG(
      [makeNode('w', 'a', 'worker'), makeNode('x', 'b', 'exit')],
      [makeEdge('w', 'x')],
    );
    const result = validateDAG(dag);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('1 entry node'));
  });

  it('rejects multiple entry nodes', () => {
    const dag = makeDAG(
      [
        makeNode('e1', 'a', 'entry'),
        makeNode('e2', 'b', 'entry'),
        makeNode('x', 'c', 'exit'),
      ],
      [makeEdge('e1', 'x'), makeEdge('e2', 'x')],
    );
    const result = validateDAG(dag);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('1 entry node'));
  });

  it('rejects no exit node', () => {
    const dag = makeDAG(
      [makeNode('e', 'a', 'entry'), makeNode('w', 'b', 'worker')],
      [makeEdge('e', 'w')],
    );
    const result = validateDAG(dag);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('1 exit node'));
  });

  it('rejects unknown edge source', () => {
    const dag = makeDAG(
      [makeNode('e', 'a', 'entry'), makeNode('x', 'b', 'exit')],
      [makeEdge('ghost', 'x')],
    );
    const result = validateDAG(dag);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('unknown source'));
  });

  it('rejects unknown edge target', () => {
    const dag = makeDAG(
      [makeNode('e', 'a', 'entry'), makeNode('x', 'b', 'exit')],
      [makeEdge('e', 'ghost')],
    );
    const result = validateDAG(dag);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('unknown target'));
  });

  it('rejects duplicate edges', () => {
    const dag = makeDAG(
      [makeNode('e', 'a', 'entry'), makeNode('x', 'b', 'exit')],
      [makeEdge('e', 'x'), makeEdge('e', 'x')],
    );
    const result = validateDAG(dag);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('Duplicate edge'));
  });

  it('rejects self-loops', () => {
    const dag = makeDAG(
      [makeNode('e', 'a', 'entry'), makeNode('x', 'b', 'exit')],
      [makeEdge('e', 'e'), makeEdge('e', 'x')],
    );
    const result = validateDAG(dag);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('Self-loop'));
  });

  it('rejects cycles', () => {
    const dag = makeDAG(
      [
        makeNode('e', 'a', 'entry'),
        makeNode('w1', 'b', 'worker'),
        makeNode('w2', 'c', 'worker'),
        makeNode('x', 'd', 'exit'),
      ],
      [
        makeEdge('e', 'w1'),
        makeEdge('w1', 'w2'),
        makeEdge('w2', 'w1'), // cycle
        makeEdge('w2', 'x'),
      ],
    );
    const result = validateDAG(dag);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('cycle'));
  });

  it('rejects unreachable nodes', () => {
    const dag = makeDAG(
      [
        makeNode('e', 'a', 'entry'),
        makeNode('w', 'b', 'worker'),
        makeNode('x', 'c', 'exit'),
      ],
      [makeEdge('e', 'x')], // w is unreachable
    );
    const result = validateDAG(dag);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining("not reachable from entry"));
  });
});

// ---------------------------------------------------------------------------
// validateDAG — warnings
// ---------------------------------------------------------------------------

describe('validateDAG — warnings', () => {
  it('warns when node cannot reach exit', () => {
    const dag = makeDAG(
      [
        makeNode('e', 'a', 'entry'),
        makeNode('w', 'b', 'worker'),
        makeNode('x', 'c', 'exit'),
      ],
      [
        makeEdge('e', 'w'),
        makeEdge('e', 'x'),
        // w has no path to x
      ],
    );
    const result = validateDAG(dag);
    expect(result.valid).toBe(true); // It's valid but has warnings
    expect(result.warnings).toContainEqual(expect.stringContaining("cannot reach exit"));
  });
});

// ---------------------------------------------------------------------------
// topologicalSort
// ---------------------------------------------------------------------------

describe('topologicalSort', () => {
  it('returns nodes in valid topological order', () => {
    const dag = createLinearDAG('d1', ['a', 'b', 'c', 'd']);
    const sorted = topologicalSort(dag);
    expect(sorted).toHaveLength(4);
    expect(sorted[0].agentName).toBe('a');
    expect(sorted[3].agentName).toBe('d');
  });

  it('handles diamond DAG', () => {
    const dag = makeDAG(
      [
        makeNode('e', 'a', 'entry'),
        makeNode('w1', 'b', 'worker'),
        makeNode('w2', 'c', 'worker'),
        makeNode('x', 'd', 'exit'),
      ],
      [
        makeEdge('e', 'w1'),
        makeEdge('e', 'w2'),
        makeEdge('w1', 'x'),
        makeEdge('w2', 'x'),
      ],
    );
    const sorted = topologicalSort(dag);
    expect(sorted).toHaveLength(4);

    // Entry must come first, exit must come last
    expect(sorted[0].id).toBe('e');
    expect(sorted[3].id).toBe('x');

    // Workers must come before exit
    const workerIndices = sorted
      .map((n, i) => ({ id: n.id, i }))
      .filter((x) => x.id === 'w1' || x.id === 'w2')
      .map((x) => x.i);
    for (const idx of workerIndices) {
      expect(idx).toBeGreaterThan(0);
      expect(idx).toBeLessThan(3);
    }
  });

  it('throws on cyclic graph', () => {
    const dag = makeDAG(
      [
        makeNode('e', 'a', 'entry'),
        makeNode('w1', 'b', 'worker'),
        makeNode('w2', 'c', 'worker'),
        makeNode('x', 'd', 'exit'),
      ],
      [
        makeEdge('e', 'w1'),
        makeEdge('w1', 'w2'),
        makeEdge('w2', 'w1'),
        makeEdge('w2', 'x'),
      ],
    );
    expect(() => topologicalSort(dag)).toThrow('cycle');
  });
});

// ---------------------------------------------------------------------------
// computeDensity
// ---------------------------------------------------------------------------

describe('computeDensity', () => {
  it('computes metrics for minimal DAG', () => {
    const dag = createMinimalDAG('d1', 'a', 'b');
    const metrics = computeDensity(dag);

    expect(metrics.nodeCount).toBe(2);
    expect(metrics.edgeCount).toBe(1);
    expect(metrics.edgeDensity).toBe(1); // 1 / (2*1/2) = 1
    expect(metrics.criticalPathLength).toBe(1);
    expect(metrics.maxFanOut).toBe(1);
    expect(metrics.reviewRatio).toBe(0);
    expect(metrics.compositeDensity).toBeGreaterThan(0);
    expect(metrics.compositeDensity).toBeLessThanOrEqual(1);
  });

  it('computes metrics for linear pipeline', () => {
    const dag = createLinearDAG('d1', ['a', 'b', 'c', 'd', 'e']);
    const metrics = computeDensity(dag);

    expect(metrics.nodeCount).toBe(5);
    expect(metrics.edgeCount).toBe(4);
    expect(metrics.edgeDensity).toBeCloseTo(4 / 10); // 4 / (5*4/2)
    expect(metrics.criticalPathLength).toBe(4);
    expect(metrics.maxFanOut).toBe(1);
    expect(metrics.avgDegree).toBeGreaterThan(0);
  });

  it('detects higher density in diamond DAG', () => {
    const linear = createLinearDAG('lin', ['a', 'b', 'c']);
    const diamond = makeDAG(
      [
        makeNode('e', 'a', 'entry'),
        makeNode('w1', 'b', 'worker'),
        makeNode('w2', 'c', 'worker'),
        makeNode('x', 'd', 'exit'),
      ],
      [
        makeEdge('e', 'w1'),
        makeEdge('e', 'w2'),
        makeEdge('w1', 'x'),
        makeEdge('w2', 'x'),
      ],
    );

    const linearDensity = computeDensity(linear);
    const diamondDensity = computeDensity(diamond);

    // Edge density: linear=2/3, diamond=4/6=2/3 (equal)
    // But diamond has higher fan-out and composite density
    expect(diamondDensity.edgeDensity).toBeGreaterThanOrEqual(linearDensity.edgeDensity);
    expect(diamondDensity.maxFanOut).toBe(2);
    expect(diamondDensity.compositeDensity).toBeGreaterThan(linearDensity.compositeDensity);
  });

  it('review ratio reflects review edges', () => {
    const dag = makeDAG(
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
    const metrics = computeDensity(dag);
    expect(metrics.reviewRatio).toBeCloseTo(1 / 3);
  });

  it('composite density is in [0, 1]', () => {
    // Test with various DAG sizes
    for (const count of [2, 3, 5, 8]) {
      const agents = Array.from({ length: count }, (_, i) => `agent-${i}`);
      const dag = createLinearDAG(`d${count}`, agents);
      const metrics = computeDensity(dag);
      expect(metrics.compositeDensity).toBeGreaterThanOrEqual(0);
      expect(metrics.compositeDensity).toBeLessThanOrEqual(1);
    }
  });

  it('dense DAG has higher composite score than sparse', () => {
    // Sparse: A→B
    const sparse = createMinimalDAG('sparse', 'a', 'b');

    // Dense: fully connected 4-node DAG
    const dense = makeDAG(
      [
        makeNode('e', 'a', 'entry'),
        makeNode('w1', 'b', 'worker'),
        makeNode('w2', 'c', 'worker'),
        makeNode('x', 'd', 'exit'),
      ],
      [
        makeEdge('e', 'w1'),
        makeEdge('e', 'w2'),
        makeEdge('w1', 'w2'),
        makeEdge('w1', 'x'),
        makeEdge('w2', 'x'),
      ],
    );

    const sparseMetrics = computeDensity(sparse);
    const denseMetrics = computeDensity(dense);

    expect(denseMetrics.compositeDensity).toBeGreaterThan(sparseMetrics.compositeDensity);
  });
});

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

describe('query helpers', () => {
  const dag = makeDAG(
    [
      makeNode('e', 'a', 'entry'),
      makeNode('w1', 'b', 'worker'),
      makeNode('w2', 'c', 'worker'),
      makeNode('x', 'd', 'exit'),
    ],
    [
      makeEdge('e', 'w1'),
      makeEdge('e', 'w2'),
      makeEdge('w1', 'x'),
      makeEdge('w2', 'x'),
    ],
  );

  it('getPredecessors returns upstream nodes', () => {
    const preds = getPredecessors(dag, 'x');
    expect(preds).toHaveLength(2);
    expect(preds.map((n) => n.id).sort()).toEqual(['w1', 'w2']);
  });

  it('getPredecessors returns empty for entry', () => {
    const preds = getPredecessors(dag, 'e');
    expect(preds).toHaveLength(0);
  });

  it('getSuccessors returns downstream nodes', () => {
    const succs = getSuccessors(dag, 'e');
    expect(succs).toHaveLength(2);
    expect(succs.map((n) => n.id).sort()).toEqual(['w1', 'w2']);
  });

  it('getSuccessors returns empty for exit', () => {
    const succs = getSuccessors(dag, 'x');
    expect(succs).toHaveLength(0);
  });

  it('getEntryNode returns entry', () => {
    expect(getEntryNode(dag).id).toBe('e');
  });

  it('getExitNode returns exit', () => {
    expect(getExitNode(dag).id).toBe('x');
  });

  it('getNode finds existing node', () => {
    expect(getNode(dag, 'w1')?.agentName).toBe('b');
  });

  it('getNode returns undefined for missing', () => {
    expect(getNode(dag, 'nonexistent')).toBeUndefined();
  });

  it('getOutgoingEdges returns outbound edges', () => {
    const edges = getOutgoingEdges(dag, 'e');
    expect(edges).toHaveLength(2);
    expect(edges.map((e) => e.target).sort()).toEqual(['w1', 'w2']);
  });

  it('getIncomingEdges returns inbound edges', () => {
    const edges = getIncomingEdges(dag, 'x');
    expect(edges).toHaveLength(2);
    expect(edges.map((e) => e.source).sort()).toEqual(['w1', 'w2']);
  });
});
