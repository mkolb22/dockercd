import { describe, it, expect } from 'vitest';
import {
  validateStory,
  validateArchitecture,
  validateImplementation,
  validateProvenanceAction,
} from './validators.js';

describe('validateStory', () => {
  it('accepts valid story', () => {
    expect(validateStory({
      story_id: 'story-001',
      status: 'ready',
      summary: 'A test story',
    })).toBe(true);
  });

  it('accepts story with extra fields', () => {
    expect(validateStory({
      story_id: 'story-001',
      status: 'completed',
      summary: 'A test story',
      title: 'Extra field',
      details: { foo: 'bar' },
    })).toBe(true);
  });

  it('rejects missing story_id', () => {
    expect(validateStory({
      status: 'ready',
      summary: 'Missing ID',
    })).toBe(false);
  });

  it('rejects missing status', () => {
    expect(validateStory({
      story_id: 'story-001',
      summary: 'Missing status',
    })).toBe(false);
  });

  it('rejects missing summary', () => {
    expect(validateStory({
      story_id: 'story-001',
      status: 'ready',
    })).toBe(false);
  });

  it('rejects non-string fields', () => {
    expect(validateStory({
      story_id: 123,
      status: 'ready',
      summary: 'Bad ID type',
    })).toBe(false);
  });

  it('rejects null', () => {
    expect(validateStory(null)).toBe(false);
  });

  it('rejects undefined', () => {
    expect(validateStory(undefined)).toBe(false);
  });

  it('rejects primitive', () => {
    expect(validateStory('string')).toBe(false);
  });
});

describe('validateArchitecture', () => {
  it('accepts valid architecture', () => {
    expect(validateArchitecture({
      id: 'arch-001',
      status: 'approved',
      summary: 'A test architecture',
    })).toBe(true);
  });

  it('rejects missing id', () => {
    expect(validateArchitecture({
      status: 'approved',
      summary: 'Missing id',
    })).toBe(false);
  });

  it('rejects arch_id instead of id', () => {
    expect(validateArchitecture({
      arch_id: 'arch-001',
      status: 'approved',
      summary: 'Wrong key name',
    })).toBe(false);
  });

  it('rejects null', () => {
    expect(validateArchitecture(null)).toBe(false);
  });
});

describe('validateImplementation', () => {
  it('accepts valid implementation', () => {
    expect(validateImplementation({
      impl_id: 'impl-001',
      status: 'completed',
      summary: 'A test implementation',
    })).toBe(true);
  });

  it('accepts implementation with optional fields', () => {
    expect(validateImplementation({
      impl_id: 'impl-001',
      arch_id: 'arch-001',
      story_id: 'story-001',
      status: 'completed',
      summary: 'With optional fields',
      files_changed: 5,
    })).toBe(true);
  });

  it('rejects missing impl_id', () => {
    expect(validateImplementation({
      status: 'completed',
      summary: 'Missing impl_id',
    })).toBe(false);
  });

  it('rejects null', () => {
    expect(validateImplementation(null)).toBe(false);
  });
});

describe('validateProvenanceAction', () => {
  it('accepts valid provenance action', () => {
    expect(validateProvenanceAction({
      action_id: 'act-001',
      concept: 'story',
      action: 'create',
      status: 'completed',
      timestamp: '2026-01-27T10:00:00Z',
    })).toBe(true);
  });

  it('accepts action with optional fields', () => {
    expect(validateProvenanceAction({
      action_id: 'act-001',
      concept: 'architecture',
      action: 'design',
      status: 'completed',
      timestamp: '2026-01-27T10:00:00Z',
      model: 'sonnet',
      flow_id: 'flow-001',
      cost: { cost_usd: 0.01 },
    })).toBe(true);
  });

  it('rejects missing action_id', () => {
    expect(validateProvenanceAction({
      concept: 'story',
      action: 'create',
      status: 'completed',
      timestamp: '2026-01-27T10:00:00Z',
    })).toBe(false);
  });

  it('rejects missing concept', () => {
    expect(validateProvenanceAction({
      action_id: 'act-001',
      action: 'create',
      status: 'completed',
      timestamp: '2026-01-27T10:00:00Z',
    })).toBe(false);
  });

  it('rejects missing timestamp', () => {
    expect(validateProvenanceAction({
      action_id: 'act-001',
      concept: 'story',
      action: 'create',
      status: 'completed',
    })).toBe(false);
  });

  it('rejects null', () => {
    expect(validateProvenanceAction(null)).toBe(false);
  });
});
