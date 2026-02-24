/**
 * StateStore Tests
 */

import { describe, it, expect } from "vitest";
import * as path from "path";
import { StateStore } from "./store.js";
import { useStoreDirHarness } from "../../test-utils/store-harness.js";

describe("StateStore", () => {
  const t = useStoreDirHarness("state-store", (dir) => new StateStore(path.join(dir, "state.db")));

  describe("health", () => {
    it("should update and get health", () => {
      const record = t.store.updateHealth(45.5, "green");

      expect(record.contextUsagePercent).toBe(45.5);
      expect(record.zone).toBe("green");
      expect(record.updatedAt).toBeTruthy();

      const retrieved = t.store.getHealth();
      expect(retrieved).not.toBeNull();
      expect(retrieved!.contextUsagePercent).toBe(45.5);
      expect(retrieved!.zone).toBe("green");
    });

    it("should replace previous health on update (upsert)", () => {
      t.store.updateHealth(30, "green");
      t.store.updateHealth(65, "yellow");

      const record = t.store.getHealth();
      expect(record!.contextUsagePercent).toBe(65);
      expect(record!.zone).toBe("yellow");
    });

    it("should return null when no health recorded", () => {
      const record = t.store.getHealth();
      expect(record).toBeNull();
    });

    it("should handle red zone", () => {
      const record = t.store.updateHealth(85, "red");
      expect(record.zone).toBe("red");
    });
  });

  describe("events", () => {
    it("should log and query events", () => {
      const event = t.store.logEvent("session_exit", { reason: "user_quit" });

      expect(event.id).toMatch(/^evt-/);
      expect(event.type).toBe("session_exit");
      expect(event.data).toEqual({ reason: "user_quit" });
      expect(event.createdAt).toBeTruthy();

      const events = t.store.queryEvents({ type: "session_exit" });
      expect(events).toHaveLength(1);
      expect(events[0].data).toEqual({ reason: "user_quit" });
    });

    it("should log events with empty data", () => {
      const event = t.store.logEvent("context_threshold");
      expect(event.data).toEqual({});
    });

    it("should filter events by type", () => {
      t.store.logEvent("session_exit", { reason: "compact" });
      t.store.logEvent("context_threshold", { percent: 70 });
      t.store.logEvent("session_exit", { reason: "manual" });

      const exits = t.store.queryEvents({ type: "session_exit" });
      expect(exits).toHaveLength(2);

      const thresholds = t.store.queryEvents({ type: "context_threshold" });
      expect(thresholds).toHaveLength(1);
    });

    it("should respect limit", () => {
      for (let i = 0; i < 10; i++) {
        t.store.logEvent("test", { index: i });
      }

      const events = t.store.queryEvents({ limit: 3 });
      expect(events).toHaveLength(3);
    });

    it("should return events in reverse chronological order", () => {
      t.store.logEvent("test", { order: "first" });
      t.store.logEvent("test", { order: "second" });

      const events = t.store.queryEvents();
      expect(events[0].data).toEqual({ order: "second" });
      expect(events[1].data).toEqual({ order: "first" });
    });

    it("should get event counts by type", () => {
      t.store.logEvent("session_exit", {});
      t.store.logEvent("session_exit", {});
      t.store.logEvent("context_threshold", {});
      t.store.logEvent("error", {});

      const counts = t.store.getEventCounts();
      expect(counts["session_exit"]).toBe(2);
      expect(counts["context_threshold"]).toBe(1);
      expect(counts["error"]).toBe(1);
    });
  });

  describe("checkpoints", () => {
    it("should save and get checkpoint", () => {
      const checkpoint = t.store.saveCheckpoint("phase2-complete", "milestone", {
        task: "Implement Phase 2",
        status: "done",
      });

      expect(checkpoint.id).toMatch(/^chk-phase2-complete-/);
      expect(checkpoint.name).toBe("phase2-complete");
      expect(checkpoint.type).toBe("milestone");
      expect(checkpoint.data).toEqual({ task: "Implement Phase 2", status: "done" });

      const retrieved = t.store.getCheckpoint(checkpoint.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.name).toBe("phase2-complete");
    });

    it("should list checkpoints", () => {
      t.store.saveCheckpoint("chk-1", "safety", { note: "auto" });
      t.store.saveCheckpoint("chk-2", "milestone", { note: "manual" });
      t.store.saveCheckpoint("chk-3", "safety", { note: "auto2" });

      const all = t.store.listCheckpoints();
      expect(all).toHaveLength(3);

      const safetyOnly = t.store.listCheckpoints({ type: "safety" });
      expect(safetyOnly).toHaveLength(2);
    });

    it("should list checkpoints newest first", () => {
      t.store.saveCheckpoint("first", "manual", {});
      t.store.saveCheckpoint("second", "manual", {});

      const checkpoints = t.store.listCheckpoints();
      expect(checkpoints[0].name).toBe("second");
      expect(checkpoints[1].name).toBe("first");
    });

    it("should get latest checkpoint", () => {
      t.store.saveCheckpoint("old", "safety", { v: 1 });
      t.store.saveCheckpoint("new", "milestone", { v: 2 });

      const latest = t.store.getLatestCheckpoint();
      expect(latest!.name).toBe("new");

      const latestSafety = t.store.getLatestCheckpoint("safety");
      expect(latestSafety!.name).toBe("old");
    });

    it("should return null for missing checkpoint", () => {
      const checkpoint = t.store.getCheckpoint("nonexistent");
      expect(checkpoint).toBeNull();
    });

    it("should return null for latest when empty", () => {
      const latest = t.store.getLatestCheckpoint();
      expect(latest).toBeNull();
    });

    it("should respect list limit", () => {
      for (let i = 0; i < 5; i++) {
        t.store.saveCheckpoint(`chk-${i}`, "manual", {});
      }

      const limited = t.store.listCheckpoints({ limit: 2 });
      expect(limited).toHaveLength(2);
    });
  });

  describe("workflow sessions", () => {
    it("should save and get a workflow session", () => {
      t.store.saveWorkflowSession({
        id: "wf-test-1",
        task: "add auth",
        context: null,
        plan: { taskType: "feature", steps: [] },
        steps: [{ concept: "story", status: "in_progress" }],
        status: "active",
        createdAt: "2026-02-07T00:00:00Z",
        updatedAt: "2026-02-07T00:00:00Z",
      });

      const record = t.store.getWorkflowSession("wf-test-1");
      expect(record).not.toBeNull();
      expect(record!.task).toBe("add auth");
      expect(record!.status).toBe("active");
      expect(record!.steps).toHaveLength(1);
    });

    it("should update existing session", () => {
      t.store.saveWorkflowSession({
        id: "wf-test-2",
        task: "refactor",
        context: null,
        plan: {},
        steps: [{ concept: "story", status: "in_progress" }],
        status: "active",
        createdAt: "2026-02-07T00:00:00Z",
        updatedAt: "2026-02-07T00:00:00Z",
      });

      t.store.saveWorkflowSession({
        id: "wf-test-2",
        task: "refactor",
        context: null,
        plan: {},
        steps: [{ concept: "story", status: "completed" }],
        status: "completed",
        createdAt: "2026-02-07T00:00:00Z",
        updatedAt: "2026-02-07T01:00:00Z",
      });

      const record = t.store.getWorkflowSession("wf-test-2");
      expect(record!.status).toBe("completed");
      expect((record!.steps[0] as { status: string }).status).toBe("completed");
    });

    it("should get active workflow session", () => {
      t.store.saveWorkflowSession({
        id: "wf-done",
        task: "done",
        context: null,
        plan: {},
        steps: [],
        status: "completed",
        createdAt: "2026-02-07T00:00:00Z",
        updatedAt: "2026-02-07T00:00:00Z",
      });
      t.store.saveWorkflowSession({
        id: "wf-active",
        task: "active",
        context: null,
        plan: {},
        steps: [],
        status: "active",
        createdAt: "2026-02-07T01:00:00Z",
        updatedAt: "2026-02-07T01:00:00Z",
      });

      const active = t.store.getActiveWorkflowSession();
      expect(active).not.toBeNull();
      expect(active!.id).toBe("wf-active");
    });

    it("should list workflow sessions with status filter", () => {
      t.store.saveWorkflowSession({
        id: "wf-a", task: "a", context: null, plan: {}, steps: [],
        status: "active", createdAt: "2026-02-07T00:00:00Z", updatedAt: "2026-02-07T00:00:00Z",
      });
      t.store.saveWorkflowSession({
        id: "wf-b", task: "b", context: null, plan: {}, steps: [],
        status: "completed", createdAt: "2026-02-07T01:00:00Z", updatedAt: "2026-02-07T01:00:00Z",
      });
      t.store.saveWorkflowSession({
        id: "wf-c", task: "c", context: null, plan: {}, steps: [],
        status: "active", createdAt: "2026-02-07T02:00:00Z", updatedAt: "2026-02-07T02:00:00Z",
      });

      const all = t.store.listWorkflowSessions();
      expect(all).toHaveLength(3);

      const activeOnly = t.store.listWorkflowSessions({ status: "active" });
      expect(activeOnly).toHaveLength(2);
    });

    it("should get workflow session counts", () => {
      t.store.saveWorkflowSession({
        id: "wf-1", task: "t", context: null, plan: {}, steps: [],
        status: "active", createdAt: "2026-02-07T00:00:00Z", updatedAt: "2026-02-07T00:00:00Z",
      });
      t.store.saveWorkflowSession({
        id: "wf-2", task: "t", context: null, plan: {}, steps: [],
        status: "completed", createdAt: "2026-02-07T00:00:00Z", updatedAt: "2026-02-07T00:00:00Z",
      });
      t.store.saveWorkflowSession({
        id: "wf-3", task: "t", context: null, plan: {}, steps: [],
        status: "failed", createdAt: "2026-02-07T00:00:00Z", updatedAt: "2026-02-07T00:00:00Z",
      });

      const counts = t.store.getWorkflowSessionCounts();
      expect(counts).toEqual({ active: 1, completed: 1, failed: 1, total: 3 });
    });

    it("should return null for missing session", () => {
      expect(t.store.getWorkflowSession("wf-missing")).toBeNull();
    });

    it("should return null when no active session", () => {
      expect(t.store.getActiveWorkflowSession()).toBeNull();
    });
  });

  describe("statistics", () => {
    it("should return empty stats initially", () => {
      const stats = t.store.getStateStats();

      expect(stats.healthRecords).toBe(0);
      expect(stats.events).toBe(0);
      expect(stats.checkpoints).toBe(0);
      expect(stats.workflowSessions).toBe(0);
      expect(stats.latestHealth).toBeNull();
      expect(stats.oldestEvent).toBeNull();
      expect(stats.newestEvent).toBeNull();
    });

    it("should return populated stats", () => {
      t.store.updateHealth(50, "yellow");
      t.store.logEvent("test1", {});
      t.store.logEvent("test2", {});
      t.store.saveCheckpoint("chk", "manual", {});

      const stats = t.store.getStateStats();

      expect(stats.healthRecords).toBe(1);
      expect(stats.events).toBe(2);
      expect(stats.checkpoints).toBe(1);
      expect(stats.latestHealth).not.toBeNull();
      expect(stats.latestHealth!.zone).toBe("yellow");
      expect(stats.oldestEvent).toBeTruthy();
      expect(stats.newestEvent).toBeTruthy();
    });
  });

  describe("database", () => {
    it("should use getStats from BaseStore", () => {
      const stats = t.store.getStats();

      expect(stats.tables).toContain("health");
      expect(stats.tables).toContain("events");
      expect(stats.tables).toContain("checkpoints");
      expect(stats.tables).toContain("workflow_sessions");
    });

    it("should create db directory if missing", () => {
      const nestedPath = path.join(t.tmpDir, "deep", "nested", "state.db");
      const nestedStore = new StateStore(nestedPath);

      nestedStore.updateHealth(10, "green");
      const record = nestedStore.getHealth();
      expect(record!.contextUsagePercent).toBe(10);

      nestedStore.close();
    });
  });
});
