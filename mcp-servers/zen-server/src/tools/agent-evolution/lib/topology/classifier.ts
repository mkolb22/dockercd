/**
 * Task Complexity Classifier for MAS Orchestration.
 *
 * Determines the complexity of an incoming task and maps it to a
 * TaskComplexity level, which drives topology selection in the
 * co-evolution conductor.
 *
 * Pipeline:
 *   raw task → extractFeatures() → scoreDifficulty() → mapToComplexity()
 *   → selectForComplexity() → best evolved topology → MAS executes
 *
 * Three signal sources (fused with confidence-weighted averaging):
 * 1. Heuristic: keyword patterns, scope estimation, structural analysis
 * 2. Historical: past task outcomes with Jaccard similarity matching
 * 3. Semantic: embedding-based similarity to past workflow outcomes
 *    (optional, requires computeSemanticSignal from workflow-intelligence)
 *
 * Adaptive thresholds: complexity boundaries shift based on feedback
 * from completed tasks (outcome success/failure adjusts bins).
 *
 * Design references:
 * - Removed compute/classifier.ts (8c026be^) — heuristic + fusion design
 * - topology/mapping.ts — density-difficulty mapping, classifyTaskComplexity()
 * - framework/workflow-intelligence.ts — computeSemanticSignal()
 * - AGENT-EVOLUTION-RESEARCH.md Phase 2
 *
 * Constraints:
 * - Zero external dependencies (semantic signal is injectable)
 * - Pure functions where possible (Classifier state is explicit)
 * - All types serializable for persistence
 */

import type { TaskComplexity } from './types.js';

// ---------------------------------------------------------------------------
// Feature extraction types
// ---------------------------------------------------------------------------

/** Structural features extracted from task text. */
export interface TaskFeatures {
  /** Character count of the task description. */
  readonly queryLength: number;

  /** Word count. */
  readonly wordCount: number;

  /** Number of distinct code entities mentioned (functions, classes, etc.). */
  readonly codeEntityCount: number;

  /** Number of file/module references. */
  readonly fileReferenceCount: number;

  /** Whether complex operation patterns are detected. */
  readonly hasComplexPatterns: boolean;

  /** Whether security-sensitive keywords are present. */
  readonly hasSecurityKeywords: boolean;

  /** Whether architectural-scope keywords are present. */
  readonly hasArchitectureKeywords: boolean;

  /** Whether multi-step/multi-phase work is implied. */
  readonly hasMultiStepStructure: boolean;

  /** Estimated scope of the task. */
  readonly estimatedScope: 'small' | 'medium' | 'large';

  /** Number of explicit constraints or requirements. */
  readonly constraintCount: number;

  /** Count of distinct complex pattern keywords matched. */
  readonly complexPatternCount: number;

  /** Count of distinct security pattern keywords matched. */
  readonly securityPatternCount: number;

  /** Count of distinct architecture pattern keywords matched. */
  readonly architecturePatternCount: number;
}

/** Result of classifying a task. */
export interface ClassificationResult {
  /** Unique ID for tracking. */
  readonly id: string;

  /** The original task text. */
  readonly query: string;

  /** Raw difficulty score (0-10). */
  readonly difficulty: number;

  /** Mapped TaskComplexity level. */
  readonly complexity: TaskComplexity;

  /** Confidence in the classification (0-1). */
  readonly confidence: number;

  /** Extracted features. */
  readonly features: TaskFeatures;

  /** Which signals contributed to the score. */
  readonly fusionMethod: 'heuristic-only' | 'heuristic+historical' | 'full-fusion';

  /** ISO 8601 timestamp. */
  readonly timestamp: string;
}

/** Feedback record for adaptive threshold adjustment. */
export interface TaskFeedback {
  /** Classification ID this feedback is for. */
  readonly classificationId: string;

  /** Actual observed difficulty (0-10). */
  readonly actualDifficulty: number;

  /** Task outcome. */
  readonly outcome: 'success' | 'partial' | 'failure';

  /** Optional notes on what went wrong/right. */
  readonly notes?: string;
}

/** Semantic signal provider (injectable for testability). */
export type SemanticSignalProvider = (
  query: string,
) => Promise<{ score: number; confidence: number } | null>;

