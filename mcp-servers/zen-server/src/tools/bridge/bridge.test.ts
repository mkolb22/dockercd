import { describe, it, expect } from "vitest";
import {
  deduplicateMemories,
  matchMemories,
  filterByCategory,
  filterByProject,
  sortSearchResults,
  buildCategorySummaries,
  confidenceLabel,
} from "./bridge.js";
import type { BridgeMemory, SearchResult } from "./types.js";

function makeMem(id: string, overrides: Partial<BridgeMemory> = {}): BridgeMemory {
  return {
    id,
    content: `Memory ${id} content`,
    confidence: "medium",
    source: "test",
    tags: ["tag1"],
    created_at: "2026-02-15T10:00:00Z",
    ...overrides,
  };
}

describe("deduplicateMemories", () => {
  it("removes duplicates by ID", () => {
    const mems = [makeMem("a"), makeMem("b"), makeMem("a")];
    const deduped = deduplicateMemories(mems);
    expect(deduped).toHaveLength(2);
    expect(deduped.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("preserves order (first occurrence)", () => {
    const mems = [makeMem("c"), makeMem("a"), makeMem("b"), makeMem("a")];
    expect(deduplicateMemories(mems).map((m) => m.id)).toEqual(["c", "a", "b"]);
  });

  it("handles empty array", () => {
    expect(deduplicateMemories([])).toHaveLength(0);
  });
});

describe("matchMemories", () => {
  it("matches by content", () => {
    const mems = [makeMem("a", { content: "Use TypeScript for type safety" }), makeMem("b", { content: "Python is great" })];
    const results = matchMemories(mems, "typescript");
    expect(results).toHaveLength(1);
    expect(results[0].matchType).toBe("content");
  });

  it("matches by tag", () => {
    const mems = [makeMem("a", { tags: ["typescript", "testing"] })];
    const results = matchMemories(mems, "testing");
    expect(results).toHaveLength(1);
    expect(results[0].matchType).toBe("tag");
  });

  it("prefers content match over tag match", () => {
    const mems = [makeMem("a", { content: "testing is important", tags: ["testing"] })];
    const results = matchMemories(mems, "testing");
    expect(results).toHaveLength(1);
    expect(results[0].matchType).toBe("content");
  });

  it("is case insensitive", () => {
    const mems = [makeMem("a", { content: "TypeScript PATTERNS" })];
    expect(matchMemories(mems, "typescript patterns")).toHaveLength(1);
  });

  it("returns empty for no matches", () => {
    expect(matchMemories([makeMem("a")], "nonexistent")).toHaveLength(0);
  });
});

describe("filterByCategory", () => {
  it("returns memories for matching category", () => {
    const map = new Map([["patterns", [makeMem("a"), makeMem("b")]], ["architecture", [makeMem("c")]]]);
    expect(filterByCategory(map, "patterns")).toHaveLength(2);
  });

  it("returns empty for unknown category", () => {
    const map = new Map([["patterns", [makeMem("a")]]]);
    expect(filterByCategory(map, "workflows")).toHaveLength(0);
  });
});

describe("filterByProject", () => {
  it("filters by project name", () => {
    const mems = [makeMem("a", { project: "bodhi" }), makeMem("b", { project: "zen" }), makeMem("c")];
    expect(filterByProject(mems, "bodhi")).toHaveLength(1);
    expect(filterByProject(mems, "bodhi")[0].id).toBe("a");
  });
});

describe("sortSearchResults", () => {
  it("content matches come before tag matches", () => {
    const results: SearchResult[] = [
      { memory: makeMem("a"), category: "patterns", matchType: "tag" },
      { memory: makeMem("b"), category: "patterns", matchType: "content" },
    ];
    const sorted = sortSearchResults(results);
    expect(sorted[0].matchType).toBe("content");
    expect(sorted[1].matchType).toBe("tag");
  });

  it("sorts by confidence within same match type", () => {
    const results: SearchResult[] = [
      { memory: makeMem("a", { confidence: "low" }), category: "p", matchType: "content" },
      { memory: makeMem("b", { confidence: "high" }), category: "p", matchType: "content" },
    ];
    const sorted = sortSearchResults(results);
    expect(sorted[0].memory.confidence).toBe("high");
  });
});

describe("buildCategorySummaries", () => {
  it("builds summaries from category map", () => {
    const map = new Map([["patterns", [makeMem("a"), makeMem("b"), makeMem("c"), makeMem("d")]]]);
    const summaries = buildCategorySummaries(map);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].category).toBe("patterns");
    expect(summaries[0].count).toBe(4);
    expect(summaries[0].preview).toHaveLength(3);
  });

  it("truncates long content in preview", () => {
    const longContent = "x".repeat(100);
    const map = new Map([["patterns", [makeMem("a", { content: longContent })]]]);
    const summaries = buildCategorySummaries(map);
    expect(summaries[0].preview[0].length).toBeLessThan(longContent.length);
    expect(summaries[0].preview[0]).toContain("...");
  });
});

describe("confidenceLabel", () => {
  it("maps numeric scores to labels", () => {
    expect(confidenceLabel(0.9)).toBe("high");
    expect(confidenceLabel(0.7)).toBe("high");
    expect(confidenceLabel(0.5)).toBe("medium");
    expect(confidenceLabel(0.4)).toBe("medium");
    expect(confidenceLabel(0.2)).toBe("low");
    expect(confidenceLabel(0)).toBe("low");
  });
});
