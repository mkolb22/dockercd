/**
 * NEAT-inspired topology mutation operators.
 *
 * Mutations evolve workflow DAG structure while preserving validity:
 * - add_node: split an edge by inserting a new agent
 * - remove_node: bypass a node, reconnecting its neighbors
 * - add_edge: create a new communication channel
 * - remove_edge: delete a redundant channel
 * - change_role: alter a node's workflow role
 * - change_edge_type: alter edge communication pattern
 * - reassign_agent: assign a different agent to a node
 *
 * All operators are non-destructive (return new DAG, never modify input)
 * and deterministic given the same RNG state.
 *
 * NEAT principle: start minimal, grow complexity through structural
 * mutations. Each mutation is small (±1 node or ±1 edge) to enable
 * gradual search of the topology space.
 *
 * Cycle prevention: add_edge checks reachability before insertion.
 * Connectivity: remove operations verify the result remains connected.
 */

import type {
  WorkflowDAG,
  TopologyNode,
  TopologyEdge,
  TopologyMutationKind,
  TopologyMutationResult,
  NodeRole,
  EdgeType,
} from './types.js';
import { validateDAG } from './dag.js';

// ---------------------------------------------------------------------------
// Mutation result helpers
// ---------------------------------------------------------------------------

function noOp(dag: WorkflowDAG, kind: TopologyMutationKind, reason: string): TopologyMutationResult {
  return { dag, applied: false, kind, description: reason };
}

function applied(dag: WorkflowDAG, kind: TopologyMutationKind, desc: string): TopologyMutationResult {
  return { dag, applied: true, kind, description: desc };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Generate a unique node ID not already in the DAG. */
function newNodeId(dag: WorkflowDAG, prefix: string = 'n'): string {
  const existing = new Set(dag.nodes.map((n) => n.id));
  let i = dag.nodes.length;
  let id = `${prefix}-${i}`;
  while (existing.has(id)) {
    i++;
    id = `${prefix}-${i}`;
  }
  return id;
}

/** Check if adding edge (source→target) would create a cycle. */
function wouldCreateCycle(dag: WorkflowDAG, source: string, target: string): boolean {
  // If target can already reach source via existing edges, adding source→target creates a cycle
  const visited = new Set<string>();
  const queue: string[] = [target];
  visited.add(target);

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === source) return true;

    for (const edge of dag.edges) {
      if (edge.source === current && !visited.has(edge.target)) {
        visited.add(edge.target);
        queue.push(edge.target);
      }
    }
  }

  return false;
}

/** Check if removing a node would disconnect the DAG. */
function isRemovable(dag: WorkflowDAG, nodeId: string): boolean {
  const node = dag.nodes.find((n) => n.id === nodeId);
  if (!node) return false;

  // Cannot remove entry or exit
  if (node.role === 'entry' || node.role === 'exit') return false;

  // Build candidate DAG without this node
  const newNodes = dag.nodes.filter((n) => n.id !== nodeId);
  const inEdges = dag.edges.filter((e) => e.target === nodeId);
  const outEdges = dag.edges.filter((e) => e.source === nodeId);
  const otherEdges = dag.edges.filter((e) => e.source !== nodeId && e.target !== nodeId);

  // Reconnect: each predecessor → each successor
  const reconnected: TopologyEdge[] = [];
  for (const inE of inEdges) {
    for (const outE of outEdges) {
      // Avoid duplicates
      const key = `${inE.source}->${outE.target}`;
      if (!otherEdges.some((e) => `${e.source}->${e.target}` === key) &&
          !reconnected.some((e) => `${e.source}->${e.target}` === key) &&
          inE.source !== outE.target) {
        reconnected.push({
          source: inE.source,
          target: outE.target,
          edgeType: inE.edgeType,
          weight: Math.max(inE.weight, outE.weight),
          condition: null,
        });
      }
    }
  }

  const candidateDAG: WorkflowDAG = {
    ...dag,
    nodes: newNodes,
    edges: [...otherEdges, ...reconnected],
  };

  return validateDAG(candidateDAG).valid;
}

// ---------------------------------------------------------------------------
// Mutation operators
// ---------------------------------------------------------------------------

/**
 * Splits an edge by inserting a new node.
 *
 * Before: A → B
 * After:  A → NEW → B
 *
 * The new node is a worker with the specified agent name.
 */