/** Classifier configuration. */
export interface ClassifierConfig {
  /** Difficulty thresholds for each complexity level. */
  readonly thresholds: {
    readonly trivial: number;   // difficulty ≤ this → trivial
    readonly simple: number;    // difficulty ≤ this → simple
    readonly medium: number;    // difficulty ≤ this → medium
    readonly complex: number;   // difficulty ≤ this → complex
    // difficulty > complex → expert
  };

  /** Signal fusion weights. */
  readonly weights: {
    readonly heuristic: number;
    readonly historical: number;
    readonly semantic: number;
  };

  /** Minimum Jaccard similarity for historical match. */
  readonly minHistoricalSimilarity: number;

  /** Minimum historical matches for signal inclusion. */
  readonly minHistoricalMatches: number;

  /** Minimum confidence for semantic signal inclusion. */
  readonly minSemanticConfidence: number;
}

// ---------------------------------------------------------------------------
// Default configuration
// ---------------------------------------------------------------------------

export const DEFAULT_CLASSIFIER_CONFIG: ClassifierConfig = {
  thresholds: {
    trivial: 1.5,
    simple: 3.5,
    medium: 5.5,
    complex: 7.5,
  },
  weights: {
    heuristic: 0.50,
    historical: 0.35,
    semantic: 0.15,
  },
  minHistoricalSimilarity: 0.1,
  minHistoricalMatches: 2,
  minSemanticConfidence: 0.3,
};

// ---------------------------------------------------------------------------
// Pattern dictionaries
// ---------------------------------------------------------------------------

const COMPLEX_PATTERNS = [
  'refactor', 'architect', 'design', 'optimize', 'migrate',
  'rewrite', 'overhaul', 'restructure', 'integrate', 'consolidate',
  'consensus', 'protocol', 'algorithm', 'failover', 'replicate',
  'replication', 'transaction', 'concurrent', 'synchron', 'idempoten',
  'cluster', 'shard', 'partition', 'quorum',
  'cach', 'middleware', 'validat', 'pagina', 'queue', 'batch',
];

const SECURITY_PATTERNS = [
  'security', 'vulnerability', 'auth', 'permission', 'encrypt',
  'credential', 'token', 'secret', 'injection', 'sanitize',
];

const ARCHITECTURE_PATTERNS = [
  'architecture', 'system', 'infrastructure', 'scale', 'distribute',
  'microservice', 'pattern', 'principle', 'pipeline', 'orchestrat',
];

const CODE_ENTITY_PATTERNS = [
  /\bfunction\s+\w+/gi,
  /\bclass\s+\w+/gi,
  /\binterface\s+\w+/gi,
  /\btype\s+\w+/gi,
  /\bmethod\s+\w+/gi,
  /\bmodule\s+\w+/gi,
  /\b\w+\(\)/g,
];

const FILE_PATTERNS = [
  /\b\w+\.(ts|js|py|go|rs|java|tsx|jsx|vue|svelte)\b/gi,
  /\bsrc\/\S+/gi,
  /\blib\/\S+/gi,
  /\btests?\/\S+/gi,
];

const MULTI_STEP_PATTERNS = [
  /\bstep\s+\d/gi,
  /\bfirst\b.*\bthen\b/gi,
  /\b(phase|stage)\s+\d/gi,
  /\b\d+\.\s+\w/gm,
  /\b(before|after|next|finally)\b/gi,
];

const CONSTRAINT_PATTERNS = [
  /\bmust\b/gi,
  /\bshould\b/gi,
  /\brequire[sd]?\b/gi,
  /\bensure\b/gi,
  /\bconstraint\b/gi,
  /\bneed[s]?\s+to\b/gi,
  /\bwithout\b/gi,
  /\bnot\s+allowed\b/gi,
];

// ---------------------------------------------------------------------------
// Feature extraction (pure function)
// ---------------------------------------------------------------------------

/**
 * Extracts structural features from task text.
 * Pure function — no side effects, no I/O.
 */
