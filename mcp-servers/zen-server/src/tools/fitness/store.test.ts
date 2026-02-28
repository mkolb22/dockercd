import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { FitnessStore } from "./store.js";
import type { FitnessScore, DebateResult, PromptVariant, ModelPerformanceMetrics, BudgetLimits, Model } from "./types.js";

let store: FitnessStore;
let dbPath: string;

beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `fitness-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  store = new FitnessStore(dbPath);
});

afterEach(() => {
  store.close();
  try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
});

function makeFitnessScore(variantId: string, fitness = 0.8): FitnessScore {
  return {
    variant_id: variantId,
    runs: 10,
    fitness: { current: fitness, rolling_avg_10: fitness, trend: "stable" },
    metrics: { test_pass_rate: 0.9, quality_score: 0.7, user_acceptance: 0.8 },
    history: [{ timestamp: "2026-02-15T10:00:00Z", fitness: 0.75, run_count: 5 }],
  };
}

function makeVariant(id: string, concept = "implementation"): PromptVariant {
  return {
    variant_id: id,
    created_at: new Date().toISOString(),
    fitness_at_creation: null,
    status: "active",
    checksum: `check-${id}`,
    content: `# ${concept} prompt variant ${id}`,
  };
}

describe("FitnessStore — fitness", () => {
  it("saves and loads fitness scores", () => {
    store.saveFitnessScore("implementation", makeFitnessScore("v1", 0.85));
    const state = store.loadFitnessState("implementation");
    expect(state).not.toBeNull();
    expect(state!.concept).toBe("implementation");
    expect(state!.variants).toHaveLength(1);
    expect(state!.variants[0].fitness.current).toBe(0.85);
  });

  it("upserts on save", () => {
    store.saveFitnessScore("impl", makeFitnessScore("v1", 0.5));
    store.saveFitnessScore("impl", makeFitnessScore("v1", 0.9));
    const state = store.loadFitnessState("impl");
    expect(state!.variants).toHaveLength(1);
    expect(state!.variants[0].fitness.current).toBe(0.9);
  });

  it("returns null for unknown concept", () => {
    expect(store.loadFitnessState("nonexistent")).toBeNull();
  });

  it("lists concept fitness overview", () => {
    store.saveFitnessScore("story", makeFitnessScore("v1", 0.7));
    store.saveFitnessScore("story", makeFitnessScore("v2", 0.9));
    store.saveFitnessScore("architecture", makeFitnessScore("v1", 0.6));
    const overview = store.listConceptFitness();
    expect(overview).toHaveLength(2);
    const storyOverview = overview.find((o) => o.concept === "story");
    expect(storyOverview!.current_fitness).toBe(0.9);
    expect(storyOverview!.variant_count).toBe(2);
  });

  it("returns empty list when no data", () => {
    expect(store.listConceptFitness()).toHaveLength(0);
  });
});

describe("FitnessStore — performance", () => {
  it("saves and loads performance metrics", () => {
    const metrics: ModelPerformanceMetrics = {
      runs: 20, successes: 18, failures: 2, success_rate: 0.9,
      avg_cost: 0.0003, avg_duration_ms: 200, last_20_runs: [true, false, true],
    };
    store.savePerformanceMetrics("implementation", "code", "sonnet", metrics);
    const state = store.loadPerformanceState();
    expect(state.concept_actions).toHaveLength(1);
    expect(state.concept_actions[0].models.sonnet!.success_rate).toBe(0.9);
  });

  it("groups by concept-action", () => {
    const m1: ModelPerformanceMetrics = { runs: 10, successes: 9, failures: 1, success_rate: 0.9, avg_cost: 0.0003, avg_duration_ms: 200, last_20_runs: [] };
    const m2: ModelPerformanceMetrics = { runs: 5, successes: 5, failures: 0, success_rate: 1.0, avg_cost: 0.015, avg_duration_ms: 500, last_20_runs: [] };
    store.savePerformanceMetrics("impl", "code", "sonnet", m1);
    store.savePerformanceMetrics("impl", "code", "opus", m2);
    const state = store.loadPerformanceState();
    expect(state.concept_actions).toHaveLength(1);
    expect(state.concept_actions[0].models.sonnet).toBeDefined();
    expect(state.concept_actions[0].models.opus).toBeDefined();
  });

  it("returns empty state when no data", () => {
    const state = store.loadPerformanceState();
    expect(state.concept_actions).toHaveLength(0);
  });
});