export function addNode(
  dag: WorkflowDAG,
  edgeIndex: number,
  agentName: string,
  role: NodeRole = 'worker',
): TopologyMutationResult {
  if (edgeIndex < 0 || edgeIndex >= dag.edges.length) {
    return noOp(dag, 'add_node', `Invalid edge index: ${edgeIndex}`);
  }

  const edge = dag.edges[edgeIndex];
  const nodeId = newNodeId(dag);

  const newNode: TopologyNode = {
    id: nodeId,
    agentName,
    role,
    modelOverride: null,
    maxRetries: 0,
  };

  // Replace the split edge with two new edges
  const newEdges = dag.edges.filter((_, i) => i !== edgeIndex);
  newEdges.push(
    { ...edge, target: nodeId },
    { source: nodeId, target: edge.target, edgeType: edge.edgeType, weight: edge.weight, condition: null },
  );

  const newDAG: WorkflowDAG = {
    ...dag,
    nodes: [...dag.nodes, newNode],
    edges: newEdges,
  };

  return applied(newDAG, 'add_node', `Inserted '${agentName}' (${role}) between '${edge.source}' and '${edge.target}'`);
}

/**
 * Removes a node, reconnecting its predecessors to its successors.
 *
 * Before: A → X → B (and possibly other edges through X)
 * After:  A → B
 *
 * Cannot remove entry or exit nodes.
 * Validates the result to ensure connectivity.
 */
export function removeNode(
  dag: WorkflowDAG,
  nodeId: string,
): TopologyMutationResult {
  if (!isRemovable(dag, nodeId)) {
    return noOp(dag, 'remove_node', `Node '${nodeId}' cannot be removed (entry/exit or would disconnect DAG)`);
  }

  const node = dag.nodes.find((n) => n.id === nodeId)!;
  const inEdges = dag.edges.filter((e) => e.target === nodeId);
  const outEdges = dag.edges.filter((e) => e.source === nodeId);
  const otherEdges = dag.edges.filter((e) => e.source !== nodeId && e.target !== nodeId);

  // Reconnect predecessors to successors
  const reconnected: TopologyEdge[] = [];
  const existingKeys = new Set(otherEdges.map((e) => `${e.source}->${e.target}`));

  for (const inE of inEdges) {
    for (const outE of outEdges) {
      const key = `${inE.source}->${outE.target}`;
      if (!existingKeys.has(key) && !reconnected.some((e) => `${e.source}->${e.target}` === key) &&
          inE.source !== outE.target) {
        reconnected.push({
          source: inE.source,
          target: outE.target,
          edgeType: inE.edgeType,
          weight: Math.max(inE.weight, outE.weight),
          condition: null,
        });
        existingKeys.add(key);
      }
    }
  }

  const newDAG: WorkflowDAG = {
    ...dag,
    nodes: dag.nodes.filter((n) => n.id !== nodeId),
    edges: [...otherEdges, ...reconnected],
  };

  return applied(newDAG, 'remove_node', `Removed '${node.agentName}' (${nodeId})`);
}

/**
 * Adds an edge between two existing nodes.
 *
 * Validates that:
 * - Both nodes exist
 * - Edge doesn't already exist
 * - Adding the edge wouldn't create a cycle
 */
export function addEdge(
  dag: WorkflowDAG,
  source: string,
  target: string,
  edgeType: EdgeType = 'sequential',
): TopologyMutationResult {
  const nodeIds = new Set(dag.nodes.map((n) => n.id));
  if (!nodeIds.has(source)) return noOp(dag, 'add_edge', `Source node '${source}' not found`);
  if (!nodeIds.has(target)) return noOp(dag, 'add_edge', `Target node '${target}' not found`);
  if (source === target) return noOp(dag, 'add_edge', `Self-loop not allowed`);

  // Check for duplicate
  if (dag.edges.some((e) => e.source === source && e.target === target)) {
    return noOp(dag, 'add_edge', `Edge '${source}→${target}' already exists`);
  }

  // Check for cycle
  if (wouldCreateCycle(dag, source, target)) {
    return noOp(dag, 'add_edge', `Edge '${source}→${target}' would create a cycle`);
  }

  const newEdge: TopologyEdge = {
    source,
    target,
    edgeType,
    weight: 1.0,
    condition: null,
  };

  const newDAG: WorkflowDAG = {
    ...dag,
    edges: [...dag.edges, newEdge],
  };

  return applied(newDAG, 'add_edge', `Added ${edgeType} edge '${source}→${target}'`);
}

/**
 * Removes an edge from the DAG.
 *
 * Validates that removing the edge doesn't disconnect the DAG
 * (all nodes must remain reachable from entry).
 */
