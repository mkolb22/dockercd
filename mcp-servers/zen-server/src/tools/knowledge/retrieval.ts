/**
 * Hybrid Retrieval
 * Multi-signal search combining semantic, keyword, graph, and community
 */

import type { KnowledgeStore } from "./store.js";
import type { QueryResult, QueryOptions } from "./types.js";

/**
 * Default weights for signal fusion
 */
export const DEFAULT_WEIGHTS = {
  semantic: 0.4,
  keyword: 0.3,
  graph: 0.2,
  community: 0.1,
};

/**
 * Compute graph proximity scores using BFS decay
 */
function computeGraphScores(
  store: KnowledgeStore,
  seedIds: string[],
  maxDepth: number = 2
): Map<string, number> {
  const scores = new Map<string, number>();
  const visited = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = seedIds.map(id => ({ id, depth: 0 }));

  // Seed entities get max score
  for (const id of seedIds) {
    scores.set(id, 1.0);
  }

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;

    if (visited.has(id) || depth > maxDepth) continue;
    visited.add(id);

    const relations = store.getRelations(id);
    const decayFactor = 1 / (depth + 1); // Score decays with distance

    for (const rel of relations) {
      const neighborId = rel.sourceId === id ? rel.targetId : rel.sourceId;

      if (!visited.has(neighborId)) {
        const neighborScore = decayFactor * rel.weight;
        const existing = scores.get(neighborId) || 0;
        scores.set(neighborId, Math.max(existing, neighborScore));
        queue.push({ id: neighborId, depth: depth + 1 });
      }
    }
  }

  return scores;
}

/**
 * Compute community boost scores
 */
function computeCommunityScores(
  store: KnowledgeStore,
  resultIds: string[]
): Map<string, number> {
  const scores = new Map<string, number>();

  // Get communities for all result entities
  const communityCounts = new Map<string, string[]>(); // community -> entity IDs

  for (const id of resultIds) {
    const community = store.findCommunityForEntity(id);
    if (community) {
      if (!communityCounts.has(community.id)) {
        communityCounts.set(community.id, []);
      }
      communityCounts.get(community.id)!.push(id);
    }
  }

  // Entities in same community as other results get a boost
  for (const [communityId, memberIds] of communityCounts) {
    if (memberIds.length > 1) {
      const boost = 1 / memberIds.length; // Distribute boost
      for (const id of memberIds) {
        scores.set(id, (scores.get(id) || 0) + boost);
      }
    }
  }

  return scores;
}

/**
 * Normalize scores to 0-1 range
 */
function normalizeScores(results: QueryResult[], field: "semanticScore" | "keywordScore" | "graphScore" | "communityScore"): void {
  const scores = results.map(r => r[field]);
  const max = Math.max(...scores, 0.001); // Avoid division by zero

  for (const result of results) {
    result[field] = result[field] / max;
  }
}

/**
 * Fuse multiple signals into final ranking
 */
function fuseSignals(
  results: QueryResult[],
  weights: typeof DEFAULT_WEIGHTS
): QueryResult[] {
  for (const result of results) {
    result.finalScore =
      weights.semantic * result.semanticScore +
      weights.keyword * result.keywordScore +
      weights.graph * result.graphScore +
      weights.community * result.communityScore;
  }

  // Sort by final score
  results.sort((a, b) => b.finalScore - a.finalScore);
  return results;
}

/**
 * Hybrid search combining all signals
 */
export function hybridSearch(
  store: KnowledgeStore,
  query: string,
  queryEmbedding: number[],
  options: QueryOptions = {}
): QueryResult[] {
  const weights = options.weights || DEFAULT_WEIGHTS;
  const limit = options.limit || 20;

  // Collect results from different sources
  const resultMap = new Map<string, QueryResult>();

  // 1. Semantic search
  const semanticResults = store.searchSemantic(queryEmbedding, {
    ...options,
    limit: limit * 2,
  });

  for (const result of semanticResults) {
    resultMap.set(result.entity.id, result);
  }

  // 2. Keyword search
  const keywordResults = store.searchKeyword(query, {
    ...options,
    limit: limit * 2,
  });

  for (const result of keywordResults) {
    if (resultMap.has(result.entity.id)) {
      resultMap.get(result.entity.id)!.keywordScore = result.keywordScore;
    } else {
      resultMap.set(result.entity.id, result);
    }
  }

  // 3. Graph proximity scores
  const semanticIds = semanticResults.slice(0, 5).map(r => r.entity.id);
  const graphScores = computeGraphScores(store, semanticIds);

  for (const [id, score] of graphScores) {
    if (resultMap.has(id)) {
      resultMap.get(id)!.graphScore = score;
    }
  }

  // 4. Community boost
  const allIds = Array.from(resultMap.keys());
  const communityScores = computeCommunityScores(store, allIds);

  for (const [id, score] of communityScores) {
    if (resultMap.has(id)) {
      resultMap.get(id)!.communityScore = score;
    }
  }

  // Convert to array
  const results = Array.from(resultMap.values());

  // Normalize each signal
  normalizeScores(results, "semanticScore");
  normalizeScores(results, "keywordScore");
  normalizeScores(results, "graphScore");
  normalizeScores(results, "communityScore");

  // Fuse and rank
  const fused = fuseSignals(results, weights);

  return fused.slice(0, limit);
}

/**
 * Simple semantic-only search
 */
export function semanticOnlySearch(
  store: KnowledgeStore,
  queryEmbedding: number[],
  options: QueryOptions = {}
): QueryResult[] {
  return store.searchSemantic(queryEmbedding, options);
}

/**
 * Simple keyword-only search
 */
export function keywordOnlySearch(
  store: KnowledgeStore,
  query: string,
  options: QueryOptions = {}
): QueryResult[] {
  return store.searchKeyword(query, options);
}
