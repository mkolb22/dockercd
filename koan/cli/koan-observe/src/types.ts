/**
 * Types for koan-observe CLI tool.
 */

export interface PromptLogEntry {
  timestamp: string;
  session_id: string;
  tool: string;
  concept: string;
  action: string;
  model: string;
  input_chars: number;
  estimated_tokens: number;
}

export interface DailyStats {
  date: string;
  total_calls: number;
  total_tokens: number;
  last_updated: string;
}

export interface ConceptStats {
  concept: string;
  calls: number;
  tokens: number;
  avg_tokens: number;
}

export interface SessionStats {
  session_id: string;
  calls: number;
  tokens: number;
  concepts: string[];
  start_time: string;
  end_time: string;
  duration_ms: number;
}

export interface ObservabilityAnalysis {
  total_calls: number;
  total_tokens: number;
  unique_sessions: number;
  by_concept: ConceptStats[];
  by_model: Record<string, number>;
  date_range: {
    from: string;
    to: string;
  };
  top_sessions: SessionStats[];
}

export interface CliOptions {
  from?: string;
  to?: string;
  concept?: string;
  format?: 'table' | 'json';
  limit?: number;
  verbose?: boolean;
}