describe("FitnessStore — budget", () => {
  it("returns defaults when no limits set", () => {
    const limits = store.loadBudgetLimits();
    expect(limits.daily_limit_usd).toBe(10);
    expect(limits.monthly_limit_usd).toBe(200);
  });

  it("saves and loads custom limits", () => {
    const custom: BudgetLimits = {
      daily_limit_usd: 5, weekly_limit_usd: 25,
      monthly_limit_usd: 100, per_operation_limit_usd: 0.5,
    };
    store.saveBudgetLimits(custom);
    const loaded = store.loadBudgetLimits();
    expect(loaded.daily_limit_usd).toBe(5);
    expect(loaded.per_operation_limit_usd).toBe(0.5);
  });

  it("records and loads spend", () => {
    store.recordSpend("impl", "code", "sonnet", 0.001);
    store.recordSpend("impl", "code", "sonnet", 0.002);
    const records = store.loadSpendRecords();
    expect(records).toHaveLength(2);
    expect(records[0].cost + records[1].cost).toBeCloseTo(0.003, 6);
  });

  it("filters spend by date", () => {
    store.recordSpend("impl", "code", "sonnet", 0.001);
    const future = new Date();
    future.setUTCFullYear(future.getUTCFullYear() + 1);
    const records = store.loadSpendRecords(future);
    expect(records).toHaveLength(0);
  });
});

describe("FitnessStore — debates", () => {
  function makeDebate(archId: string): DebateResult {
    return {
      debate_id: `debate-${archId}`,
      arch_id: archId,
      duration_ms: 5000,
      advocate: { agent: "debate-advocate", model: "sonnet", proposed_approach: "test", confidence: 0.8, key_arguments: ["arg1"] } as any,
      critic: { agent: "debate-critic", model: "sonnet", confidence: 0.7, concerns: [], risk_assessment: "low" } as any,
      synthesis: { agent: "debate-synthesis", model: "opus", final_decision: "proceed", confidence: 0.9, incorporated_concerns: [], remaining_risks: [], dissent_documented: false, dissent_summary: "", recommendation: "proceed" } as any,
      metadata: { triggered_by: "test", model_used: "multi-agent", cost: 0.021 },
    };
  }

  it("saves and loads debates", () => {
    store.saveDebate(makeDebate("arch-001"));
    const debates = store.loadDebates();
    expect(debates).toHaveLength(1);
    expect(debates[0].arch_id).toBe("arch-001");
  });

  it("filters debates by arch_id", () => {
    store.saveDebate(makeDebate("arch-001"));
    store.saveDebate(makeDebate("arch-002"));
    const filtered = store.loadDebates("arch-001");
    expect(filtered).toHaveLength(1);
    expect(filtered[0].arch_id).toBe("arch-001");
  });

  it("respects limit parameter", () => {
    for (let i = 0; i < 5; i++) store.saveDebate(makeDebate(`arch-${i}`));
    const limited = store.loadDebates(undefined, 3);
    expect(limited).toHaveLength(3);
  });
});

describe("FitnessStore — variants", () => {
  it("saves and retrieves a variant", () => {
    const v = makeVariant("v1");
    store.saveVariant("impl", v);
    const loaded = store.getVariant("impl", "v1");
    expect(loaded).not.toBeNull();
    expect(loaded!.variant_id).toBe("v1");
    expect(loaded!.content).toContain("variant v1");
  });

  it("returns null for missing variant", () => {
    expect(store.getVariant("impl", "nonexistent")).toBeNull();
  });

  it("loads variants by status", () => {
    store.saveVariant("impl", makeVariant("v1"));
    store.saveVariant("impl", { ...makeVariant("v2"), status: "archived" });
    const active = store.loadVariants("impl", "active");
    expect(active).toHaveLength(1);
    expect(active[0].variant_id).toBe("v1");
  });

  it("loads all variants for a concept", () => {
    store.saveVariant("impl", makeVariant("v1"));
    store.saveVariant("impl", makeVariant("v2"));
    store.saveVariant("story", makeVariant("v3", "story"));
    const all = store.loadVariants("impl");
    expect(all).toHaveLength(2);
  });

  it("updates variant status", () => {
    store.saveVariant("impl", makeVariant("v1"));
    store.updateVariantStatus("impl", "v1", "promoted");
    const v = store.getVariant("impl", "v1");
    expect(v!.status).toBe("promoted");
  });

  it("upserts variant on save", () => {
    const v = makeVariant("v1");
    store.saveVariant("impl", v);
    const updated = { ...v, content: "# Updated content", checksum: "new-check" };
    store.saveVariant("impl", updated);
    const loaded = store.getVariant("impl", "v1");
    expect(loaded!.content).toBe("# Updated content");
  });
});
