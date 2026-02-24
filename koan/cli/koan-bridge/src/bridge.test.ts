import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import yaml from 'js-yaml';
import Database from 'better-sqlite3';
import type { Memory, MemoryFile } from './bridge.js';
import {
  ensureGlobalDir,
  loadLocalMemories,
  loadGlobalMemories,
  exportMemories,
  importMemories,
  searchMemories,
  listMemories,
  renderExportResult,
  renderImportResult,
  renderSearchResults,
  renderMemoryList,
} from './bridge.js';

// --- Test helpers ---

let testDir: string;
let globalDir: string;
let projectDir: string;

function makeTempDir(): string {
  const dir = join(tmpdir(), 'koan-bridge-test-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeYaml(path: string, data: unknown): void {
  const dir = join(path, '..');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, yaml.dump(data, { lineWidth: 120, noRefs: true }), 'utf-8');
}

function makeMemoryFile(category: string, memories: Partial<Memory>[]): MemoryFile {
  return {
    type: 'semantic',
    category,
    created_at: '2026-01-01T00:00:00Z',
    last_updated: '2026-01-01T00:00:00Z',
    memories: memories.map((m, i) => ({
      id: m.id || `mem-${i}`,
      content: m.content || 'Test memory',
      confidence: m.confidence || 'high',
      source: m.source || 'test',
      tags: m.tags || [],
      created_at: m.created_at || '2026-01-01T00:00:00Z',
      ...m,
    })) as Memory[],
  };
}

/**
 * Create a memory.db SQLite file with test data.
 * Matches the schema used by the MCP memory module.
 */
