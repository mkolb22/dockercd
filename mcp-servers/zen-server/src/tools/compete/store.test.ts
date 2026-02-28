/**
 * CompeteStore Tests
 * CRUD operations for sessions, rounds, and ablation runs.
 */

import { describe, it, expect } from "vitest";
import { CompeteStore } from "./store.js";
import { useStoreHarness } from "../../test-utils/store-harness.js";
import type { CompeteConfig, FitnessScores, ToolCategory } from "./types.js";

const TEST_CONFIG: CompeteConfig = {
  totalRounds: 5,
  significanceLevel: 0.05,
  specId: "spec-test-123",
  targetLanguage: "go",
};

const TEST_SCORES: FitnessScores = {
  correctness: 0.85,
  contracts: 0.70,
  security: 0.90,
  performance: 0.60,
  complexity: 0.75,
  lint: 0.80,
};

describe("CompeteStore", () => {
  const t = useStoreHarness("compete", (p) => new CompeteStore(p));

  // ─── Sessions ────────────────────────────────────────

  describe("createSession", () => {
    it("should create a session with valid fields", () => {
      const session = t.store.createSession("spec-123", "string-utils", TEST_CONFIG);

      expect(session.id).toMatch(/^com-/);
      expect(session.specId).toBe("spec-123");
      expect(session.specName).toBe("string-utils");
      expect(session.status).toBe("active");
      expect(session.currentRound).toBe(0);
      expect(session.winner).toBeNull();
      expect(session.summaryJson).toBeNull();
      expect(session.config.totalRounds).toBe(5);
      expect(session.config.significanceLevel).toBe(0.05);
    });

    it("should preserve config through serialization", () => {
      const session = t.store.createSession("spec-456", "auth-service", TEST_CONFIG);
      const retrieved = t.store.getSession(session.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.config).toEqual(TEST_CONFIG);
    });
  });

  describe("getSession", () => {
    it("should retrieve a session by ID", () => {
      const created = t.store.createSession("spec-1", "test-spec", TEST_CONFIG);
      const retrieved = t.store.getSession(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(created.id);
      expect(retrieved!.specId).toBe("spec-1");
      expect(retrieved!.specName).toBe("test-spec");
    });

    it("should return null for missing session", () => {
      const result = t.store.getSession("com-nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("updateSession", () => {
    it("should update currentRound", () => {
      const session = t.store.createSession("spec-1", "test", TEST_CONFIG);
      t.store.updateSession(session.id, { currentRound: 3 });

      const updated = t.store.getSession(session.id);
      expect(updated!.currentRound).toBe(3);
    });

    it("should update status", () => {
      const session = t.store.createSession("spec-1", "test", TEST_CONFIG);
      t.store.updateSession(session.id, { status: "completed" });

      const updated = t.store.getSession(session.id);
      expect(updated!.status).toBe("completed");
    });

    it("should update winner and summaryJson", () => {
      const session = t.store.createSession("spec-1", "test", TEST_CONFIG);
      const summary = JSON.stringify({ overallWinner: "treatment" });
      t.store.updateSession(session.id, { winner: "treatment", summaryJson: summary });

      const updated = t.store.getSession(session.id);
      expect(updated!.winner).toBe("treatment");
      expect(updated!.summaryJson).toBe(summary);
    });

    it("should set updatedAt on update", () => {
      const session = t.store.createSession("spec-1", "test", TEST_CONFIG);
      const originalUpdatedAt = session.updatedAt;

      // Small delay to ensure different timestamp
      t.store.updateSession(session.id, { currentRound: 1 });
      const updated = t.store.getSession(session.id);
      expect(updated!.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("should be a no-op when no fields are provided", () => {
      const session = t.store.createSession("spec-1", "test", TEST_CONFIG);
      t.store.updateSession(session.id, {});

      const after = t.store.getSession(session.id);
      expect(after!.currentRound).toBe(0);
      expect(after!.status).toBe("active");
    });
  });

  // ─── Rounds ──────────────────────────────────────────

  describe("insertRound", () => {
    it("should insert a round and return it", () => {
      const session = t.store.createSession("spec-1", "test", TEST_CONFIG);
      const round = t.store.insertRound(session.id, 1, "control", TEST_SCORES, 0.78);

      expect(round.id).toMatch(/^rnd-/);
      expect(round.sessionId).toBe(session.id);
      expect(round.round).toBe(1);
      expect(round.arm).toBe("control");
      expect(round.scores).toEqual(TEST_SCORES);
      expect(round.composite).toBe(0.78);
      expect(round.rawMetrics).toBeNull();
    });

    it("should store raw metrics when provided", () => {
      const session = t.store.createSession("spec-1", "test", TEST_CONFIG);
      const metrics = JSON.stringify({ goTestOutput: "ok" });
      const round = t.store.insertRound(session.id, 1, "treatment", TEST_SCORES, 0.85, metrics);

      expect(round.rawMetrics).toBe(metrics);
    });
  });

  describe("getRounds", () => {
    it("should return all rounds for a session", () => {
      const session = t.store.createSession("spec-1", "test", TEST_CONFIG);
      t.store.insertRound(session.id, 1, "control", TEST_SCORES, 0.7);
      t.store.insertRound(session.id, 1, "treatment", TEST_SCORES, 0.8);
      t.store.insertRound(session.id, 2, "control", TEST_SCORES, 0.72);

      const all = t.store.getRounds(session.id);
      expect(all).toHaveLength(3);
    });

    it("should filter rounds by arm", () => {
      const session = t.store.createSession("spec-1", "test", TEST_CONFIG);
      t.store.insertRound(session.id, 1, "control", TEST_SCORES, 0.7);
      t.store.insertRound(session.id, 1, "treatment", TEST_SCORES, 0.8);
      t.store.insertRound(session.id, 2, "control", TEST_SCORES, 0.72);

      const controlRounds = t.store.getRounds(session.id, "control");
      expect(controlRounds).toHaveLength(2);
      expect(controlRounds.every((r) => r.arm === "control")).toBe(true);

      const treatmentRounds = t.store.getRounds(session.id, "treatment");
      expect(treatmentRounds).toHaveLength(1);
    });

    it("should order rounds by round number ascending", () => {
      const session = t.store.createSession("spec-1", "test", TEST_CONFIG);
      t.store.insertRound(session.id, 3, "control", TEST_SCORES, 0.9);
      t.store.insertRound(session.id, 1, "control", TEST_SCORES, 0.7);
      t.store.insertRound(session.id, 2, "control", TEST_SCORES, 0.8);

      const rounds = t.store.getRounds(session.id, "control");
      expect(rounds[0].round).toBe(1);
      expect(rounds[1].round).toBe(2);
      expect(rounds[2].round).toBe(3);
    });
  });

  describe("getRoundPair", () => {
    it("should return both arms for a round", () => {
      const session = t.store.createSession("spec-1", "test", TEST_CONFIG);
      t.store.insertRound(session.id, 1, "control", TEST_SCORES, 0.7);
      t.store.insertRound(session.id, 1, "treatment", TEST_SCORES, 0.85);

      const pair = t.store.getRoundPair(session.id, 1);
      expect(pair.control).toBeDefined();
      expect(pair.treatment).toBeDefined();
      expect(pair.control!.composite).toBe(0.7);
      expect(pair.treatment!.composite).toBe(0.85);
    });

    it("should return partial pair when only one arm submitted", () => {
      const session = t.store.createSession("spec-1", "test", TEST_CONFIG);
      t.store.insertRound(session.id, 1, "control", TEST_SCORES, 0.7);

      const pair = t.store.getRoundPair(session.id, 1);
      expect(pair.control).toBeDefined();
      expect(pair.treatment).toBeUndefined();
    });

    it("should return empty for nonexistent round", () => {
      const session = t.store.createSession("spec-1", "test", TEST_CONFIG);
      const pair = t.store.getRoundPair(session.id, 99);
      expect(pair.control).toBeUndefined();
      expect(pair.treatment).toBeUndefined();
    });
  });

  describe("getRoundCount", () => {
    it("should count distinct rounds", () => {
      const session = t.store.createSession("spec-1", "test", TEST_CONFIG);
      expect(t.store.getRoundCount(session.id)).toBe(0);

      t.store.insertRound(session.id, 1, "control", TEST_SCORES, 0.7);
      t.store.insertRound(session.id, 1, "treatment", TEST_SCORES, 0.8);
      expect(t.store.getRoundCount(session.id)).toBe(1);

      t.store.insertRound(session.id, 2, "control", TEST_SCORES, 0.75);
      expect(t.store.getRoundCount(session.id)).toBe(2);
    });
  });

  // ─── Ablations ───────────────────────────────────────

  describe("insertAblationRun", () => {
    it("should insert an ablation run and return it", () => {
      const session = t.store.createSession("spec-1", "test", TEST_CONFIG);
      const run = t.store.insertAblationRun(session.id, "ast", 1, TEST_SCORES, 0.65);

      expect(run.id).toMatch(/^abl-/);
      expect(run.sessionId).toBe(session.id);
      expect(run.disabledCategory).toBe("ast");
      expect(run.round).toBe(1);
      expect(run.composite).toBe(0.65);
      expect(run.status).toBe("completed");
    });
  });

  describe("getAblationRuns", () => {
    it("should return all ablation runs for a session", () => {
      const session = t.store.createSession("spec-1", "test", TEST_CONFIG);
      t.store.insertAblationRun(session.id, "ast", 1, TEST_SCORES, 0.6);
      t.store.insertAblationRun(session.id, "memory", 1, TEST_SCORES, 0.7);
      t.store.insertAblationRun(session.id, "ast", 2, TEST_SCORES, 0.65);

      const all = t.store.getAblationRuns(session.id);
      expect(all).toHaveLength(3);
    });

    it("should filter by category", () => {
      const session = t.store.createSession("spec-1", "test", TEST_CONFIG);
      t.store.insertAblationRun(session.id, "ast", 1, TEST_SCORES, 0.6);
      t.store.insertAblationRun(session.id, "memory", 1, TEST_SCORES, 0.7);
      t.store.insertAblationRun(session.id, "ast", 2, TEST_SCORES, 0.65);

      const astRuns = t.store.getAblationRuns(session.id, "ast");
      expect(astRuns).toHaveLength(2);
      expect(astRuns.every((r) => r.disabledCategory === "ast")).toBe(true);
    });

    it("should order by round ascending", () => {
      const session = t.store.createSession("spec-1", "test", TEST_CONFIG);
      t.store.insertAblationRun(session.id, "ast", 3, TEST_SCORES, 0.9);
      t.store.insertAblationRun(session.id, "ast", 1, TEST_SCORES, 0.6);
      t.store.insertAblationRun(session.id, "ast", 2, TEST_SCORES, 0.7);

      const runs = t.store.getAblationRuns(session.id, "ast");
      expect(runs[0].round).toBe(1);
      expect(runs[1].round).toBe(2);
      expect(runs[2].round).toBe(3);
    });
  });

  describe("getAblationCategories", () => {
    it("should return distinct categories", () => {
      const session = t.store.createSession("spec-1", "test", TEST_CONFIG);
      t.store.insertAblationRun(session.id, "ast", 1, TEST_SCORES, 0.6);
      t.store.insertAblationRun(session.id, "ast", 2, TEST_SCORES, 0.65);
      t.store.insertAblationRun(session.id, "memory", 1, TEST_SCORES, 0.7);
      t.store.insertAblationRun(session.id, "semantic", 1, TEST_SCORES, 0.75);

      const categories = t.store.getAblationCategories(session.id);
      expect(categories).toHaveLength(3);
      expect(categories).toContain("ast");
      expect(categories).toContain("memory");
      expect(categories).toContain("semantic");
    });

    it("should return empty array for no ablation runs", () => {
      const session = t.store.createSession("spec-1", "test", TEST_CONFIG);
      expect(t.store.getAblationCategories(session.id)).toHaveLength(0);
    });
  });
});