export function extractFeatures(query: string, context?: string): TaskFeatures {
  const text = `${query} ${context || ''}`;
  const lower = text.toLowerCase();
  const words = lower.split(/\s+/).filter(Boolean);

  // Code entity count
  let codeEntityCount = 0;
  for (const pat of CODE_ENTITY_PATTERNS) {
    const matches = text.match(pat);
    if (matches) codeEntityCount += matches.length;
  }

  // File reference count
  let fileReferenceCount = 0;
  for (const pat of FILE_PATTERNS) {
    const matches = text.match(pat);
    if (matches) fileReferenceCount += matches.length;
  }

  // Multi-step detection
  let multiStepCount = 0;
  for (const pat of MULTI_STEP_PATTERNS) {
    const matches = text.match(pat);
    if (matches) multiStepCount += matches.length;
  }

  // Constraint count
  let constraintCount = 0;
  for (const pat of CONSTRAINT_PATTERNS) {
    const matches = text.match(pat);
    if (matches) constraintCount += matches.length;
  }

  // Count distinct pattern matches per category
  let complexPatternCount = 0;
  for (const p of COMPLEX_PATTERNS) {
    if (lower.includes(p)) complexPatternCount++;
  }
  let securityPatternCount = 0;
  for (const p of SECURITY_PATTERNS) {
    if (lower.includes(p)) securityPatternCount++;
  }
  let architecturePatternCount = 0;
  for (const p of ARCHITECTURE_PATTERNS) {
    if (lower.includes(p)) architecturePatternCount++;
  }

  const hasComplexPatterns = complexPatternCount > 0;
  const hasSecurityKeywords = securityPatternCount > 0;
  const hasArchitectureKeywords = architecturePatternCount > 0;
  const hasMultiStepStructure = multiStepCount >= 2;

  // Scope estimation
  let estimatedScope: 'small' | 'medium' | 'large' = 'small';
  if (words.length > 100 || hasArchitectureKeywords || fileReferenceCount > 3) {
    estimatedScope = 'large';
  } else if (words.length > 30 || hasComplexPatterns || fileReferenceCount > 1 || hasMultiStepStructure) {
    estimatedScope = 'medium';
  }

  return {
    queryLength: query.length,
    wordCount: words.length,
    codeEntityCount,
    fileReferenceCount,
    hasComplexPatterns,
    hasSecurityKeywords,
    hasArchitectureKeywords,
    hasMultiStepStructure,
    estimatedScope,
    constraintCount,
    complexPatternCount,
    securityPatternCount,
    architecturePatternCount,
  };
}

// ---------------------------------------------------------------------------
// Difficulty scoring (pure function)
// ---------------------------------------------------------------------------

/**
 * Scores task difficulty from 0-10 based on extracted features.
 * Pure function — deterministic, no side effects.
 *
 * Budget breakdown (max contribution per signal):
 *   Length:      0-2.0    Words:       0-1.5
 *   Entities:    0-1.5    Files:       0-1.0
 *   Patterns:    0-3.5    Multi-step:  0-0.75
 *   Constraints: 0-1.0    Depth:       0-1.5
 *   Interaction: 0-0.75   Scope:       ×1.05-1.10
 *   Theoretical max: ~13.5 × 1.10 ≈ 14.9 → capped at 10
 *
 * Tuning notes (calibration corpus — 16 entries, 5 levels):
 * - Pattern weights reduced from 4.5 to 3.5 (prevents saturation)
 * - Interaction bonus reduced from +1/+2 to +0.4/+0.75
 * - Depth bonus added to distinguish complex (1-2 keywords/category)
 *   from expert (3+ keywords/category)
 * - Scope multiplier reduced from 1.15 to 1.10 for large scope
 */
