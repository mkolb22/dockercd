import { describe, it, expect } from 'vitest';
import { join } from 'path';
import {
  findProjectRoot,
  loadStories,
  loadArchitectures,
  loadImplementations,
  loadProvenanceActions,
  loadAllWorkflowState,
} from './loader.js';

const fixturesDir = join(import.meta.dirname, '..', 'tests', 'fixtures');

describe('findProjectRoot', () => {
  it('finds koan/ directory from project root', () => {
    const root = findProjectRoot(fixturesDir);
    expect(root).toBe(fixturesDir);
  });

  it('finds koan/ directory from subdirectory', () => {
    const root = findProjectRoot(join(fixturesDir, 'koan', 'stories'));
    expect(root).toBe(fixturesDir);
  });

  it('returns null when no koan/ exists', () => {
    const root = findProjectRoot('/tmp');
    expect(root).toBeNull();
  });
});

describe('loadStories', () => {
  it('loads valid stories from fixtures', async () => {
    const stories = await loadStories(fixturesDir);
    expect(stories.length).toBeGreaterThanOrEqual(1);
    const testStory = stories.find(s => s.story_id === 'story-test-001');
    expect(testStory).toBeDefined();
    expect(testStory!.status).toBe('completed');
    expect(testStory!.summary).toBe('Test story for unit tests');
  });

  it('filters out invalid stories', async () => {
    const stories = await loadStories(fixturesDir);
    const invalid = stories.find(s => s.summary === 'Missing story_id field');
    expect(invalid).toBeUndefined();
  });

  it('returns empty array for missing directory', async () => {
    const stories = await loadStories('/tmp/nonexistent-koan-dir');
    expect(stories).toEqual([]);
  });
});

describe('loadArchitectures', () => {
  it('loads valid architectures from fixtures', async () => {
    const archs = await loadArchitectures(fixturesDir);
    expect(archs.length).toBeGreaterThanOrEqual(1);
    const testArch = archs.find(a => a.id === 'arch-test-001');
    expect(testArch).toBeDefined();
    expect(testArch!.status).toBe('approved');
    expect(testArch!.story_id).toBe('story-test-001');
  });

  it('returns empty array for missing directory', async () => {
    const archs = await loadArchitectures('/tmp/nonexistent-koan-dir');
    expect(archs).toEqual([]);
  });
});

describe('loadImplementations', () => {
  it('loads valid implementations from fixtures', async () => {
    const impls = await loadImplementations(fixturesDir);
    expect(impls.length).toBeGreaterThanOrEqual(1);
    const testImpl = impls.find(i => i.impl_id === 'impl-test-001');
    expect(testImpl).toBeDefined();
    expect(testImpl!.status).toBe('completed');
    expect(testImpl!.arch_id).toBe('arch-test-001');
  });

  it('promotes arch_id and story_id from details to top level', async () => {
    const impls = await loadImplementations(fixturesDir);
    const nested = impls.find(i => i.impl_id === 'impl-test-nested');
    expect(nested).toBeDefined();
    expect(nested!.arch_id).toBe('arch-test-001');
    expect(nested!.story_id).toBe('story-test-001');
  });

  it('preserves top-level arch_id when both levels exist', async () => {
    const impls = await loadImplementations(fixturesDir);
    const both = impls.find(i => i.impl_id === 'impl-test-both');
    expect(both).toBeDefined();
    expect(both!.arch_id).toBe('arch-top-level');
    expect(both!.story_id).toBe('story-top-level');
  });

  it('returns empty array for missing directory', async () => {
    const impls = await loadImplementations('/tmp/nonexistent-koan-dir');
    expect(impls).toEqual([]);
  });
});

describe('loadProvenanceActions', () => {
  it('returns empty array when no state.db exists', async () => {
    // Fixtures dir has no state.db, so SQLite-only path returns []
    const actions = await loadProvenanceActions(fixturesDir);
    expect(actions).toEqual([]);
  });

  it('returns empty array when project root does not exist', async () => {
    const actions = await loadProvenanceActions('/tmp/nonexistent-koan-dir');
    expect(actions).toEqual([]);
  });
});

describe('loadAllWorkflowState', () => {
  it('loads all workflow state from fixtures', async () => {
    const state = await loadAllWorkflowState(fixturesDir);
    expect(state.stories.length).toBeGreaterThanOrEqual(1);
    expect(state.architectures.length).toBeGreaterThanOrEqual(1);
    expect(state.implementations.length).toBeGreaterThanOrEqual(1);
  });

  it('returns empty arrays for missing project', async () => {
    const state = await loadAllWorkflowState('/tmp/nonexistent-koan-dir');
    expect(state.stories).toEqual([]);
    expect(state.architectures).toEqual([]);
    expect(state.implementations).toEqual([]);
  });
});
