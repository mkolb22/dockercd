/**
 * Session Manager
 * Workflow session tracking with optional SQLite persistence.
 *
 * When a StateStore is provided, sessions are persisted to SQLite and survive
 * server restarts. Without a store, sessions are purely in-memory (ephemeral).
 */

import type {
  WorkflowSession,
  WorkflowStepState,
  WorkflowPlan,
  WorkflowSummary,
  WorkflowStateSnapshot,
  SessionStatus,
  StepStatus,
} from "./types.js";
import type { StateStore } from "../state/store.js";
import { createResettableLazyLoader } from "../../utils/lazy.js";
import { config } from "../../core/config.js";
import { recordWorkflowOutcome, getFailureHints } from "./workflow-intelligence.js";
import type { FailureHint } from "./workflow-intelligence.js";

/**
 * Generate a workflow ID: wf-{base36_timestamp}-{random4}
 */
function generateWorkflowId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `wf-${ts}-${rand}`;
}

/**
 * SessionManager tracks workflow sessions with optional persistence
 */
export class SessionManager {
  private sessions: Map<string, WorkflowSession> = new Map();
  private currentId: string | null = null;
  private store: StateStore | null;

  constructor(store?: StateStore) {
    this.store = store ?? null;
    if (this.store) {
      this.hydrate();
    }
  }

  /**
   * Start a new workflow from a plan
   */
  startWorkflow(task: string, plan: WorkflowPlan, context?: string): WorkflowSession {
    const id = generateWorkflowId();
    const now = new Date().toISOString();

    const steps: WorkflowStepState[] = plan.steps.map((s) => ({
      concept: s.concept,
      agent: s.agent,
      model: s.model,
      status: "pending" as StepStatus,
      startedAt: null,
      completedAt: null,
      durationMs: null,
      outcome: null,
      notes: null,
    }));

    // Mark first step as in_progress
    if (steps.length > 0) {
      steps[0].status = "in_progress";
      steps[0].startedAt = now;
    }

    const session: WorkflowSession = {
      id,
      task,
      context: context || null,
      plan,
      steps,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };

    this.sessions.set(id, session);
    this.currentId = id;
    this.persist(session);
    return session;
  }

  /**
   * Advance a workflow step.
   * Marks the named step as completed/failed, then advances to the next pending step.
   *
   * Returns the index of the next step, or -1 if workflow is complete or step failed.
   */
  advanceStep(
    workflowId: string,
    concept: string,
    outcome: "success" | "partial" | "failed",
    notes?: string,
  ): number {
    const session = this.sessions.get(workflowId);
    if (!session) return -1;

    const now = new Date().toISOString();

    // Find the in_progress step matching the concept
    const stepIndex = session.steps.findIndex(
      (s) => s.concept === concept && s.status === "in_progress",
    );
    if (stepIndex === -1) return -1;

    const step = session.steps[stepIndex];
    step.completedAt = now;
    step.durationMs = step.startedAt
      ? new Date(now).getTime() - new Date(step.startedAt).getTime()
      : null;
    step.outcome = outcome;
    step.notes = notes || null;

    if (outcome === "failed") {
      step.status = "failed";
      session.status = "failed";
      session.updatedAt = now;
      this.persist(session);
      return -1;
    }

    // Mark as completed (both success and partial)
    step.status = "completed";
    session.updatedAt = now;

    // Find and activate the next pending step
    const nextIndex = session.steps.findIndex((s) => s.status === "pending");
    if (nextIndex === -1) {
      // All steps done
      session.status = "completed";
      this.persist(session);
      return -1;
    }

    session.steps[nextIndex].status = "in_progress";
    session.steps[nextIndex].startedAt = now;
    this.persist(session);
    return nextIndex;
  }

  /**
   * Advance a step with intelligence: records outcomes to memory and returns failure hints.
   */
  async advanceStepWithIntelligence(
    workflowId: string,
    concept: string,
    outcome: "success" | "partial" | "failed",
    notes?: string,
  ): Promise<{ nextIndex: number; failureHints?: FailureHint }> {
    const nextIndex = this.advanceStep(workflowId, concept, outcome, notes);
    const session = this.sessions.get(workflowId);
    if (!session || !config().memoryEnabled) return { nextIndex };

    // On workflow terminal state: record outcome (fire-and-forget)
    if (session.status === "completed" || session.status === "failed") {
      const summary = this.getSummary(session);
      recordWorkflowOutcome(
        session.task,
        session.plan.taskType,
        session.plan.complexity,
        session.status,
        session.steps.map((s) => ({
          concept: s.concept,
          outcome: s.outcome,
          durationMs: s.durationMs,
        })),
        summary.totalDurationMs,
      ).catch(() => {});
    }

    // On step failure: get recovery hints
    let failureHints: FailureHint | undefined;
    if (outcome === "failed") {
      try {
        failureHints = await getFailureHints(session.task, concept);
        // Only include if there are actual hints
        if (failureHints.pastFailures.length === 0) failureHints = undefined;
      } catch {
        /* graceful */
      }
    }

    return { nextIndex, failureHints };
  }

