/**
 * Memory Store Tests
 * Comprehensive tests for memory storage, retrieval, linking, and evolution
 */

import { describe, it, expect } from 'vitest';
import { MemoryStore } from './store.js';
import { useStoreHarness } from '../../test-utils/store-harness.js';

describe('MemoryStore', () => {
  const t = useStoreHarness('memory', (p) => new MemoryStore(p));

  describe('insertMemory', () => {
    it('should insert an episodic memory', () => {
      const id = t.store.insertMemory({
        type: 'episodic',
        content: 'User fixed a bug in the authentication module',
        confidence: 1.0,
        category: 'debugging',
        archived: false,
      });

      expect(id).toBeDefined();
      expect(id).toMatch(/^mem-/);
    });

    it('should insert a semantic memory', () => {
      const id = t.store.insertMemory({
        type: 'semantic',
        content: 'React hooks must be called at the top level of a function component',
        confidence: 1.0,
        category: 'patterns',
        archived: false,
      });

      expect(id).toBeDefined();
      const memory = t.store.getMemory(id);
      expect(memory?.type).toBe('semantic');
      expect(memory?.content).toContain('React hooks');
    });

    it('should insert a procedural memory with steps', () => {
      const id = t.store.insertMemory({
        type: 'procedural',
        content: 'How to deploy to production',
        confidence: 1.0,
        category: 'workflows',
        steps: ['Run tests', 'Build artifacts', 'Deploy to staging', 'Deploy to production'],
        archived: false,
      });

      const memory = t.store.getMemory(id);
      expect(memory?.type).toBe('procedural');
      expect(memory?.steps).toHaveLength(4);
      expect(memory?.steps?.[0]).toBe('Run tests');
    });
  });

  describe('getMemory', () => {
    it('should retrieve a memory by ID', () => {
      const id = t.store.insertMemory({
        type: 'semantic',
        content: 'Test content',
        confidence: 0.8,
        archived: false,
      });

      const memory = t.store.getMemory(id);
      expect(memory).not.toBeNull();
      expect(memory?.content).toBe('Test content');
      expect(memory?.confidence).toBe(0.8);
    });

    it('should return null for non-existent ID', () => {
      const memory = t.store.getMemory('non-existent-id');
      expect(memory).toBeNull();
    });
  });

  describe('updateMemory', () => {
    it('should update confidence', () => {
      const id = t.store.insertMemory({
        type: 'semantic',
        content: 'Initial content',
        confidence: 1.0,
        archived: false,
      });

      t.store.updateMemory(id, { confidence: 0.7 });

      const memory = t.store.getMemory(id);
      expect(memory?.confidence).toBe(0.7);
    });

    it('should update content and summary', () => {
      const id = t.store.insertMemory({
        type: 'semantic',
        content: 'Initial content',
        confidence: 1.0,
        archived: false,
      });

      t.store.updateMemory(id, {
        content: 'Updated content',
        summary: 'A brief summary',
      });

      const memory = t.store.getMemory(id);
      expect(memory?.content).toBe('Updated content');
      expect(memory?.summary).toBe('A brief summary');
    });

    it('should update tags', () => {
      const id = t.store.insertMemory({
        type: 'semantic',
        content: 'Test',
        confidence: 1.0,
        tags: ['initial'],
        archived: false,
      });

      t.store.updateMemory(id, { tags: ['tag1', 'tag2', 'tag3'] });

      const memory = t.store.getMemory(id);
      expect(memory?.tags).toHaveLength(3);
      expect(memory?.tags).toContain('tag2');
    });
  });

  describe('touchMemory', () => {
    it('should increment access count', () => {
      const id = t.store.insertMemory({
        type: 'semantic',
        content: 'Test',
        confidence: 1.0,
        archived: false,
      });

      const before = t.store.getMemory(id);
      expect(before?.accessCount).toBe(0);

      t.store.touchMemory(id);
      t.store.touchMemory(id);
      t.store.touchMemory(id);

      const after = t.store.getMemory(id);
      expect(after?.accessCount).toBe(3);
    });
  });

  describe('archiveMemory', () => {
    it('should archive a memory with reason', () => {
      const id = t.store.insertMemory({
        type: 'semantic',
        content: 'To be archived',
        confidence: 1.0,
        archived: false,
      });

      t.store.archiveMemory(id, 'No longer relevant');

      const memory = t.store.getMemory(id);
      expect(memory?.archived).toBe(true);
      expect(memory?.archiveReason).toBe('No longer relevant');
    });
  });

  describe('insertEmbedding and searchByEmbedding', () => {
    it('should store and retrieve embeddings', () => {
      const id = t.store.insertMemory({
        type: 'semantic',
        content: 'Test embedding',
        confidence: 1.0,
        archived: false,
      });

      // Create a simple embedding (384 dimensions like MiniLM)
      const embedding = new Array(384).fill(0).map((_, i) => Math.sin(i * 0.1));
      t.store.insertEmbedding(id, embedding);

      // Search with the same embedding - should find it
      const results = t.store.searchByEmbedding(embedding, { limit: 10, threshold: 0.5 });
      expect(results.length).toBe(1);
      expect(results[0].memory.id).toBe(id);
      expect(results[0].similarity).toBeGreaterThan(0.99); // Should be very high similarity
    });

    it('should filter by type', () => {
      const id1 = t.store.insertMemory({
        type: 'episodic',
        content: 'Episodic memory',
        confidence: 1.0,
        archived: false,
      });
      const id2 = t.store.insertMemory({
        type: 'semantic',
        content: 'Semantic memory',
        confidence: 1.0,
        archived: false,
      });

      const emb1 = new Array(384).fill(0).map((_, i) => Math.sin(i * 0.1));
      const emb2 = new Array(384).fill(0).map((_, i) => Math.cos(i * 0.1));

      t.store.insertEmbedding(id1, emb1);
      t.store.insertEmbedding(id2, emb2);

      // Search for episodic only
      const results = t.store.searchByEmbedding(emb1, {
        limit: 10,
        threshold: 0.1,
        type: 'episodic',
      });

      expect(results.length).toBe(1);
      expect(results[0].memory.type).toBe('episodic');
    });

    it('should exclude archived memories', () => {
      const id = t.store.insertMemory({
        type: 'semantic',
        content: 'Archived memory',
        confidence: 1.0,
        archived: false,
      });

      const embedding = new Array(384).fill(0).map((_, i) => Math.sin(i * 0.1));
      t.store.insertEmbedding(id, embedding);

      t.store.archiveMemory(id, 'Testing archive exclusion');

      const results = t.store.searchByEmbedding(embedding, { limit: 10, threshold: 0.1 });
      expect(results.length).toBe(0);
    });
  });

  describe('createLink and getLinks', () => {
    it('should create a link between memories', () => {
      const id1 = t.store.insertMemory({
        type: 'semantic',
        content: 'Memory 1',
        confidence: 1.0,
        archived: false,
      });
      const id2 = t.store.insertMemory({
        type: 'semantic',
        content: 'Memory 2',
        confidence: 1.0,
        archived: false,
      });

      const linkId = t.store.createLink(id1, id2, 'related', 0.8, false);
      expect(linkId).toBeDefined();
      expect(linkId).toMatch(/^link-/);

      const links = t.store.getLinks(id1);
      expect(links.length).toBe(1);
      expect(links[0].relationship).toBe('related');
      expect(links[0].strength).toBe(0.8);
    });

    it('should not create duplicate links (same source, target, relationship)', () => {
      const id1 = t.store.insertMemory({
        type: 'semantic',
        content: 'Memory 1',
        confidence: 1.0,
        archived: false,
      });
      const id2 = t.store.insertMemory({
        type: 'semantic',
        content: 'Memory 2',
        confidence: 1.0,
        archived: false,
      });

      t.store.createLink(id1, id2, 'related', 0.8, false);
      t.store.createLink(id1, id2, 'related', 0.9, false); // Duplicate attempt

      // Only one link should exist due to UNIQUE constraint with OR IGNORE
      const links = t.store.getLinks(id1);
      const relatedLinks = links.filter(l => l.relationship === 'related');
      expect(relatedLinks.length).toBe(1);
      expect(relatedLinks[0].strength).toBe(0.8); // First value preserved
    });

    it('should mark auto-created links', () => {
      const id1 = t.store.insertMemory({
        type: 'semantic',
        content: 'Memory 1',
        confidence: 1.0,
        archived: false,
      });
      const id2 = t.store.insertMemory({
        type: 'semantic',
        content: 'Memory 2',
        confidence: 1.0,
        archived: false,
      });

      t.store.createLink(id1, id2, 'related', 0.75, true);

      const links = t.store.getLinks(id1);
      expect(links[0].autoCreated).toBe(true);
    });
  });

  describe('traverseGraph', () => {
    it('should traverse connected memories with BFS', () => {
      // Create a chain: A -> B -> C
      const idA = t.store.insertMemory({
        type: 'semantic',
        content: 'Memory A',
        confidence: 1.0,
        archived: false,
      });
      const idB = t.store.insertMemory({
        type: 'semantic',
        content: 'Memory B',
        confidence: 1.0,
        archived: false,
      });
      const idC = t.store.insertMemory({
        type: 'semantic',
        content: 'Memory C',
        confidence: 1.0,
        archived: false,
      });

      t.store.createLink(idA, idB, 'extends', 1.0, false);
      t.store.createLink(idB, idC, 'extends', 1.0, false);

      const nodes = t.store.traverseGraph([idA], 2, 10);

      expect(nodes.length).toBe(3);
      expect(nodes.find(n => n.memory.id === idA)).toBeDefined();
      expect(nodes.find(n => n.memory.id === idB)).toBeDefined();
      expect(nodes.find(n => n.memory.id === idC)).toBeDefined();
    });

    it('should respect maxDepth', () => {
      // Create a chain: A -> B -> C
      const idA = t.store.insertMemory({
        type: 'semantic',
        content: 'Memory A',
        confidence: 1.0,
        archived: false,
      });
      const idB = t.store.insertMemory({
        type: 'semantic',
        content: 'Memory B',
        confidence: 1.0,
        archived: false,
      });
      const idC = t.store.insertMemory({
        type: 'semantic',
        content: 'Memory C',
        confidence: 1.0,
        archived: false,
      });

      t.store.createLink(idA, idB, 'extends', 1.0, false);
      t.store.createLink(idB, idC, 'extends', 1.0, false);

      // Only depth 1 should exclude C
      const nodes = t.store.traverseGraph([idA], 1, 10);
      expect(nodes.length).toBe(2);
      expect(nodes.find(n => n.memory.id === idC)).toBeUndefined();
    });

    it('should respect maxNodes limit', () => {
      // Create many connected memories
      const ids: string[] = [];
      for (let i = 0; i < 10; i++) {
        ids.push(
          t.store.insertMemory({
            type: 'semantic',
            content: `Memory ${i}`,
            confidence: 1.0,
            archived: false,
          })
        );
      }

      // Link them all to the first one
      for (let i = 1; i < ids.length; i++) {
        t.store.createLink(ids[0], ids[i], 'related', 1.0, false);
      }

      const nodes = t.store.traverseGraph([ids[0]], 5, 3);
      expect(nodes.length).toBe(3);
    });
  });

  describe('runDecay', () => {
    it('should decay old memories', () => {
      const id = t.store.insertMemory({
        type: 'semantic',
        content: 'Old memory',
        confidence: 1.0,
        archived: false,
      });

      // Manually set created_at to old date (simulate old memory)
      t.store['execute'](
        `UPDATE memories SET created_at = datetime('now', '-30 days') WHERE id = ?`,
        [id]
      );

      const result = t.store.runDecay(7, 0.1, 0.2);

      expect(result.processed).toBe(1);
      expect(result.decayed).toBe(1);

      const memory = t.store.getMemory(id);
      expect(memory?.confidence).toBeLessThan(1.0);
    });

    it('should not decay memories within grace period', () => {
      const id = t.store.insertMemory({
        type: 'semantic',
        content: 'New memory',
        confidence: 1.0,
        archived: false,
      });

      const result = t.store.runDecay(7, 0.1, 0.2);

      expect(result.processed).toBe(0);

      const memory = t.store.getMemory(id);
      expect(memory?.confidence).toBe(1.0);
    });

    it('should archive memories below threshold', () => {
      const id = t.store.insertMemory({
        type: 'semantic',
        content: 'Very old memory',
        confidence: 0.15, // Already low
        archived: false,
      });

      t.store['execute'](
        `UPDATE memories SET created_at = datetime('now', '-60 days') WHERE id = ?`,
        [id]
      );

      const result = t.store.runDecay(7, 0.1, 0.2);

      expect(result.archived).toBe(1);

      const memory = t.store.getMemory(id);
      expect(memory?.archived).toBe(true);
    });

    it('should slow decay based on access count', () => {
      const id1 = t.store.insertMemory({
        type: 'semantic',
        content: 'Accessed memory',
        confidence: 1.0,
        archived: false,
      });
      const id2 = t.store.insertMemory({
        type: 'semantic',
        content: 'Untouched memory',
        confidence: 1.0,
        archived: false,
      });

      // Touch one memory many times
      for (let i = 0; i < 10; i++) {
        t.store.touchMemory(id1);
      }

      // Age both
      t.store['execute'](
        `UPDATE memories SET created_at = datetime('now', '-30 days') WHERE id IN (?, ?)`,
        [id1, id2]
      );

      t.store.runDecay(7, 0.1, 0.2);

      const m1 = t.store.getMemory(id1);
      const m2 = t.store.getMemory(id2);

      // Accessed memory should decay slower
      expect(m1!.confidence).toBeGreaterThan(m2!.confidence);
    });
  });

  describe('getMemoryStats', () => {
    it('should return accurate statistics', () => {
      // Insert different types
      t.store.insertMemory({ type: 'episodic', content: 'E1', confidence: 1.0, archived: false });
      t.store.insertMemory({ type: 'episodic', content: 'E2', confidence: 0.8, archived: false });
      t.store.insertMemory({ type: 'semantic', content: 'S1', confidence: 0.6, archived: false });
      t.store.insertMemory({ type: 'procedural', content: 'P1', confidence: 1.0, archived: false });
      t.store.insertMemory({ type: 'semantic', content: 'Archived', confidence: 1.0, archived: true });

      const stats = t.store.getMemoryStats();

      expect(stats.totalMemories).toBe(5);
      expect(stats.activeMemories).toBe(4);
      expect(stats.archivedMemories).toBe(1);
      expect(stats.byType.episodic).toBe(2);
      expect(stats.byType.semantic).toBe(1); // Excluding archived
      expect(stats.byType.procedural).toBe(1);
      expect(stats.avgConfidence).toBeCloseTo(0.85, 1); // (1 + 0.8 + 0.6 + 1) / 4
    });

    it('should count links', () => {
      const id1 = t.store.insertMemory({ type: 'semantic', content: 'M1', confidence: 1.0, archived: false });
      const id2 = t.store.insertMemory({ type: 'semantic', content: 'M2', confidence: 1.0, archived: false });
      const id3 = t.store.insertMemory({ type: 'semantic', content: 'M3', confidence: 1.0, archived: false });

      t.store.createLink(id1, id2, 'related', 1.0, false);
      t.store.createLink(id2, id3, 'extends', 1.0, false);
      t.store.createLink(id1, id3, 'supports', 1.0, false);

      const stats = t.store.getMemoryStats();
      expect(stats.totalLinks).toBe(3);
    });
  });
});
