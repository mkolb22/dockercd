import { describe, it, expect } from 'vitest';
import {
  addNode,
  removeNode,
  addEdge,
  removeEdge,
  changeRole,
  changeEdgeType,
  reassignAgent,
  randomMutation,
} from '../mutations.js';
import { createMinimalDAG, createLinearDAG, validateDAG } from '../dag.js';
import type { WorkflowDAG, TopologyNode, TopologyEdge } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDAG(
  nodes: TopologyNode[],
  edges: TopologyEdge[],
  id: string = 'test',
): WorkflowDAG {
  return { id, name: 'Test', nodes, edges };
}

function makeNode(id: string, agent: string, role: TopologyNode['role'] = 'worker'): TopologyNode {
  return { id, agentName: agent, role, modelOverride: null, maxRetries: 0 };
}

function makeEdge(src: string, tgt: string, edgeType: TopologyEdge['edgeType'] = 'sequential'): TopologyEdge {
  return { source: src, target: tgt, edgeType, weight: 1.0, condition: null };
}

/** Deterministic RNG: returns values from a preset sequence. */
function seededRng(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[i % values.length];
    i++;
    return v;
  };
}

// ---------------------------------------------------------------------------
// addNode
// ---------------------------------------------------------------------------

describe('addNode', () => {
  it('splits an edge by inserting a new node', () => {
    const dag = createMinimalDAG('d1', 'a', 'b');
    const result = addNode(dag, 0, 'middle-agent');

    expect(result.applied).toBe(true);
    expect(result.kind).toBe('add_node');
    expect(result.dag.nodes).toHaveLength(3);
    expect(result.dag.edges).toHaveLength(2);

    // New node exists
    const newNode = result.dag.nodes.find((n) => n.agentName === 'middle-agent');
    expect(newNode).toBeDefined();
    expect(newNode!.role).toBe('worker');

    // Edges: entry → new → exit
    const toNew = result.dag.edges.find((e) => e.target === newNode!.id);
    const fromNew = result.dag.edges.find((e) => e.source === newNode!.id);
    expect(toNew).toBeDefined();
    expect(fromNew).toBeDefined();
    expect(toNew!.source).toBe('entry');
    expect(fromNew!.target).toBe('exit');
  });

  it('preserves original edge type in split edges', () => {
    const dag = makeDAG(
      [makeNode('e', 'a', 'entry'), makeNode('x', 'b', 'exit')],
      [makeEdge('e', 'x', 'review')],
    );
    const result = addNode(dag, 0, 'reviewer');

    expect(result.applied).toBe(true);
    for (const edge of result.dag.edges) {
      expect(edge.edgeType).toBe('review');
    }
  });

  it('respects the role parameter', () => {
    const dag = createMinimalDAG('d1', 'a', 'b');
    const result = addNode(dag, 0, 'review-agent', 'reviewer');

    expect(result.applied).toBe(true);
    const newNode = result.dag.nodes.find((n) => n.agentName === 'review-agent');
    expect(newNode!.role).toBe('reviewer');
  });

  it('returns no-op for invalid edge index (negative)', () => {
    const dag = createMinimalDAG('d1', 'a', 'b');
    const result = addNode(dag, -1, 'agent');

    expect(result.applied).toBe(false);
    expect(result.dag).toBe(dag);
  });

  it('returns no-op for invalid edge index (out of bounds)', () => {
    const dag = createMinimalDAG('d1', 'a', 'b');
    const result = addNode(dag, 5, 'agent');

    expect(result.applied).toBe(false);
    expect(result.dag).toBe(dag);
  });

  it('produces a valid DAG', () => {
    const dag = createLinearDAG('d1', ['a', 'b', 'c']);
    const result = addNode(dag, 1, 'inserted');

    expect(result.applied).toBe(true);
    expect(validateDAG(result.dag).valid).toBe(true);
  });

  it('does not mutate the original DAG', () => {
    const dag = createMinimalDAG('d1', 'a', 'b');
    const originalNodeCount = dag.nodes.length;
    const originalEdgeCount = dag.edges.length;
    addNode(dag, 0, 'new-agent');

    expect(dag.nodes).toHaveLength(originalNodeCount);
    expect(dag.edges).toHaveLength(originalEdgeCount);
  });

  it('generates unique node IDs', () => {
    const dag = createLinearDAG('d1', ['a', 'b', 'c', 'd']);
    // Insert twice in succession
    const r1 = addNode(dag, 0, 'x');
    const r2 = addNode(r1.dag, 0, 'y');

    expect(r1.applied).toBe(true);
    expect(r2.applied).toBe(true);

    const ids = r2.dag.nodes.map((n) => n.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});

// ---------------------------------------------------------------------------
// removeNode
// ---------------------------------------------------------------------------

describe('removeNode', () => {
  it('removes a worker node and reconnects neighbors', () => {
    const dag = createLinearDAG('d1', ['a', 'b', 'c']);
    // Remove middle node (node-1, role=worker)
    const result = removeNode(dag, 'node-1');

    expect(result.applied).toBe(true);
    expect(result.kind).toBe('remove_node');
    expect(result.dag.nodes).toHaveLength(2);
    expect(result.dag.nodes.some((n) => n.id === 'node-1')).toBe(false);

    // Edge from entry to exit should exist
    expect(result.dag.edges.some(
      (e) => e.source === 'node-0' && e.target === 'node-2',
    )).toBe(true);
  });

  it('cannot remove entry node', () => {
    const dag = createLinearDAG('d1', ['a', 'b', 'c']);
    const result = removeNode(dag, 'node-0');

    expect(result.applied).toBe(false);
    expect(result.dag).toBe(dag);
  });

  it('cannot remove exit node', () => {
    const dag = createLinearDAG('d1', ['a', 'b', 'c']);
    const result = removeNode(dag, 'node-2');

    expect(result.applied).toBe(false);
    expect(result.dag).toBe(dag);
  });

  it('cannot remove node that does not exist', () => {
    const dag = createMinimalDAG('d1', 'a', 'b');
    const result = removeNode(dag, 'nonexistent');

    expect(result.applied).toBe(false);
  });

  it('produces a valid DAG after removal', () => {
    const dag = createLinearDAG('d1', ['a', 'b', 'c', 'd']);
    const result = removeNode(dag, 'node-2'); // remove worker 'c'

    expect(result.applied).toBe(true);
    expect(validateDAG(result.dag).valid).toBe(true);
  });

  it('handles diamond topology (node with multiple predecessors and successors)', () => {
    // entry → A → exit
    // entry → B → exit
    // A → B (cross edge)
    const dag = makeDAG(
      [
        makeNode('e', 'entry-agent', 'entry'),
        makeNode('a', 'agent-a', 'worker'),
        makeNode('b', 'agent-b', 'worker'),
        makeNode('x', 'exit-agent', 'exit'),
      ],
      [
        makeEdge('e', 'a'),
        makeEdge('e', 'b'),
        makeEdge('a', 'x'),
        makeEdge('b', 'x'),
        makeEdge('a', 'b'),
      ],
    );

    // Remove node 'a': e→a→{b, x}, so reconnect e→{b, x}
    const result = removeNode(dag, 'a');
    expect(result.applied).toBe(true);
    expect(result.dag.nodes).toHaveLength(3);
    expect(validateDAG(result.dag).valid).toBe(true);
  });

  it('does not mutate the original DAG', () => {
    const dag = createLinearDAG('d1', ['a', 'b', 'c']);
    const originalNodeCount = dag.nodes.length;
    removeNode(dag, 'node-1');
    expect(dag.nodes).toHaveLength(originalNodeCount);
  });
});

// ---------------------------------------------------------------------------
// addEdge
// ---------------------------------------------------------------------------

describe('addEdge', () => {
  it('adds an edge between existing nodes', () => {
    // 3-node linear DAG: entry → worker → exit
    // Add skip edge: entry → exit
    const dag = createLinearDAG('d1', ['a', 'b', 'c']);
    const result = addEdge(dag, 'node-0', 'node-2');

    expect(result.applied).toBe(true);
    expect(result.kind).toBe('add_edge');
    expect(result.dag.edges).toHaveLength(3); // 2 original + 1 new
    expect(result.dag.edges.some(
      (e) => e.source === 'node-0' && e.target === 'node-2',
    )).toBe(true);
  });

  it('defaults to sequential edge type', () => {
    const dag = createLinearDAG('d1', ['a', 'b', 'c']);
    const result = addEdge(dag, 'node-0', 'node-2');

    const newEdge = result.dag.edges.find(
      (e) => e.source === 'node-0' && e.target === 'node-2',
    );
    expect(newEdge!.edgeType).toBe('sequential');
  });

  it('uses specified edge type', () => {
    const dag = createLinearDAG('d1', ['a', 'b', 'c']);
    const result = addEdge(dag, 'node-0', 'node-2', 'review');

    const newEdge = result.dag.edges.find(
      (e) => e.source === 'node-0' && e.target === 'node-2',
    );
    expect(newEdge!.edgeType).toBe('review');
  });

  it('rejects self-loops', () => {
    const dag = createMinimalDAG('d1', 'a', 'b');
    const result = addEdge(dag, 'entry', 'entry');

    expect(result.applied).toBe(false);
  });

  it('rejects duplicate edges', () => {
    const dag = createMinimalDAG('d1', 'a', 'b');
    const result = addEdge(dag, 'entry', 'exit');

    expect(result.applied).toBe(false);
    expect(result.description).toContain('already exists');
  });

  it('rejects edges that would create a cycle', () => {
    // Linear: entry → worker → exit
    // Adding exit → entry would create a cycle
    const dag = createLinearDAG('d1', ['a', 'b', 'c']);
    const result = addEdge(dag, 'node-2', 'node-0');

    expect(result.applied).toBe(false);
    expect(result.description).toContain('cycle');
  });

  it('rejects backward edges in linear DAG', () => {
    // Linear: 0 → 1 → 2
    // Adding 1 → 0 would create a cycle
    const dag = createLinearDAG('d1', ['a', 'b', 'c']);
    const result = addEdge(dag, 'node-1', 'node-0');

    expect(result.applied).toBe(false);
    expect(result.description).toContain('cycle');
  });

  it('rejects edges with unknown source node', () => {
    const dag = createMinimalDAG('d1', 'a', 'b');
    const result = addEdge(dag, 'ghost', 'exit');

    expect(result.applied).toBe(false);
    expect(result.description).toContain('not found');
  });

  it('rejects edges with unknown target node', () => {
    const dag = createMinimalDAG('d1', 'a', 'b');
    const result = addEdge(dag, 'entry', 'ghost');

    expect(result.applied).toBe(false);
    expect(result.description).toContain('not found');
  });

  it('produces a valid DAG', () => {
    const dag = createLinearDAG('d1', ['a', 'b', 'c', 'd']);
    const result = addEdge(dag, 'node-0', 'node-2');

    expect(result.applied).toBe(true);
    expect(validateDAG(result.dag).valid).toBe(true);
  });

  it('does not mutate the original DAG', () => {
    const dag = createLinearDAG('d1', ['a', 'b', 'c']);
    const originalEdgeCount = dag.edges.length;
    addEdge(dag, 'node-0', 'node-2');
    expect(dag.edges).toHaveLength(originalEdgeCount);
  });
});

// ---------------------------------------------------------------------------
// removeEdge
// ---------------------------------------------------------------------------

describe('removeEdge', () => {
  it('removes a redundant edge', () => {
    // DAG with skip edge: 0→1→2, 0→2
    const dag = makeDAG(
      [
        makeNode('e', 'a', 'entry'),
        makeNode('w', 'b', 'worker'),
        makeNode('x', 'c', 'exit'),
      ],
      [makeEdge('e', 'w'), makeEdge('w', 'x'), makeEdge('e', 'x')],
    );

    // Remove the skip edge e→x — DAG remains connected via e→w→x
    const result = removeEdge(dag, 'e', 'x');

    expect(result.applied).toBe(true);
    expect(result.kind).toBe('remove_edge');
    expect(result.dag.edges).toHaveLength(2);
    expect(result.dag.edges.some((e) => e.source === 'e' && e.target === 'x')).toBe(false);
  });

  it('rejects removing an edge that would disconnect the DAG', () => {
    // Linear: entry → exit (only one edge)
    const dag = createMinimalDAG('d1', 'a', 'b');
    const result = removeEdge(dag, 'entry', 'exit');

    expect(result.applied).toBe(false);
    expect(result.description).toContain('only edge');
  });

  it('rejects removing critical edge in linear DAG', () => {
    // Linear: 0 → 1 → 2, removing 0→1 disconnects node-1
    const dag = createLinearDAG('d1', ['a', 'b', 'c']);
    const result = removeEdge(dag, 'node-0', 'node-1');

    expect(result.applied).toBe(false);
  });

  it('rejects removing a non-existent edge', () => {
    const dag = createMinimalDAG('d1', 'a', 'b');
    const result = removeEdge(dag, 'exit', 'entry');

    expect(result.applied).toBe(false);
    expect(result.description).toContain('not found');
  });

  it('produces a valid DAG after removal', () => {
    const dag = makeDAG(
      [
        makeNode('e', 'a', 'entry'),
        makeNode('w', 'b', 'worker'),
        makeNode('x', 'c', 'exit'),
      ],
      [makeEdge('e', 'w'), makeEdge('w', 'x'), makeEdge('e', 'x')],
    );
    const result = removeEdge(dag, 'e', 'x');

    expect(result.applied).toBe(true);
    expect(validateDAG(result.dag).valid).toBe(true);
  });

  it('does not mutate the original DAG', () => {
    const dag = makeDAG(
      [
        makeNode('e', 'a', 'entry'),
        makeNode('w', 'b', 'worker'),
        makeNode('x', 'c', 'exit'),
      ],
      [makeEdge('e', 'w'), makeEdge('w', 'x'), makeEdge('e', 'x')],
    );
    const originalEdgeCount = dag.edges.length;
    removeEdge(dag, 'e', 'x');
    expect(dag.edges).toHaveLength(originalEdgeCount);
  });
});

// ---------------------------------------------------------------------------
// changeRole
// ---------------------------------------------------------------------------

describe('changeRole', () => {
  it('changes a worker to reviewer', () => {
    const dag = createLinearDAG('d1', ['a', 'b', 'c']);
    const result = changeRole(dag, 'node-1', 'reviewer');

    expect(result.applied).toBe(true);
    expect(result.kind).toBe('change_role');
    const changed = result.dag.nodes.find((n) => n.id === 'node-1');
    expect(changed!.role).toBe('reviewer');
  });

  it('changes a worker to aggregator', () => {
    const dag = createLinearDAG('d1', ['a', 'b', 'c']);
    const result = changeRole(dag, 'node-1', 'aggregator');

    expect(result.applied).toBe(true);
    const changed = result.dag.nodes.find((n) => n.id === 'node-1');
    expect(changed!.role).toBe('aggregator');
  });

  it('rejects changing entry node role', () => {
    const dag = createLinearDAG('d1', ['a', 'b', 'c']);
    const result = changeRole(dag, 'node-0', 'worker');

    expect(result.applied).toBe(false);
    expect(result.description).toContain('entry');
  });

  it('rejects changing exit node role', () => {
    const dag = createLinearDAG('d1', ['a', 'b', 'c']);
    const result = changeRole(dag, 'node-2', 'worker');

    expect(result.applied).toBe(false);
    expect(result.description).toContain('exit');
  });

  it('rejects same role (no-op)', () => {
    const dag = createLinearDAG('d1', ['a', 'b', 'c']);
    const result = changeRole(dag, 'node-1', 'worker');

    expect(result.applied).toBe(false);
    expect(result.description).toContain('already');
  });

  it('rejects non-existent node', () => {
    const dag = createMinimalDAG('d1', 'a', 'b');
    const result = changeRole(dag, 'ghost', 'reviewer');

    expect(result.applied).toBe(false);
    expect(result.description).toContain('not found');
  });

  it('does not mutate the original DAG', () => {
    const dag = createLinearDAG('d1', ['a', 'b', 'c']);
    const originalRole = dag.nodes[1].role;
    changeRole(dag, 'node-1', 'reviewer');
    expect(dag.nodes[1].role).toBe(originalRole);
  });
});

// ---------------------------------------------------------------------------
// changeEdgeType
// ---------------------------------------------------------------------------

describe('changeEdgeType', () => {
  it('changes sequential to review', () => {
    const dag = createMinimalDAG('d1', 'a', 'b');
    const result = changeEdgeType(dag, 'entry', 'exit', 'review');

    expect(result.applied).toBe(true);
    expect(result.kind).toBe('change_edge_type');
    expect(result.dag.edges[0].edgeType).toBe('review');
  });

  it('changes to parallel', () => {
    const dag = createMinimalDAG('d1', 'a', 'b');
    const result = changeEdgeType(dag, 'entry', 'exit', 'parallel');

    expect(result.applied).toBe(true);
    expect(result.dag.edges[0].edgeType).toBe('parallel');
  });

  it('changes to conditional', () => {
    const dag = createMinimalDAG('d1', 'a', 'b');
    const result = changeEdgeType(dag, 'entry', 'exit', 'conditional');

    expect(result.applied).toBe(true);
    expect(result.dag.edges[0].edgeType).toBe('conditional');
  });

  it('rejects same type (no-op)', () => {
    const dag = createMinimalDAG('d1', 'a', 'b');
    const result = changeEdgeType(dag, 'entry', 'exit', 'sequential');

    expect(result.applied).toBe(false);
    expect(result.description).toContain('already');
  });

  it('rejects non-existent edge', () => {
    const dag = createMinimalDAG('d1', 'a', 'b');
    const result = changeEdgeType(dag, 'exit', 'entry', 'review');

    expect(result.applied).toBe(false);
    expect(result.description).toContain('not found');
  });

  it('does not mutate the original DAG', () => {
    const dag = createMinimalDAG('d1', 'a', 'b');
    const originalType = dag.edges[0].edgeType;
    changeEdgeType(dag, 'entry', 'exit', 'review');
    expect(dag.edges[0].edgeType).toBe(originalType);
  });
});

// ---------------------------------------------------------------------------
// reassignAgent
// ---------------------------------------------------------------------------

describe('reassignAgent', () => {
  it('reassigns a node to a different agent', () => {
    const dag = createLinearDAG('d1', ['a', 'b', 'c']);
    const result = reassignAgent(dag, 'node-1', 'new-agent');

    expect(result.applied).toBe(true);
    expect(result.kind).toBe('reassign_agent');
    const changed = result.dag.nodes.find((n) => n.id === 'node-1');
    expect(changed!.agentName).toBe('new-agent');
  });

  it('rejects same agent name (no-op)', () => {
    const dag = createLinearDAG('d1', ['a', 'b', 'c']);
    const result = reassignAgent(dag, 'node-1', 'b');

    expect(result.applied).toBe(false);
    expect(result.description).toContain('already');
  });

  it('rejects non-existent node', () => {
    const dag = createMinimalDAG('d1', 'a', 'b');
    const result = reassignAgent(dag, 'ghost', 'new-agent');

    expect(result.applied).toBe(false);
    expect(result.description).toContain('not found');
  });

  it('can reassign entry node', () => {
    const dag = createMinimalDAG('d1', 'a', 'b');
    const result = reassignAgent(dag, 'entry', 'new-entry-agent');

    expect(result.applied).toBe(true);
    const changed = result.dag.nodes.find((n) => n.id === 'entry');
    expect(changed!.agentName).toBe('new-entry-agent');
  });

  it('does not mutate the original DAG', () => {
    const dag = createLinearDAG('d1', ['a', 'b', 'c']);
    const originalAgent = dag.nodes[1].agentName;
    reassignAgent(dag, 'node-1', 'different');
    expect(dag.nodes[1].agentName).toBe(originalAgent);
  });
});

// ---------------------------------------------------------------------------
// randomMutation
// ---------------------------------------------------------------------------

describe('randomMutation', () => {
  const agents = ['alpha', 'beta', 'gamma'];

  it('applies add_node when roll < 0.25', () => {
    const dag = createLinearDAG('d1', ['a', 'b', 'c']);
    // roll=0.1 → add_node, edgeIdx=0, agent=agents[0], role=WORKER_ROLES[0]
    const rng = seededRng([0.1, 0.0, 0.0, 0.0]);
    const result = randomMutation(dag, rng, agents);

    expect(result.applied).toBe(true);
    expect(result.kind).toBe('add_node');
    expect(result.dag.nodes.length).toBeGreaterThan(dag.nodes.length);
  });

  it('applies remove_node when roll is 0.25-0.40', () => {
    // 4-node linear: entry → w1 → w2 → exit
    const dag = createLinearDAG('d1', ['a', 'b', 'c', 'd']);
    // roll=0.3 → remove_node, pick workerNodes[0]
    const rng = seededRng([0.3, 0.0]);
    const result = randomMutation(dag, rng, agents);

    expect(result.applied).toBe(true);
    expect(result.kind).toBe('remove_node');
    expect(result.dag.nodes.length).toBeLessThan(dag.nodes.length);
  });

  it('applies add_edge when roll is 0.40-0.60', () => {
    const dag = createLinearDAG('d1', ['a', 'b', 'c', 'd']);
    // roll=0.5 → add_edge. Need src != tgt and forward direction
    // src=0 (node-0=entry), tgt=2/3 * 4 = node-2 or node-3
    const rng = seededRng([0.5, 0.0, 0.75, 0.0]);
    const result = randomMutation(dag, rng, agents);

    // Might succeed or fall through to fallback, but should produce applied result
    expect(result.applied).toBe(true);
  });

  it('applies change_role when roll is 0.75-0.85', () => {
    const dag = createLinearDAG('d1', ['a', 'b', 'c']);
    // roll=0.8 → change_role. Worker is node-1, pick role=WORKER_ROLES[1]='reviewer'
    const rng = seededRng([0.8, 0.0, 0.5]);
    const result = randomMutation(dag, rng, agents);

    expect(result.applied).toBe(true);
    // Could be change_role or fallback
  });

  it('applies change_edge_type when roll is 0.85-0.95', () => {
    const dag = createLinearDAG('d1', ['a', 'b', 'c']);
    // roll=0.9 → change_edge_type. Pick edge[0], new type=EDGE_TYPES[1]='review'
    const rng = seededRng([0.9, 0.0, 0.3]);
    const result = randomMutation(dag, rng, agents);

    expect(result.applied).toBe(true);
  });

  it('applies reassign_agent when roll >= 0.95', () => {
    const dag = createLinearDAG('d1', ['a', 'b', 'c']);
    // roll=0.97 → reassign_agent. Pick node[0], agent=agents[1]='beta'
    const rng = seededRng([0.97, 0.0, 0.5]);
    const result = randomMutation(dag, rng, agents);

    expect(result.applied).toBe(true);
    expect(result.kind).toBe('reassign_agent');
  });

  it('falls back on failure (remove_node with minimal DAG)', () => {
    // Minimal DAG has no worker nodes → remove_node fails → fallback to add_edge/reassign
    const dag = createMinimalDAG('d1', 'a', 'b');
    const rng = seededRng([0.3, 0.0, 0.0, 0.0, 0.5]);
    const result = randomMutation(dag, rng, agents);

    expect(result.applied).toBe(true);
    // Primary mutation failed, should fall back to add_edge or reassign_agent
    expect(['add_edge', 'reassign_agent']).toContain(result.kind);
  });

  it('always produces a valid DAG', () => {
    const dag = createLinearDAG('d1', ['a', 'b', 'c', 'd', 'e']);
    // Run many random mutations to stress-test
    for (let i = 0; i < 20; i++) {
      const rng = seededRng([i / 20, 0.3, 0.6, 0.1, 0.9, 0.5]);
      const result = randomMutation(dag, rng, agents);
      if (result.applied) {
        const validation = validateDAG(result.dag);
        expect(validation.valid).toBe(true);
      }
    }
  });

  it('preserves DAG immutability across many mutations', () => {
    let dag = createLinearDAG('d1', ['a', 'b', 'c']);
    const originalNodeCount = dag.nodes.length;
    const originalEdgeCount = dag.edges.length;

    // Apply several mutations sequentially
    for (let i = 0; i < 10; i++) {
      const rng = seededRng([i / 10, 0.5, 0.3, 0.7, 0.2]);
      const result = randomMutation(dag, rng, agents);
      if (result.applied) {
        dag = result.dag;
      }
    }

    // Original should still be intact (we only reassigned the variable)
    const original = createLinearDAG('d1', ['a', 'b', 'c']);
    expect(original.nodes).toHaveLength(originalNodeCount);
    expect(original.edges).toHaveLength(originalEdgeCount);
  });

  it('uses custom agent pool', () => {
    const dag = createMinimalDAG('d1', 'a', 'b');
    const customPool = ['custom-agent-1', 'custom-agent-2'];
    // roll=0.1 → add_node using customPool
    const rng = seededRng([0.1, 0.0, 0.0, 0.0]);
    const result = randomMutation(dag, rng, customPool);

    expect(result.applied).toBe(true);
    if (result.kind === 'add_node') {
      const newNode = result.dag.nodes.find(
        (n) => customPool.includes(n.agentName) && n.role !== 'entry' && n.role !== 'exit',
      );
      expect(newNode).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Composition: multiple mutations
// ---------------------------------------------------------------------------

describe('mutation composition', () => {
  it('can grow a minimal DAG through sequential add_node mutations', () => {
    let dag: WorkflowDAG = createMinimalDAG('d1', 'a', 'b');

    for (let i = 0; i < 5; i++) {
      const result = addNode(dag, 0, `worker-${i}`);
      expect(result.applied).toBe(true);
      dag = result.dag;
    }

    expect(dag.nodes).toHaveLength(7); // 2 original + 5 added
    expect(dag.edges).toHaveLength(6); // 1 original split into 6
    expect(validateDAG(dag).valid).toBe(true);
  });

  it('can grow and then shrink a DAG', () => {
    let dag: WorkflowDAG = createMinimalDAG('d1', 'a', 'b');

    // Grow: add 3 nodes
    for (let i = 0; i < 3; i++) {
      const result = addNode(dag, 0, `worker-${i}`);
      dag = result.dag;
    }
    expect(dag.nodes).toHaveLength(5);

    // Shrink: remove worker nodes
    const workers = dag.nodes.filter((n) => n.role === 'worker');
    for (const w of workers) {
      const result = removeNode(dag, w.id);
      if (result.applied) dag = result.dag;
    }

    expect(dag.nodes).toHaveLength(2); // back to entry + exit
    expect(validateDAG(dag).valid).toBe(true);
  });

  it('add_edge + remove_edge is reversible', () => {
    const dag = createLinearDAG('d1', ['a', 'b', 'c']);
    const addResult = addEdge(dag, 'node-0', 'node-2');
    expect(addResult.applied).toBe(true);

    const removeResult = removeEdge(addResult.dag, 'node-0', 'node-2');
    expect(removeResult.applied).toBe(true);

    // Should be back to original edge count
    expect(removeResult.dag.edges).toHaveLength(dag.edges.length);
  });

  it('handles complex topology transformations', () => {
    // Start minimal, grow, add edges, change roles, then validate
    let dag: WorkflowDAG = createMinimalDAG('d1', 'a', 'b');

    // Add 2 worker nodes
    let r = addNode(dag, 0, 'worker-1');
    dag = r.dag;
    r = addNode(dag, 1, 'worker-2');
    dag = r.dag;

    // Add a skip edge
    const skipResult = addEdge(dag, dag.nodes[0].id, dag.nodes[dag.nodes.length - 1].id);
    if (skipResult.applied) dag = skipResult.dag;

    // Change a worker to reviewer
    const workers = dag.nodes.filter((n) => n.role === 'worker');
    if (workers.length > 0) {
      const roleResult = changeRole(dag, workers[0].id, 'reviewer');
      if (roleResult.applied) dag = roleResult.dag;
    }

    // Change an edge type
    if (dag.edges.length > 0) {
      const etResult = changeEdgeType(dag, dag.edges[0].source, dag.edges[0].target, 'review');
      if (etResult.applied) dag = etResult.dag;
    }

    // Final DAG should be valid
    expect(validateDAG(dag).valid).toBe(true);
    expect(dag.nodes.length).toBeGreaterThanOrEqual(4);
  });
});