export function removeEdge(
  dag: WorkflowDAG,
  source: string,
  target: string,
): TopologyMutationResult {
  const edgeIdx = dag.edges.findIndex((e) => e.source === source && e.target === target);
  if (edgeIdx === -1) {
    return noOp(dag, 'remove_edge', `Edge '${source}→${target}' not found`);
  }

  // Don't remove if it's the only edge
  if (dag.edges.length <= 1) {
    return noOp(dag, 'remove_edge', 'Cannot remove the only edge');
  }

  const candidateDAG: WorkflowDAG = {
    ...dag,
    edges: dag.edges.filter((_, i) => i !== edgeIdx),
  };

  // Validate connectivity
  const validation = validateDAG(candidateDAG);
  if (!validation.valid) {
    return noOp(dag, 'remove_edge', `Removing '${source}→${target}' would disconnect the DAG`);
  }

  return applied(candidateDAG, 'remove_edge', `Removed edge '${source}→${target}'`);
}

/**
 * Changes the role of a non-entry/non-exit node.
 */
export function changeRole(
  dag: WorkflowDAG,
  nodeId: string,
  newRole: NodeRole,
): TopologyMutationResult {
  const nodeIdx = dag.nodes.findIndex((n) => n.id === nodeId);
  if (nodeIdx === -1) return noOp(dag, 'change_role', `Node '${nodeId}' not found`);

  const node = dag.nodes[nodeIdx];
  if (node.role === 'entry' || node.role === 'exit') {
    return noOp(dag, 'change_role', `Cannot change role of ${node.role} node`);
  }
  if (node.role === newRole) {
    return noOp(dag, 'change_role', `Node '${nodeId}' already has role '${newRole}'`);
  }

  const newNodes = [...dag.nodes];
  newNodes[nodeIdx] = { ...node, role: newRole };

  return applied(
    { ...dag, nodes: newNodes },
    'change_role',
    `Changed '${nodeId}' role from '${node.role}' to '${newRole}'`,
  );
}

/**
 * Changes the type of an edge (e.g., sequential → review).
 */
export function changeEdgeType(
  dag: WorkflowDAG,
  source: string,
  target: string,
  newType: EdgeType,
): TopologyMutationResult {
  const edgeIdx = dag.edges.findIndex((e) => e.source === source && e.target === target);
  if (edgeIdx === -1) {
    return noOp(dag, 'change_edge_type', `Edge '${source}→${target}' not found`);
  }

  const edge = dag.edges[edgeIdx];
  if (edge.edgeType === newType) {
    return noOp(dag, 'change_edge_type', `Edge already has type '${newType}'`);
  }

  const newEdges = [...dag.edges];
  newEdges[edgeIdx] = { ...edge, edgeType: newType };

  return applied(
    { ...dag, edges: newEdges },
    'change_edge_type',
    `Changed edge '${source}→${target}' from '${edge.edgeType}' to '${newType}'`,
  );
}

/**
 * Reassigns a different agent genome to a node.
 */
export function reassignAgent(
  dag: WorkflowDAG,
  nodeId: string,
  newAgentName: string,
): TopologyMutationResult {
  const nodeIdx = dag.nodes.findIndex((n) => n.id === nodeId);
  if (nodeIdx === -1) return noOp(dag, 'reassign_agent', `Node '${nodeId}' not found`);

  const node = dag.nodes[nodeIdx];
  if (node.agentName === newAgentName) {
    return noOp(dag, 'reassign_agent', `Node '${nodeId}' already assigned to '${newAgentName}'`);
  }

  const newNodes = [...dag.nodes];
  newNodes[nodeIdx] = { ...node, agentName: newAgentName };

  return applied(
    { ...dag, nodes: newNodes },
    'reassign_agent',
    `Reassigned '${nodeId}' from '${node.agentName}' to '${newAgentName}'`,
  );
}

// ---------------------------------------------------------------------------
// Random mutation (for evolution)
// ---------------------------------------------------------------------------

/**
 * Available agent names for topology evolution.
 * Maps to the concept agents in the zen framework.
 */
const DEFAULT_AGENT_POOL = [
  'story-concept',
  'architecture-concept',
  'implementation-concept',
  'quality-concept',
  'verification-concept',
  'version-concept',
  'documentation-concept',
  'code-analysis-concept',
  'security-concept',
  'research-concept',
];

const WORKER_ROLES: NodeRole[] = ['worker', 'reviewer', 'aggregator'];
const EDGE_TYPES: EdgeType[] = ['sequential', 'review', 'parallel', 'conditional'];

/**
 * Applies a random topology mutation, selected by the RNG.
 *
 * Mutation probabilities:
 * - add_node: 25%
 * - remove_node: 15%
 * - add_edge: 20%
 * - remove_edge: 15%
 * - change_role: 10%
 * - change_edge_type: 10%
 * - reassign_agent: 5%
 *
 * Falls back to next mutation type if chosen one is a no-op.
 */
