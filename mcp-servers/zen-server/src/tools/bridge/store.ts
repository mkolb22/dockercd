/**
 * Bridge Store
 * Reads local memories from project memory.db and global memories from YAML files.
 * No BaseStore inheritance — uses direct file I/O for YAML and better-sqlite3 for local.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { join, basename } from "path";
import Database from "better-sqlite3";
import type { BridgeMemory, MemoryFile, MemoryConfidence } from "./types.js";

// ─── Constants ───────────────────────────────────────────────

export const CATEGORIES = ["architecture", "conventions", "patterns", "preferences", "technologies", "workflows"] as const;

const CATEGORY_FILES: Record<string, string> = {
  architecture: "architecture.yaml",
  conventions: "conventions.yaml",
  patterns: "patterns.yaml",
  preferences: "preferences.yaml",
};

// ─── YAML I/O ────────────────────────────────────────────────

function readMemoryFile(path: string): MemoryFile | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    // Simple YAML-like parser for our known structure
    const data = parseSimpleYaml(raw);
    if (!data || !data.type) return null;
    return {
      type: String(data.type),
      category: String(data.category || ""),
      created_at: String(data.created_at || ""),
      last_updated: String(data.last_updated || ""),
      memories: Array.isArray(data.memories) ? data.memories : [],
    };
  } catch {
    return null;
  }
}

function writeMemoryFile(filePath: string, file: MemoryFile): void {
  const dir = join(filePath, "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const content = serializeMemoryFile(file);
  writeFileSync(filePath, content, "utf-8");
}

/**
 * Minimal YAML serializer for MemoryFile structure.
 * Avoids js-yaml dependency.
 */
function serializeMemoryFile(file: MemoryFile): string {
  const lines: string[] = [];
  lines.push(`type: ${file.type}`);
  lines.push(`category: ${file.category}`);
  lines.push(`created_at: "${file.created_at}"`);
  lines.push(`last_updated: "${file.last_updated}"`);
  lines.push("memories:");
  for (const m of file.memories) {
    lines.push(`  - id: "${m.id}"`);
    lines.push(`    content: "${escapeYaml(m.content)}"`);
    lines.push(`    confidence: ${m.confidence}`);
    lines.push(`    source: "${escapeYaml(m.source)}"`);
    lines.push(`    tags: [${m.tags.map((t) => `"${escapeYaml(t)}"`).join(", ")}]`);
    lines.push(`    created_at: "${m.created_at}"`);
    if (m.project) lines.push(`    project: "${escapeYaml(m.project)}"`);
    if (m.related_files && m.related_files.length > 0) {
      lines.push(`    related_files: [${m.related_files.map((f) => `"${escapeYaml(f)}"`).join(", ")}]`);
    }
  }
  return lines.join("\n") + "\n";
}

function escapeYaml(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

/**
 * Minimal YAML parser for MemoryFile structure.
 * Handles our known structure without a full YAML library.
 */
function parseSimpleYaml(raw: string): Record<string, unknown> | null {
  try {
    const result: Record<string, unknown> = {};
    const memories: BridgeMemory[] = [];
    let currentMemory: Partial<BridgeMemory> | null = null;
    let inMemories = false;

    for (const line of raw.split("\n")) {
      const trimmed = line.trimEnd();
      if (!trimmed || trimmed.startsWith("#")) continue;

      if (trimmed === "memories:") {
        inMemories = true;
        continue;
      }

      if (!inMemories) {
        const match = trimmed.match(/^(\w+):\s*"?([^"]*)"?\s*$/);
        if (match) result[match[1]] = match[2];
        continue;
      }

      // Inside memories array
      if (trimmed.match(/^\s+-\s+id:/)) {
        if (currentMemory && currentMemory.id) {
          memories.push(finishMemory(currentMemory));
        }
        currentMemory = {};
        const idMatch = trimmed.match(/id:\s*"?([^"]*)"?/);
        if (idMatch) currentMemory.id = idMatch[1];
        continue;
      }

      if (currentMemory) {
        const kvMatch = trimmed.match(/^\s+(\w+):\s*(.+)$/);
        if (kvMatch) {
          const [, key, value] = kvMatch;
          if (key === "tags" || key === "related_files") {
            const arrMatch = value.match(/\[(.*)\]/);
            const items = arrMatch ? arrMatch[1].split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean) : [];
            (currentMemory as Record<string, unknown>)[key] = items;
          } else {
            (currentMemory as Record<string, unknown>)[key] = value.replace(/^"|"$/g, "").replace(/\\n/g, "\n").replace(/\\"/g, '"');
          }
        }
      }
    }

    if (currentMemory && currentMemory.id) {
      memories.push(finishMemory(currentMemory));
    }

    result.memories = memories;
    return result;
  } catch {
    return null;
  }
}

function finishMemory(partial: Partial<BridgeMemory>): BridgeMemory {
  return {
    id: partial.id || "",
    content: partial.content || "",
    confidence: (partial.confidence || "medium") as MemoryConfidence,
    source: partial.source || "unknown",
    tags: partial.tags || [],
    created_at: partial.created_at || "",
    project: partial.project,
    related_files: partial.related_files,
  };
}