export function scoreDifficulty(features: TaskFeatures): number {
  let score = 0;

  // Length factor (0-2)
  if (features.queryLength > 300) score += 2;
  else if (features.queryLength > 150) score += 1.5;
  else if (features.queryLength > 50) score += 0.5;

  // Word count factor (0-1.5)
  if (features.wordCount > 80) score += 1.5;
  else if (features.wordCount > 30) score += 0.75;

  // Code complexity (0-1.5)
  score += Math.min(1.5, features.codeEntityCount * 0.3);

  // File scope (0-1.0)
  score += Math.min(1, features.fileReferenceCount * 0.4);

  // Pattern presence (0-3.5)
  if (features.hasComplexPatterns) score += 1.5;
  if (features.hasSecurityKeywords) score += 1.0;
  if (features.hasArchitectureKeywords) score += 1.0;

  // Multi-step (0-0.75)
  if (features.hasMultiStepStructure) score += 0.75;

  // Constraint density (0-1)
  score += Math.min(1, features.constraintCount * 0.15);

  // Depth bonus: multiple distinct keywords in the same category
  // signal deeper domain involvement (0-1.5)
  const depthBonus =
    Math.max(0, features.complexPatternCount - 1) * 0.35 +
    Math.max(0, features.securityPatternCount - 1) * 0.35 +
    Math.max(0, features.architecturePatternCount - 1) * 0.35;
  score += Math.min(1.5, depthBonus);

  // Category interaction: crossing multiple domains (0-0.75)
  const patternCategories =
    (features.hasComplexPatterns ? 1 : 0) +
    (features.hasSecurityKeywords ? 1 : 0) +
    (features.hasArchitectureKeywords ? 1 : 0);
  if (patternCategories >= 3) score += 0.75;
  else if (patternCategories >= 2) score += 0.4;

  // Scope multiplier (additive would be cleaner, but multiplicative
  // preserves the relative ordering from other signals)
  if (features.estimatedScope === 'large') score *= 1.10;
  else if (features.estimatedScope === 'medium') score *= 1.05;

  return Math.min(10, Math.max(0, score));
}

/**
 * Maps a difficulty score (0-10) to a TaskComplexity level.
 * Pure function.
 */
export function mapToComplexity(
  difficulty: number,
  config: ClassifierConfig = DEFAULT_CLASSIFIER_CONFIG,
): TaskComplexity {
  if (difficulty <= config.thresholds.trivial) return 'trivial';
  if (difficulty <= config.thresholds.simple) return 'simple';
  if (difficulty <= config.thresholds.medium) return 'medium';
  if (difficulty <= config.thresholds.complex) return 'complex';
  return 'expert';
}

// ---------------------------------------------------------------------------
// Confidence calculation (pure function)
// ---------------------------------------------------------------------------

/**
 * Computes confidence in the heuristic classification.
 * Higher when there are strong, unambiguous signals.
 */
export function calculateConfidence(features: TaskFeatures): number {
  let confidence = 0.5;

  // Clear complexity signals increase confidence
  if (features.hasComplexPatterns || features.hasArchitectureKeywords) confidence += 0.15;
  if (features.hasSecurityKeywords) confidence += 0.1;
  if (features.estimatedScope !== 'small') confidence += 0.1;

  // Many code entities = clearer scope
  if (features.codeEntityCount >= 3) confidence += 0.1;

  // File references = clearer scope
  if (features.fileReferenceCount >= 2) confidence += 0.05;

  return Math.min(1, Math.max(0, confidence));
}

// ---------------------------------------------------------------------------
// Jaccard similarity (pure function)
// ---------------------------------------------------------------------------

/**
 * Computes Jaccard similarity between two text strings.
 * Uses word-level overlap with minimum word length filter.
 */
export function jaccardSimilarity(a: string, b: string, minWordLength: number = 2): number {
  const aWords = new Set(a.toLowerCase().split(/\s+/).filter((w) => w.length > minWordLength));
  const bWords = new Set(b.toLowerCase().split(/\s+/).filter((w) => w.length > minWordLength));

  if (aWords.size === 0 && bWords.size === 0) return 1;
  if (aWords.size === 0 || bWords.size === 0) return 0;

  let intersection = 0;
  for (const w of aWords) {
    if (bWords.has(w)) intersection++;
  }

  const union = new Set([...aWords, ...bWords]).size;
  return union > 0 ? intersection / union : 0;
}

// ---------------------------------------------------------------------------
// Task Complexity Classifier
// ---------------------------------------------------------------------------

/**
 * Stateful classifier that maintains history and feedback for
 * adaptive complexity classification.
 *
 * Usage:
 * ```typescript
 * const classifier = new TaskComplexityClassifier();
 *
 * // Classify a task
 * const result = await classifier.classify("Refactor the auth module to use JWT tokens");
 * // → { complexity: 'complex', difficulty: 7.2, confidence: 0.75 }
 *
 * // After task completes, provide feedback
 * classifier.addFeedback({
 *   classificationId: result.id,
 *   actualDifficulty: 8.0,
 *   outcome: 'success',
 * });
 *
 * // Future classifications improve via historical signal
 * ```
 */
