/**
 * Shared type definitions for koan workflow state.
 * Single source of truth — all CLI tools import from here.
 */

// Status for workflow items (stories, architectures, implementations)
export type Status = 'ready' | 'in_progress' | 'completed' | 'blocked' | 'approved';

// Zen concepts
export type Concept = 'story' | 'architecture' | 'implementation' | 'quality' | 'version' | 'context' | 'retrospective' | 'security' | 'documentation' | 'code-analysis' | 'verification';

// Model tiers
export type Model = 'haiku' | 'sonnet' | 'opus';

// Provenance action status
export type ActionStatus = 'started' | 'completed' | 'failed' | 'blocked';

// Common metadata
export interface Metadata {
  created_at?: string;
  concept?: string;
  model?: string;
  cost?: number;
  [key: string]: unknown;
}

// Cost tracking
export interface CostInfo {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  cost_usd?: number;
}

// Story state
export interface Story {
  story_id: string;
  status: Status;
  summary: string;
  title?: string;
  complexity?: string;
  details?: {
    title?: string;
    description?: string;
    acceptance_criteria?: unknown[];
    context?: unknown;
    dependencies?: unknown[];
    estimated_complexity?: string;
    ambiguities?: unknown[];
    metadata?: Metadata;
  };
}

// Architecture state
export interface Architecture {
  id: string;
  story_id?: string;
  title?: string;
  status: Status;
  estimated_risk?: string;
  summary: string;
  details?: {
    created_at?: string;
    concept?: string;
    model?: string;
    technology_stack?: unknown;
    components?: unknown[];
    architectural_patterns?: unknown[];
    data_flow?: unknown[];
    decisions?: unknown[];
    security_considerations?: unknown[];
    risks?: unknown[];
    file_structure?: unknown[];
    [key: string]: unknown;
  };
}

// Implementation state
export interface Implementation {
  impl_id: string;
  arch_id?: string;
  story_id?: string;
  status: Status;
  summary: string;
  files_changed?: number;
  details?: {
    arch_id?: string;
    story_id?: string;
    files_created?: unknown[];
    files_modified?: unknown[];
    tests_created?: unknown[];
    implementation_notes?: string[];
    blockers?: unknown[];
    metadata?: Metadata;
  };
}

// Provenance action record
export interface ProvenanceAction {
  action_id: string;
  concept: Concept;
  action: string;
  status: ActionStatus;
  timestamp: string;
  model?: Model;
  triggered_by?: string | null;
  flow_id?: string;
  sync_rule_id?: string | null;
  inputs?: Record<string, unknown>;
  outputs?: {
    artifact_id?: string;
    artifact_type?: string;
    artifact_path?: string;
  };
  cost?: CostInfo;
  duration_ms?: number;
  error?: {
    type: string;
    message: string;
    recoverable: boolean;
  } | null;
  metadata?: Record<string, unknown>;
}

// Combined workflow state (stories + architectures + implementations)
export interface WorkflowState {
  stories: Story[];
  architectures: Architecture[];
  implementations: Implementation[];
}

// Base CLI options shared across koan tools
export interface BaseCliOptions {
  from?: string;
  to?: string;
  since?: string;
  concept?: string;
  verbose?: boolean;
  json?: boolean;
}