export function randomMutation(
  dag: WorkflowDAG,
  rng: () => number,
  agentPool: readonly string[] = DEFAULT_AGENT_POOL,
): TopologyMutationResult {
  const roll = rng();
  const workerNodes = dag.nodes.filter((n) => n.role !== 'entry' && n.role !== 'exit');

  // Try mutations in order of probability until one succeeds
  const attempts: (() => TopologyMutationResult)[] = [];

  if (roll < 0.25) {
    // add_node
    attempts.push(() => {
      if (dag.edges.length === 0) return noOp(dag, 'add_node', 'No edges to split');
      const edgeIdx = Math.floor(rng() * dag.edges.length);
      const agent = agentPool[Math.floor(rng() * agentPool.length)];
      const role = WORKER_ROLES[Math.floor(rng() * WORKER_ROLES.length)];
      return addNode(dag, edgeIdx, agent, role);
    });
  } else if (roll < 0.40) {
    // remove_node
    attempts.push(() => {
      if (workerNodes.length === 0) return noOp(dag, 'remove_node', 'No removable nodes');
      const node = workerNodes[Math.floor(rng() * workerNodes.length)];
      return removeNode(dag, node.id);
    });
  } else if (roll < 0.60) {
    // add_edge
    attempts.push(() => {
      const n = dag.nodes.length;
      if (n < 2) return noOp(dag, 'add_edge', 'Not enough nodes');
      const srcIdx = Math.floor(rng() * n);
      const tgtIdx = Math.floor(rng() * n);
      if (srcIdx === tgtIdx) return noOp(dag, 'add_edge', 'Same node selected');
      const edgeType = EDGE_TYPES[Math.floor(rng() * EDGE_TYPES.length)];
      return addEdge(dag, dag.nodes[srcIdx].id, dag.nodes[tgtIdx].id, edgeType);
    });
  } else if (roll < 0.75) {
    // remove_edge
    attempts.push(() => {
      if (dag.edges.length <= 1) return noOp(dag, 'remove_edge', 'Not enough edges');
      const edge = dag.edges[Math.floor(rng() * dag.edges.length)];
      return removeEdge(dag, edge.source, edge.target);
    });
  } else if (roll < 0.85) {
    // change_role
    attempts.push(() => {
      if (workerNodes.length === 0) return noOp(dag, 'change_role', 'No worker nodes');
      const node = workerNodes[Math.floor(rng() * workerNodes.length)];
      const newRole = WORKER_ROLES[Math.floor(rng() * WORKER_ROLES.length)];
      return changeRole(dag, node.id, newRole);
    });
  } else if (roll < 0.95) {
    // change_edge_type
    attempts.push(() => {
      if (dag.edges.length === 0) return noOp(dag, 'change_edge_type', 'No edges');
      const edge = dag.edges[Math.floor(rng() * dag.edges.length)];
      const newType = EDGE_TYPES[Math.floor(rng() * EDGE_TYPES.length)];
      return changeEdgeType(dag, edge.source, edge.target, newType);
    });
  } else {
    // reassign_agent
    attempts.push(() => {
      if (dag.nodes.length === 0) return noOp(dag, 'reassign_agent', 'No nodes');
      const node = dag.nodes[Math.floor(rng() * dag.nodes.length)];
      const newAgent = agentPool[Math.floor(rng() * agentPool.length)];
      return reassignAgent(dag, node.id, newAgent);
    });
  }

  // Fallback: try add_edge if primary mutation fails
  attempts.push(() => {
    if (dag.nodes.length < 2) return noOp(dag, 'add_edge', 'Not enough nodes');
    const srcIdx = Math.floor(rng() * dag.nodes.length);
    let tgtIdx = Math.floor(rng() * (dag.nodes.length - 1));
    if (tgtIdx >= srcIdx) tgtIdx++;
    return addEdge(dag, dag.nodes[srcIdx].id, dag.nodes[tgtIdx].id);
  });

  // Fallback: reassign agent (always works if there are nodes)
  attempts.push(() => {
    if (dag.nodes.length === 0) return noOp(dag, 'reassign_agent', 'No nodes');
    const node = dag.nodes[Math.floor(rng() * dag.nodes.length)];
    const newAgent = agentPool[Math.floor(rng() * agentPool.length)];
    return reassignAgent(dag, node.id, newAgent);
  });

  for (const attempt of attempts) {
    const result = attempt();
    if (result.applied) return result;
  }

  return noOp(dag, 'add_node', 'All mutation attempts failed');
}
