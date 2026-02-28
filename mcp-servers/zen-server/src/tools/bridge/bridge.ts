/**
 * Bridge pure functions — deduplication, matching, filtering.
 * No I/O — operates on in-memory data.
 */

import type { BridgeMemory, SearchResult, CategorySummary } from "./types.js";

/**
 * Deduplicate memories by ID — keeps first occurrence.
 */
export function deduplicateMemories(memories: BridgeMemory[]): BridgeMemory[] {
  const seen = new Set<string>();
  const result: BridgeMemory[] = [];
  for (const m of memories) {
    if (!seen.has(m.id)) {
      seen.add(m.id);
      result.push(m);
    }
  }
  return result;
}

/**
 * Find memories matching a query string (content or tags).
 */
export function matchMemories(
  memories: BridgeMemory[],
  query: string,
): Array<{ memory: BridgeMemory; matchType: "content" | "tag" }> {
  const q = query.toLowerCase();
  const results: Array<{ memory: BridgeMemory; matchType: "content" | "tag" }> = [];

  for (const memory of memories) {
    if (memory.content.toLowerCase().includes(q)) {
      results.push({ memory, matchType: "content" });
    } else if (memory.tags.some((t) => t.toLowerCase().includes(q))) {
      results.push({ memory, matchType: "tag" });
    }
  }

  return results;
}

/**
 * Filter memories by category.
 */
export function filterByCategory(
  memoriesByCategory: Map<string, BridgeMemory[]>,
  category: string,
): BridgeMemory[] {
  return memoriesByCategory.get(category) || [];
}

/**
 * Filter memories by project.
 */
export function filterByProject(
  memories: BridgeMemory[],
  project: string,
): BridgeMemory[] {
  return memories.filter((m) => m.project === project);
}

/**
 * Sort search results: content matches first, then by confidence.
 */
export function sortSearchResults(results: SearchResult[]): SearchResult[] {
  const confidenceOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  return [...results].sort((a, b) => {
    if (a.matchType !== b.matchType) return a.matchType === "content" ? -1 : 1;
    return (confidenceOrder[a.memory.confidence] ?? 2) - (confidenceOrder[b.memory.confidence] ?? 2);
  });
}

/**
 * Build category summaries.
 */
export function buildCategorySummaries(
  memoriesByCategory: Map<string, BridgeMemory[]>,
): CategorySummary[] {
  const summaries: CategorySummary[] = [];
  for (const [category, memories] of memoriesByCategory) {
    summaries.push({
      category,
      count: memories.length,
      preview: memories.slice(0, 3).map((m) =>
        m.content.length > 70 ? m.content.slice(0, 70) + "..." : m.content,
      ),
    });
  }
  return summaries;
}

/**
 * Map numeric confidence to label.
 */
export function confidenceLabel(score: number): "high" | "medium" | "low" {
  if (score >= 0.7) return "high";
  if (score >= 0.4) return "medium";
  return "low";
}
