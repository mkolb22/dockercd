/**
 * VectorStore Tests
 * Tests for embedding storage, similarity search, and statistics
 */

import { describe, it, expect } from 'vitest';
import { VectorStore } from './store.js';
import { useStoreHarness } from '../../test-utils/store-harness.js';
import type { CodeChunk } from '../../core/types.js';

function makeChunk(overrides: Partial<CodeChunk> & { id?: string } = {}): CodeChunk {
  const id = overrides.id ?? `chunk-${Math.random().toString(36).slice(2, 6)}`;
  return {
    id,
    content: 'function hello() { return "world"; }',
    hash: `hash-${id}`,
    metadata: {
      file: 'src/index.ts',
      language: 'typescript',
      kind: 'function',
      name: 'hello',
      startLine: 1,
      endLine: 3,
      ...overrides.metadata,
    },
    ...overrides,
    // Re-spread metadata to ensure it's not overridden by top-level overrides
  } as CodeChunk;
}

/** Simple normalized vector for testing. Returns a unit vector along dimension `dim`. */
function makeEmbedding(dim: number, size: number = 8): number[] {
  const vec = new Array(size).fill(0);
  vec[dim % size] = 1.0;
  return vec;
}

describe('VectorStore', () => {
  const t = useStoreHarness('vec', (p) => new VectorStore(p));

  describe('addEmbeddings', () => {
    it('should insert chunks with embeddings', () => {
      t.store.addEmbeddings([
        { chunk: makeChunk({ id: 'c1' }), embedding: makeEmbedding(0) },
        { chunk: makeChunk({ id: 'c2' }), embedding: makeEmbedding(1) },
      ]);

      expect(t.store.getChunkCount()).toBe(2);
    });

    it('should handle upsert (replace on duplicate id)', () => {
      const chunk = makeChunk({ id: 'c1', content: 'original' });
      t.store.addEmbeddings([{ chunk, embedding: makeEmbedding(0) }]);

      const updatedChunk = makeChunk({ id: 'c1', content: 'updated' });
      t.store.addEmbeddings([{ chunk: updatedChunk, embedding: makeEmbedding(0) }]);

      expect(t.store.getChunkCount()).toBe(1);
    });
  });

  describe('search', () => {
    it('should find similar embeddings by cosine similarity', () => {
      t.store.addEmbeddings([
        { chunk: makeChunk({ id: 'c1' }), embedding: makeEmbedding(0) },
        { chunk: makeChunk({ id: 'c2' }), embedding: makeEmbedding(1) },
        { chunk: makeChunk({ id: 'c3' }), embedding: makeEmbedding(2) },
      ]);

      // Search with a query vector identical to c1's embedding
      const results = t.store.search({ embedding: makeEmbedding(0), threshold: 0.5 });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('c1');
      expect(results[0].similarity).toBeCloseTo(1.0, 5);
    });

    it('should respect the limit parameter', () => {
      // Add many chunks with similar embeddings
      const items = Array.from({ length: 10 }, (_, i) => ({
        chunk: makeChunk({ id: `c${i}` }),
        // All in the same general direction for similarity
        embedding: (() => {
          const v = new Array(8).fill(0.1);
          v[0] = 1.0 - i * 0.05; // Slightly different
          return v;
        })(),
      }));
      t.store.addEmbeddings(items);

      const results = t.store.search({
        embedding: items[0].embedding,
        limit: 3,
        threshold: 0.1,
      });
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it('should respect the threshold parameter', () => {
      t.store.addEmbeddings([
        { chunk: makeChunk({ id: 'c1' }), embedding: makeEmbedding(0) },
        { chunk: makeChunk({ id: 'c2' }), embedding: makeEmbedding(1) },
      ]);

      // Orthogonal vectors have similarity 0
      const results = t.store.search({ embedding: makeEmbedding(0), threshold: 0.9 });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('c1');
    });

    it('should filter by language', () => {
      t.store.addEmbeddings([
        {
          chunk: makeChunk({
            id: 'ts1',
            metadata: { file: 'a.ts', language: 'typescript', kind: 'function', name: 'a', startLine: 1, endLine: 5 },
          }),
          embedding: makeEmbedding(0),
        },
        {
          chunk: makeChunk({
            id: 'py1',
            metadata: { file: 'b.py', language: 'python', kind: 'function', name: 'b', startLine: 1, endLine: 5 },
          }),
          embedding: makeEmbedding(0),
        },
      ]);

      const results = t.store.search({
        embedding: makeEmbedding(0),
        threshold: 0.5,
        filter: { language: 'typescript' },
      });
      expect(results).toHaveLength(1);
      expect(results[0].metadata.language).toBe('typescript');
    });

    it('should filter by kind', () => {
      t.store.addEmbeddings([
        {
          chunk: makeChunk({
            id: 'fn1',
            metadata: { file: 'a.ts', language: 'typescript', kind: 'function', name: 'a', startLine: 1, endLine: 5 },
          }),
          embedding: makeEmbedding(0),
        },
        {
          chunk: makeChunk({
            id: 'cls1',
            metadata: { file: 'b.ts', language: 'typescript', kind: 'class', name: 'B', startLine: 1, endLine: 10 },
          }),
          embedding: makeEmbedding(0),
        },
      ]);

      const results = t.store.search({
        embedding: makeEmbedding(0),
        threshold: 0.5,
        filter: { kind: 'class' },
      });
      expect(results).toHaveLength(1);
      expect(results[0].metadata.kind).toBe('class');
    });
  });

  describe('getFileHashes', () => {
    it('should return file hashes from addEmbeddings', () => {
      t.store.addEmbeddings([
        {
          chunk: makeChunk({
            id: 'c1',
            hash: 'hash-abc',
            metadata: { file: 'src/a.ts', language: 'typescript', kind: 'function', name: 'a', startLine: 1, endLine: 5 },
          }),
          embedding: makeEmbedding(0),
        },
        {
          chunk: makeChunk({
            id: 'c2',
            hash: 'hash-def',
            metadata: { file: 'src/b.ts', language: 'typescript', kind: 'function', name: 'b', startLine: 1, endLine: 5 },
          }),
          embedding: makeEmbedding(1),
        },
      ]);

      const hashes = t.store.getFileHashes();
      expect(hashes['src/a.ts']).toBe('hash-abc');
      expect(hashes['src/b.ts']).toBe('hash-def');
    });

    it('should return empty object when no embeddings exist', () => {
      const hashes = t.store.getFileHashes();
      expect(hashes).toEqual({});
    });
  });

  describe('getChunkCount', () => {
    it('should return 0 for empty store', () => {
      expect(t.store.getChunkCount()).toBe(0);
    });

    it('should return correct count after insertions', () => {
      t.store.addEmbeddings([
        { chunk: makeChunk({ id: 'c1' }), embedding: makeEmbedding(0) },
        { chunk: makeChunk({ id: 'c2' }), embedding: makeEmbedding(1) },
        { chunk: makeChunk({ id: 'c3' }), embedding: makeEmbedding(2) },
      ]);
      expect(t.store.getChunkCount()).toBe(3);
    });
  });

  describe('getVectorStats', () => {
    it('should return zeros for empty store', () => {
      const stats = t.store.getVectorStats();
      expect(stats.totalChunks).toBe(0);
      expect(stats.totalFiles).toBe(0);
      expect(stats.byLanguage).toEqual({});
      expect(stats.byKind).toEqual({});
    });

    it('should return correct stats', () => {
      t.store.addEmbeddings([
        {
          chunk: makeChunk({
            id: 'c1',
            metadata: { file: 'a.ts', language: 'typescript', kind: 'function', name: 'a', startLine: 1, endLine: 5 },
          }),
          embedding: makeEmbedding(0),
        },
        {
          chunk: makeChunk({
            id: 'c2',
            metadata: { file: 'a.ts', language: 'typescript', kind: 'class', name: 'A', startLine: 10, endLine: 20 },
          }),
          embedding: makeEmbedding(1),
        },
        {
          chunk: makeChunk({
            id: 'c3',
            metadata: { file: 'b.py', language: 'python', kind: 'function', name: 'b', startLine: 1, endLine: 5 },
          }),
          embedding: makeEmbedding(2),
        },
      ]);

      const stats = t.store.getVectorStats();
      expect(stats.totalChunks).toBe(3);
      expect(stats.totalFiles).toBe(2);
      expect(stats.byLanguage.typescript).toBe(2);
      expect(stats.byLanguage.python).toBe(1);
      expect(stats.byKind.function).toBe(2);
      expect(stats.byKind.class).toBe(1);
    });
  });

  describe('clearVectors', () => {
    it('should empty all vector tables', () => {
      t.store.addEmbeddings([
        { chunk: makeChunk({ id: 'c1' }), embedding: makeEmbedding(0) },
        { chunk: makeChunk({ id: 'c2' }), embedding: makeEmbedding(1) },
      ]);
      expect(t.store.getChunkCount()).toBe(2);

      t.store.clearVectors();

      expect(t.store.getChunkCount()).toBe(0);
      expect(t.store.getFileHashes()).toEqual({});
    });
  });
});
