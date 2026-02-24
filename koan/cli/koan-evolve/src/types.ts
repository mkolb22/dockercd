/**
 * Type definitions for koan-evolve CLI
 * Phase 1: Fitness Tracking
 * Phase 5.2: Prompt Population
 * Phase 5.3: Adaptive Model Routing
 */

import type { Concept } from '@zen/koan-core';

// Fitness calculation metrics
export interface FitnessMetrics {
  test_pass_rate: number;
  quality_score: number;
  user_acceptance: number;
}

// Individual fitness score
export interface FitnessScore {
  variant_id: string;
  runs: number;
  fitness: {
    current: number;
    rolling_avg_10: number;
    trend: 'improving' | 'stable' | 'degrading';
  };
  metrics: FitnessMetrics;
  history: FitnessHistoryEntry[];
}

// Fitness history entry
export interface FitnessHistoryEntry {
  timestamp: string;
  fitness: number;
  run_count: number;
}

// Complete fitness state for a concept
export interface FitnessState {
  concept: Concept;
  current_variant: string;
  variants: FitnessScore[];
  promotion_threshold: number;
  minimum_runs: number;
  metadata: {
    last_updated: string;
    checksum: string;
  };
}

// State validation result
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// Integrity check result
export interface IntegrityResult {
  valid: boolean;
  expectedChecksum: string;
  actualChecksum: string;
  error?: string;
}

// CLI options
export interface CliOptions {
  verbose?: boolean;
  concept?: string;
  json?: boolean;
  arch?: string;
  list?: boolean;
  config?: boolean;
  // Phase 5.2: Population management
  focus?: string;
  variantA?: string;
  variantB?: string;
  variant?: string;
  dryRun?: boolean;
  parents?: string;
  prepare?: boolean;
  contentFile?: string;
  // Phase 5.3: Model routing
  recommend?: boolean;
  setLimit?: string;
}

// Status display for all concepts
export interface ConceptFitness {
  concept: Concept;
  current_variant: string;
  current_fitness: number;
  runs: number;
  trend: 'improving' | 'stable' | 'degrading';
  variant_count: number;
}

// ============================================================================
// PHASE 5.2: PROMPT POPULATION TYPES
// ============================================================================

// Re-export from population/manager for convenience
export type { PromptVariant, Population, PromotionResult, VariantMetadata } from './population/manager.js';
export type { MutationConfig, CrossoverConfig } from './population/mutator.js';
export type { Finding, QuarantineRecord } from './security/variant-validator.js';

// ============================================================================
// PHASE 5.3: MODEL ROUTING TYPES
// ============================================================================

// Re-export from routing modules for convenience
export type { Model, ModelPerformanceMetrics, ConceptActionPerformance, PerformanceState } from './routing/performance.js';
export type { RoutingDecision, RoutingConfig, RoutingRecommendation } from './routing/router.js';
export type { OptimizationReport } from './routing/optimizer.js';
export type { BudgetLimits, BudgetStatus, SpendRecord, BudgetState, BudgetCheckResult, CostAlert } from './security/budget-enforcer.js';

// ============================================================================
// PHASE 5.4: MULTI-AGENT DEBATE TYPES
// ============================================================================

// Debate configuration
export interface DebateConfig {
  enabled: boolean;
  trigger_concepts: string[];
  timeout_seconds: number;
  min_confidence_for_auto_accept: number;
  require_human_approval_below: number;
}

// Advocate agent output
export interface AdvocateOutput {
  agent: 'debate-advocate';
  model: 'sonnet';
  proposed_approach: string;
  confidence: number;
  key_arguments: string[];
  timeout?: boolean;
}

// Critic concern
export interface CriticConcern {
  concern: string;
  severity: 'low' | 'medium' | 'high';
  suggestion: string;
}

// Critic agent output
export interface CriticOutput {
  agent: 'debate-critic';
  model: 'sonnet';
  confidence: number;
  concerns: CriticConcern[];
  risk_assessment: 'low' | 'medium' | 'high' | 'unknown';
  timeout?: boolean;
}

// Synthesis agent output
export interface SynthesisOutput {
  agent: 'debate-synthesis';
  model: 'opus';
  final_decision: string;
  confidence: number;
  incorporated_concerns: string[];
  remaining_risks: string[];
  dissent_documented: boolean;
  dissent_summary: string;
  recommendation: 'proceed' | 'revise' | 'escalate';
  timeout?: boolean;
}

// Complete debate result
export interface DebateResult {
  debate_id: string;
  arch_id: string;
  duration_ms: number;
  advocate: AdvocateOutput;
  critic: CriticOutput;
  synthesis: SynthesisOutput;
  metadata: {
    triggered_by: string;
    model_used: string;
    cost: number;
    sanitization_applied: boolean;
    timeout_occurred?: boolean;
    last_updated?: string;
    checksum: string;
  };
}

// Sanitized context
export interface SanitizedContext {
  sanitized_text: string;
  redactions: SanitizationEntry[];
  original_hash: string;
}

// PII match
export interface PIIMatch {
  type: string;
  value: string;
  index: number;
  length: number;
}

// Secret match
export interface SecretMatch {
  type: string;
  value: string;
  index: number;
  length: number;
}

// Sanitization log entry
export interface SanitizationEntry {
  type: 'pii' | 'secret';
  subtype: string;
  count: number;
  timestamp: string;
  context_hash?: string;
}