  /**
   * Get a session by ID (checks memory first, then SQLite)
   */
  getSession(id: string): WorkflowSession | null {
    const memSession = this.sessions.get(id);
    if (memSession) return memSession;

    // Try loading from store
    if (this.store) {
      const record = this.store.getWorkflowSession(id);
      if (record) {
        const session = this.recordToSession(record);
        this.sessions.set(id, session);
        return session;
      }
    }

    return null;
  }

  /**
   * Get the current (most recent active) session
   */
  getCurrentSession(): WorkflowSession | null {
    if (this.currentId) {
      const session = this.sessions.get(this.currentId);
      if (session && session.status === "active") return session;
    }
    // Fallback: find any active session (most recently added)
    for (const [, session] of [...this.sessions].reverse()) {
      if (session.status === "active") return session;
    }
    return null;
  }

  /**
   * Get the current in_progress step of a session
   */
  getCurrentStep(session: WorkflowSession): WorkflowStepState | null {
    return session.steps.find((s) => s.status === "in_progress") || null;
  }

  /**
   * Compute summary statistics for a session
   */
  getSummary(session: WorkflowSession): WorkflowSummary {
    let totalDurationMs = 0;
    let completedSteps = 0;
    let failedSteps = 0;
    let skippedSteps = 0;

    for (const step of session.steps) {
      if (step.status === "completed") completedSteps++;
      else if (step.status === "failed") failedSteps++;
      else if (step.status === "skipped") skippedSteps++;
      if (step.durationMs) totalDurationMs += step.durationMs;
    }

    return {
      totalSteps: session.steps.length,
      completedSteps,
      failedSteps,
      skippedSteps,
      totalDurationMs,
    };
  }

  /**
   * Get a full state snapshot for reporting
   */
  getStateSnapshot(session: WorkflowSession): WorkflowStateSnapshot {
    return {
      session,
      currentStep: this.getCurrentStep(session),
      summary: this.getSummary(session),
    };
  }

  /**
   * Get counts for status reporting
   */
  getStats(): { activeSessions: number; totalSessions: number } {
    let activeSessions = 0;
    for (const session of this.sessions.values()) {
      if (session.status === "active") activeSessions++;
    }
    return { activeSessions, totalSessions: this.sessions.size };
  }

  /**
   * Expire stale active sessions that haven't been updated within maxAgeMs.
   * Returns the number of sessions expired.
   */
  expireStale(maxAgeMs: number = 3600000): number {
    const now = Date.now();
    let expired = 0;

    for (const session of this.sessions.values()) {
      if (session.status !== "active") continue;
      const updatedAt = new Date(session.updatedAt).getTime();
      if (now - updatedAt > maxAgeMs) {
        session.status = "stale";
        session.updatedAt = new Date().toISOString();
        this.persist(session);
        expired++;
      }
    }

    return expired;
  }

  /**
   * Persist a session to the store (if available)
   */
  private persist(session: WorkflowSession): void {
    if (!this.store) return;
    this.store.saveWorkflowSession({
      id: session.id,
      task: session.task,
      context: session.context,
      plan: session.plan as unknown as Record<string, unknown>,
      steps: session.steps as unknown as Record<string, unknown>[],
      status: session.status,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    });
  }

  /**
   * Hydrate active sessions from the store on startup
   */
  private hydrate(): void {
    if (!this.store) return;
    const records = this.store.listWorkflowSessions({ status: "active", limit: 10 });
    for (const record of records) {
      const session = this.recordToSession(record);
      this.sessions.set(session.id, session);
      this.currentId = session.id;
    }
  }

  /**
   * Convert a store record back to a WorkflowSession
   */
  private recordToSession(record: {
    id: string;
    task: string;
    context: string | null;
    plan: Record<string, unknown>;
    steps: Record<string, unknown>[];
    status: string;
    createdAt: string;
    updatedAt: string;
  }): WorkflowSession {
    return {
      id: record.id,
      task: record.task,
      context: record.context,
      plan: record.plan as unknown as WorkflowPlan,
      steps: record.steps as unknown as WorkflowStepState[],
      status: record.status as SessionStatus,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}

/**
 * Singleton session manager (resettable for testing).
 * When state store is enabled, sessions persist to SQLite.
 * The store must be wired by calling `setSessionStore()` before first use.
 */
let sessionStore: StateStore | undefined;

export function setSessionStore(store: StateStore): void {
  sessionStore = store;
}

const sessionManagerLoader = createResettableLazyLoader(
  () => new SessionManager(sessionStore),
);
export const getSessionManager = sessionManagerLoader.get;
export const resetSessionManager = sessionManagerLoader.reset;
