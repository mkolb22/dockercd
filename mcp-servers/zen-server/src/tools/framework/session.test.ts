/**
 * SessionManager Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { SessionManager } from "./session.js";
import { StateStore } from "../state/store.js";
import type { WorkflowPlan } from "./types.js";

function makePlan(steps: Array<{ concept: string; agent: string; model: string }>): WorkflowPlan {
  return {
    task: "test task",
    taskType: "feature",
    complexity: "medium",
    steps: steps.map((s, i) => ({
      order: i + 1,
      concept: s.concept,
      agent: s.agent,
      model: s.model,
      skills: [],
      estimatedCost: 0.005,
      reason: `Step ${i + 1}`,
    })),
    skippedSteps: [],
    totalEstimatedCost: 0.015,
    reasoning: "Test plan",
  };
}

const defaultPlan = makePlan([
  { concept: "story", agent: "story-concept", model: "sonnet" },
  { concept: "architecture", agent: "architecture-concept", model: "opus" },
  { concept: "implementation", agent: "implementation-concept", model: "sonnet" },
]);

describe("SessionManager", () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager();
  });

  describe("startWorkflow()", () => {
    it("should create a session with correct initial state", () => {
      const session = manager.startWorkflow("add user auth", defaultPlan);

      expect(session.id).toMatch(/^wf-/);
      expect(session.task).toBe("add user auth");
      expect(session.status).toBe("active");
      expect(session.steps).toHaveLength(3);
      expect(session.context).toBeNull();
    });

    it("should store optional context", () => {
      const session = manager.startWorkflow("task", defaultPlan, "React project");

      expect(session.context).toBe("React project");
    });

    it("should set first step to in_progress", () => {
      const session = manager.startWorkflow("task", defaultPlan);

      expect(session.steps[0].status).toBe("in_progress");
      expect(session.steps[0].startedAt).not.toBeNull();
      expect(session.steps[1].status).toBe("pending");
      expect(session.steps[2].status).toBe("pending");
    });

    it("should handle empty plan", () => {
      const emptyPlan = makePlan([]);
      const session = manager.startWorkflow("task", emptyPlan);

      expect(session.steps).toHaveLength(0);
      expect(session.status).toBe("active");
    });

    it("should set this as the current session", () => {
      const session = manager.startWorkflow("task", defaultPlan);

      expect(manager.getCurrentSession()).toBe(session);
    });
  });

  describe("advanceStep()", () => {
    it("should mark step as completed and advance to next", () => {
      const session = manager.startWorkflow("task", defaultPlan);

      const nextIndex = manager.advanceStep(session.id, "story", "success");

      expect(nextIndex).toBe(1);
      expect(session.steps[0].status).toBe("completed");
      expect(session.steps[0].completedAt).not.toBeNull();
      expect(session.steps[0].durationMs).not.toBeNull();
      expect(session.steps[0].outcome).toBe("success");
      expect(session.steps[1].status).toBe("in_progress");
      expect(session.steps[1].startedAt).not.toBeNull();
    });

    it("should complete workflow when last step finishes", () => {
      const session = manager.startWorkflow("task", defaultPlan);

      manager.advanceStep(session.id, "story", "success");
      manager.advanceStep(session.id, "architecture", "success");
      const nextIndex = manager.advanceStep(session.id, "implementation", "success");

      expect(nextIndex).toBe(-1);
      expect(session.status).toBe("completed");
      expect(session.steps.every((s) => s.status === "completed")).toBe(true);
    });

    it("should handle partial outcome same as success", () => {
      const session = manager.startWorkflow("task", defaultPlan);

      const nextIndex = manager.advanceStep(session.id, "story", "partial");

      expect(nextIndex).toBe(1);
      expect(session.steps[0].status).toBe("completed");
      expect(session.steps[0].outcome).toBe("partial");
    });

    it("should not auto-advance on failure", () => {
      const session = manager.startWorkflow("task", defaultPlan);

      const nextIndex = manager.advanceStep(session.id, "story", "failed");

      expect(nextIndex).toBe(-1);
      expect(session.steps[0].status).toBe("failed");
      expect(session.status).toBe("failed");
      // Remaining steps stay pending
      expect(session.steps[1].status).toBe("pending");
      expect(session.steps[2].status).toBe("pending");
    });

    it("should store notes", () => {
      const session = manager.startWorkflow("task", defaultPlan);

      manager.advanceStep(session.id, "story", "success", "Story looks good");

      expect(session.steps[0].notes).toBe("Story looks good");
    });

    it("should return -1 for unknown workflow", () => {
      expect(manager.advanceStep("wf-nonexistent", "story", "success")).toBe(-1);
    });

    it("should return -1 for mismatched concept", () => {
      const session = manager.startWorkflow("task", defaultPlan);

      expect(manager.advanceStep(session.id, "architecture", "success")).toBe(-1);
    });
  });

  describe("getSession()", () => {
    it("should return session by ID", () => {
      const session = manager.startWorkflow("task", defaultPlan);

      expect(manager.getSession(session.id)).toBe(session);
    });

    it("should return null for unknown ID", () => {
      expect(manager.getSession("wf-nonexistent")).toBeNull();
    });
  });

  describe("getCurrentSession()", () => {
    it("should return most recently started active session", () => {
      const s1 = manager.startWorkflow("task1", defaultPlan);
      const s2 = manager.startWorkflow("task2", defaultPlan);

      expect(manager.getCurrentSession()).toBe(s2);
    });

    it("should skip completed sessions", () => {
      const s1 = manager.startWorkflow("task1", makePlan([
        { concept: "story", agent: "story-concept", model: "sonnet" },
      ]));
      manager.advanceStep(s1.id, "story", "success");

      const s2 = manager.startWorkflow("task2", defaultPlan);
      expect(manager.getCurrentSession()).toBe(s2);
    });

    it("should return null when no active sessions", () => {
      expect(manager.getCurrentSession()).toBeNull();
    });
  });

  describe("getCurrentStep()", () => {
    it("should return the in_progress step", () => {
      const session = manager.startWorkflow("task", defaultPlan);

      const step = manager.getCurrentStep(session);
      expect(step).not.toBeNull();
      expect(step!.concept).toBe("story");
    });

    it("should return null when no step is in_progress", () => {
      const plan = makePlan([
        { concept: "story", agent: "story-concept", model: "sonnet" },
      ]);
      const session = manager.startWorkflow("task", plan);
      manager.advanceStep(session.id, "story", "success");

      expect(manager.getCurrentStep(session)).toBeNull();
    });
  });

  describe("getSummary()", () => {
    it("should compute correct stats", () => {
      const session = manager.startWorkflow("task", defaultPlan);
      manager.advanceStep(session.id, "story", "success");

      const summary = manager.getSummary(session);

      expect(summary.totalSteps).toBe(3);
      expect(summary.completedSteps).toBe(1);
      expect(summary.failedSteps).toBe(0);
      expect(summary.skippedSteps).toBe(0);
      expect(summary.totalDurationMs).toBeGreaterThanOrEqual(0);
    });

    it("should count failed steps", () => {
      const session = manager.startWorkflow("task", defaultPlan);
      manager.advanceStep(session.id, "story", "failed");

      const summary = manager.getSummary(session);

      expect(summary.completedSteps).toBe(0);
      expect(summary.failedSteps).toBe(1);
    });
  });

  describe("getStateSnapshot()", () => {
    it("should return full snapshot", () => {
      const session = manager.startWorkflow("task", defaultPlan);

      const snapshot = manager.getStateSnapshot(session);

      expect(snapshot.session).toBe(session);
      expect(snapshot.currentStep).not.toBeNull();
      expect(snapshot.currentStep!.concept).toBe("story");
      expect(snapshot.summary.totalSteps).toBe(3);
    });
  });

  describe("getStats()", () => {
    it("should count sessions", () => {
      expect(manager.getStats()).toEqual({ activeSessions: 0, totalSessions: 0 });

      manager.startWorkflow("task1", defaultPlan);
      expect(manager.getStats()).toEqual({ activeSessions: 1, totalSessions: 1 });

      const s2 = manager.startWorkflow("task2", makePlan([
        { concept: "story", agent: "story-concept", model: "sonnet" },
      ]));
      manager.advanceStep(s2.id, "story", "success");

      expect(manager.getStats()).toEqual({ activeSessions: 1, totalSessions: 2 });
    });
  });
});

describe("SessionManager with persistence", () => {
  let tmpDir: string;
  let store: StateStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "session-persist-test-"));
    store = new StateStore(path.join(tmpDir, "state.db"));
  });

  afterEach(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should persist sessions to SQLite", () => {
    const manager = new SessionManager(store);
    const session = manager.startWorkflow("persist test", defaultPlan);

    // Verify session was written to SQLite
    const record = store.getWorkflowSession(session.id);
    expect(record).not.toBeNull();
    expect(record!.task).toBe("persist test");
    expect(record!.status).toBe("active");
  });

  it("should persist step advancement", () => {
    const manager = new SessionManager(store);
    const session = manager.startWorkflow("advance test", defaultPlan);

    manager.advanceStep(session.id, "story", "success", "looks good");

    const record = store.getWorkflowSession(session.id);
    expect(record).not.toBeNull();
    const steps = record!.steps as Array<{ concept: string; status: string; outcome: string | null }>;
    expect(steps[0].status).toBe("completed");
    expect(steps[0].outcome).toBe("success");
    expect(steps[1].status).toBe("in_progress");
  });

  it("should hydrate active sessions on construction", () => {
    // First manager creates a session
    const manager1 = new SessionManager(store);
    const session = manager1.startWorkflow("hydrate test", defaultPlan);
    manager1.advanceStep(session.id, "story", "success");

    // Second manager (simulating restart) should hydrate from SQLite
    const manager2 = new SessionManager(store);
    const hydrated = manager2.getSession(session.id);

    expect(hydrated).not.toBeNull();
    expect(hydrated!.task).toBe("hydrate test");
    expect(hydrated!.status).toBe("active");
    expect(hydrated!.steps[0].status).toBe("completed");
    expect(hydrated!.steps[1].status).toBe("in_progress");
  });

  it("should hydrate as current session", () => {
    const manager1 = new SessionManager(store);
    manager1.startWorkflow("current test", defaultPlan);

    const manager2 = new SessionManager(store);
    const current = manager2.getCurrentSession();

    expect(current).not.toBeNull();
    expect(current!.task).toBe("current test");
  });

  it("should not hydrate completed sessions", () => {
    const manager1 = new SessionManager(store);
    const plan = makePlan([
      { concept: "story", agent: "story-concept", model: "sonnet" },
    ]);
    const session = manager1.startWorkflow("done test", plan);
    manager1.advanceStep(session.id, "story", "success");

    const manager2 = new SessionManager(store);
    expect(manager2.getCurrentSession()).toBeNull();
    expect(manager2.getStats().totalSessions).toBe(0);
  });

  it("should load session from SQLite on getSession miss", () => {
    const manager1 = new SessionManager(store);
    const plan = makePlan([
      { concept: "story", agent: "story-concept", model: "sonnet" },
    ]);
    const session = manager1.startWorkflow("complete", plan);
    manager1.advanceStep(session.id, "story", "success");

    // manager2 won't hydrate completed sessions, but getSession should still find it
    const manager2 = new SessionManager(store);
    const found = manager2.getSession(session.id);

    expect(found).not.toBeNull();
    expect(found!.status).toBe("completed");
  });

  it("should persist failure status", () => {
    const manager = new SessionManager(store);
    const session = manager.startWorkflow("fail test", defaultPlan);
    manager.advanceStep(session.id, "story", "failed");

    const record = store.getWorkflowSession(session.id);
    expect(record!.status).toBe("failed");
  });
});