export class TaskComplexityClassifier {
  private history: ClassificationResult[] = [];
  private feedback: TaskFeedback[] = [];
  private counter = 0;
  private readonly config: ClassifierConfig;
  private readonly semanticProvider: SemanticSignalProvider | null;

  // Adaptive thresholds (null = use config defaults)
  private adjustedThresholds: ClassifierConfig['thresholds'] | null = null;

  constructor(
    config: ClassifierConfig = DEFAULT_CLASSIFIER_CONFIG,
    semanticProvider: SemanticSignalProvider | null = null,
  ) {
    this.config = config;
    this.semanticProvider = semanticProvider;
  }

  /** Current effective thresholds (adjusted or default). */
  get effectiveThresholds(): ClassifierConfig['thresholds'] {
    return this.adjustedThresholds ?? this.config.thresholds;
  }

  /** Number of classifications performed. */
  get classificationCount(): number {
    return this.history.length;
  }

  /** Number of feedback records received. */
  get feedbackCount(): number {
    return this.feedback.length;
  }

  // -------------------------------------------------------------------------
  // Classification
  // -------------------------------------------------------------------------

  /**
   * Classifies a task's complexity using multi-signal fusion.
   *
   * Signals:
   * 1. Heuristic (always): keyword patterns + structural analysis
   * 2. Historical (when available): Jaccard similarity to past tasks
   * 3. Semantic (when available): embedding similarity via provider
   */
  async classify(query: string, context?: string): Promise<ClassificationResult> {
    const features = extractFeatures(query, context);
    const heuristicScore = scoreDifficulty(features);
    const heuristicConfidence = calculateConfidence(features);

    // Historical signal
    const historicalSignal = this.computeHistoricalSignal(query);

    // Semantic signal (optional)
    let semanticSignal: { score: number; confidence: number } | null = null;
    if (this.semanticProvider) {
      try {
        semanticSignal = await this.semanticProvider(query);
      } catch {
        // Graceful degradation
      }
    }

    // Fuse signals
    const fused = this.fuseSignals(
      { score: heuristicScore, confidence: heuristicConfidence },
      historicalSignal,
      semanticSignal,
    );

    const id = `tc-${++this.counter}`;
    const effectiveConfig = this.adjustedThresholds
      ? { ...this.config, thresholds: this.adjustedThresholds }
      : this.config;

    const result: ClassificationResult = {
      id,
      query,
      difficulty: fused.difficulty,
      complexity: mapToComplexity(fused.difficulty, effectiveConfig),
      confidence: fused.confidence,
      features,
      fusionMethod: fused.fusionMethod,
      timestamp: new Date().toISOString(),
    };

    this.history.push(result);
    return result;
  }

  /**
   * Synchronous classification using only heuristic signal.
   * Useful when historical/semantic data isn't needed.
   */
  classifySync(query: string, context?: string): ClassificationResult {
    const features = extractFeatures(query, context);
    const heuristicScore = scoreDifficulty(features);
    const heuristicConfidence = calculateConfidence(features);

    const id = `tc-${++this.counter}`;
    const effectiveConfig = this.adjustedThresholds
      ? { ...this.config, thresholds: this.adjustedThresholds }
      : this.config;

    const result: ClassificationResult = {
      id,
      query,
      difficulty: heuristicScore,
      complexity: mapToComplexity(heuristicScore, effectiveConfig),
      confidence: heuristicConfidence,
      features,
      fusionMethod: 'heuristic-only',
      timestamp: new Date().toISOString(),
    };

    this.history.push(result);
    return result;
  }

  // -------------------------------------------------------------------------
  // Feedback + adaptive thresholds
  // -------------------------------------------------------------------------

  /** Record feedback for a classification to improve future accuracy. */
  addFeedback(feedback: TaskFeedback): void {
    this.feedback.push(feedback);
  }

