import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { loadPromptLogs, filterLogs, analyzePromptLogs } from "./observe.js";
import type { PromptLogEntry } from "./types.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "observe-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeJsonl(entries: PromptLogEntry[]): void {
  const logDir = path.join(tmpDir, "koan", "observability");
  fs.mkdirSync(logDir, { recursive: true });
  const lines = entries.map((e) => JSON.stringify(e)).join("\n");
  fs.writeFileSync(path.join(logDir, "prompts.jsonl"), lines);
}

describe("loadPromptLogs", () => {
  it("returns empty for missing log file", () => {
    expect(loadPromptLogs(tmpDir)).toHaveLength(0);
  });

  it("loads valid JSONL entries", () => {
    writeJsonl([
      { timestamp: "2026-02-15T10:00:00Z", concept: "story", model: "sonnet", input_tokens: 100, output_tokens: 50 },
      { timestamp: "2026-02-15T11:00:00Z", concept: "implementation", model: "opus", input_tokens: 200, output_tokens: 100 },
    ]);
    const logs = loadPromptLogs(tmpDir);
    expect(logs).toHaveLength(2);
    expect(logs[0].concept).toBe("story");
  });

  it("skips malformed lines", () => {
    const logDir = path.join(tmpDir, "koan", "observability");
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(
      path.join(logDir, "prompts.jsonl"),
      '{"timestamp":"2026-02-15T10:00:00Z","concept":"story"}\n{bad json}\n{"timestamp":"2026-02-15T11:00:00Z","concept":"impl"}',
    );
    const logs = loadPromptLogs(tmpDir);
    expect(logs).toHaveLength(2);
  });
});

describe("filterLogs", () => {
  const entries: PromptLogEntry[] = [
    { timestamp: "2026-02-14T10:00:00Z", concept: "story" },
    { timestamp: "2026-02-15T10:00:00Z", concept: "implementation" },
    { timestamp: "2026-02-16T10:00:00Z", concept: "quality" },
  ];

  it("filters by from date", () => {
    const filtered = filterLogs(entries, { from: "2026-02-15" });
    expect(filtered).toHaveLength(2);
  });

  it("filters by to date", () => {
    const filtered = filterLogs(entries, { to: "2026-02-15" });
    expect(filtered).toHaveLength(1);
  });

  it("filters by concept", () => {
    const filtered = filterLogs(entries, { concept: "story" });
    expect(filtered).toHaveLength(1);
  });

  it("combines filters with AND logic", () => {
    const filtered = filterLogs(entries, { from: "2026-02-15", concept: "quality" });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].concept).toBe("quality");
  });
});

describe("analyzePromptLogs", () => {
  it("returns zeros for empty input", () => {
    const result = analyzePromptLogs([]);
    expect(result.total_calls).toBe(0);
    expect(result.total_tokens).toBe(0);
  });

  it("aggregates by concept and model", () => {
    const entries: PromptLogEntry[] = [
      { timestamp: "2026-02-15T10:00:00Z", concept: "story", model: "sonnet", session_id: "s1", input_tokens: 100, output_tokens: 50 },
      { timestamp: "2026-02-15T11:00:00Z", concept: "story", model: "opus", session_id: "s1", input_tokens: 200, output_tokens: 100 },
      { timestamp: "2026-02-15T12:00:00Z", concept: "implementation", model: "sonnet", session_id: "s2", input_tokens: 300, output_tokens: 150 },
    ];
    const result = analyzePromptLogs(entries);
    expect(result.total_calls).toBe(3);
    expect(result.total_tokens).toBe(900);
    expect(result.unique_sessions).toBe(2);
    expect(result.by_concept).toHaveLength(2);
    expect(result.by_model).toHaveLength(2);
  });

  it("computes top sessions by token usage", () => {
    const entries: PromptLogEntry[] = [
      { timestamp: "2026-02-15T10:00:00Z", session_id: "s1", input_tokens: 1000, output_tokens: 500 },
      { timestamp: "2026-02-15T10:30:00Z", session_id: "s1", input_tokens: 500, output_tokens: 200 },
      { timestamp: "2026-02-15T11:00:00Z", session_id: "s2", input_tokens: 100, output_tokens: 50 },
    ];
    const result = analyzePromptLogs(entries);
    expect(result.top_sessions).toHaveLength(2);
    expect(result.top_sessions[0].session_id).toBe("s1");
    expect(result.top_sessions[0].total_tokens).toBe(2200);
  });
});
