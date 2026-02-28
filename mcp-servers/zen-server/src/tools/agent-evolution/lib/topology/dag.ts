/**
 * DAG operations: construction, validation, density computation, traversal.
 *
 * All operations are pure functions — DAGs are immutable value objects.
 * Validation enforces structural invariants required for correct
 * workflow execution:
 *   - Exactly one entry, exactly one exit
 *   - Full reachability (no disconnected nodes)
 *   - Acyclicity (topological order exists)
 *   - Referential integrity (edges reference existing nodes)
 *
 * Density metrics quantify topological complexity for the
 * density-difficulty mapping and MAP-Elites behavioral dimension.
 */

import type {
  WorkflowDAG,
  TopologyNode,
  TopologyEdge,
  DensityMetrics,
  DAGValidationResult,
  NodeRole,
  EdgeType,
} from './types.js';

// ---------------------------------------------------------------------------
// Construction helpers
// ---------------------------------------------------------------------------

/**
 * Creates a minimal linear DAG: entry → exit.
 * The simplest valid topology (2 nodes, 1 edge).
 */
export function createMinimalDAG(
  id: string,
  entryAgent: string,
  exitAgent: string,
): WorkflowDAG {
  return {
    id,
    name: `${entryAgent}→${exitAgent}`,
    nodes: [
      { id: 'entry', agentName: entryAgent, role: 'entry', modelOverride: null, maxRetries: 0 },
      { id: 'exit', agentName: exitAgent, role: 'exit', modelOverride: null, maxRetries: 0 },
    ],
    edges: [
      { source: 'entry', target: 'exit', edgeType: 'sequential', weight: 1.0, condition: null },
    ],
  };
}

/**
 * Creates a linear pipeline DAG: agent1 → agent2 → ... → agentN.
 * First node is entry, last is exit, intermediaries are workers.
 */
export function createLinearDAG(
  id: string,
  agents: readonly string[],
): WorkflowDAG {
  if (agents.length === 0) {
    throw new Error('Cannot create DAG with zero agents');
  }
  if (agents.length === 1) {
    return createMinimalDAG(id, agents[0], agents[0]);
  }

  const nodes: TopologyNode[] = agents.map((agent, i) => ({
    id: `node-${i}`,
    agentName: agent,
    role: (i === 0 ? 'entry' : i === agents.length - 1 ? 'exit' : 'worker') as NodeRole,
    modelOverride: null,
    maxRetries: 0,
  }));

  const edges: TopologyEdge[] = [];
  for (let i = 0; i < agents.length - 1; i++) {
    edges.push({
      source: `node-${i}`,
      target: `node-${i + 1}`,
      edgeType: 'sequential',
      weight: 1.0,
      condition: null,
    });
  }

  return {
    id,
    name: agents.join('→'),
    nodes,
    edges,
  };
}

// ---------------------------------------------------------------------------
// Adjacency helpers (internal)
// ---------------------------------------------------------------------------

/** Build forward adjacency list: node ID → list of target IDs. */
function buildAdjacency(dag: WorkflowDAG): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const node of dag.nodes) {
    adj.set(node.id, []);
  }
  for (const edge of dag.edges) {
    adj.get(edge.source)?.push(edge.target);
  }
  return adj;
}

/** Build reverse adjacency list: node ID → list of source IDs. */
function buildReverseAdjacency(dag: WorkflowDAG): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const node of dag.nodes) {
    adj.set(node.id, []);
  }
  for (const edge of dag.edges) {
    adj.get(edge.target)?.push(edge.source);
  }
  return adj;
}

