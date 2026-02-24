/**
 * SEC-003: Budget enforcement and cost anomaly detection.
 *
 * Enforces daily/weekly/monthly budget limits and detects cost anomalies.
 */

import type { Concept } from '@zen/koan-core';
import type { Model } from '../routing/performance.js';

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
  concept: Concept;
  action: string;
  model: Model;
  cost: number;
}

export interface BudgetState {
  limits: BudgetLimits;
  spend_records: SpendRecord[];
  metadata: {
    last_updated: string;
    checksum: string;
  };
}

export interface BudgetCheckResult {
  allowed: boolean;
  reason?: string;
  remaining: number;
}

export interface CostAlert {
  type: 'anomaly' | 'threshold_warning' | 'limit_exceeded';
  severity: 'low' | 'medium' | 'high';
  message: string;
  details: {
    concept: Concept;
    action: string;
    model: Model;
    cost: number;
    baseline?: number;
    threshold?: number;
  };
}

const DEFAULT_LIMITS: BudgetLimits = {
  daily_limit_usd: 10.0,
  weekly_limit_usd: 50.0,
  monthly_limit_usd: 200.0,
  per_operation_limit_usd: 1.0,
};

/**
 * Check if operation is within budget.
 */
export function checkBudget(
  state: BudgetState,
  estimatedCost: number
): BudgetCheckResult {
  const status = getBudgetStatus(state);
  const limits = state.limits;

  // Check per-operation limit
  if (estimatedCost > limits.per_operation_limit_usd) {
    return {
      allowed: false,
      reason: `Operation cost ($${estimatedCost.toFixed(4)}) exceeds per-operation limit ($${limits.per_operation_limit_usd.toFixed(2)})`,
      remaining: 0,
    };
  }

  // Check daily limit
  if (status.current_daily_spend + estimatedCost > limits.daily_limit_usd) {
    return {
      allowed: false,
      reason: `Would exceed daily limit ($${limits.daily_limit_usd.toFixed(2)}). Current: $${status.current_daily_spend.toFixed(2)}, Estimated: $${estimatedCost.toFixed(4)}`,
      remaining: status.daily_remaining,
    };
  }

  // Check weekly limit
  if (status.current_weekly_spend + estimatedCost > limits.weekly_limit_usd) {
    return {
      allowed: false,
      reason: `Would exceed weekly limit ($${limits.weekly_limit_usd.toFixed(2)}). Current: $${status.current_weekly_spend.toFixed(2)}, Estimated: $${estimatedCost.toFixed(4)}`,
      remaining: status.weekly_remaining,
    };
  }

  // Check monthly limit
  if (status.current_monthly_spend + estimatedCost > limits.monthly_limit_usd) {
    return {
      allowed: false,
      reason: `Would exceed monthly limit ($${limits.monthly_limit_usd.toFixed(2)}). Current: $${status.current_monthly_spend.toFixed(2)}, Estimated: $${estimatedCost.toFixed(4)}`,
      remaining: status.monthly_remaining,
    };
  }

  return {
    allowed: true,
    remaining: Math.min(
      status.daily_remaining,
      status.weekly_remaining,
      status.monthly_remaining
    ),
  };
}

/**
 * Record spend after operation completes.
 */
export function recordSpend(
  state: BudgetState,
  concept: Concept,
  action: string,
  model: Model,
  actualCost: number
): BudgetState {
  const record: SpendRecord = {
    timestamp: new Date().toISOString(),
    concept,
    action,
    model,
    cost: actualCost,
  };

  state.spend_records.push(record);
  state.metadata.last_updated = new Date().toISOString();

  return state;
}

/**
 * Get current budget status.
 */
export function getBudgetStatus(state: BudgetState): BudgetStatus {
  const now = new Date();
  const dailyReset = getNextDailyReset(now);
  const weeklyReset = getNextWeeklyReset(now);
  const monthlyReset = getNextMonthlyReset(now);

  // Calculate current spend for each period
  const dailySpend = calculateSpend(state.spend_records, dailyReset.start);
  const weeklySpend = calculateSpend(state.spend_records, weeklyReset.start);
  const monthlySpend = calculateSpend(state.spend_records, monthlyReset.start);

  return {
    current_daily_spend: dailySpend,
    current_weekly_spend: weeklySpend,
    current_monthly_spend: monthlySpend,
    daily_remaining: Math.max(0, state.limits.daily_limit_usd - dailySpend),
    weekly_remaining: Math.max(0, state.limits.weekly_limit_usd - weeklySpend),
    monthly_remaining: Math.max(0, state.limits.monthly_limit_usd - monthlySpend),
    reset_times: {
      daily_reset: dailyReset.next.toISOString(),
      weekly_reset: weeklyReset.next.toISOString(),
      monthly_reset: monthlyReset.next.toISOString(),
    },
  };
}