function createMemoryDb(projectDir: string, memories: Array<{ id: string; content: string; category?: string; confidence?: number; source?: string; tags?: string[] }>): void {
  const memDir = join(projectDir, 'koan', 'memory');
  mkdirSync(memDir, { recursive: true });
  const dbPath = join(memDir, 'memory.db');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      type TEXT DEFAULT 'semantic',
      category TEXT DEFAULT 'patterns',
      tags TEXT DEFAULT '[]',
      confidence REAL DEFAULT 0.8,
      source TEXT DEFAULT 'local',
      created_at TEXT DEFAULT (datetime('now')),
      archived INTEGER DEFAULT 0
    )
  `);
  const insert = db.prepare(
    'INSERT INTO memories (id, content, category, confidence, source, tags, created_at, archived) VALUES (?, ?, ?, ?, ?, ?, ?, 0)'
  );
  for (const m of memories) {
    insert.run(
      m.id,
      m.content,
      m.category || 'patterns',
      m.confidence ?? 0.8,
      m.source || 'local',
      JSON.stringify(m.tags || []),
      '2026-01-01T00:00:00Z',
    );
  }
  db.close();
}

beforeEach(() => {
  testDir = makeTempDir();
  globalDir = join(testDir, 'global-memory');
  projectDir = join(testDir, 'project');
  mkdirSync(join(projectDir, 'koan', 'memory'), { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

// --- ensureGlobalDir ---

describe('ensureGlobalDir', () => {
  it('creates all category subdirectories', () => {
    ensureGlobalDir(globalDir);
    expect(existsSync(join(globalDir, 'architecture'))).toBe(true);
    expect(existsSync(join(globalDir, 'patterns'))).toBe(true);
    expect(existsSync(join(globalDir, 'conventions'))).toBe(true);
    expect(existsSync(join(globalDir, 'preferences'))).toBe(true);
    expect(existsSync(join(globalDir, 'technologies'))).toBe(true);
    expect(existsSync(join(globalDir, 'workflows'))).toBe(true);
  });

  it('is idempotent', () => {
    ensureGlobalDir(globalDir);
    ensureGlobalDir(globalDir);
    expect(existsSync(join(globalDir, 'architecture'))).toBe(true);
  });
});

// --- loadLocalMemories ---

describe('loadLocalMemories', () => {
  it('loads memories from memory.db', () => {
    createMemoryDb(projectDir, [
      { id: 'mem-001', content: 'Uses TypeScript', category: 'architecture' },
    ]);

    const result = loadLocalMemories(projectDir);
    expect(result.size).toBe(1);
    expect(result.get('architecture')).toHaveLength(1);
    expect(result.get('architecture')![0].content).toBe('Uses TypeScript');
  });

  it('loads multiple categories from memory.db', () => {
    createMemoryDb(projectDir, [
      { id: 'mem-001', content: 'Arch', category: 'architecture' },
      { id: 'mem-002', content: 'Pattern', category: 'patterns' },
    ]);

    const result = loadLocalMemories(projectDir);
    expect(result.size).toBe(2);
  });

  it('returns empty map when no memory.db exists', () => {
    const result = loadLocalMemories(projectDir);
    expect(result.size).toBe(0);
  });

  it('maps confidence scores to levels', () => {
    createMemoryDb(projectDir, [
      { id: 'mem-high', content: 'High conf', category: 'patterns', confidence: 0.9 },
      { id: 'mem-med', content: 'Med conf', category: 'patterns', confidence: 0.5 },
      { id: 'mem-low', content: 'Low conf', category: 'patterns', confidence: 0.2 },
    ]);

    const result = loadLocalMemories(projectDir);
    const patterns = result.get('patterns')!;
    expect(patterns.find(m => m.id === 'mem-high')!.confidence).toBe('high');
    expect(patterns.find(m => m.id === 'mem-med')!.confidence).toBe('medium');
    expect(patterns.find(m => m.id === 'mem-low')!.confidence).toBe('low');
  });
});

// --- loadGlobalMemories ---

describe('loadGlobalMemories', () => {
  it('loads memories from global category directories', () => {
    ensureGlobalDir(globalDir);
    writeYaml(join(globalDir, 'architecture', 'project-a.yaml'),
      makeMemoryFile('architecture', [{ id: 'mem-g1', content: 'Global arch', project: 'project-a' }]));

    const result = loadGlobalMemories(globalDir);
    expect(result.size).toBe(1);
    expect(result.get('architecture')![0].project).toBe('project-a');
  });

  it('merges memories from multiple project files in same category', () => {
    ensureGlobalDir(globalDir);
    writeYaml(join(globalDir, 'patterns', 'project-a.yaml'),
      makeMemoryFile('patterns', [{ id: 'mem-a1', content: 'From A' }]));
    writeYaml(join(globalDir, 'patterns', 'project-b.yaml'),
      makeMemoryFile('patterns', [{ id: 'mem-b1', content: 'From B' }]));

    const result = loadGlobalMemories(globalDir);
    expect(result.get('patterns')).toHaveLength(2);
  });

  it('returns empty map when global dir does not exist', () => {
    const result = loadGlobalMemories(join(testDir, 'nonexistent'));
    expect(result.size).toBe(0);
  });
});

// --- exportMemories ---

describe('exportMemories', () => {
  it('exports local memories to global store', () => {
    createMemoryDb(projectDir, [
      { id: 'mem-001', content: 'Uses TypeScript', category: 'architecture', tags: ['typescript'] },
    ]);

    const result = exportMemories(projectDir, 'my-project', globalDir);
    expect(result.exported).toBe(1);
    expect(result.categories).toContain('architecture');

    // Verify file was written
    const exported = yaml.load(
      readFileSync(join(globalDir, 'architecture', 'my-project.yaml'), 'utf-8')
    ) as Record<string, unknown>;
    const mems = exported.memories as Memory[];
    expect(mems).toHaveLength(1);
    expect(mems[0].project).toBe('my-project');
  });

  it('skips already-exported memories', () => {
    createMemoryDb(projectDir, [
      { id: 'mem-001', content: 'Already there', category: 'architecture' },
    ]);

    // First export
    exportMemories(projectDir, 'proj', globalDir);
    // Second export
    const result = exportMemories(projectDir, 'proj', globalDir);
    expect(result.exported).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('returns zero counts when no local memories', () => {
    const result = exportMemories(projectDir, 'empty-proj', globalDir);
    expect(result.exported).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.categories).toEqual([]);
  });

  it('exports multiple categories', () => {
    createMemoryDb(projectDir, [
      { id: 'mem-001', content: 'Arch', category: 'architecture' },
      { id: 'mem-002', content: 'Pattern', category: 'patterns' },
    ]);

    const result = exportMemories(projectDir, 'multi-proj', globalDir);
    expect(result.exported).toBe(2);
    expect(result.categories).toHaveLength(2);
  });
});

// --- importMemories ---

describe('importMemories', () => {
  it('imports global memories into local project', () => {
    ensureGlobalDir(globalDir);
    writeYaml(join(globalDir, 'architecture', 'project-a.yaml'),
      makeMemoryFile('architecture', [
        { id: 'mem-g1', content: 'JWT auth pattern', tags: ['auth'], project: 'project-a' },
      ]));

    const result = importMemories(projectDir, globalDir);
    expect(result.imported).toBe(1);
    expect(result.categories).toContain('architecture');
  });

  it('skips memories already in local project', () => {
    ensureGlobalDir(globalDir);
    writeYaml(join(globalDir, 'architecture', 'other.yaml'),
      makeMemoryFile('architecture', [{ id: 'mem-001', content: 'Already local' }]));
    // Local memories now come from SQLite
    createMemoryDb(projectDir, [
      { id: 'mem-001', content: 'Already local', category: 'architecture' },
    ]);

    const result = importMemories(projectDir, globalDir);
    expect(result.imported).toBe(0);
  });

  it('filters by query', () => {
    ensureGlobalDir(globalDir);
    writeYaml(join(globalDir, 'architecture', 'other.yaml'),
      makeMemoryFile('architecture', [
        { id: 'mem-g1', content: 'JWT auth pattern', tags: ['auth'] },
        { id: 'mem-g2', content: 'Database indexing', tags: ['database'] },
      ]));

    const result = importMemories(projectDir, globalDir, 'auth');
    expect(result.imported).toBe(1);
  });

  it('filters by project', () => {
    ensureGlobalDir(globalDir);
    writeYaml(join(globalDir, 'patterns', 'project-a.yaml'),
      makeMemoryFile('patterns', [{ id: 'mem-a1', content: 'From A', project: 'project-a' }]));
    writeYaml(join(globalDir, 'patterns', 'project-b.yaml'),
      makeMemoryFile('patterns', [{ id: 'mem-b1', content: 'From B', project: 'project-b' }]));

    const result = importMemories(projectDir, globalDir, undefined, 'project-a');
    expect(result.imported).toBe(1);
  });

  it('returns zero when no matching global memories', () => {
    ensureGlobalDir(globalDir);
    const result = importMemories(projectDir, globalDir);
    expect(result.imported).toBe(0);
  });
});

// --- searchMemories ---

describe('searchMemories', () => {
  beforeEach(() => {
    ensureGlobalDir(globalDir);
    writeYaml(join(globalDir, 'architecture', 'proj.yaml'),
      makeMemoryFile('architecture', [
        { id: 'mem-1', content: 'JWT authentication with RS256', tags: ['auth', 'jwt'], confidence: 'high' },
        { id: 'mem-2', content: 'PostgreSQL for primary storage', tags: ['database', 'postgres'], confidence: 'medium' },
      ]));
    writeYaml(join(globalDir, 'patterns', 'proj.yaml'),
      makeMemoryFile('patterns', [
        { id: 'mem-3', content: 'Repository pattern for data access', tags: ['patterns', 'data'], confidence: 'high' },
      ]));
  });

  it('finds memories by content match', () => {
    const results = searchMemories(globalDir, 'JWT');
    expect(results).toHaveLength(1);
    expect(results[0].memory.id).toBe('mem-1');
    expect(results[0].matchType).toBe('content');
  });

  it('finds memories by tag match', () => {
    const results = searchMemories(globalDir, 'database');
    expect(results).toHaveLength(1);
    expect(results[0].memory.id).toBe('mem-2');
    expect(results[0].matchType).toBe('tag');
  });

  it('is case-insensitive', () => {
    const results = searchMemories(globalDir, 'jwt');
    expect(results).toHaveLength(1);
  });

  it('returns empty for no matches', () => {
    const results = searchMemories(globalDir, 'graphql');
    expect(results).toEqual([]);
  });

  it('sorts content matches before tag matches', () => {
    // "postgres" appears in content of mem-2 and in tag of mem-2
    // "data" appears in content of mem-3 (via "data access") and tag of mem-3
    const results = searchMemories(globalDir, 'data');
    expect(results.length).toBeGreaterThan(0);
    // Content matches come first
    if (results.length > 1) {
      expect(results[0].matchType).toBe('content');
    }
  });

  it('filters by project', () => {
    writeYaml(join(globalDir, 'architecture', 'other.yaml'),
      makeMemoryFile('architecture', [
        { id: 'mem-other', content: 'JWT from other project', tags: ['auth'], project: 'other-proj' },
      ]));

    const results = searchMemories(globalDir, 'JWT', 'other-proj');
    expect(results).toHaveLength(1);
    expect(results[0].memory.id).toBe('mem-other');
  });
});

// --- listMemories ---

describe('listMemories', () => {
  it('lists all global memories', () => {
    ensureGlobalDir(globalDir);
    writeYaml(join(globalDir, 'architecture', 'proj.yaml'),
      makeMemoryFile('architecture', [
        { id: 'mem-1', content: 'Arch memory' },
      ]));

    const result = listMemories(globalDir);
    expect(result.size).toBe(1);
    expect(result.get('architecture')).toHaveLength(1);
  });

  it('filters by project', () => {
    ensureGlobalDir(globalDir);
    writeYaml(join(globalDir, 'patterns', 'proj-a.yaml'),
      makeMemoryFile('patterns', [
        { id: 'mem-a', content: 'From A', project: 'proj-a' },
      ]));
    writeYaml(join(globalDir, 'patterns', 'proj-b.yaml'),
      makeMemoryFile('patterns', [
        { id: 'mem-b', content: 'From B', project: 'proj-b' },
      ]));

    const result = listMemories(globalDir, 'proj-a');
    expect(result.size).toBe(1);
    expect(result.get('patterns')).toHaveLength(1);
    expect(result.get('patterns')![0].project).toBe('proj-a');
  });

  it('returns empty map when no global memories', () => {
    ensureGlobalDir(globalDir);
    const result = listMemories(globalDir);
    expect(result.size).toBe(0);
  });
});

// --- Rendering ---

describe('renderExportResult', () => {
  it('renders successful export', () => {
    const output = renderExportResult({ exported: 3, skipped: 1, categories: ['architecture', 'patterns'] }, 'my-proj');
    expect(output).toContain('3 memories exported');
    expect(output).toContain('my-proj');
    expect(output).toContain('1 already present');
  });

  it('renders empty export', () => {
    const output = renderExportResult({ exported: 0, skipped: 0, categories: [] }, 'proj');
    expect(output).toContain('No local memories');
  });

  it('renders all-skipped export', () => {
    const output = renderExportResult({ exported: 0, skipped: 5, categories: [] }, 'proj');
    expect(output).toContain('5 memories already exported');
  });
});

describe('renderImportResult', () => {
  it('renders successful import', () => {
    const output = renderImportResult({ imported: 2, skipped: 0, categories: ['patterns'] });
    expect(output).toContain('2 memories imported');
  });

  it('renders empty import', () => {
    const output = renderImportResult({ imported: 0, skipped: 0, categories: [] });
    expect(output).toContain('No new memories');
  });
});

describe('renderSearchResults', () => {
  it('renders found results', () => {
    const results = [{
      memory: {
        id: 'mem-1', content: 'JWT auth', confidence: 'high' as const,
        source: 'test', tags: ['auth'], created_at: '2026-01-01T00:00:00Z',
        project: 'proj-a',
      },
      category: 'architecture',
      matchType: 'content' as const,
    }];
    const output = renderSearchResults(results, 'JWT');
    expect(output).toContain('1 result(s)');
    expect(output).toContain('JWT auth');
    expect(output).toContain('architecture');
    expect(output).toContain('proj-a');
  });

  it('renders empty results', () => {
    const output = renderSearchResults([], 'nothing');
    expect(output).toContain('No memories found');
  });
});

describe('renderMemoryList', () => {
  it('renders memory categories', () => {
    const memories = new Map<string, Memory[]>();
    memories.set('architecture', [
      { id: 'mem-1', content: 'Arch memory', confidence: 'high', source: 'test', tags: [], created_at: '2026-01-01T00:00:00Z' },
    ]);
    const output = renderMemoryList(memories);
    expect(output).toContain('architecture');
    expect(output).toContain('1 memories');
    expect(output).toContain('1 total memories');
  });

  it('renders empty state', () => {
    const output = renderMemoryList(new Map());
    expect(output).toContain('No global memories');
    expect(output).toContain('koan-bridge export');
  });

  it('truncates long lists with overflow indicator', () => {
    const mems: Memory[] = Array.from({ length: 5 }, (_, i) => ({
      id: `mem-${i}`, content: `Memory ${i}`, confidence: 'high' as const,
      source: 'test', tags: [], created_at: '2026-01-01T00:00:00Z',
    }));
    const memories = new Map<string, Memory[]>();
    memories.set('patterns', mems);
    const output = renderMemoryList(memories);
    expect(output).toContain('...and 2 more');
  });

  it('includes project filter in header', () => {
    const output = renderMemoryList(new Map(), 'my-project');
    expect(output).toContain('my-project');
  });
});
