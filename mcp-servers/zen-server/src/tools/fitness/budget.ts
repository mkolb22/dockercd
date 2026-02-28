/**
 * Budget enforcement and cost anomaly detection.
 * Pure functions — no I/O.
 */

import type {
  Model,
  BudgetLimits,
  BudgetStatus,
  BudgetState,
  SpendRecord,
  BudgetCheckResult,
  CostAlert,
} from "./types.js";

/**
 * Check if an operation is within budget.
 */
export function checkBudget(state: BudgetState, estimatedCost: number): BudgetCheckResult {
  const status = getBudgetStatus(state);

  if (estimatedCost > state.limits.per_operation_limit_usd) {
    return {
      allowed: false,
      reason: `Operation cost ($${estimatedCost.toFixed(4)}) exceeds per-operation limit ($${state.limits.per_operation_limit_usd.toFixed(2)})`,
      remaining: 0,
    };
  }

  if (status.current_daily_spend + estimatedCost > state.limits.daily_limit_usd) {
    return {
      allowed: false,
      reason: `Would exceed daily limit ($${state.limits.daily_limit_usd.toFixed(2)})`,
      remaining: status.daily_remaining,
    };
  }

  if (status.current_weekly_spend + estimatedCost > state.limits.weekly_limit_usd) {
    return {
      allowed: false,
      reason: `Would exceed weekly limit ($${state.limits.weekly_limit_usd.toFixed(2)})`,
      remaining: status.weekly_remaining,
    };
  }

  if (status.current_monthly_spend + estimatedCost > state.limits.monthly_limit_usd) {
    return {
      allowed: false,
      reason: `Would exceed monthly limit ($${state.limits.monthly_limit_usd.toFixed(2)})`,
      remaining: status.monthly_remaining,
    };
  }

  return {
    allowed: true,
    remaining: Math.min(status.daily_remaining, status.weekly_remaining, status.monthly_remaining),
  };
}

/**
 * Get current budget status with spend totals and remaining amounts.
 */
export function getBudgetStatus(state: BudgetState): BudgetStatus {
  const now = new Date();
  const dayStart = startOfDay(now);
  const weekStart = startOfWeek(now);
  const monthStart = startOfMonth(now);

  const daily = sumSpend(state.spend_records, dayStart);
  const weekly = sumSpend(state.spend_records, weekStart);
  const monthly = sumSpend(state.spend_records, monthStart);

  const nextDay = new Date(dayStart);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);

  const nextWeek = new Date(weekStart);
  nextWeek.setUTCDate(nextWeek.getUTCDate() + 7);

  const nextMonth = new Date(monthStart);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);

  return {
    current_daily_spend: daily,
    current_weekly_spend: weekly,
    current_monthly_spend: monthly,
    daily_remaining: Math.max(0, state.limits.daily_limit_usd - daily),
    weekly_remaining: Math.max(0, state.limits.weekly_limit_usd - weekly),
    monthly_remaining: Math.max(0, state.limits.monthly_limit_usd - monthly),
    reset_times: {
      daily_reset: nextDay.toISOString(),
      weekly_reset: nextWeek.toISOString(),
      monthly_reset: nextMonth.toISOString(),
    },
  };
}

/**
 * Detect cost anomalies using 3-sigma outlier detection.
 */
export function detectAnomaly(
  records: SpendRecord[],
  concept: string,
  action: string,
  model: Model,
  cost: number,
): CostAlert | null {
  const historical = records
    .filter((r) => r.concept === concept && r.action === action && r.model === model)
    .map((r) => r.cost);

  if (historical.length < 10) return null;

  const avg = historical.reduce((s, c) => s + c, 0) / historical.length;
  const variance = historical.reduce((s, c) => s + (c - avg) ** 2, 0) / historical.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev > 0) {
    const zScore = (cost - avg) / stdDev;
    if (Math.abs(zScore) > 3) {
      return {
        type: "anomaly",
        severity: "high",
        message: `Cost anomaly: ${Math.abs(zScore).toFixed(1)}x std dev from baseline`,
        details: { concept, action, model, cost, baseline: avg, threshold: avg + 3 * stdDev },
      };
    }
  }

  if (cost > avg * 2) {
    return {
      type: "threshold_warning",
      severity: "medium",
      message: `Cost ${(cost / avg).toFixed(1)}x higher than baseline`,
      details: { concept, action, model, cost, baseline: avg },
    };
  }

  return null;
}

/**
 * Create default budget limits.
 */
export function defaultLimits(): BudgetLimits {
  return {
    daily_limit_usd: 10.0,
    weekly_limit_usd: 50.0,
    monthly_limit_usd: 200.0,
    per_operation_limit_usd: 1.0,
  };
}

// ─── Helpers ──────────────────────────────────────────────────

function sumSpend(records: SpendRecord[], since: Date): number {
  return records
    .filter((r) => new Date(r.timestamp) >= since)
    .reduce((s, r) => s + r.cost, 0);
}

function startOfDay(d: Date): Date {
  const s = new Date(d);
  s.setUTCHours(0, 0, 0, 0);
  return s;
}

function startOfWeek(d: Date): Date {
  const s = new Date(d);
  const day = s.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  s.setUTCDate(s.getUTCDate() - diff);
  s.setUTCHours(0, 0, 0, 0);
  return s;
}

function startOfMonth(d: Date): Date {
  const s = new Date(d);
  s.setUTCDate(1);
  s.setUTCHours(0, 0, 0, 0);
  return s;
}