  /**
   * Adjusts complexity thresholds based on accumulated feedback.
   *
   * Logic:
   * - If tasks classified as 'simple' frequently fail → lower simple threshold
   *   (push more tasks into higher complexity bins)
   * - If tasks classified as 'complex' frequently succeed easily → raise
   *   complex threshold (push more tasks into lower bins)
   *
   * Returns the adjustments made.
   */
  adjustThresholds(): { thresholds: ClassifierConfig['thresholds']; adjustments: string[] } {
    const adjustments: string[] = [];
    const t = { ...this.config.thresholds };

    // Group feedback by classified complexity
    const byComplexity = new Map<TaskComplexity, { total: number; failures: number; overEstimated: number }>();
    for (const c of ['trivial', 'simple', 'medium', 'complex', 'expert'] as TaskComplexity[]) {
      byComplexity.set(c, { total: 0, failures: 0, overEstimated: 0 });
    }

    for (const fb of this.feedback) {
      const classification = this.history.find((h) => h.id === fb.classificationId);
      if (!classification) continue;

      const group = byComplexity.get(classification.complexity)!;
      group.total++;
      if (fb.outcome === 'failure') group.failures++;
      if (fb.actualDifficulty < classification.difficulty - 2) group.overEstimated++;
    }

    // Simple tasks failing often → lower threshold (fewer tasks classified as simple)
    const simpleGroup = byComplexity.get('simple')!;
    if (simpleGroup.total >= 5) {
      const failRate = simpleGroup.failures / simpleGroup.total;
      if (failRate > 0.3) {
        t.simple = Math.max(t.simple - 0.5, 2.0);
        adjustments.push(`Simple failure rate ${(failRate * 100).toFixed(0)}% → lowered simple threshold to ${t.simple}`);
      }
    }

    // Medium tasks failing often → lower threshold
    const mediumGroup = byComplexity.get('medium')!;
    if (mediumGroup.total >= 5) {
      const failRate = mediumGroup.failures / mediumGroup.total;
      if (failRate > 0.3) {
        t.medium = Math.max(t.medium - 0.5, 4.0);
        adjustments.push(`Medium failure rate ${(failRate * 100).toFixed(0)}% → lowered medium threshold to ${t.medium}`);
      }
    }

    // Complex tasks consistently over-estimated → raise threshold
    const complexGroup = byComplexity.get('complex')!;
    if (complexGroup.total >= 5) {
      const overRate = complexGroup.overEstimated / complexGroup.total;
      if (overRate > 0.5) {
        t.complex = Math.min(t.complex + 0.5, 8.5);
        adjustments.push(`Complex over-estimation rate ${(overRate * 100).toFixed(0)}% → raised threshold to ${t.complex}`);
      }
    }

    this.adjustedThresholds = t;
    return { thresholds: t, adjustments };
  }

  // -------------------------------------------------------------------------
  // Historical signal
  // -------------------------------------------------------------------------

