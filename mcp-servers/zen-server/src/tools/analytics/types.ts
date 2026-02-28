/**
 * Analytics Module Types
 * Consolidated types for cost analysis, benchmarks, learning, drift detection,
 * observability, timeline, and validation.
 */

// Provenance types (subset needed for analytics)
export type Concept =
  | "story"
  | "architecture"
  | "implementation"
  | "quality"
  | "version"
  | "context"
  | "retrospective"
  | "security"
  | "documentation"
  | "code-analysis"
  | "verification";

export type Model = "haiku" | "sonnet" | "opus";
export type ActionStatus = "started" | "completed" | "failed" | "blocked";

export interface CostInfo {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  cost_usd?: number;
}

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
  error?: { type: string; message: string; recoverable: boolean } | null;
  metadata?: Record<string, unknown>;
}

export interface ProvenanceFilter {
  dateRange?: { from?: Date; to?: Date };
  concepts?: Concept[];
  models?: Model[];
  flowId?: string;
  storyId?: string;
}

// Cost analytics
export interface CostByDimension {
  dimension: string;
  total_cost: number;
  count: number;
  avg_cost: number;
  input_tokens: number;
  output_tokens: number;
}

export interface CostAnalytics {
  total_cost: number;
  total_actions: number;
  by_concept: CostByDimension[];
  by_model: CostByDimension[];
  by_flow: CostByDimension[];
  by_date: CostByDimension[];
  time_series: { date: string; cost: number }[];
}

// Benchmark metrics
export interface CostMetrics {
  total_spend: number;
  by_concept: Array<{
    concept: string;
    total: number;
    avg: number;
    count: number;
  }>;
  by_story: Array<{ story_id: string; total: number; count: number }>;
  by_model: Array<{
    model: string;
    total: number;
    avg: number;
    count: number;
  }>;
}

export interface DurationMetrics {
  total_duration_ms: number;
  by_concept: Array<{
    concept: string;
    total_ms: number;
    avg_ms: number;
    p50_ms: number;
    p90_ms: number;
    p99_ms: number;
    count: number;
  }>;
  by_story: Array<{ story_id: string; total_ms: number; count: number }>;
}

export interface QualityMetrics {
  total_reviews: number;
  approval_rate: number;
  avg_review_cycles: number;
  by_concept: Array<{
    concept: string;
    reviews: number;
    approvals: number;
    rejections: number;
  }>;
}

export interface ModelUsage {
  distribution: Array<{ model: string; count: number; percentage: number }>;
  cost_distribution: Array<{
    model: string;
    cost: number;
    percentage: number;
  }>;
}

export interface FailureMetrics {
  total_failures: number;
  failure_rate: number;
  retry_count: number;
  by_concept: Array<{
    concept: string;
    failures: number;
    retries: number;
  }>;
  by_error_type: Array<{ error_type: string; count: number }>;
}

export interface TrendData {
  window_size: number;
  cost_trend: Array<{
    story_id: string;
    cost: number;
    cumulative: number;
  }>;
  duration_trend: Array<{ story_id: string; duration_ms: number }>;
  failure_trend: Array<{ story_id: string; failure_rate: number }>;
}

export interface BenchmarkMetrics {
  generated_at: string;
  action_count: number;
  story_count: number;
  cost: CostMetrics;
  duration: DurationMetrics;
  quality: QualityMetrics;
  model_usage: ModelUsage;
  failures: FailureMetrics;
  trends?: TrendData;
}

// Learning types
export interface LearnedPattern {
  concept: string;
  action: string;
  occurrences: number;
  success_rate: number;
  avg_duration_ms: number;
  avg_cost: number;
  confidence: "low" | "medium" | "high";
  first_seen: string;
  last_seen: string;
  models_used: string[];
}

export interface MemoryCalibration {
  category: string;
  total_injections: number;
  led_to_success: number;
  effectiveness: number;
}

export interface LearningState {
  patterns: LearnedPattern[];
  calibrations: MemoryCalibration[];
}

export interface SkillTemplate {
  name: string;
  description: string;
  content: string;
  pattern: LearnedPattern;
}

// Drift types
export interface FileEntry {
  relativePath: string;
  fullPath: string;
  hash: string;
  category: string;
}

export interface DriftItem {
  relativePath: string;
  category: string;
  templatePath: string;
  installedPath: string;
}

export interface DriftReport {
  modified: DriftItem[];
  missing: DriftItem[];
  added: DriftItem[];
  scanned_at: string;
}

// Observability types
export interface PromptLogEntry {
  timestamp: string;
  session_id?: string;
  concept?: string;
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  duration_ms?: number;
  metadata?: Record<string, unknown>;
}

export interface SessionStats {
  session_id: string;
  total_tokens: number;
  call_count: number;
  concepts: string[];
  duration_ms: number;
}

export interface ObservabilityAnalysis {
  total_calls: number;
  total_tokens: number;
  unique_sessions: number;
  by_concept: Array<{
    concept: string;
    calls: number;
    tokens: number;
    avg_tokens: number;
  }>;
  by_model: Array<{
    model: string;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  }>;
  date_range: { from: string; to: string };
  top_sessions: SessionStats[];
}

// Validation types
export interface ValidationError {
  file: string;
  path?: string;
  message: string;
  severity: "error" | "warning";
}

export interface ValidationReport {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
  files_checked: number;
  schemas_used: string[];
}

// Timeline types
export interface TimelineEntry {
  action_id: string;
  timestamp: string;
  concept: string;
  action: string;
  status: string;
  model?: string;
  duration_ms?: number;
  cost_usd?: number;
  flow_id?: string;
}

export interface TimelineView {
  entries: TimelineEntry[];
  total_duration_ms: number;
  total_cost: number;
  flow_ids: string[];
  date_range: { from: string; to: string };
}
