/**
 * Type definitions for koan-flow execution plans.
 */

// Re-export from koan-compose
import type {
  Pipeline,
  PipelineStep,
  StepType,
  ValidationResult,
  ValidationError,
} from '@zen/koan-compose/dist/compose.js';

export type {
  Pipeline,
  PipelineStep,
  StepType,
  ValidationResult,
  ValidationError,
};

// Re-export from koan-core
export type {
  Story,
  Architecture,
  Implementation,
  Status,
  Concept,
} from '@zen/koan-core';

// Sync rule types
export interface SyncRule {
  id: string;
  description?: string;
  when: {
    concept: string;
    action: string;
    status: string;
  };
  where?: {
    query: string;
  };
  then: SyncAction[];
  depends_on?: DependsOn;
  slo_expectations?: SloExpectations;
  provenance?: ProvenanceInfo;
}

export interface SyncAction {
  concept?: string;
  action?: string;
  model?: string;
  parallel?: boolean;
  inputs?: Record<string, unknown>;
  outputs?: { target: string };
}

export interface DependsOn {
  sync_rule?: string;
  concept?: string;
  status?: string;
}

export interface ProvenanceInfo {
  flow_id?: string;
  reason?: string;
  decision_point?: boolean;
  user_interaction?: string;
  category?: string;
}

export interface SloExpectations {
  expected_duration_ms: number;
  max_duration_ms: number;
  expected_cost_usd: number;
  max_cost_usd: number;
  expected_context_tokens?: number;
  success_rate_target?: number;
}

export interface SyncRuleSet {
  rules: SyncRule[];
  sloTemplates: Record<string, SloExpectations>;
}

// Execution plan types
export type StepStatus =
  | 'pending'
  | 'ready'
  | 'blocked'
  | 'completed'
  | 'skipped';

export interface ExecutionStep {
  step_number: number;
  concept: string;
  action: string;
  status: StepStatus;
  preconditions: PreconditionCheck[];
  sync_rules: string[];
  slo_expectations?: SloExpectations;
  inputs?: Record<string, unknown>;
  outputs?: { target: string };
  blocked_by?: number[];
  parallel_with?: number[];
  instructions?: string;
}

export interface PreconditionCheck {
  type: 'file_exists' | 'status_equals' | 'field_not_empty';
  target: string;
  passed: boolean;
  message: string;
}

export interface PreconditionResult {
  step: number;
  concept: string;
  passed: boolean;
  checks: PreconditionCheck[];
}

export type PlanStatus =
  | 'valid'
  | 'invalid'
  | 'ready'
  | 'in_progress'
  | 'completed';

export interface ExecutionPlan {
  plan_id: string;
  pipeline_dsl: string;
  story_id?: string;
  created_at: string;
  status: PlanStatus;
  steps: ExecutionStep[];
  validation: ValidationResult;
  precondition_results: PreconditionResult[];
  estimated_cost_usd: number;
  estimated_duration_ms: number;
  start_from_step?: number;
}

export interface PlanOptions {
  storyId?: string;
  fromStep?: number;
  dryRun?: boolean;
  verbose?: boolean;
  projectRoot: string;
}

export interface RenderOptions {
  verbose?: boolean;
  showPreconditions?: boolean;
  showSyncRules?: boolean;
}
