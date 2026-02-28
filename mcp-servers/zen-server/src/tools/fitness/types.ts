/**
 * Fitness Module Types
 * Fitness tracking, population management, model routing, budget enforcement, debate.
 */

export type Concept = "story" | "architecture" | "implementation" | "quality" | "version" | "context" | "retrospective" | "security" | "documentation" | "code-analysis" | "verification";
export type Model = "haiku" | "sonnet" | "opus";
export type FitnessTrend = "improving" | "stable" | "degrading";
export type VariantStatus = "active" | "promoted" | "archived" | "quarantined";
export type DebateRecommendation = "proceed" | "revise" | "escalate";
export type AlertType = "anomaly" | "threshold_warning" | "limit_exceeded";
export type AlertSeverity = "low" | "medium" | "high";

// ─── Fitness ──────────────────────────────────────────────────

export interface FitnessMetrics {
  test_pass_rate: number;
  quality_score: number;
  user_acceptance: number;
}

export interface FitnessHistoryEntry {
  timestamp: string;
  fitness: number;
  run_count: number;
}

export interface FitnessScore {
  variant_id: string;
  runs: number;
  fitness: { current: number; rolling_avg_10: number; trend: FitnessTrend };
  metrics: FitnessMetrics;
  history: FitnessHistoryEntry[];
}

export interface FitnessState {
  concept: string;
  current_variant: string;
  variants: FitnessScore[];
  promotion_threshold: number;
  minimum_runs: number;
}

export interface ConceptFitness {
  concept: string;
  current_variant: string;
  current_fitness: number;
  runs: number;
  trend: FitnessTrend;
  variant_count: number;
}

// ─── Population ───────────────────────────────────────────────

export interface PromptVariant {
  variant_id: string;
  parent?: string;
  created_at: string;
  mutation_type?: string;
  mutation_focus?: string;
  fitness_at_creation: number | null;
  status: VariantStatus;
  checksum: string;
  content: string;
}

export interface MutationConfig {
  focus: string;
  recentFailures: string[];
}

export interface CrossoverConfig {
  variantA: PromptVariant;
  variantB: PromptVariant;
  fitnessA: number;
  fitnessB: number;
}

// ─── Routing ──────────────────────────────────────────────────

export interface ModelPerformanceMetrics {
  runs: number;
  successes: number;
  failures: number;
  success_rate: number;
  avg_cost: number;
  avg_duration_ms: number;
  last_20_runs: boolean[];
}

export interface ConceptActionPerformance {
  concept: string;
  action: string;
  models: Partial<Record<Model, ModelPerformanceMetrics>>;
}

export interface PerformanceState {
  concept_actions: ConceptActionPerformance[];
}

export interface RoutingDecision {
  model: Model;
  reason: "exploit" | "explore" | "fallback";
  confidence: number;
  estimated_cost: number;
}

export interface RoutingConfig {
  epsilon: number;
  success_threshold: number;
}

export interface RoutingRecommendation {
  concept: string;
  action: string;
  current_model: Model;
  recommended_model: Model;
  potential_savings_per_run: number;
  success_rate: number;
  runs: number;
}

// ─── Budget ───────────────────────────────────────────────────

export interface BudgetLimits {
  daily_limit_usd: number;
  weekly_limit_usd: number;
  monthly_limit_usd: number;
  per_operation_limit_usd: number;
}

export interface BudgetStatus {
  current_daily_spend: number;
  current_weekly_spend: number;
  current_monthly_spend: number;
  daily_remaining: number;
  weekly_remaining: number;
  monthly_remaining: number;
  reset_times: {
    daily_reset: string;
    weekly_reset: string;
    monthly_reset: string;
  };
}

export interface SpendRecord {
  timestamp: string;
  concept: string;
  action: string;
  model: Model;
  cost: number;
}

export interface BudgetState {
  limits: BudgetLimits;
  spend_records: SpendRecord[];
}

export interface BudgetCheckResult {
  allowed: boolean;
  reason?: string;
  remaining: number;
}

export interface CostAlert {
  type: AlertType;
  severity: AlertSeverity;
  message: string;
  details: {
    concept: string;
    action: string;
    model: Model;
    cost: number;
    baseline?: number;
    threshold?: number;
  };
}

// ─── Debate ───────────────────────────────────────────────────

export interface AdvocateOutput {
  agent: "debate-advocate";
  model: "sonnet";
  proposed_approach: string;
  confidence: number;
  key_arguments: string[];
}

export interface CriticConcern {
  concern: string;
  severity: AlertSeverity;
  suggestion: string;
}

export interface CriticOutput {
  agent: "debate-critic";
  model: "sonnet";
  confidence: number;
  concerns: CriticConcern[];
  risk_assessment: "low" | "medium" | "high" | "unknown";
}

export interface SynthesisOutput {
  agent: "debate-synthesis";
  model: "opus";
  final_decision: string;
  confidence: number;
  incorporated_concerns: string[];
  remaining_risks: string[];
  dissent_documented: boolean;
  dissent_summary: string;
  recommendation: DebateRecommendation;
}

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
  };
}