  /** Find similar past tasks that have feedback. */
  private findSimilarWithFeedback(
    query: string,
    limit: number,
  ): Array<{ difficulty: number; similarity: number; outcome: TaskFeedback['outcome'] }> {
    return this.history
      .filter((h) => this.feedback.some((f) => f.classificationId === h.id))
      .map((h) => {
        const similarity = jaccardSimilarity(query, h.query);
        const fb = this.feedback.find((f) => f.classificationId === h.id)!;
        return {
          difficulty: fb.actualDifficulty,
          similarity,
          outcome: fb.outcome,
        };
      })
      .filter((s) => s.similarity > this.config.minHistoricalSimilarity)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  /** Compute historical difficulty signal from similar past tasks. */
  private computeHistoricalSignal(
    query: string,
  ): { score: number; confidence: number; matchCount: number } | null {
    const similar = this.findSimilarWithFeedback(query, 10);
    if (similar.length < this.config.minHistoricalMatches) return null;

    let totalWeight = 0;
    let weightedScore = 0;

    for (let i = 0; i < similar.length; i++) {
      const s = similar[i];
      const recencyWeight = 1 - i * 0.05;
      const weight = s.similarity * recencyWeight;

      // Failures suggest the task was harder than estimated
      const outcomeMultiplier = s.outcome === 'success' ? 0.9 : s.outcome === 'partial' ? 1.0 : 1.2;
      weightedScore += s.difficulty * outcomeMultiplier * weight;
      totalWeight += weight;
    }

    if (totalWeight === 0) return null;

    const score = weightedScore / totalWeight;
    const avgSimilarity = similar.reduce((sum, s) => sum + s.similarity, 0) / similar.length;
    const confidence = Math.min(0.9, avgSimilarity * (0.5 + Math.min(similar.length / 10, 0.5)));

    return { score, confidence, matchCount: similar.length };
  }

  // -------------------------------------------------------------------------
  // Signal fusion
  // -------------------------------------------------------------------------

  private fuseSignals(
    heuristic: { score: number; confidence: number },
    historical: { score: number; confidence: number; matchCount: number } | null,
    semantic: { score: number; confidence: number } | null,
  ): { difficulty: number; confidence: number; fusionMethod: ClassificationResult['fusionMethod'] } {
    let fusionMethod: ClassificationResult['fusionMethod'] = 'heuristic-only';

    // Confidence-weighted averaging: both numerator and denominator use
    // (weight × confidence) so that confidence scales a signal's influence
    // relative to other signals, but does NOT attenuate a lone signal's score.
    const hW = this.config.weights.heuristic * heuristic.confidence;
    let totalWeight = hW;
    let weightedDifficulty = heuristic.score * hW;
    let weightedConfidence = heuristic.confidence * this.config.weights.heuristic;

    // Historical signal
    if (historical && historical.matchCount >= this.config.minHistoricalMatches) {
      const histBase = this.config.weights.historical * Math.min(historical.matchCount / 5, 1);
      const histW = histBase * historical.confidence;
      weightedDifficulty += historical.score * histW;
      weightedConfidence += historical.confidence * histBase;
      totalWeight += histW;
      fusionMethod = 'heuristic+historical';
    }

    // Semantic signal
    if (semantic && semantic.confidence > this.config.minSemanticConfidence) {
      const semBase = this.config.weights.semantic;
      const semW = semBase * semantic.confidence;
      weightedDifficulty += semantic.score * semW;
      weightedConfidence += semantic.confidence * semBase;
      totalWeight += semW;
      fusionMethod = 'full-fusion';
    }

    const difficulty = totalWeight > 0 ? weightedDifficulty / totalWeight : heuristic.score;
    const confDenom = this.config.weights.heuristic +
      (fusionMethod !== 'heuristic-only' ? this.config.weights.historical : 0) +
      (fusionMethod === 'full-fusion' ? this.config.weights.semantic : 0);
    const confidence = confDenom > 0 ? weightedConfidence / confDenom : heuristic.confidence;

    return {
      difficulty: Math.min(10, Math.max(0, difficulty)),
      confidence: Math.min(1, Math.max(0, confidence)),
      fusionMethod,
    };
  }

  // -------------------------------------------------------------------------
  // Statistics / introspection
  // -------------------------------------------------------------------------

  /** Returns classification accuracy based on feedback. */
  getAccuracy(): { total: number; correct: number; rate: number } {
    let correct = 0;
    let total = 0;

    for (const fb of this.feedback) {
      const classification = this.history.find((h) => h.id === fb.classificationId);
      if (!classification) continue;

      total++;
      const actualComplexity = mapToComplexity(fb.actualDifficulty, this.config);
      if (actualComplexity === classification.complexity) {
        correct++;
      }
    }

    return { total, correct, rate: total > 0 ? correct / total : 0 };
  }

  /** Returns distribution of classifications across complexity levels. */
  getDistribution(): Readonly<Record<TaskComplexity, number>> {
    const dist: Record<TaskComplexity, number> = {
      trivial: 0, simple: 0, medium: 0, complex: 0, expert: 0,
    };
    for (const h of this.history) {
      dist[h.complexity]++;
    }
    return dist;
  }

  /** Exports classifier state for persistence. */
  exportState(): {
    history: readonly ClassificationResult[];
    feedback: readonly TaskFeedback[];
    adjustedThresholds: ClassifierConfig['thresholds'] | null;
  } {
    return {
      history: this.history,
      feedback: this.feedback,
      adjustedThresholds: this.adjustedThresholds,
    };
  }

  /** Imports previously exported state. */
  importState(state: {
    history: readonly ClassificationResult[];
    feedback: readonly TaskFeedback[];
    adjustedThresholds: ClassifierConfig['thresholds'] | null;
  }): void {
    this.history = [...state.history];
    this.feedback = [...state.feedback];
    this.adjustedThresholds = state.adjustedThresholds;
    this.counter = this.history.length;
  }
}
