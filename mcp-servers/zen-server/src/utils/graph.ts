/**
 * Generic BFS Graph Traversal
 * Shared graph traversal utility used by memory store
 */

export interface BfsOptions<TNode, TEdge> {
  /** Get node data by ID. Return null to skip the node. */
  getNode: (id: string) => TNode | null;
  /** Get edges for a node ID */
  getEdges: (id: string) => TEdge[];
  /** Extract neighbor IDs from an edge given the current node ID */
  getNeighborId: (edge: TEdge, currentId: string) => string;
  /** Maximum BFS depth */
  maxDepth: number;
  /** Maximum nodes to return */
  maxNodes: number;
}

export interface BfsResult<TNode, TEdge> {
  node: TNode;
  depth: number;
  edges: TEdge[];
}

/**
 * BFS traversal from one or more seed IDs.
 */
export function bfsTraverse<TNode, TEdge>(
  seedIds: string[],
  options: BfsOptions<TNode, TEdge>,
): BfsResult<TNode, TEdge>[] {
  const { getNode, getEdges, getNeighborId, maxDepth, maxNodes } = options;
  const visited = new Set<string>();
  const result: BfsResult<TNode, TEdge>[] = [];
  const queue: Array<{ id: string; depth: number }> = seedIds.map(id => ({ id, depth: 0 }));

  while (queue.length > 0 && result.length < maxNodes) {
    const { id, depth } = queue.shift()!;

    if (visited.has(id) || depth > maxDepth) continue;
    visited.add(id);

    const node = getNode(id);
    if (!node) continue;

    const edges = getEdges(id);
    result.push({ node, depth, edges });

    for (const edge of edges) {
      const neighborId = getNeighborId(edge, id);
      if (!visited.has(neighborId)) {
        queue.push({ id: neighborId, depth: depth + 1 });
      }
    }
  }

  return result;
}
