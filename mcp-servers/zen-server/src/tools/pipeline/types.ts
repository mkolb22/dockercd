/**
 * Pipeline Module Types
 * Concept composition DSL parsing, validation, and execution planning.
 */

// ─── Composition ─────────────────────────────────────────────

export type StepType = "sequential" | "parallel";

/** Extended concept reference with optional action, model, and passes. */
export interface ConceptRef {
  concept: string;
  action?: string;
  model?: string;
  passes?: number;
}

export interface PipelineStep {
  type: StepType;
  concepts: string[];
  conceptRefs: ConceptRef[];
}

export interface PipelineAnnotations {
  slo?: string;
  errors?: string;
}

export interface Pipeline {
  raw: string;
  steps: PipelineStep[];
  annotations: PipelineAnnotations;
}

export interface ValidationError {
  step: number;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: string[];
}

// ─── Execution Plan ──────────────────────────────────────────

export type StepStatus = "pending" | "ready" | "blocked" | "completed" | "skipped";
export type PlanStatus = "valid" | "invalid" | "ready" | "in_progress" | "completed";

export interface PreconditionSpec {
  type: "file_exists" | "status_equals" | "field_not_empty";
  target: string;
  description: string;
}

export interface ExecutionStep {
  step_number: number;
  concept: string;
  action: string;
  model?: string;
  passes: number;
  preconditions: PreconditionSpec[];
  blocked_by?: number[];
  parallel_with?: number[];
  instructions: string;
}

export interface ExecutionPlan {
  plan_id: string;
  pipeline_dsl: string;
  story_id?: string;
  created_at: string;
  status: PlanStatus;
  steps: ExecutionStep[];
  validation: ValidationResult;
  estimated_cost_usd: number;
  estimated_duration_ms: number;
  start_from_step?: number;
}

export interface PlanOptions {
  storyId?: string;
  fromStep?: number;
}

// ─── Sync Rule DSL ───────────────────────────────────────────

export interface ParsedTrigger {
  concept: string;
  action: string;
  status: string;
  params?: Record<string, string>;
}

export interface ParsedAction {
  concept: string;
  action: string;
  model?: string;
  sloProfile?: string;
  parallel?: boolean;
  condition?: string[];
}

export interface ParsedRule {
  trigger: ParsedTrigger;
  action: ParsedAction;
  condition?: string[];
}

export interface SyncRuleCompiled {
  id: string;
  description: string;
  when: { concept: string; action: string; status: string };
  then: { concept: string; action: string; model?: string; parallel?: boolean };
  where?: string;
}
