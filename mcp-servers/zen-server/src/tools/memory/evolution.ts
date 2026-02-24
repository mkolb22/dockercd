/**
 * Memory Evolution
 * Confidence updates and auto-linking
 */

import type { MemoryStore } from "./store.js";
import type { Memory, RelationshipType, EvolveOptions } from "./types.js";
import { cosineSimilarity, bytesToNumberArray } from "../../utils/vectors.js";

/**
 * Apply confidence evolution based on relationship type
 */
export function evolveConfidence(
  currentConfidence: number,
  relationship: RelationshipType
): number {
  switch (relationship) {
    case "supports":
      // Diminishing returns: gain 20% of remaining headroom
      return Math.min(1.0, currentConfidence + (1.0 - currentConfidence) * 0.2);

    case "contradicts":
      // Penalty: lose 30% of current confidence
      return Math.max(0, currentConfidence - 0.3);

    case "extends":
      // Small boost for extension
      return Math.min(1.0, currentConfidence + 0.1);

    case "supersedes":
      // Mark as outdated (but not deleted)
      return 0.1;

    case "related":
      // No confidence change for general relations
      return currentConfidence;

    default:
      return currentConfidence;
  }
}

/**
 * Evolve a memory with new evidence
 */
export async function evolveMemory(
  store: MemoryStore,
  options: EvolveOptions,
  embedFn: (text: string) => Promise<number[]>
): Promise<{ oldConfidence: number; newConfidence: number; linked: boolean }> {
  const memory = store.getMemory(options.memoryId);
  if (!memory) {
    throw new Error(`Memory not found: ${options.memoryId}`);
  }

  const oldConfidence = memory.confidence;
  const newConfidence = evolveConfidence(oldConfidence, options.relationship);

  // Handle content changes for "extends"
  let newContent = memory.content;
  if (options.relationship === "extends") {
    const timestamp = new Date().toISOString();
    newContent = `${memory.content}\n\n--- Extended ${timestamp} ---\n${options.newEvidence}`;

    // Re-embed extended content
    const newEmbedding = await embedFn(newContent);
    store.insertEmbedding(memory.id, newEmbedding);
  }

  // Update memory
  store.updateMemory(memory.id, {
    content: options.relationship === "extends" ? newContent : undefined,
    confidence: newConfidence,
  });

  // Log evolution
  store.logEvolution({
    memoryId: memory.id,
    action: "evolved",
    relationship: options.relationship,
    oldConfidence,
    newConfidence,
    oldContent: options.relationship === "extends" ? memory.content : undefined,
    newContent: options.relationship === "extends" ? newContent : undefined,
    evidence: options.newEvidence,
  });

  // Create link to evidence if we stored it as a new memory
  // (caller handles this typically)

  return { oldConfidence, newConfidence, linked: false };
}

/**
 * Auto-link similar memories on store
 */
export async function autoLink(
  store: MemoryStore,
  memoryId: string,
  embedding: number[],
  threshold: number = 0.4,
  maxLinks: number = 5
): Promise<number> {
  // Get all non-archived memories with embeddings
  const candidates = store.getAllEmbeddings(memoryId);

  const similarities: Array<{ id: string; similarity: number }> = [];

  for (const row of candidates) {
    const otherEmbedding = bytesToNumberArray(row.embedding);
    const similarity = cosineSimilarity(embedding, otherEmbedding);

    if (similarity >= threshold) {
      similarities.push({ id: row.memory_id, similarity });
    }
  }

  // Sort by similarity and take top N
  similarities.sort((a, b) => b.similarity - a.similarity);
  const topSimilar = similarities.slice(0, maxLinks);

  // Create links
  let created = 0;
  for (const { id, similarity } of topSimilar) {
    const linkId = store.createLink(memoryId, id, "related", similarity, true);
    if (linkId) created++;
  }

  return created;
}

/**
 * Find memories that support or contradict a given memory
 */
export function findRelatedEvidence(
  store: MemoryStore,
  memoryId: string,
  relationship: "supports" | "contradicts"
): Memory[] {
  const links = store.getLinks(memoryId);
  const relatedIds = links
    .filter(l => l.relationship === relationship)
    .map(l => (l.sourceId === memoryId ? l.targetId : l.sourceId));

  const memories: Memory[] = [];
  for (const id of relatedIds) {
    const memory = store.getMemory(id);
    if (memory && !memory.archived) {
      memories.push(memory);
    }
  }

  return memories;
}

/**
 * Calculate memory health score
 */
export function calculateHealthScore(memory: Memory): number {
  let score = 0;

  // Confidence contributes 40%
  score += memory.confidence * 0.4;

  // Recency contributes 30%
  const daysSinceAccess = (Date.now() - new Date(memory.lastAccessed).getTime()) / (1000 * 60 * 60 * 24);
  const recencyScore = Math.max(0, 1 - daysSinceAccess / 30); // Decays over 30 days
  score += recencyScore * 0.3;

  // Access count contributes 20%
  const accessScore = Math.min(1, memory.accessCount / 10);
  score += accessScore * 0.2;

  // Not archived contributes 10%
  score += memory.archived ? 0 : 0.1;

  return score;
}
