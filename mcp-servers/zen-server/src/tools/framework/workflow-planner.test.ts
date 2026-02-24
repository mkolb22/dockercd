/**
 * Workflow Planner Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { planWorkflow } from "./workflow-planner.js";

// Mock the content loader to avoid filesystem dependency in planner tests
vi.mock("./content-loader.js", () => {
  const mockLoader = {
    get: () => null,
    getAll: () => [],
    search: () => [],
    getSkillsForAgent: () => [],
    getStatus: () => ({
      contentRoot: "/mock",
      loaded: true,
      loadedAt: new Date().toISOString(),
      counts: { concept: 0, command: 0, agent: 0, skill: 0 },
      items: { concept: [], command: [], agent: [], skill: [] },
    }),
    reload: () => {},
  };

  return {
    getContentLoader: () => mockLoader,
    ContentLoader: vi.fn(),
  };
});

// Mock workflow intelligence to avoid SQLite/embedder dependency
vi.mock("./workflow-intelligence.js", () => ({
  recallSimilarWorkflows: vi.fn().mockResolvedValue({
    similarTasks: [],
    suggestedComplexity: null,
    reasoning: "",
  }),
}));

describe("planWorkflow", () => {
  describe("task classification", () => {
    it("should classify bugfix tasks", async () => {
      const plan = await planWorkflow("fix the login bug");
      expect(plan.taskType).toBe("bugfix");
    });

    it("should classify error-related tasks as bugfix", async () => {
      const plan = await planWorkflow("resolve the authentication error");
      expect(plan.taskType).toBe("bugfix");
    });

    it("should classify documentation tasks", async () => {
      const plan = await planWorkflow("document the API endpoints");
      expect(plan.taskType).toBe("docs");
    });

    it("should classify refactoring tasks", async () => {
      const plan = await planWorkflow("refactor the database layer");
      expect(plan.taskType).toBe("refactor");
    });

    it("should default to feature for unrecognized tasks", async () => {
      const plan = await planWorkflow("add user authentication");
      expect(plan.taskType).toBe("feature");
    });
  });

  describe("complexity estimation", () => {
    it("should estimate small for simple tasks", async () => {
      const plan = await planWorkflow("fix a simple typo");
      expect(plan.complexity).toBe("small");
    });

    it("should estimate large for system-level tasks", async () => {
      const plan = await planWorkflow("redesign the system architecture for microservices migration");
      expect(plan.complexity).toBe("large");
    });

    it("should estimate medium for average tasks", async () => {
      const plan = await planWorkflow("add a new REST endpoint for user profiles with validation");
      expect(plan.complexity).toBe("medium");
    });
  });

  describe("workflow generation", () => {
    it("should generate simplified workflow for small bugfix", async () => {
      const plan = await planWorkflow("fix a simple typo in the header");
      expect(plan.taskType).toBe("bugfix");
      expect(plan.complexity).toBe("small");
      // Small bugfix should skip story, architecture, and version
      expect(plan.steps.some((s) => s.concept === "implementation")).toBe(true);
      expect(plan.steps.some((s) => s.concept === "quality")).toBe(true);
      expect(plan.skippedSteps.some((s) => s.concept === "story")).toBe(true);
      expect(plan.skippedSteps.some((s) => s.concept === "architecture")).toBe(true);
    });

    it("should generate full workflow for large feature", async () => {
      const plan = await planWorkflow("design new authentication system with OAuth and JWT");
      expect(plan.taskType).toBe("feature");
      expect(plan.complexity).toBe("large");
      expect(plan.steps.some((s) => s.concept === "story")).toBe(true);
      expect(plan.steps.some((s) => s.concept === "architecture")).toBe(true);
      expect(plan.steps.some((s) => s.concept === "implementation")).toBe(true);
      expect(plan.steps.some((s) => s.concept === "quality")).toBe(true);
      expect(plan.steps.some((s) => s.concept === "security")).toBe(true);
    });

    it("should generate docs-only workflow", async () => {
      const plan = await planWorkflow("document the API");
      expect(plan.taskType).toBe("docs");
      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0].concept).toBe("documentation");
    });

    it("should include step ordering", async () => {
      const plan = await planWorkflow("add user profiles feature");
      for (let i = 0; i < plan.steps.length; i++) {
        expect(plan.steps[i].order).toBe(i + 1);
      }
    });

    it("should assign correct models", async () => {
      const plan = await planWorkflow("design new system architecture and implement it");
      const archStep = plan.steps.find((s) => s.concept === "architecture");
      if (archStep) {
        expect(archStep.model).toBe("opus");
      }
      const implStep = plan.steps.find((s) => s.concept === "implementation");
      if (implStep) {
        expect(implStep.model).toBe("sonnet");
      }
    });
  });

  describe("cost estimation", () => {
    it("should calculate total cost", async () => {
      const plan = await planWorkflow("add a new feature");
      expect(plan.totalEstimatedCost).toBeGreaterThan(0);
      const summedCost = plan.steps.reduce((sum, s) => sum + s.estimatedCost, 0);
      expect(plan.totalEstimatedCost).toBeCloseTo(summedCost, 3);
    });
  });

  describe("reasoning", () => {
    it("should include reasoning text", async () => {
      const plan = await planWorkflow("fix the login bug");
      expect(plan.reasoning).toContain("bugfix");
      expect(plan.reasoning.length).toBeGreaterThan(10);
    });

    it("should mention skipped steps when applicable", async () => {
      const plan = await planWorkflow("fix a simple typo");
      expect(plan.reasoning).toContain("Skipping");
    });
  });
});
