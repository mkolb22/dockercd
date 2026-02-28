/**
 * Observability analysis for prompt/token usage logs.
 * Reads JSONL prompt logs and computes analytics.
 */

import * as fs from "fs";
import * as path from "path";
import type {
  PromptLogEntry,
  SessionStats,
  ObservabilityAnalysis,
} from "./types.js";

/**
 * Load prompt logs from JSONL file.
 */
export function loadPromptLogs(projectRoot: string): PromptLogEntry[] {
  const logPath = path.join(projectRoot, "koan", "observability", "prompts.jsonl");
  if (!fs.existsSync(logPath)) return [];

  const lines = fs.readFileSync(logPath, "utf-8").split("\n").filter(Boolean);
  const entries: PromptLogEntry[] = [];

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as PromptLogEntry;
      if (parsed.timestamp) entries.push(parsed);
    } catch {
      // Skip malformed lines
    }
  }

  return entries;
}

/**
 * Filter log entries by date range and concept.
 */
export function filterLogs(
  entries: PromptLogEntry[],
  options: { from?: string; to?: string; concept?: string },
): PromptLogEntry[] {
  return entries.filter((e) => {
    if (options.from && e.timestamp < options.from) return false;
    if (options.to && e.timestamp > options.to) return false;
    if (options.concept && e.concept !== options.concept) return false;
    return true;
  });
}

/**
 * Analyze prompt logs into structured analytics.
 */
export function analyzePromptLogs(entries: PromptLogEntry[]): ObservabilityAnalysis {
  if (entries.length === 0) {
    return {
      total_calls: 0,
      total_tokens: 0,
      unique_sessions: 0,
      by_concept: [],
      by_model: [],
      date_range: { from: "", to: "" },
      top_sessions: [],
    };
  }

  const total_calls = entries.length;
  let total_tokens = 0;
  const sessions = new Set<string>();

  const byConcept = new Map<string, { calls: number; tokens: number }>();
  const byModel = new Map<string, { input: number; output: number; total: number }>();
  const bySession = new Map<string, {
    tokens: number;
    calls: number;
    concepts: Set<string>;
    firstTs: string;
    lastTs: string;
  }>();

  for (const e of entries) {
    const tokens = (e.input_tokens || 0) + (e.output_tokens || 0);
    total_tokens += tokens;

    if (e.session_id) sessions.add(e.session_id);

    // By concept
    if (e.concept) {
      const cg = byConcept.get(e.concept) || { calls: 0, tokens: 0 };
      cg.calls += 1;
      cg.tokens += tokens;
      byConcept.set(e.concept, cg);
    }

    // By model
    if (e.model) {
      const mg = byModel.get(e.model) || { input: 0, output: 0, total: 0 };
      mg.input += e.input_tokens || 0;
      mg.output += e.output_tokens || 0;
      mg.total += tokens;
      byModel.set(e.model, mg);
    }

    // By session
    if (e.session_id) {
      const sg = bySession.get(e.session_id) || {
        tokens: 0,
        calls: 0,
        concepts: new Set<string>(),
        firstTs: e.timestamp,
        lastTs: e.timestamp,
      };
      sg.tokens += tokens;
      sg.calls += 1;
      if (e.concept) sg.concepts.add(e.concept);
      if (e.timestamp < sg.firstTs) sg.firstTs = e.timestamp;
      if (e.timestamp > sg.lastTs) sg.lastTs = e.timestamp;
      bySession.set(e.session_id, sg);
    }
  }

  // Sort entries for date range
  const timestamps = entries.map((e) => e.timestamp).sort();

  // Top 5 sessions by token usage
  const top_sessions: SessionStats[] = Array.from(bySession.entries())
    .map(([session_id, s]) => ({
      session_id,
      total_tokens: s.tokens,
      call_count: s.calls,
      concepts: Array.from(s.concepts),
      duration_ms: new Date(s.lastTs).getTime() - new Date(s.firstTs).getTime(),
    }))
    .sort((a, b) => b.total_tokens - a.total_tokens)
    .slice(0, 5);

  return {
    total_calls,
    total_tokens,
    unique_sessions: sessions.size,
    by_concept: Array.from(byConcept.entries())
      .map(([concept, d]) => ({
        concept,
        calls: d.calls,
        tokens: d.tokens,
        avg_tokens: d.calls > 0 ? d.tokens / d.calls : 0,
      }))
      .sort((a, b) => b.tokens - a.tokens),
    by_model: Array.from(byModel.entries())
      .map(([model, d]) => ({
        model,
        input_tokens: d.input,
        output_tokens: d.output,
        total_tokens: d.total,
      }))
      .sort((a, b) => b.total_tokens - a.total_tokens),
    date_range: {
      from: timestamps[0] || "",
      to: timestamps[timestamps.length - 1] || "",
    },
    top_sessions,
  };
}
