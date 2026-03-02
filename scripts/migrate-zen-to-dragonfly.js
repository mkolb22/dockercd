#!/usr/bin/env node
/**
 * One-time migration: zen SQLite → dragonfly SQLite
 * Run from the project root: node scripts/migrate-zen-to-dragonfly.js
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const ROOT = process.env.PROJECT_ROOT ?? process.cwd();
const NOW  = new Date().toISOString();

const ZEN_MEMORY = join(ROOT, 'koan/memory/memory.db');
const ZEN_STATE  = join(ROOT, 'koan/state/state.db');
const DF_DATA    = join(ROOT, 'data');
const DF_MEMORY  = join(DF_DATA, 'memory.db');
const DF_STATE   = join(DF_DATA, 'state.db');

if (!existsSync(ZEN_MEMORY)) { console.error('zen memory.db not found:', ZEN_MEMORY); process.exit(1); }
if (!existsSync(ZEN_STATE))  { console.error('zen state.db not found:', ZEN_STATE); process.exit(1); }
if (!existsSync(DF_DATA)) mkdirSync(DF_DATA, { recursive: true });

const zenMem   = new Database(ZEN_MEMORY, { readonly: true });
const zenState = new Database(ZEN_STATE,  { readonly: true });
const dfMem    = new Database(DF_MEMORY);
const dfState  = new Database(DF_STATE);

// ── Initialize dragonfly memory.db schema ───────────────────────────────────
dfMem.exec(`
  CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    summary TEXT,
    confidence REAL NOT NULL DEFAULT 1.0,
    source TEXT,
    category TEXT,
    tags TEXT,
    steps TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_accessed TEXT NOT NULL,
    access_count INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    archive_reason TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
  CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);
  CREATE INDEX IF NOT EXISTS idx_memories_archived ON memories(archived);
`);

// ── Migrate memories ─────────────────────────────────────────────────────────
const zenMemories = zenMem.prepare('SELECT * FROM memories').all();
console.log(`\nMigrating ${zenMemories.length} memories...`);

const insertMem = dfMem.prepare(`
  INSERT OR IGNORE INTO memories
    (id, type, content, summary, confidence, source, category, tags, created_at, updated_at, last_accessed, access_count)
  VALUES
    (@id, @type, @content, @summary, @confidence, @source, @category, @tags, @created_at, @updated_at, @last_accessed, @access_count)
`);

let memOk = 0;
for (const m of zenMemories) {
  try {
    insertMem.run({
      id:            m.id,
      type:          m.type,
      content:       typeof m.content === 'object' ? JSON.stringify(m.content) : m.content,
      summary:       m.summary ?? null,
      confidence:    m.confidence ?? 1.0,
      source:        m.source ?? null,
      category:      m.category ?? null,
      tags:          m.tags ?? null,
      created_at:    m.created_at ?? NOW,
      updated_at:    m.updated_at ?? NOW,
      last_accessed: m.last_accessed ?? NOW,
      access_count:  m.access_count ?? 0,
    });
    console.log(`  ✓ [${m.type}/${m.category}] ${m.id.slice(0,30)}…`);
    memOk++;
  } catch (e) {
    console.warn(`  ✗ ${m.id}: ${e.message}`);
  }
}
console.log(`Memories: ${memOk}/${zenMemories.length} imported`);

// ── Migrate checkpoints ───────────────────────────────────────────────────────
const zenCheckpoints = zenState.prepare('SELECT * FROM checkpoints ORDER BY created_at').all();
console.log(`\nMigrating ${zenCheckpoints.length} checkpoints...`);

// Ensure checkpoints table exists in dragonfly state.db
dfState.exec(`
  CREATE TABLE IF NOT EXISTS checkpoints (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'manual',
    data TEXT NOT NULL DEFAULT '{}',
    restoration_prompt TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const insertChk = dfState.prepare(`
  INSERT OR IGNORE INTO checkpoints (id, name, type, data, created_at)
  VALUES (@id, @name, @type, @data, @created_at)
`);

let chkOk = 0;
for (const c of zenCheckpoints) {
  try {
    // Merge restoration_prompt into data JSON if present
    let data = '{}';
    try { data = c.data ?? '{}'; } catch {}
    if (c.restoration_prompt) {
      try {
        const parsed = JSON.parse(data);
        parsed.restoration_prompt = c.restoration_prompt;
        data = JSON.stringify(parsed);
      } catch {}
    }
    insertChk.run({
      id:         c.id,
      name:       c.name,
      type:       c.type ?? 'manual',
      data:       data,
      created_at: c.created_at ?? NOW,
    });
    console.log(`  ✓ [${c.type}] ${c.name}`);
    chkOk++;
  } catch (e) {
    console.warn(`  ✗ ${c.id}: ${e.message}`);
  }
}
console.log(`Checkpoints: ${chkOk}/${zenCheckpoints.length} imported`);

// ── Migrate stories ───────────────────────────────────────────────────────────
const zenStories = zenState.prepare('SELECT * FROM stories').all();
console.log(`\nMigrating ${zenStories.length} stories...`);

const dfStoryTables = dfState.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='stories'").get();
if (dfStoryTables) {
  const insertStory = dfState.prepare(`
    INSERT OR IGNORE INTO stories (id, title, status, data, created_at, updated_at)
    VALUES (@id, @title, @status, @data, @created_at, @updated_at)
  `);
  let storyOk = 0;
  for (const s of zenStories) {
    try {
      insertStory.run({
        id:         s.id,
        title:      s.title,
        status:     s.status ?? 'ready',
        data:       s.data ?? '{}',
        created_at: s.created_at ?? NOW,
        updated_at: s.updated_at ?? NOW,
      });
      console.log(`  ✓ [${s.status}] ${s.title}`);
      storyOk++;
    } catch (e) {
      console.warn(`  ✗ ${s.id}: ${e.message}`);
    }
  }
  console.log(`Stories: ${storyOk}/${zenStories.length} imported`);
} else {
  console.log('  (stories table not in dragonfly state.db — skipping)');
}

// ── Migrate specs ─────────────────────────────────────────────────────────────
const zenSpecs = zenState.prepare('SELECT * FROM specs').all();
console.log(`\nMigrating ${zenSpecs.length} specs...`);

const dfSpecTable = dfState.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='specs'").get();
if (dfSpecTable) {
  const dfSpecCols = dfState.prepare("PRAGMA table_info(specs)").all().map(r => r.name);
  const insertSpec = dfState.prepare(`
    INSERT OR IGNORE INTO specs (${dfSpecCols.join(', ')})
    VALUES (${dfSpecCols.map(c => '@' + c).join(', ')})
  `);
  let specOk = 0;
  for (const s of zenSpecs) {
    try {
      const row = {};
      for (const col of dfSpecCols) { row[col] = s[col] ?? null; }
      insertSpec.run(row);
      console.log(`  ✓ ${s.name ?? s.id}`);
      specOk++;
    } catch (e) {
      console.warn(`  ✗ ${s.id}: ${e.message}`);
    }
  }
  console.log(`Specs: ${specOk}/${zenSpecs.length} imported`);
} else {
  // Specs not in dragonfly — store as memories instead so knowledge is preserved
  console.log('  (no specs table in dragonfly — storing as semantic memories)');
  const insertSpecMem = dfMem.prepare(`
    INSERT OR IGNORE INTO memories
      (id, type, content, category, tags, confidence, source, created_at, updated_at, last_accessed, access_count)
    VALUES
      (@id, 'semantic', @content, 'spec', @tags, 1.0, 'zen-migration', @created_at, @created_at, @created_at, 0)
  `);
  let specMemOk = 0;
  for (const s of zenSpecs) {
    try {
      insertSpecMem.run({
        id:         `spec-migrated-${s.id}`,
        content:    `SPEC [${s.name}]: ${s.data}`,
        tags:       JSON.stringify(['spec', 'zen-migration', s.name]),
        created_at: s.created_at ?? NOW,
      });
      console.log(`  ✓ spec→memory: ${s.name ?? s.id}`);
      specMemOk++;
    } catch (e) {
      console.warn(`  ✗ ${s.id}: ${e.message}`);
    }
  }
  console.log(`Specs (as memories): ${specMemOk}/${zenSpecs.length} imported`);
}

zenMem.close(); zenState.close(); dfMem.close(); dfState.close();
console.log('\n✓ Migration complete');
