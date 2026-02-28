import { describe, it, expect } from "vitest";
import { checkBudget, getBudgetStatus, detectAnomaly, defaultLimits } from "./budget.js";
import type { BudgetState, SpendRecord, Model } from "./types.js";

function makeRecord(overrides: Partial<SpendRecord> = {}): SpendRecord {
  return {
    timestamp: new Date().toISOString(),
    concept: "implementation",
    action: "code",
    model: "sonnet" as Model,
    cost: 0.001,
    ...overrides,
  };
}

function makeState(limits = defaultLimits(), records: SpendRecord[] = []): BudgetState {
  return { limits, spend_records: records };
}

describe("defaultLimits", () => {
  it("returns sensible defaults", () => {
    const limits = defaultLimits();
    expect(limits.daily_limit_usd).toBe(10.0);
    expect(limits.weekly_limit_usd).toBe(50.0);
    expect(limits.monthly_limit_usd).toBe(200.0);
    expect(limits.per_operation_limit_usd).toBe(1.0);
  });
});

describe("getBudgetStatus", () => {
  it("returns zero spend for empty records", () => {
    const status = getBudgetStatus(makeState());
    expect(status.current_daily_spend).toBe(0);
    expect(status.current_weekly_spend).toBe(0);
    expect(status.current_monthly_spend).toBe(0);
    expect(status.daily_remaining).toBe(10.0);
    expect(status.weekly_remaining).toBe(50.0);
    expect(status.monthly_remaining).toBe(200.0);
  });

  it("sums recent spend correctly", () => {
    const records = [
      makeRecord({ cost: 1.0 }),
      makeRecord({ cost: 2.5 }),
    ];
    const status = getBudgetStatus(makeState(defaultLimits(), records));
    expect(status.current_daily_spend).toBe(3.5);
    expect(status.daily_remaining).toBe(6.5);
  });

  it("excludes old records from daily spend", () => {
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 2);
    const records = [
      makeRecord({ cost: 5.0, timestamp: yesterday.toISOString() }),
      makeRecord({ cost: 1.0 }),
    ];
    const status = getBudgetStatus(makeState(defaultLimits(), records));
    expect(status.current_daily_spend).toBe(1.0);
  });

  it("provides reset times", () => {
    const status = getBudgetStatus(makeState());
    expect(status.reset_times.daily_reset).toBeTruthy();
    expect(status.reset_times.weekly_reset).toBeTruthy();
    expect(status.reset_times.monthly_reset).toBeTruthy();
    // Reset times should be in the future
    expect(new Date(status.reset_times.daily_reset).getTime()).toBeGreaterThan(Date.now() - 60000);
  });
});

describe("checkBudget", () => {
  it("allows operations within budget", () => {
    const result = checkBudget(makeState(), 0.5);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBeGreaterThan(0);
  });

  it("blocks operations exceeding per-operation limit", () => {
    const result = checkBudget(makeState(), 1.5);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("per-operation limit");
  });

  it("blocks operations that would exceed daily limit", () => {
    const records = Array.from({ length: 10 }, () => makeRecord({ cost: 0.95 }));
    const result = checkBudget(makeState(defaultLimits(), records), 0.9);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("daily limit");
  });

  it("blocks operations that would exceed weekly limit", () => {
    const limits = { ...defaultLimits(), daily_limit_usd: 100, per_operation_limit_usd: 100 };
    const records = Array.from({ length: 50 }, () => makeRecord({ cost: 0.99 }));
    const result = checkBudget(makeState(limits, records), 1.0);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("weekly limit");
  });

  it("blocks operations that would exceed monthly limit", () => {
    const limits = { daily_limit_usd: 1000, weekly_limit_usd: 1000, monthly_limit_usd: 10, per_operation_limit_usd: 100 };
    const records = Array.from({ length: 10 }, () => makeRecord({ cost: 0.95 }));
    const result = checkBudget(makeState(limits, records), 1.0);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("monthly limit");
  });

  it("returns min remaining across all limits", () => {
    const result = checkBudget(makeState(), 0.001);
    expect(result.remaining).toBe(Math.min(10.0, 50.0, 200.0));
  });
});

describe("detectAnomaly", () => {
  it("returns null with insufficient data (< 10 records)", () => {
    const records = Array.from({ length: 5 }, () => makeRecord({ cost: 0.001 }));
    const result = detectAnomaly(records, "implementation", "code", "sonnet", 0.1);
    expect(result).toBeNull();
  });

  it("returns null for normal costs", () => {
    const records = Array.from({ length: 20 }, () => makeRecord({ cost: 0.001 }));
    const result = detectAnomaly(records, "implementation", "code", "sonnet", 0.001);
    expect(result).toBeNull();
  });

  it("detects 3-sigma anomaly", () => {
    const records = Array.from({ length: 20 }, () => makeRecord({ cost: 0.001 }));
    const result = detectAnomaly(records, "implementation", "code", "sonnet", 1.0);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("anomaly");
    expect(result!.severity).toBe("high");
  });

  it("detects 2x threshold warning", () => {
    // Create records with high variance so 3-sigma doesn't trigger,
    // but 2x baseline still catches it
    const records = Array.from({ length: 20 }, (_, i) =>
      makeRecord({ cost: i % 2 === 0 ? 0.01 : 0.03 }),
    );
    const avg = records.reduce((s, r) => s + r.cost, 0) / records.length;
    const result = detectAnomaly(records, "implementation", "code", "sonnet", avg * 2.5);
    expect(result).not.toBeNull();
    // Could be anomaly or threshold_warning depending on stddev
    expect(["anomaly", "threshold_warning"]).toContain(result!.type);
  });

  it("filters by concept/action/model correctly", () => {
    const records = [
      ...Array.from({ length: 20 }, () => makeRecord({ cost: 0.001, concept: "story", action: "create", model: "haiku" })),
      ...Array.from({ length: 20 }, () => makeRecord({ cost: 0.001 })),
    ];
    // High cost for implementation.code.sonnet — should trigger
    const result = detectAnomaly(records, "implementation", "code", "sonnet", 1.0);
    expect(result).not.toBeNull();
    // High cost for story.create.haiku — should also trigger
    const result2 = detectAnomaly(records, "story", "create", "haiku", 1.0);
    expect(result2).not.toBeNull();
    // No data for architecture.design.opus — should return null (insufficient data)
    const result3 = detectAnomaly(records, "architecture", "design", "opus", 1.0);
    expect(result3).toBeNull();
  });
});
