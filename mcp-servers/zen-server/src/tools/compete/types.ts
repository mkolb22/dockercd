/**
 * Types for the competitive evaluation module.
 * Dual-arm experiments comparing Zen-assisted vs vanilla code generation,
 * with statistical analysis (Welch's t-test, Cohen's d) and tool ablation.
 */

export type CompeteStatus = "active" | "evaluating" | "completed" | "ablating";
export type CompeteArm = "control" | "treatment";
export type ToolCategory = "ast" | "semantic" | "memory" | "framework" | "spec" | "all";

export interface FitnessScores {
  correctness: number;  // 0-1, weight 0.30 — go test pass rate + race detector
  contracts: number;    // 0-1, weight 0.20 — property-based test pass rate
  security: number;     // 0-1, weight 0.20 — gosec findings (inverted)
  performance: number;  // 0-1, weight 0.10 — benchmark ns/op (normalized)
  complexity: number;   // 0-1, weight 0.10 — gocyclo avg (inverted)
  lint: number;         // 0-1, weight 0.10 — go vet + staticcheck findings
}

export const DEFAULT_WEIGHTS: FitnessScores = {
  correctness: 0.30,
  contracts: 0.20,
  security: 0.20,
  performance: 0.10,
  complexity: 0.10,
  lint: 0.10,
};

export const DIMENSIONS = Object.keys(DEFAULT_WEIGHTS) as (keyof FitnessScores)[];

export interface CompeteConfig {
  totalRounds: number;
  significanceLevel: number;
  specId: string;
  targetLanguage: string;
}

export interface CompeteSession {
  id: string;
  specId: string;
  specName: string;
  config: CompeteConfig;
  status: CompeteStatus;
  currentRound: number;
  winner: string | null;         // null | "control" | "treatment" | "inconclusive"
  summaryJson: string | null;    // JSON: CompeteSummary
  createdAt: string;
  updatedAt: string;
}

export interface CompeteRound {
  id: string;
  sessionId: string;
  round: number;
  arm: CompeteArm;
  scores: FitnessScores;
  composite: number;
  rawMetrics: string | null;     // JSON: optional raw Go toolchain output
  createdAt: string;
}

export interface DimensionStats {
  dimension: string;
  controlMean: number;
  controlStd: number;
  treatmentMean: number;
  treatmentStd: number;
  tStatistic: number;
  pValue: number;
  cohensD: number;
  significant: boolean;
  winner: "control" | "treatment" | "inconclusive";
}

export interface CompeteSummary {
  overallWinner: "control" | "treatment" | "inconclusive";
  compositeStats: DimensionStats;
  dimensionStats: DimensionStats[];
  roundsCompleted: number;
}

export interface AblationRun {
  id: string;
  sessionId: string;
  disabledCategory: ToolCategory;
  round: number;
  scores: FitnessScores;
  composite: number;
  status: string;
  createdAt: string;
}

export interface AblationResult {
  category: ToolCategory;
  meanComposite: number;
  deltaFromFull: number;
  pValue: number;
  cohensD: number;
  recommendation: "keep" | "remove" | "investigate";
}

export interface AblationSummary {
  fullTreatmentMean: number;
  results: AblationResult[];
  minimalEffectiveToolset: ToolCategory[];
}
