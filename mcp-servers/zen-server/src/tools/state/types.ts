/**
 * State Store Types
 * Operational state for health, events, and checkpoints
 */

/**
 * Health zone classification
 */
export type HealthZone = "green" | "yellow" | "red";

/**
 * Health status record
 */
export interface HealthRecord {
  id: number;
  contextUsagePercent: number;
  zone: HealthZone;
  updatedAt: string;
}

/**
 * Event types logged by hooks and workflows
 */
export type EventType =
  | "session_exit"
  | "context_threshold"
  | "concept_complete"
  | "checkpoint_created"
  | "workflow_step"
  | "error"
  | string;

/**
 * Event record
 */
export interface EventRecord {
  id: string;
  type: EventType;
  data: Record<string, unknown>;
  createdAt: string;
}

/**
 * Checkpoint types
 */
export type CheckpointType =
  | "safety"
  | "commit"
  | "milestone"
  | "session_exit"
  | "pre_compact"
  | "manual"
  | string;

/**
 * Checkpoint record
 */
export interface CheckpointRecord {
  id: string;
  name: string;
  type: CheckpointType;
  data: Record<string, unknown>;
  createdAt: string;
}

/**
 * Workflow session status
 */
export type WorkflowSessionStatus = "active" | "completed" | "failed" | "stale";

/**
 * Persisted workflow session record
 */
export interface WorkflowSessionRecord {
  id: string;
  task: string;
  context: string | null;
  plan: Record<string, unknown>;
  steps: Record<string, unknown>[];
  status: WorkflowSessionStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * Story status
 */
export type StoryStatus = "draft" | "ready" | "in_progress" | "completed" | "cancelled" | string;

/**
 * Story record
 */
export interface StoryRecord {
  id: string;
  title: string;
  status: StoryStatus;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * State store statistics
 */
export interface StateStats {
  healthRecords: number;
  events: number;
  checkpoints: number;
  workflowSessions: number;
  stories: number;
  latestHealth: HealthRecord | null;
  oldestEvent: string | null;
  newestEvent: string | null;
}