// ─── Public API ──────────────────────────────────────────────

export class BridgeStore {
  private globalDir: string;

  constructor(globalDir: string) {
    this.globalDir = globalDir;
  }

  ensureGlobalDir(): void {
    for (const cat of CATEGORIES) {
      const dir = join(this.globalDir, cat);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Load local memories from project's memory.db.
   */
  loadLocalMemories(memoryDbPath: string): Map<string, BridgeMemory[]> {
    const result = new Map<string, BridgeMemory[]>();
    if (!existsSync(memoryDbPath)) return result;

    let db: Database.Database | null = null;
    try {
      db = new Database(memoryDbPath, { readonly: true });
      const rows = db.prepare(
        "SELECT id, content, type, category, tags, confidence, source, created_at FROM memories WHERE archived = 0 ORDER BY created_at DESC",
      ).all() as Array<Record<string, unknown>>;

      for (const r of rows) {
        const category = String(r.category || "patterns");
        const confidence = Number(r.confidence || 0);
        const mem: BridgeMemory = {
          id: String(r.id),
          content: String(r.content),
          confidence: confidence >= 0.7 ? "high" : confidence >= 0.4 ? "medium" : "low",
          source: String(r.source || "local"),
          tags: safeJsonParse(String(r.tags || "[]")),
          created_at: String(r.created_at),
        };
        if (!result.has(category)) result.set(category, []);
        result.get(category)!.push(mem);
      }
    } catch {
      // Schema mismatch or other error — return empty
    } finally {
      db?.close();
    }

    return result;
  }

  /**
   * Load all global memories from YAML files.
   */
  loadGlobalMemories(): Map<string, BridgeMemory[]> {
    const result = new Map<string, BridgeMemory[]>();

    for (const cat of CATEGORIES) {
      const catDir = join(this.globalDir, cat);
      if (!existsSync(catDir)) continue;

      let entries: string[];
      try {
        entries = readdirSync(catDir).filter((f) => f.endsWith(".yaml"));
      } catch {
        continue;
      }

      const allMemories: BridgeMemory[] = [];
      for (const entry of entries) {
        const mf = readMemoryFile(join(catDir, entry));
        if (mf) allMemories.push(...mf.memories);
      }

      if (allMemories.length > 0) {
        result.set(cat, allMemories);
      }
    }

    return result;
  }

  /**
   * Export local memories to global store.
   */
  exportMemories(memoryDbPath: string, projectName: string): { exported: number; skipped: number; categories: string[] } {
    this.ensureGlobalDir();
    const local = this.loadLocalMemories(memoryDbPath);
    let exported = 0;
    let skipped = 0;
    const categories: string[] = [];

    for (const [category, memories] of local) {
      const targetPath = join(this.globalDir, category, `${projectName}.yaml`);
      const existing = readMemoryFile(targetPath);
      const existingIds = new Set(existing?.memories.map((m) => m.id) || []);

      const toExport = memories
        .filter((m) => !existingIds.has(m.id))
        .map((m) => ({ ...m, project: projectName }));

      skipped += memories.length - toExport.length;

      if (toExport.length === 0 && existing) continue;

      const merged = [...(existing?.memories || []), ...toExport];
      exported += toExport.length;
      categories.push(category);

      const now = new Date().toISOString();
      writeMemoryFile(targetPath, {
        type: "semantic",
        category,
        created_at: existing?.created_at || now,
        last_updated: now,
        memories: merged,
      });
    }

    return { exported, skipped, categories };
  }

  /**
   * Search global memories by query and optional project filter.
   */
  searchMemories(query: string, projectFilter?: string): Array<{ memory: BridgeMemory; category: string; matchType: "content" | "tag" }> {
    const global = this.loadGlobalMemories();
    const results: Array<{ memory: BridgeMemory; category: string; matchType: "content" | "tag" }> = [];
    const q = query.toLowerCase();

    for (const [category, memories] of global) {
      for (const memory of memories) {
        if (projectFilter && memory.project !== projectFilter) continue;

        if (memory.content.toLowerCase().includes(q)) {
          results.push({ memory, category, matchType: "content" });
        } else if (memory.tags.some((t) => t.toLowerCase().includes(q))) {
          results.push({ memory, category, matchType: "tag" });
        }
      }
    }

    const confidenceOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
    results.sort((a, b) => {
      if (a.matchType !== b.matchType) return a.matchType === "content" ? -1 : 1;
      return (confidenceOrder[a.memory.confidence] ?? 2) - (confidenceOrder[b.memory.confidence] ?? 2);
    });

    return results;
  }

  /**
   * List all global memories by category.
   */
  listMemories(projectFilter?: string): Array<{ category: string; count: number; memories: BridgeMemory[] }> {
    const global = this.loadGlobalMemories();
    const result: Array<{ category: string; count: number; memories: BridgeMemory[] }> = [];

    for (const [category, memories] of global) {
      const filtered = projectFilter ? memories.filter((m) => m.project === projectFilter) : memories;
      if (filtered.length > 0) {
        result.push({ category, count: filtered.length, memories: filtered });
      }
    }

    return result;
  }
}

function safeJsonParse(str: string): string[] {
  try {
    const parsed = JSON.parse(str);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
