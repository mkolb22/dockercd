/**
 * Pure learning functions for extracting workflow patterns and computing calibration.
 * No I/O — operates on in-memory ProvenanceAction arrays.
 */

import type {
  ProvenanceAction,
  LearnedPattern,
  MemoryCalibration,
  LearningState,
  SkillTemplate,
} from "./types.js";

/**
 * Extract recurring patterns from provenance actions.
 * Groups by concept-action pair, computes success rate, duration, cost, confidence.
 */
export function extractPatterns(actions: ProvenanceAction[]): LearnedPattern[] {
  const groups = new Map<string, {
    concept: string;
    action: string;
    total: number;
    successes: number;
    durations: number[];
    costs: number[];
    timestamps: string[];
    models: Set<string>;
  }>();

  for (const a of actions) {
    const key = `${a.concept}:${a.action}`;
    const g = groups.get(key) || {
      concept: a.concept,
      action: a.action,
      total: 0,
      successes: 0,
      durations: [],
      costs: [],
      timestamps: [],
      models: new Set<string>(),
    };

    g.total += 1;
    if (a.status === "completed") g.successes += 1;
    if (a.duration_ms) g.durations.push(a.duration_ms);
    if (a.cost?.cost_usd) g.costs.push(a.cost.cost_usd);
    g.timestamps.push(a.timestamp);
    if (a.model) g.models.add(a.model);
    groups.set(key, g);
  }

  return Array.from(groups.values()).map((g) => {
    const successRate = g.total > 0 ? g.successes / g.total : 0;
    const avgDuration = g.durations.length > 0
      ? g.durations.reduce((s, d) => s + d, 0) / g.durations.length
      : 0;
    const avgCost = g.costs.length > 0
      ? g.costs.reduce((s, c) => s + c, 0) / g.costs.length
      : 0;

    const sorted = [...g.timestamps].sort();

    let confidence: LearnedPattern["confidence"];
    if (g.total >= 10 && successRate >= 0.8) confidence = "high";
    else if (g.total >= 5 && successRate >= 0.6) confidence = "medium";
    else confidence = "low";

    return {
      concept: g.concept,
      action: g.action,
      occurrences: g.total,
      success_rate: successRate,
      avg_duration_ms: avgDuration,
      avg_cost: avgCost,
      confidence,
      first_seen: sorted[0] || "",
      last_seen: sorted[sorted.length - 1] || "",
      models_used: Array.from(g.models),
    };
  }).sort((a, b) => b.occurrences - a.occurrences);
}

/**
 * Compute memory calibration effectiveness per concept.
 * Measures how often memory injections led to successful outcomes.
 */
export function computeCalibration(actions: ProvenanceAction[]): MemoryCalibration[] {
  const groups = new Map<string, { injections: number; successes: number }>();

  for (const a of actions) {
    const hasMemoryInjection = a.metadata?.memory_injected === true
      || a.metadata?.memories_used !== undefined;

    if (!hasMemoryInjection) continue;

    const g = groups.get(a.concept) || { injections: 0, successes: 0 };
    g.injections += 1;
    if (a.status === "completed" && !a.error) g.successes += 1;
    groups.set(a.concept, g);
  }

  return Array.from(groups.entries())
    .map(([category, g]) => ({
      category,
      total_injections: g.injections,
      led_to_success: g.successes,
      effectiveness: g.injections > 0 ? g.successes / g.injections : 0,
    }))
    .sort((a, b) => b.effectiveness - a.effectiveness);
}

/**
 * Generate a skill template from a learned pattern.
 */
export function generateSkill(pattern: LearnedPattern): SkillTemplate {
  const name = `${pattern.concept}-${pattern.action}`;
  const description = `Learned pattern for ${pattern.concept}/${pattern.action} `
    + `(${pattern.occurrences} occurrences, ${(pattern.success_rate * 100).toFixed(0)}% success)`;

  const content = [
    `# ${name}`,
    "",
    `## Context`,
    `- Concept: ${pattern.concept}`,
    `- Action: ${pattern.action}`,
    `- Success Rate: ${(pattern.success_rate * 100).toFixed(1)}%`,
    `- Average Duration: ${(pattern.avg_duration_ms / 1000).toFixed(1)}s`,
    `- Average Cost: $${pattern.avg_cost.toFixed(4)}`,
    `- Confidence: ${pattern.confidence}`,
    "",
    `## Models`,
    pattern.models_used.map((m) => `- ${m}`).join("\n"),
    "",
    `## Insights`,
    `Based on ${pattern.occurrences} observed executions.`,
    `First seen: ${pattern.first_seen}`,
    `Last seen: ${pattern.last_seen}`,
  ].join("\n");

  return { name, description, content, pattern };
}

/**
 * Filter patterns eligible for skill generation.
 * Requires 5+ occurrences and 80%+ success rate.
 */
export function getEligiblePatterns(patterns: LearnedPattern[]): LearnedPattern[] {
  return patterns.filter((p) => p.occurrences >= 5 && p.success_rate >= 0.8);
}

/**
 * Compute full learning state from provenance actions.
 */
export function computeLearningState(actions: ProvenanceAction[]): LearningState {
  return {
    patterns: extractPatterns(actions),
    calibrations: computeCalibration(actions),
  };
}
