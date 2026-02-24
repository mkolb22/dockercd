/**
 * Tests for SEC-003: Budget enforcement.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  checkBudget,
  recordSpend,
  getBudgetStatus,
  detectAnomaly,
  createDefaultBudgetState,
  updateBudgetLimits,
  type BudgetState,
} from './budget-enforcer.js';

describe('checkBudget', () => {
  let state: BudgetState;

  beforeEach(() => {
    state = createDefaultBudgetState();
  });

  it('allows operation within all limits', () => {
    const result = checkBudget(state, 0.001);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBeGreaterThan(0);
  });

  it('blocks operation exceeding per-operation limit', () => {
    const result = checkBudget(state, 2.0); // Exceeds $1.00 per-op limit

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('per-operation limit');
  });

  it('blocks operation exceeding daily limit', () => {
    // Add spend records up to daily limit
    for (let i = 0; i < 100; i++) {
      state = recordSpend(state, 'story', 'create', 'haiku', 0.1);
    }

    const result = checkBudget(state, 0.5);

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('daily limit');
  });

  it('blocks operation exceeding weekly limit', () => {
    // Increase daily limit to test weekly limit isolation
    state.limits.daily_limit_usd = 100.0;

    // Add spend just at the weekly limit
    for (let i = 0; i < 500; i++) {
      state.spend_records.push({
        timestamp: new Date().toISOString(), // Current time
        concept: 'story',
        action: 'create',
        model: 'opus',
        cost: 0.099, // $49.50 total (under $50 limit)
      });
    }

    const result = checkBudget(state, 0.51); // Would push weekly to $50.01

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('weekly limit');
  });

  it('blocks operation exceeding monthly limit', () => {
    // Set very high daily/weekly limits to isolate monthly check
    state.limits.daily_limit_usd = 1000.0;
    state.limits.weekly_limit_usd = 5000.0;
    state.limits.monthly_limit_usd = 1.0; // Low monthly limit

    // Add spend within the month
    state.spend_records.push({
      timestamp: new Date().toISOString(),
      concept: 'architecture',
      action: 'design',
      model: 'opus',
      cost: 0.95,
    });

    const result = checkBudget(state, 0.10); // Would push monthly to $1.05

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('monthly limit');
  });
});

describe('recordSpend', () => {
  it('adds spend record to state', () => {
    const state = createDefaultBudgetState();

    const result = recordSpend(state, 'story', 'create', 'sonnet', 0.0003);

    expect(result.spend_records).toHaveLength(1);
    expect(result.spend_records[0].concept).toBe('story');
    expect(result.spend_records[0].action).toBe('create');
    expect(result.spend_records[0].model).toBe('sonnet');
    expect(result.spend_records[0].cost).toBe(0.0003);
  });

  it('updates metadata timestamp', async () => {
    const state = createDefaultBudgetState();
    const before = state.metadata.last_updated;

    // Wait a bit to ensure timestamp difference
    await new Promise(resolve => setTimeout(resolve, 10));
    const result = recordSpend(state, 'story', 'create', 'sonnet', 0.0003);

    expect(result.metadata.last_updated).not.toBe(before);
  });
});

describe('getBudgetStatus', () => {
  it('calculates current spend for each period', () => {
    const state = createDefaultBudgetState();

    // Add some recent spend
    state.spend_records.push({
      timestamp: new Date().toISOString(),
      concept: 'story',
      action: 'create',
      model: 'sonnet',
      cost: 1.5,
    });

    const status = getBudgetStatus(state);

    expect(status.current_daily_spend).toBe(1.5);
    expect(status.current_weekly_spend).toBe(1.5);
    expect(status.current_monthly_spend).toBe(1.5);
    expect(status.daily_remaining).toBe(8.5); // 10 - 1.5
  });

  it('excludes old spend from daily calculation', () => {
    // Pin time to Wednesday noon UTC — mid-week avoids weekly boundary edge cases,
    // and UTC avoids local timezone mismatch with the UTC-based reset logic.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-11T12:00:00Z')); // Wednesday

    const state = createDefaultBudgetState();

    // "yesterday" = Tuesday noon UTC (within same week, before daily reset)
    state.spend_records.push({
      timestamp: '2026-02-10T12:00:00.000Z',
      concept: 'story',
      action: 'create',
      model: 'opus',
      cost: 5.0,
    });

    // "today" = Wednesday noon UTC
    state.spend_records.push({
      timestamp: new Date().toISOString(),
      concept: 'story',
      action: 'create',
      model: 'sonnet',
      cost: 1.0,
    });

    const status = getBudgetStatus(state);

    // Daily spend should only include today's spend
    expect(status.current_daily_spend).toBe(1.0);
    // Weekly spend should include both (Tuesday + Wednesday are in same Mon-Sun week)
    expect(status.current_weekly_spend).toBe(6.0);

    vi.useRealTimers();
  });

  it('provides reset times', () => {
    const state = createDefaultBudgetState();
    const status = getBudgetStatus(state);

    expect(status.reset_times.daily_reset).toBeTruthy();
    expect(status.reset_times.weekly_reset).toBeTruthy();
    expect(status.reset_times.monthly_reset).toBeTruthy();
  });
});

describe('detectAnomaly', () => {
  it('returns null with insufficient data', () => {
    const state = createDefaultBudgetState();

    // Add only 5 records (need 10+)
    for (let i = 0; i < 5; i++) {
      state.spend_records.push({
        timestamp: new Date().toISOString(),
        concept: 'story',
        action: 'create',
        model: 'sonnet',
        cost: 0.0003,
      });
    }

    const alert = detectAnomaly(state, 'story', 'create', 'sonnet', 0.0003);

    expect(alert).toBeNull();
  });

  it('detects 3-sigma anomaly', () => {
    const state = createDefaultBudgetState();

    // Add 20 records with some variance
    for (let i = 0; i < 20; i++) {
      state.spend_records.push({
        timestamp: new Date().toISOString(),
        concept: 'story',
        action: 'create',
        model: 'sonnet',
        cost: 0.0003 + (i % 3) * 0.00001, // Slight variance
      });
    }

    // Test with anomalous cost (100x normal)
    const alert = detectAnomaly(state, 'story', 'create', 'sonnet', 0.03);

    expect(alert).not.toBeNull();
    expect(alert?.type).toBe('anomaly');
    expect(alert?.severity).toBe('high');
  });

  it('detects threshold warning for 2x cost (when below 3-sigma)', () => {
    const state = createDefaultBudgetState();

    // Add 20 records with large variance so 2x is not 3-sigma
    // Mean will be 0.5, stdDev will be ~0.29, 3-sigma threshold ~1.37
    for (let i = 0; i < 20; i++) {
      state.spend_records.push({
        timestamp: new Date().toISOString(),
        concept: 'story',
        action: 'create',
        model: 'sonnet',
        cost: i < 10 ? 0.2 : 0.8, // Half at 0.2, half at 0.8, mean = 0.5
      });
    }

    // Test with 1.1 (2.2x mean but under 3-sigma of 1.37)
    const alert = detectAnomaly(state, 'story', 'create', 'sonnet', 1.1);

    expect(alert).not.toBeNull();
    expect(alert?.type).toBe('threshold_warning');
    expect(alert?.severity).toBe('medium');
  });

  it('returns null for normal cost', () => {
    const state = createDefaultBudgetState();

    // Add 20 normal records (~0.0003)
    for (let i = 0; i < 20; i++) {
      state.spend_records.push({
        timestamp: new Date().toISOString(),
        concept: 'story',
        action: 'create',
        model: 'sonnet',
        cost: 0.0003,
      });
    }

    // Test with normal cost
    const alert = detectAnomaly(state, 'story', 'create', 'sonnet', 0.00032);

    expect(alert).toBeNull();
  });
});

describe('updateBudgetLimits', () => {
  it('updates specified limits', () => {
    const state = createDefaultBudgetState();

    const result = updateBudgetLimits(state, {
      daily_limit_usd: 20.0,
      weekly_limit_usd: 100.0,
    });

    expect(result.limits.daily_limit_usd).toBe(20.0);
    expect(result.limits.weekly_limit_usd).toBe(100.0);
    expect(result.limits.monthly_limit_usd).toBe(200.0); // Unchanged
  });

  it('updates metadata timestamp', async () => {
    const state = createDefaultBudgetState();
    const before = state.metadata.last_updated;

    await new Promise(resolve => setTimeout(resolve, 10));
    const result = updateBudgetLimits(state, { daily_limit_usd: 15.0 });

    expect(result.metadata.last_updated).not.toBe(before);
  });
});
