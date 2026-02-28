import { describe, it, expect } from "vitest";
import {
  extractPatterns,
  computeCalibration,
  generateSkill,
  getEligiblePatterns,
  computeLearningState,
} from "./learner.js";
import type { ProvenanceAction, LearnedPattern } from "./types.js";

function makeAction(overrides: Partial<ProvenanceAction> = {}): ProvenanceAction {
  return {
    action_id: `act-${Math.random().toString(36).slice(2, 8)}`,
    concept: "implementation",
    action: "complete",
    status: "completed",
    timestamp: "2026-02-15T10:00:00Z",
    model: "sonnet",
    cost: { cost_usd: 0.01 },
    duration_ms: 5000,
    ...overrides,
  };
}

describe("extractPatterns", () => {
  it("returns empty for no actions", () => {
    expect(extractPatterns([])).toHaveLength(0);
  });

  it("groups by concept-action", () => {
    const actions = [
      makeAction({ concept: "story", action: "complete" }),
      makeAction({ concept: "story", action: "complete" }),
      makeAction({ concept: "implementation", action: "start" }),
    ];
    const patterns = extractPatterns(actions);
    expect(patterns).toHaveLength(2);
    expect(patterns[0].occurrences).toBe(2);
  });

  it("computes success rate correctly", () => {
    const actions = [
      makeAction({ concept: "quality", action: "review", status: "completed" }),
      makeAction({ concept: "quality", action: "review", status: "completed" }),
      makeAction({ concept: "quality", action: "review", status: "failed" }),
    ];
    const patterns = extractPatterns(actions);
    const p = patterns.find((p) => p.concept === "quality")!;
    expect(p.success_rate).toBeCloseTo(2 / 3);
  });

  it("assigns confidence levels correctly", () => {
    // 10+ occurrences with 80%+ success = high
    const highActions = Array.from({ length: 10 }, () =>
      makeAction({ concept: "story", action: "complete", status: "completed" }),
    );
    const patterns = extractPatterns(highActions);
    expect(patterns[0].confidence).toBe("high");
  });

  it("tracks models used", () => {
    const actions = [
      makeAction({ concept: "story", action: "complete", model: "opus" }),
      makeAction({ concept: "story", action: "complete", model: "sonnet" }),
      makeAction({ concept: "story", action: "complete", model: "opus" }),
    ];
    const patterns = extractPatterns(actions);
    expect(patterns[0].models_used).toContain("opus");
    expect(patterns[0].models_used).toContain("sonnet");
    expect(patterns[0].models_used).toHaveLength(2);
  });
});

describe("computeCalibration", () => {
  it("returns empty for no memory-injected actions", () => {
    const actions = [makeAction()];
    expect(computeCalibration(actions)).toHaveLength(0);
  });

  it("computes effectiveness from memory_injected metadata", () => {
    const actions = [
      makeAction({ concept: "implementation", status: "completed", metadata: { memory_injected: true } }),
      makeAction({ concept: "implementation", status: "completed", metadata: { memory_injected: true } }),
      makeAction({ concept: "implementation", status: "failed", metadata: { memory_injected: true } }),
    ];
    const cals = computeCalibration(actions);
    expect(cals).toHaveLength(1);
    expect(cals[0].total_injections).toBe(3);
    expect(cals[0].effectiveness).toBeCloseTo(2 / 3);
  });
});

describe("generateSkill", () => {
  it("generates markdown skill template", () => {
    const pattern: LearnedPattern = {
      concept: "implementation",
      action: "complete",
      occurrences: 15,
      success_rate: 0.93,
      avg_duration_ms: 8000,
      avg_cost: 0.05,
      confidence: "high",
      first_seen: "2026-01-01T00:00:00Z",
      last_seen: "2026-02-15T00:00:00Z",
      models_used: ["sonnet", "opus"],
    };
    const skill = generateSkill(pattern);
    expect(skill.name).toBe("implementation-complete");
    expect(skill.content).toContain("93.0%");
    expect(skill.content).toContain("sonnet");
  });
});

describe("getEligiblePatterns", () => {
  it("filters by occurrences and success rate", () => {
    const patterns: LearnedPattern[] = [
      { concept: "story", action: "complete", occurrences: 10, success_rate: 0.9, avg_duration_ms: 0, avg_cost: 0, confidence: "high", first_seen: "", last_seen: "", models_used: [] },
      { concept: "quality", action: "review", occurrences: 3, success_rate: 0.9, avg_duration_ms: 0, avg_cost: 0, confidence: "medium", first_seen: "", last_seen: "", models_used: [] },
      { concept: "impl", action: "start", occurrences: 6, success_rate: 0.5, avg_duration_ms: 0, avg_cost: 0, confidence: "low", first_seen: "", last_seen: "", models_used: [] },
    ];
    const eligible = getEligiblePatterns(patterns);
    expect(eligible).toHaveLength(1);
    expect(eligible[0].concept).toBe("story");
  });
});

describe("computeLearningState", () => {
  it("returns both patterns and calibrations", () => {
    const actions = [
      makeAction({ concept: "story", metadata: { memory_injected: true } }),
      makeAction({ concept: "story" }),
    ];
    const state = computeLearningState(actions);
    expect(state.patterns.length).toBeGreaterThan(0);
    expect(state.calibrations.length).toBeGreaterThan(0);
  });
});
