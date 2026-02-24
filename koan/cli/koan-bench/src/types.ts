/**
 * Type definitions for benchmark metrics and options.
 */

export type { Concept, Model, ProvenanceAction } from '@zen/koan-core';

export interface CostMetrics {
  total_spend: number;
  by_concept: Array<{
    concept: string;
    total: number;
    avg: number;
    count: number;
  }>;
  by_story: Array<{
    story_id: string;
    total: number;
    count: number;
  }>;
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
  by_story: Array<{
    story_id: string;
    total_ms: number;
    count: number;
  }>;
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
  distribution: Array<{
    model: string;
    count: number;
    percentage: number;
  }>;
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
  by_error_type: Array<{
    error_type: string;
    count: number;
  }>;
}

export interface TrendData {
  window_size: number;
  cost_trend: Array<{
    story_id: string;
    cost: number;
    cumulative: number;
  }>;
  duration_trend: Array<{
    story_id: string;
    duration_ms: number;
  }>;
  failure_trend: Array<{
    story_id: string;
    failure_rate: number;
  }>;
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

export interface CliOptions {
  verbose?: boolean;
  json?: boolean;
  since?: string;
  concept?: string;
  stories?: number;
}
