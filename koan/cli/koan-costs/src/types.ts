/**
 * CLI-specific types for koan-costs.
 * Shared types (ProvenanceAction, CostInfo, etc.) come from @zen/koan-core.
 */

import type { Concept, Model } from '@zen/koan-core';

export type { Concept, Model };

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

export interface CliOptions {
  from?: string;
  to?: string;
  concept?: string;
  model?: string;
  flow?: string;
  chart?: boolean;
  json?: boolean;
  verbose?: boolean;
}