/** BFS from a start node, returns set of reachable node IDs. */
function bfsReachable(adj: Map<string, string[]>, startId: string): Set<string> {
  const visited = new Set<string>();
  const queue: string[] = [startId];
  visited.add(startId);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const neighbors = adj.get(current);
    if (neighbors) {
      for (const n of neighbors) {
        if (!visited.has(n)) {
          visited.add(n);
          queue.push(n);
        }
      }
    }
  }
  return visited;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validates a WorkflowDAG against all structural invariants.
 *
 * Checks:
 * 1. Non-empty (at least 2 nodes)
 * 2. Unique node IDs
 * 3. Exactly one entry node, exactly one exit node
 * 4. All edge references are valid
 * 5. No duplicate edges
 * 6. No self-loops
 * 7. Acyclicity (Kahn's algorithm)
 * 8. Forward reachability: all nodes reachable from entry
 * 9. Backward reachability: exit reachable from all nodes
 */
export function validateDAG(dag: WorkflowDAG): DAGValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Non-empty
  if (dag.nodes.length < 2) {
    errors.push('DAG must have at least 2 nodes (entry + exit)');
  }

  // 2. Unique IDs
  const nodeIds = new Set<string>();
  for (const node of dag.nodes) {
    if (nodeIds.has(node.id)) {
      errors.push(`Duplicate node ID: '${node.id}'`);
    }
    nodeIds.add(node.id);
  }

  // 3. Entry/exit counts
  const entries = dag.nodes.filter((n) => n.role === 'entry');
  const exits = dag.nodes.filter((n) => n.role === 'exit');
  if (entries.length !== 1) {
    errors.push(`Expected exactly 1 entry node, found ${entries.length}`);
  }
  if (exits.length !== 1) {
    errors.push(`Expected exactly 1 exit node, found ${exits.length}`);
  }

  // 4. Edge reference validity
  for (const edge of dag.edges) {
    if (!nodeIds.has(edge.source)) {
      errors.push(`Edge references unknown source node: '${edge.source}'`);
    }
    if (!nodeIds.has(edge.target)) {
      errors.push(`Edge references unknown target node: '${edge.target}'`);
    }
  }

  // 5. No duplicate edges
  const edgeKeys = new Set<string>();
  for (const edge of dag.edges) {
    const key = `${edge.source}->${edge.target}`;
    if (edgeKeys.has(key)) {
      errors.push(`Duplicate edge: ${key}`);
    }
    edgeKeys.add(key);
  }

  // 6. No self-loops
  for (const edge of dag.edges) {
    if (edge.source === edge.target) {
      errors.push(`Self-loop on node '${edge.source}'`);
    }
  }

  // Early return if basic structure is invalid
  if (errors.length > 0) {
    return { valid: false, errors, warnings };
  }

  // 7. Acyclicity (Kahn's algorithm)
  const inDegree = new Map<string, number>();
  for (const node of dag.nodes) inDegree.set(node.id, 0);
  for (const edge of dag.edges) {
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  let sorted = 0;
  const adj = buildAdjacency(dag);
  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted++;
    const neighbors = adj.get(current) ?? [];
    for (const n of neighbors) {
      const newDeg = (inDegree.get(n) ?? 1) - 1;
      inDegree.set(n, newDeg);
      if (newDeg === 0) queue.push(n);
    }
  }

  if (sorted !== dag.nodes.length) {
    errors.push('DAG contains a cycle');
    return { valid: false, errors, warnings };
  }

  // 8. Forward reachability
  const entryId = entries[0].id;
  const forwardReachable = bfsReachable(adj, entryId);
  for (const node of dag.nodes) {
    if (!forwardReachable.has(node.id)) {
      errors.push(`Node '${node.id}' is not reachable from entry`);
    }
  }

  // 9. Backward reachability (exit reachable from all nodes)
  const exitId = exits[0].id;
  const reverseAdj = buildReverseAdjacency(dag);
  const backwardReachable = bfsReachable(reverseAdj, exitId);
  for (const node of dag.nodes) {
    if (!backwardReachable.has(node.id)) {
      warnings.push(`Node '${node.id}' cannot reach exit`);
    }
  }

  // Warnings for unusual structures
  if (dag.edges.length === 0) {
    warnings.push('DAG has no edges');
  }

  const isolatedNodes = dag.nodes.filter((n) => {
    const hasOut = dag.edges.some((e) => e.source === n.id);
    const hasIn = dag.edges.some((e) => e.target === n.id);
    return !hasOut && !hasIn && n.role !== 'entry' && n.role !== 'exit';
  });
  for (const node of isolatedNodes) {
    warnings.push(`Node '${node.id}' has no edges (isolated)`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ---------------------------------------------------------------------------
// Topological sort
// ---------------------------------------------------------------------------

/**
 * Returns nodes in topological order (Kahn's algorithm).
 * Throws if the DAG contains a cycle.
 */
export function topologicalSort(dag: WorkflowDAG): readonly TopologyNode[] {
  const inDegree = new Map<string, number>();
  for (const node of dag.nodes) inDegree.set(node.id, 0);
  for (const edge of dag.edges) {
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const result: TopologyNode[] = [];
  const nodeMap = new Map(dag.nodes.map((n) => [n.id, n]));
  const adj = buildAdjacency(dag);

  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(nodeMap.get(current)!);
    const neighbors = adj.get(current) ?? [];
    for (const n of neighbors) {
      const newDeg = (inDegree.get(n) ?? 1) - 1;
      inDegree.set(n, newDeg);
      if (newDeg === 0) queue.push(n);
    }
  }

  if (result.length !== dag.nodes.length) {
    throw new Error('Cannot topologically sort: DAG contains a cycle');
  }

  return result;
}

// ---------------------------------------------------------------------------
// Density metrics
// ---------------------------------------------------------------------------

/**
 * Computes density metrics for a DAG.
 *
 * All metrics are normalized to [0, 1] where applicable.
 * The composite density is a weighted combination used as
 * the behavioral dimension in MAP-Elites.
 */
export function computeDensity(dag: WorkflowDAG): DensityMetrics {
  const n = dag.nodes.length;
  const e = dag.edges.length;

  // Edge density: |E| / max_possible_edges
  // For DAG: max = n*(n-1)/2 (upper triangle of adjacency matrix)
  const maxEdges = n > 1 ? (n * (n - 1)) / 2 : 1;
  const edgeDensity = e / maxEdges;

  // Average degree
  const degreeMap = new Map<string, number>();
  for (const node of dag.nodes) degreeMap.set(node.id, 0);
  for (const edge of dag.edges) {
    degreeMap.set(edge.source, (degreeMap.get(edge.source) ?? 0) + 1);
    degreeMap.set(edge.target, (degreeMap.get(edge.target) ?? 0) + 1);
  }
  let totalDegree = 0;
  for (const deg of degreeMap.values()) totalDegree += deg;
  const avgDegree = n > 0 ? totalDegree / n : 0;

  // Critical path length (longest path from entry to exit via BFS/DFS)
  const entries = dag.nodes.filter((node) => node.role === 'entry');
  const exits = dag.nodes.filter((node) => node.role === 'exit');
  let criticalPathLength = 0;

  if (entries.length === 1 && exits.length === 1) {
    criticalPathLength = longestPath(dag, entries[0].id, exits[0].id);
  }

  // Max fan-out
  const outDegree = new Map<string, number>();
  for (const node of dag.nodes) outDegree.set(node.id, 0);
  for (const edge of dag.edges) {
    outDegree.set(edge.source, (outDegree.get(edge.source) ?? 0) + 1);
  }
  let maxFanOut = 0;
  for (const deg of outDegree.values()) {
    if (deg > maxFanOut) maxFanOut = deg;
  }

  // Review ratio
  const reviewEdges = dag.edges.filter((edge) => edge.edgeType === 'review').length;
  const reviewRatio = e > 0 ? reviewEdges / e : 0;

  // Composite density: weighted combination
  // Weights empirically tuned for correlation with task complexity
  const compositeDensity = Math.min(1, Math.max(0,
    0.25 * edgeDensity +
    0.20 * Math.min(1, avgDegree / 4) +
    0.25 * Math.min(1, criticalPathLength / 6) +
    0.15 * Math.min(1, maxFanOut / 4) +
    0.15 * reviewRatio
  ));

  return {
    nodeCount: n,
    edgeCount: e,
    edgeDensity,
    avgDegree,
    criticalPathLength,
    maxFanOut,
    reviewRatio,
    compositeDensity,
  };
}

// ---------------------------------------------------------------------------
// Longest path (internal)
// ---------------------------------------------------------------------------

/**
 * Computes the longest path (in edge count) from source to target.
 * Uses dynamic programming on topological order.
 * Returns 0 if no path exists.
 */
function longestPath(dag: WorkflowDAG, sourceId: string, targetId: string): number {
  const sorted = topologicalSort(dag);
  const adj = buildAdjacency(dag);
  const dist = new Map<string, number>();

  for (const node of sorted) dist.set(node.id, -Infinity);
  dist.set(sourceId, 0);

  for (const node of sorted) {
    const d = dist.get(node.id)!;
    if (d === -Infinity) continue;

    const neighbors = adj.get(node.id) ?? [];
    for (const n of neighbors) {
      const current = dist.get(n)!;
      if (d + 1 > current) {
        dist.set(n, d + 1);
      }
    }
  }

  const result = dist.get(targetId);
  return result !== undefined && result > 0 ? result : 0;
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

/** Get all predecessors of a node (nodes with edges pointing to it). */
export function getPredecessors(dag: WorkflowDAG, nodeId: string): readonly TopologyNode[] {
  const sourceIds = new Set(
    dag.edges.filter((e) => e.target === nodeId).map((e) => e.source),
  );
  return dag.nodes.filter((n) => sourceIds.has(n.id));
}

/** Get all successors of a node (nodes it has edges pointing to). */
export function getSuccessors(dag: WorkflowDAG, nodeId: string): readonly TopologyNode[] {
  const targetIds = new Set(
    dag.edges.filter((e) => e.source === nodeId).map((e) => e.target),
  );
  return dag.nodes.filter((n) => targetIds.has(n.id));
}

/** Find entry node (throws if not exactly one). */
export function getEntryNode(dag: WorkflowDAG): TopologyNode {
  const entries = dag.nodes.filter((n) => n.role === 'entry');
  if (entries.length !== 1) throw new Error(`Expected 1 entry node, found ${entries.length}`);
  return entries[0];
}

/** Find exit node (throws if not exactly one). */
export function getExitNode(dag: WorkflowDAG): TopologyNode {
  const exits = dag.nodes.filter((n) => n.role === 'exit');
  if (exits.length !== 1) throw new Error(`Expected 1 exit node, found ${exits.length}`);
  return exits[0];
}

/** Get the node with a given ID (undefined if not found). */
export function getNode(dag: WorkflowDAG, nodeId: string): TopologyNode | undefined {
  return dag.nodes.find((n) => n.id === nodeId);
}

/** Get all edges from a specific source node. */
export function getOutgoingEdges(dag: WorkflowDAG, nodeId: string): readonly TopologyEdge[] {
  return dag.edges.filter((e) => e.source === nodeId);
}

/** Get all edges to a specific target node. */
export function getIncomingEdges(dag: WorkflowDAG, nodeId: string): readonly TopologyEdge[] {
  return dag.edges.filter((e) => e.target === nodeId);
}
