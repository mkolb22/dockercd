/**
 * Cross-project memory bridge — pure functions for memory transfer.
 * Reads/writes YAML memory files between local project and global store.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import yaml from 'js-yaml';
import chalk from 'chalk';
import { getDatabase } from '@zen/koan-core';

// --- Types ---

export interface Memory {
  id: string;
  content: string;
  confidence: 'high' | 'medium' | 'low';
  source: string;
  tags: string[];
  created_at: string;
  related_files?: string[];
  project?: string; // added during export to track origin
}

export interface MemoryFile {
  type: string;
  category: string;
  created_at: string;
  last_updated: string;
  memories: Memory[];
}

export interface ExportResult {
  exported: number;
  skipped: number;
  categories: string[];
}

export interface ImportResult {
  imported: number;
  skipped: number;
  categories: string[];
}

export interface SearchResult {
  memory: Memory;
  category: string;
  matchType: 'content' | 'tag';
}

// --- Constants ---

const GLOBAL_DIR = join(process.env.HOME || '~', '.zen', 'global-memory');
const CATEGORIES = ['architecture', 'conventions', 'patterns', 'preferences', 'technologies', 'workflows'] as const;

// Category to local filename mapping
const CATEGORY_FILES: Record<string, string> = {
  architecture: 'architecture.yaml',
  conventions: 'conventions.yaml',
  patterns: 'patterns.yaml',
  preferences: 'preferences.yaml',
};

// --- File I/O helpers ---

function readMemoryFile(path: string): MemoryFile | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf-8');
    const data = yaml.load(raw) as Record<string, unknown>;
    if (!data || !data.type) return null;
    return {
      type: String(data.type || 'semantic'),
      category: String(data.category || ''),
      created_at: String(data.created_at || ''),
      last_updated: String(data.last_updated || ''),
      memories: Array.isArray(data.memories) ? (data.memories as Memory[]) : [],
    };
  } catch {
    return null;
  }
}

function writeMemoryFile(path: string, file: MemoryFile): void {
  const dir = join(path, '..');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const content = yaml.dump({
    type: file.type,
    category: file.category,
    created_at: file.created_at,
    last_updated: file.last_updated,
    memories: file.memories,
  }, { lineWidth: 120, noRefs: true });
  writeFileSync(path, content, 'utf-8');
}

// --- Core functions ---

export function ensureGlobalDir(globalDir: string = GLOBAL_DIR): void {
  for (const cat of CATEGORIES) {
    const dir = join(globalDir, cat);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

export function loadLocalMemories(projectRoot: string): Map<string, Memory[]> {
  const memDb = join(projectRoot, 'koan', 'memory', 'memory.db');
  if (existsSync(memDb)) return loadLocalMemoriesFromDb(memDb);
  return new Map();
}

function loadLocalMemoriesFromDb(dbPath: string): Map<string, Memory[]> {
  const result = new Map<string, Memory[]>();
  const db = getDatabase(dbPath, true);
  if (!db) return result;

  try {
    const rows = db.prepare(
      'SELECT id, content, type, category, tags, confidence, source, created_at FROM memories WHERE archived = 0 ORDER BY created_at DESC'
    ).all();

    for (const r of rows as any[]) {
      const category = r.category || 'patterns';
      const mem: Memory = {
        id: r.id,
        content: r.content,
        confidence: r.confidence >= 0.7 ? 'high' : r.confidence >= 0.4 ? 'medium' : 'low',
        source: r.source || 'local',
        tags: safeJsonParse(r.tags),
        created_at: r.created_at,
      };
      if (!result.has(category)) result.set(category, []);
      result.get(category)!.push(mem);
    }
  } catch {
    // Schema mismatch or other error — fall through to YAML
  } finally {
    db.close();
  }

  return result;
}

function safeJsonParse(str: string): string[] {
  try {
    const parsed = JSON.parse(str);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function loadGlobalMemories(globalDir: string = GLOBAL_DIR): Map<string, Memory[]> {
  const result = new Map<string, Memory[]>();

  for (const cat of CATEGORIES) {
    const catDir = join(globalDir, cat);
    if (!existsSync(catDir)) continue;

    let entries: string[];
    try {
      entries = readdirSync(catDir).filter(f => f.endsWith('.yaml'));
    } catch {
      continue;
    }

    const allMemories: Memory[] = [];
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

export function exportMemories(
  projectRoot: string,
  projectName: string,
  globalDir: string = GLOBAL_DIR,
): ExportResult {
  ensureGlobalDir(globalDir);
  const local = loadLocalMemories(projectRoot);
  let exported = 0;
  let skipped = 0;
  const categories: string[] = [];

  for (const [category, memories] of local) {
    const targetPath = join(globalDir, category, projectName + '.yaml');
    const existing = readMemoryFile(targetPath);
    const existingIds = new Set(existing?.memories.map(m => m.id) || []);

    const toExport = memories
      .filter(m => !existingIds.has(m.id))
      .map(m => ({ ...m, project: projectName }));

    skipped += memories.length - toExport.length;

    if (toExport.length === 0 && existing) continue;

    const merged: Memory[] = [...(existing?.memories || []), ...toExport];
    exported += toExport.length;
    categories.push(category);

    const now = new Date().toISOString();
    writeMemoryFile(targetPath, {
      type: 'semantic',
      category,
      created_at: existing?.created_at || now,
      last_updated: now,
      memories: merged,
    });
  }

  return { exported, skipped, categories };
}

export function importMemories(
  projectRoot: string,
  globalDir: string = GLOBAL_DIR,
  query?: string,
  projectFilter?: string,
): ImportResult {
  const global = loadGlobalMemories(globalDir);
  const local = loadLocalMemories(projectRoot);
  let imported = 0;
  let skipped = 0;
  const categories: string[] = [];

  for (const [category, memories] of global) {
    const localFilename = CATEGORY_FILES[category];
    if (!localFilename) continue;

    const localMems = local.get(category) || [];
    const localIds = new Set(localMems.map(m => m.id));

    let candidates = memories.filter(m => !localIds.has(m.id));

    if (projectFilter) {
      candidates = candidates.filter(m => m.project === projectFilter);
    }

    if (query) {
      const q = query.toLowerCase();
      candidates = candidates.filter(m =>
        m.content.toLowerCase().includes(q) ||
        m.tags.some(t => t.toLowerCase().includes(q))
      );
    }

    if (candidates.length === 0) {
      skipped += memories.filter(m => localIds.has(m.id)).length;
      continue;
    }

    // Write merged memories back to local file
    const memDir = join(projectRoot, 'koan', 'memory', 'semantic');
    const filePath = join(memDir, localFilename);
    const existing = readMemoryFile(filePath);
    const now = new Date().toISOString();

    writeMemoryFile(filePath, {
      type: existing?.type || 'semantic',
      category,
      created_at: existing?.created_at || now,
      last_updated: now,
      memories: [...localMems, ...candidates],
    });

    imported += candidates.length;
    categories.push(category);
  }

  return { imported, skipped, categories };
}

export function searchMemories(
  globalDir: string = GLOBAL_DIR,
  query: string,
  projectFilter?: string,
): SearchResult[] {
  const global = loadGlobalMemories(globalDir);
  const results: SearchResult[] = [];
  const q = query.toLowerCase();

  for (const [category, memories] of global) {
    for (const memory of memories) {
      if (projectFilter && memory.project !== projectFilter) continue;

      if (memory.content.toLowerCase().includes(q)) {
        results.push({ memory, category, matchType: 'content' });
      } else if (memory.tags.some(t => t.toLowerCase().includes(q))) {
        results.push({ memory, category, matchType: 'tag' });
      }
    }
  }

  // Sort: content matches first, then by confidence
  const confidenceOrder = { high: 0, medium: 1, low: 2 };
  results.sort((a, b) => {
    if (a.matchType !== b.matchType) return a.matchType === 'content' ? -1 : 1;
    return (confidenceOrder[a.memory.confidence] || 2) - (confidenceOrder[b.memory.confidence] || 2);
  });

  return results;
}

export function listMemories(
  globalDir: string = GLOBAL_DIR,
  projectFilter?: string,
): Map<string, Memory[]> {
  const global = loadGlobalMemories(globalDir);

  if (!projectFilter) return global;

  const filtered = new Map<string, Memory[]>();
  for (const [category, memories] of global) {
    const matching = memories.filter(m => m.project === projectFilter);
    if (matching.length > 0) {
      filtered.set(category, matching);
    }
  }

  return filtered;
}

// --- Rendering ---

const RULE = '\u2501'.repeat(40);

export function renderExportResult(result: ExportResult, projectName: string): string {
  const lines: string[] = [];
  lines.push(chalk.cyan(RULE));
  lines.push(chalk.bold.cyan('  Memory Export'));
  lines.push(chalk.cyan(RULE));
  lines.push('');

  if (result.exported === 0 && result.skipped === 0) {
    lines.push(chalk.gray('  No local memories to export.'));
  } else if (result.exported === 0) {
    lines.push(chalk.gray('  All ' + result.skipped + ' memories already exported.'));
  } else {
    lines.push('  ' + chalk.green(result.exported + ' memories exported') + ' from ' + chalk.cyan(projectName));
    if (result.skipped > 0) {
      lines.push('  ' + chalk.gray(result.skipped + ' already present (skipped)'));
    }
    lines.push('  Categories: ' + result.categories.join(', '));
  }

  lines.push('');
  return lines.join('\n');
}

export function renderImportResult(result: ImportResult): string {
  const lines: string[] = [];
  lines.push(chalk.cyan(RULE));
  lines.push(chalk.bold.cyan('  Memory Import'));
  lines.push(chalk.cyan(RULE));
  lines.push('');

  if (result.imported === 0) {
    lines.push(chalk.gray('  No new memories to import.'));
  } else {
    lines.push('  ' + chalk.green(result.imported + ' memories imported'));
    lines.push('  Categories: ' + result.categories.join(', '));
  }

  lines.push('');
  return lines.join('\n');
}

export function renderSearchResults(results: SearchResult[], query: string): string {
  const lines: string[] = [];
  lines.push(chalk.cyan(RULE));
  lines.push(chalk.bold.cyan('  Memory Search: "' + query + '"'));
  lines.push(chalk.cyan(RULE));
  lines.push('');

  if (results.length === 0) {
    lines.push(chalk.gray('  No memories found matching "' + query + '".'));
  } else {
    lines.push('  ' + results.length + ' result(s) found:');
    lines.push('');
    for (const r of results) {
      const conf = r.memory.confidence === 'high' ? chalk.green('high')
        : r.memory.confidence === 'medium' ? chalk.yellow('medium')
        : chalk.gray('low');
      lines.push('  ' + chalk.cyan(r.category) + ' ' + chalk.gray('[' + r.matchType + ']') + ' ' + conf);
      lines.push('    ' + r.memory.content);
      if (r.memory.project) {
        lines.push('    ' + chalk.gray('Project: ' + r.memory.project));
      }
      if (r.memory.tags.length > 0) {
        lines.push('    ' + chalk.gray('Tags: ' + r.memory.tags.join(', ')));
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

export function renderMemoryList(memories: Map<string, Memory[]>, projectFilter?: string): string {
  const lines: string[] = [];
  lines.push(chalk.cyan(RULE));
  lines.push(chalk.bold.cyan('  Global Memories' + (projectFilter ? ' (' + projectFilter + ')' : '')));
  lines.push(chalk.cyan(RULE));
  lines.push('');

  let total = 0;
  for (const [category, mems] of memories) {
    total += mems.length;
    lines.push('  ' + chalk.cyan(category.padEnd(16)) + mems.length + ' memories');
    for (const m of mems.slice(0, 3)) {
      const conf = m.confidence === 'high' ? chalk.green('*')
        : m.confidence === 'medium' ? chalk.yellow('*')
        : chalk.gray('*');
      lines.push('    ' + conf + ' ' + m.content.slice(0, 70) + (m.content.length > 70 ? '...' : ''));
    }
    if (mems.length > 3) {
      lines.push('    ' + chalk.gray('...and ' + (mems.length - 3) + ' more'));
    }
    lines.push('');
  }

  if (total === 0) {
    lines.push(chalk.gray('  No global memories found.'));
    lines.push(chalk.gray('  Use: koan-bridge export to share this project\'s memories.'));
    lines.push('');
  } else {
    lines.push('  ' + chalk.bold(total + ' total memories') + ' across ' + memories.size + ' categories');
    lines.push('');
  }

  return lines.join('\n');
}
