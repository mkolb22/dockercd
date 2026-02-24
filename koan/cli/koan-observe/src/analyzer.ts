/**
 * Prompt log analyzer for koan-observe.
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  PromptLogEntry,
  DailyStats,
  ConceptStats,
  SessionStats,
  ObservabilityAnalysis,
} from './types.js';

/**
 * Load prompt logs from the observability directory.
 */
export function loadPromptLogs(projectRoot: string): PromptLogEntry[] {
  const logFile = path.join(projectRoot, 'koan/observability/prompts.jsonl');

  if (!fs.existsSync(logFile)) {
    return [];
  }

  const content = fs.readFileSync(logFile, 'utf-8');
  const lines = content.trim().split('\n').filter(Boolean);

  return lines.map((line) => {
    try {
      return JSON.parse(line) as PromptLogEntry;
    } catch {
      return null;
    }
  }).filter((entry): entry is PromptLogEntry => entry !== null);
}

/**
 * Load daily stats from the observability directory.
 */
export function loadDailyStats(projectRoot: string): DailyStats | null {
  const statsFile = path.join(projectRoot, 'koan/observability/daily-stats.json');

  if (!fs.existsSync(statsFile)) {
    return null;
  }

  try {
    const content = fs.readFileSync(statsFile, 'utf-8');
    return JSON.parse(content) as DailyStats;
  } catch {
    return null;
  }
}

/**
 * Filter logs by date range and concept.
 */
export function filterLogs(
  logs: PromptLogEntry[],
  options: { from?: Date; to?: Date; concept?: string }
): PromptLogEntry[] {
  return logs.filter((entry) => {
    const entryDate = new Date(entry.timestamp);

    if (options.from && entryDate < options.from) {
      return false;
    }

    if (options.to && entryDate > options.to) {
      return false;
    }

    if (options.concept && entry.concept !== options.concept) {
      return false;
    }

    return true;
  });
}

/**
 * Analyze prompt logs and generate statistics.
 */
export function analyzePromptLogs(logs: PromptLogEntry[]): ObservabilityAnalysis {
  if (logs.length === 0) {
    return {
      total_calls: 0,
      total_tokens: 0,
      unique_sessions: 0,
      by_concept: [],
      by_model: {},
      date_range: { from: '', to: '' },
      top_sessions: [],
    };
  }

  // Sort by timestamp
  const sortedLogs = [...logs].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  // Basic totals
  const total_calls = logs.length;
  const total_tokens = logs.reduce((sum, e) => sum + e.estimated_tokens, 0);

  // Group by concept
  const conceptMap = new Map<string, { calls: number; tokens: number }>();
  for (const entry of logs) {
    const key = entry.concept || 'unknown';
    const current = conceptMap.get(key) || { calls: 0, tokens: 0 };
    current.calls += 1;
    current.tokens += entry.estimated_tokens;
    conceptMap.set(key, current);
  }

  const by_concept: ConceptStats[] = Array.from(conceptMap.entries())
    .map(([concept, stats]) => ({
      concept,
      calls: stats.calls,
      tokens: stats.tokens,
      avg_tokens: Math.round(stats.tokens / stats.calls),
    }))
    .sort((a, b) => b.tokens - a.tokens);

  // Group by model
  const by_model: Record<string, number> = {};
  for (const entry of logs) {
    const model = entry.model || 'unknown';
    by_model[model] = (by_model[model] || 0) + entry.estimated_tokens;
  }

  // Unique sessions
  const sessionIds = new Set(logs.map((e) => e.session_id));
  const unique_sessions = sessionIds.size;

  // Date range
  const date_range = {
    from: sortedLogs[0].timestamp,
    to: sortedLogs[sortedLogs.length - 1].timestamp,
  };

  // Top sessions by tokens
  const sessionMap = new Map<string, {
    calls: number;
    tokens: number;
    concepts: Set<string>;
    times: Date[];
  }>();

  for (const entry of logs) {
    const current = sessionMap.get(entry.session_id) || {
      calls: 0,
      tokens: 0,
      concepts: new Set<string>(),
      times: [],
    };
    current.calls += 1;
    current.tokens += entry.estimated_tokens;
    if (entry.concept) {
      current.concepts.add(entry.concept);
    }
    current.times.push(new Date(entry.timestamp));
    sessionMap.set(entry.session_id, current);
  }

  const top_sessions: SessionStats[] = Array.from(sessionMap.entries())
    .map(([session_id, stats]) => {
      const sortedTimes = stats.times.sort((a, b) => a.getTime() - b.getTime());
      return {
        session_id,
        calls: stats.calls,
        tokens: stats.tokens,
        concepts: Array.from(stats.concepts),
        start_time: sortedTimes[0].toISOString(),
        end_time: sortedTimes[sortedTimes.length - 1].toISOString(),
        duration_ms: sortedTimes[sortedTimes.length - 1].getTime() - sortedTimes[0].getTime(),
      };
    })
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 5);

  return {
    total_calls,
    total_tokens,
    unique_sessions,
    by_concept,
    by_model,
    date_range,
    top_sessions,
  };
}

