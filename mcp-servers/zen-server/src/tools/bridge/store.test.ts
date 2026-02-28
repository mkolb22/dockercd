import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import Database from "better-sqlite3";
import { BridgeStore } from "./store.js";

let store: BridgeStore;
let globalDir: string;

beforeEach(() => {
  globalDir = path.join(os.tmpdir(), `bridge-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  store = new BridgeStore(globalDir);
});

afterEach(() => {
  try { fs.rmSync(globalDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

function createMemoryDb(dbPath: string, memories: Array<{ id: string; content: string; category: string; confidence: number; tags?: string[] }>): void {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'semantic',
      category TEXT,
      tags TEXT DEFAULT '[]',
      confidence REAL DEFAULT 0.5,
      source TEXT DEFAULT 'test',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      archived INTEGER DEFAULT 0
    )
  `);
  const insert = db.prepare("INSERT INTO memories (id, content, category, confidence, tags, created_at) VALUES (?, ?, ?, ?, ?, ?)");
  for (const m of memories) {
    insert.run(m.id, m.content, m.category, m.confidence, JSON.stringify(m.tags || []), new Date().toISOString());
  }
  db.close();
}

describe("BridgeStore — global dir", () => {
  it("creates category directories", () => {
    store.ensureGlobalDir();
    expect(fs.existsSync(path.join(globalDir, "patterns"))).toBe(true);
    expect(fs.existsSync(path.join(globalDir, "architecture"))).toBe(true);
    expect(fs.existsSync(path.join(globalDir, "conventions"))).toBe(true);
  });
});

describe("BridgeStore — loadLocalMemories", () => {
  it("loads from memory.db", () => {
    const dbPath = path.join(globalDir, "test.db");
    createMemoryDb(dbPath, [
      { id: "m1", content: "Use singleton pattern", category: "patterns", confidence: 0.8 },
      { id: "m2", content: "Prefer composition", category: "patterns", confidence: 0.5 },
    ]);
    const result = store.loadLocalMemories(dbPath);
    expect(result.get("patterns")).toHaveLength(2);
    expect(result.get("patterns")![0].confidence).toBe("high");
    expect(result.get("patterns")![1].confidence).toBe("medium");
  });

  it("returns empty for nonexistent db", () => {
    const result = store.loadLocalMemories("/nonexistent/path.db");
    expect(result.size).toBe(0);
  });

  it("maps confidence correctly", () => {
    const dbPath = path.join(globalDir, "conf.db");
    createMemoryDb(dbPath, [
      { id: "h", content: "high", category: "a", confidence: 0.9 },
      { id: "m", content: "med", category: "a", confidence: 0.5 },
      { id: "l", content: "low", category: "a", confidence: 0.2 },
    ]);
    const result = store.loadLocalMemories(dbPath);
    const mems = result.get("a")!;
    expect(mems.find((m) => m.id === "h")!.confidence).toBe("high");
    expect(mems.find((m) => m.id === "m")!.confidence).toBe("medium");
    expect(mems.find((m) => m.id === "l")!.confidence).toBe("low");
  });
});

describe("BridgeStore — exportMemories", () => {
  it("exports local memories to global store", () => {
    const dbPath = path.join(globalDir, "export-test.db");
    createMemoryDb(dbPath, [
      { id: "m1", content: "Pattern 1", category: "patterns", confidence: 0.7 },
      { id: "m2", content: "Arch decision", category: "architecture", confidence: 0.8 },
    ]);
    const result = store.exportMemories(dbPath, "test-project");
    expect(result.exported).toBe(2);
    expect(result.categories).toContain("patterns");
    expect(result.categories).toContain("architecture");

    // Verify file was created
    expect(fs.existsSync(path.join(globalDir, "patterns", "test-project.yaml"))).toBe(true);
  });

  it("deduplicates on re-export", () => {
    const dbPath = path.join(globalDir, "dedup.db");
    createMemoryDb(dbPath, [
      { id: "m1", content: "Pattern 1", category: "patterns", confidence: 0.7 },
    ]);
    store.exportMemories(dbPath, "proj");
    const result = store.exportMemories(dbPath, "proj");
    expect(result.exported).toBe(0);
    expect(result.skipped).toBe(1);
  });
});

describe("BridgeStore — loadGlobalMemories", () => {
  it("returns empty when no global dir", () => {
    const emptyStore = new BridgeStore("/nonexistent");
    expect(emptyStore.loadGlobalMemories().size).toBe(0);
  });

  it("loads exported memories", () => {
    const dbPath = path.join(globalDir, "load.db");
    createMemoryDb(dbPath, [
      { id: "m1", content: "Test", category: "patterns", confidence: 0.5 },
    ]);
    store.exportMemories(dbPath, "test");
    const global = store.loadGlobalMemories();
    expect(global.get("patterns")).toBeDefined();
    expect(global.get("patterns")!.length).toBeGreaterThanOrEqual(1);
  });
});

describe("BridgeStore — searchMemories", () => {
  it("searches by content", () => {
    const dbPath = path.join(globalDir, "search.db");
    createMemoryDb(dbPath, [
      { id: "m1", content: "Use TypeScript for safety", category: "patterns", confidence: 0.7 },
      { id: "m2", content: "Python is great", category: "patterns", confidence: 0.7 },
    ]);
    store.exportMemories(dbPath, "proj");
    const results = store.searchMemories("typescript");
    expect(results).toHaveLength(1);
    expect(results[0].matchType).toBe("content");
  });

  it("searches by tag", () => {
    const dbPath = path.join(globalDir, "tag.db");
    createMemoryDb(dbPath, [
      { id: "m1", content: "Something", category: "patterns", confidence: 0.7, tags: ["typescript", "testing"] },
    ]);
    store.exportMemories(dbPath, "proj");
    const results = store.searchMemories("testing");
    expect(results).toHaveLength(1);
    expect(results[0].matchType).toBe("tag");
  });

  it("filters by project", () => {
    const dbPath = path.join(globalDir, "filter.db");
    createMemoryDb(dbPath, [
      { id: "m1", content: "Alpha pattern", category: "patterns", confidence: 0.7 },
    ]);
    store.exportMemories(dbPath, "alpha");
    const results = store.searchMemories("pattern", "beta");
    expect(results).toHaveLength(0);
  });
});

describe("BridgeStore — listMemories", () => {
  it("lists categories with counts", () => {
    const dbPath = path.join(globalDir, "list.db");
    createMemoryDb(dbPath, [
      { id: "m1", content: "P1", category: "patterns", confidence: 0.7 },
      { id: "m2", content: "P2", category: "patterns", confidence: 0.7 },
      { id: "m3", content: "A1", category: "architecture", confidence: 0.7 },
    ]);
    store.exportMemories(dbPath, "proj");
    const categories = store.listMemories();
    expect(categories.length).toBeGreaterThanOrEqual(2);
    const patterns = categories.find((c) => c.category === "patterns");
    expect(patterns!.count).toBe(2);
  });

  it("filters by project", () => {
    const dbPath = path.join(globalDir, "list-proj.db");
    createMemoryDb(dbPath, [
      { id: "m1", content: "P1", category: "patterns", confidence: 0.7 },
    ]);
    store.exportMemories(dbPath, "projA");
    const categories = store.listMemories("projB");
    expect(categories).toHaveLength(0);
  });
});
