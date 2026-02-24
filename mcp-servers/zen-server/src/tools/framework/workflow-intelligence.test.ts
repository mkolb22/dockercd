/**
 * Workflow Intelligence Tests
 * Tests for memory-informed workflow planning and outcome recording
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  recordWorkflowOutcome,
  recallSimilarWorkflows,
  getFailureHints,
  computeSemanticSignal,
} from "./workflow-intelligence.js";

// Mock config
vi.mock("../../core/config.js", () => ({
  config: () => ({
    memoryEnabled: true,
    memoryDbPath: ":memory:",
  }),
}));

// Mock the shared embedder
const mockEmbed = vi.fn().mockResolvedValue(new Array(384).fill(0.1));
vi.mock("../../utils/embedder.js", () => ({
  getSharedEmbedder: () => ({
    embed: mockEmbed,
  }),
}));

// Mock MemoryStore
const mockInsertMemory = vi.fn().mockReturnValue("mem-test-123");
const mockInsertEmbedding = vi.fn();
const mockSearchByEmbedding = vi.fn().mockReturnValue([]);

vi.mock("../memory/store.js", () => ({
  MemoryStore: vi.fn().mockImplementation(() => ({
    insertMemory: mockInsertMemory,
    insertEmbedding: mockInsertEmbedding,
    searchByEmbedding: mockSearchByEmbedding,
  })),
}));

describe("workflow-intelligence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchByEmbedding.mockReturnValue([]);
  });

  describe("recordWorkflowOutcome", () => {
    it("stores a workflow outcome as episodic memory", async () => {
      const result = await recordWorkflowOutcome(
        "add OAuth authentication",
        "feature",
        "medium",
        "completed",
        [
          { concept: "story", outcome: "success", durationMs: 5000 },
          { concept: "implementation", outcome: "success", durationMs: 15000 },
        ],
        20000,
      );

      expect(result).toBe("mem-test-123");
      expect(mockInsertMemory).toHaveBeenCalledOnce();
      const call = mockInsertMemory.mock.calls[0][0];
      expect(call.type).toBe("episodic");
      expect(call.category).toBe("workflow-outcome");
      expect(call.tags).toContain("workflow");
      expect(call.tags).toContain("feature");
      expect(call.tags).toContain("completed");

      // Should have embedded the task
      expect(mockEmbed).toHaveBeenCalledWith("add OAuth authentication");
      expect(mockInsertEmbedding).toHaveBeenCalledWith("mem-test-123", expect.any(Array));
    });

    it("stores structured JSON content", async () => {
      await recordWorkflowOutcome("test task", "bugfix", "small", "completed", [], 1000);

      const content = JSON.parse(mockInsertMemory.mock.calls[0][0].content);
      expect(content.task).toBe("test task");
      expect(content.taskType).toBe("bugfix");
      expect(content.complexity).toBe("small");
      expect(content.outcome).toBe("completed");
      expect(content.totalDurationMs).toBe(1000);
    });

    it("handles embedding failure gracefully", async () => {
      mockEmbed.mockRejectedValueOnce(new Error("embedding failed"));

      const result = await recordWorkflowOutcome("test", "feature", "small", "completed", [], 500);
      // Should still return the memory ID (memory was stored, embedding just failed)
      expect(result).toBe("mem-test-123");
    });
  });

  describe("recallSimilarWorkflows", () => {
    it("returns empty insight when no similar workflows found", async () => {
      mockSearchByEmbedding.mockReturnValue([]);

      const insight = await recallSimilarWorkflows("add user profiles");

      expect(insight.similarTasks).toHaveLength(0);
      expect(insight.suggestedComplexity).toBeNull();
      expect(insight.reasoning).toBe("");
    });

    it("returns similar tasks with parsed data", async () => {
      mockSearchByEmbedding.mockReturnValue([
        {
          memory: {
            id: "mem-1",
            content: JSON.stringify({
              task: "add OAuth",
              taskType: "feature",
              complexity: "medium",
              outcome: "completed",
              totalDurationMs: 30000,
            }),
          },
          similarity: 0.85,
        },
        {
          memory: {
            id: "mem-2",
            content: JSON.stringify({
              task: "add API key auth",
              taskType: "feature",
              complexity: "medium",
              outcome: "completed",
              totalDurationMs: 25000,
            }),
          },
          similarity: 0.78,
        },
      ]);

      const insight = await recallSimilarWorkflows("add JWT authentication");

      expect(insight.similarTasks).toHaveLength(2);
      expect(insight.similarTasks[0].task).toBe("add OAuth");
      expect(insight.similarTasks[0].similarity).toBe(0.85);
    });

    it("suggests complexity when >=2 similar tasks agree", async () => {
      mockSearchByEmbedding.mockReturnValue([
        {
          memory: {
            id: "mem-1",
            content: JSON.stringify({
              task: "t1", taskType: "feature", complexity: "large",
              outcome: "completed", totalDurationMs: 30000,
            }),
          },
          similarity: 0.9,
        },
        {
          memory: {
            id: "mem-2",
            content: JSON.stringify({
              task: "t2", taskType: "feature", complexity: "large",
              outcome: "completed", totalDurationMs: 25000,
            }),
          },
          similarity: 0.8,
        },
      ]);

      const insight = await recallSimilarWorkflows("another big task");

      expect(insight.suggestedComplexity).toBe("large");
      expect(insight.reasoning).toContain("2 of 2");
    });

    it("skips unparseable memories", async () => {
      mockSearchByEmbedding.mockReturnValue([
        { memory: { id: "mem-bad", content: "not json" }, similarity: 0.9 },
      ]);

      const insight = await recallSimilarWorkflows("test");
      expect(insight.similarTasks).toHaveLength(0);
    });

    it("respects timeout", async () => {
      // Make embed take longer than the timeout
      mockEmbed.mockImplementationOnce(() => new Promise(resolve => setTimeout(() => resolve(new Array(384).fill(0.1)), 1000)));

      const insight = await recallSimilarWorkflows("test", 50);
      // Should return empty fallback due to timeout
      expect(insight.similarTasks).toHaveLength(0);
    });
  });

  describe("getFailureHints", () => {
    it("returns empty hints when no past failures found", async () => {
      mockSearchByEmbedding.mockReturnValue([]);

      const hints = await getFailureHints("test task", "implementation");

      expect(hints.pastFailures).toHaveLength(0);
      expect(hints.suggestion).toBe("");
    });

    it("finds past failures at the same step", async () => {
      mockSearchByEmbedding.mockReturnValue([
        {
          memory: {
            id: "mem-f1",
            content: JSON.stringify({
              task: "similar task",
              taskType: "feature",
              complexity: "medium",
              outcome: "failed",
              steps: [
                { concept: "story", outcome: "success", durationMs: 5000 },
                { concept: "implementation", outcome: "failed", durationMs: 10000 },
              ],
              totalDurationMs: 15000,
            }),
          },
          similarity: 0.75,
        },
      ]);

      const hints = await getFailureHints("my task", "implementation");

      expect(hints.pastFailures).toHaveLength(1);
      expect(hints.pastFailures[0].failedStep).toBe("implementation");
      expect(hints.suggestion).toContain("implementation");
    });

    it("ignores successful workflows", async () => {
      mockSearchByEmbedding.mockReturnValue([
        {
          memory: {
            id: "mem-s1",
            content: JSON.stringify({
              task: "successful task",
              taskType: "feature",
              complexity: "medium",
              outcome: "completed",
              steps: [
                { concept: "implementation", outcome: "success", durationMs: 10000 },
              ],
              totalDurationMs: 10000,
            }),
          },
          similarity: 0.85,
        },
      ]);

      const hints = await getFailureHints("my task", "implementation");
      expect(hints.pastFailures).toHaveLength(0);
    });
  });

  describe("computeSemanticSignal", () => {
    it("returns null when no relevant memories found", async () => {
      mockSearchByEmbedding.mockReturnValue([]);

      const signal = await computeSemanticSignal("test query");
      expect(signal).toBeNull();
    });

    it("returns weighted score from past workflow complexities", async () => {
      mockSearchByEmbedding.mockReturnValue([
        {
          memory: {
            id: "mem-1",
            content: JSON.stringify({ complexity: "large" }),
          },
          similarity: 0.9,
        },
        {
          memory: {
            id: "mem-2",
            content: JSON.stringify({ complexity: "medium" }),
          },
          similarity: 0.7,
        },
      ]);

      const signal = await computeSemanticSignal("complex architecture task");

      expect(signal).not.toBeNull();
      expect(signal!.score).toBeGreaterThan(5); // large=8, medium=5, weighted toward large
      expect(signal!.confidence).toBeGreaterThan(0);
      expect(signal!.confidence).toBeLessThanOrEqual(1);
    });

    it("maps complexity to difficulty correctly", async () => {
      mockSearchByEmbedding.mockReturnValue([
        {
          memory: { id: "m1", content: JSON.stringify({ complexity: "small" }) },
          similarity: 1.0,
        },
      ]);

      const signal = await computeSemanticSignal("simple task");
      expect(signal).not.toBeNull();
      expect(signal!.score).toBe(2); // small maps to 2
    });

    it("respects timeout", async () => {
      mockEmbed.mockImplementationOnce(() => new Promise(resolve => setTimeout(() => resolve(new Array(384).fill(0.1)), 1000)));

      const signal = await computeSemanticSignal("test", 50);
      expect(signal).toBeNull(); // Should return null fallback
    });
  });
});