/**
 * Detect cost anomalies (3-sigma outlier detection).
 */
export function detectAnomaly(
  state: BudgetState,
  concept: Concept,
  action: string,
  model: Model,
  cost: number
): CostAlert | null {
  // Get historical costs for this concept-action-model
  const historicalCosts = state.spend_records
    .filter(r => r.concept === concept && r.action === action && r.model === model)
    .map(r => r.cost);

  if (historicalCosts.length < 10) {
    return null; // Not enough data
  }

  // Calculate baseline (mean and std dev)
  const mean = historicalCosts.reduce((sum, c) => sum + c, 0) / historicalCosts.length;
  const variance =
    historicalCosts.reduce((sum, c) => sum + Math.pow(c - mean, 2), 0) /
    historicalCosts.length;
  const stdDev = Math.sqrt(variance);

  // Check both 3-sigma and 2x threshold
  let is3Sigma = false;
  if (stdDev > 0) {
    const zScore = (cost - mean) / stdDev;
    is3Sigma = Math.abs(zScore) > 3;
  }

  const is2xMean = cost > mean * 2;

  // 3-sigma takes precedence over 2x threshold
  if (is3Sigma) {
    const zScore = (cost - mean) / stdDev;
    return {
      type: 'anomaly',
      severity: 'high',
      message: `Cost anomaly detected: ${Math.abs(zScore).toFixed(1)}x standard deviation from baseline`,
      details: {
        concept,
        action,
        model,
        cost,
        baseline: mean,
        threshold: mean + 3 * stdDev,
      },
    };
  }

  // Check if cost is > 2x mean (less strict threshold warning)
  if (is2xMean) {
    return {
      type: 'threshold_warning',
      severity: 'medium',
      message: `Cost is ${(cost / mean).toFixed(1)}x higher than baseline`,
      details: {
        concept,
        action,
        model,
        cost,
        baseline: mean,
      },
    };
  }

  return null;
}

/**
 * Calculate total spend since a given timestamp.
 */
function calculateSpend(records: SpendRecord[], since: Date): number {
  return records
    .filter(r => new Date(r.timestamp) >= since)
    .reduce((sum, r) => sum + r.cost, 0);
}

/**
 * Get next daily reset time (midnight UTC).
 */
function getNextDailyReset(now: Date): { start: Date; next: Date } {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);

  const next = new Date(start);
  next.setUTCDate(next.getUTCDate() + 1);

  return { start, next };
}

/**
 * Get next weekly reset time (Monday midnight UTC).
 */
function getNextWeeklyReset(now: Date): { start: Date; next: Date } {
  const start = new Date(now);
  const dayOfWeek = start.getUTCDay();
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Adjust for Monday start
  start.setUTCDate(start.getUTCDate() - daysToMonday);
  start.setUTCHours(0, 0, 0, 0);

  const next = new Date(start);
  next.setUTCDate(next.getUTCDate() + 7);

  return { start, next };
}

/**
 * Get next monthly reset time (1st of month midnight UTC).
 */
function getNextMonthlyReset(now: Date): { start: Date; next: Date } {
  const start = new Date(now);
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);

  const next = new Date(start);
  next.setUTCMonth(next.getUTCMonth() + 1);

  return { start, next };
}

/**
 * Create default budget state.
 */
export function createDefaultBudgetState(): BudgetState {
  return {
    limits: { ...DEFAULT_LIMITS },
    spend_records: [],
    metadata: {
      last_updated: new Date().toISOString(),
      checksum: '',
    },
  };
}

/**
 * Update budget limits.
 */
export function updateBudgetLimits(
  state: BudgetState,
  updates: Partial<BudgetLimits>
): BudgetState {
  state.limits = { ...state.limits, ...updates };
  state.metadata.last_updated = new Date().toISOString();
  return state;
}
