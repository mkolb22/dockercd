import { describe, it, expect } from 'vitest';
import type { ProvenanceAction } from '@zen/koan-core';
import { extractPatterns, computeCalibration, generateSkill, getEligiblePatterns } from './learner.js';
import type { LearnedPattern } from './types.js';

const mockActions: ProvenanceAction[] = [
  { action_id: 'act-001', concept: 'story', action: 'create', status: 'completed', timestamp: '2026-01-01T10:00:00Z', model: 'sonnet' },
  { action_id: 'act-002', concept: 'story', action: 'create', status: 'completed', timestamp: '2026-01-02T10:00:00Z', model: 'sonnet' },
  { action_id: 'act-003', concept: 'story', action: 'create', status: 'completed', timestamp: '2026-01-03T10:00:00Z', model: 'sonnet' },
  { action_id: 'act-004', concept: 'story', action: 'create', status: 'completed', timestamp: '2026-01-04T10:00:00Z', model: 'sonnet' },
  { action_id: 'act-005', concept: 'story', action: 'create', status: 'completed', timestamp: '2026-01-05T10:00:00Z', model: 'sonnet' },
  { action_id: 'act-006', concept: 'architecture', action: 'design', status: 'completed', timestamp: '2026-01-01T11:00:00Z', model: 'opus' },
  { action_id: 'act-007', concept: 'architecture', action: 'design', status: 'completed', timestamp: '2026-01-02T11:00:00Z', model: 'opus' },
  { action_id: 'act-008', concept: 'architecture', action: 'design', status: 'failed', timestamp: '2026-01-03T11:00:00Z', model: 'opus' },
  { action_id: 'act-009', concept: 'implementation', action: 'generate', status: 'completed', timestamp: '2026-01-01T12:00:00Z', model: 'sonnet' },
  { action_id: 'act-010', concept: 'implementation', action: 'generate', status: 'completed', timestamp: '2026-01-02T12:00:00Z', model: 'sonnet' },
];

describe('extractPatterns', () => {
  it('should extract patterns from actions', () => {
    const patterns = extractPatterns(mockActions);

    expect(patterns.length).toBeGreaterThan(0);
    expect(patterns[0].occurrences).toBeGreaterThanOrEqual(3);
  });

  it('should calculate success rate correctly', () => {
    const patterns = extractPatterns(mockActions);

    const storyPattern = patterns.find(p => p.id === 'pattern-story-create');
    expect(storyPattern).toBeDefined();
    expect(storyPattern!.success_rate).toBe(1.0); // 5/5 completed

    const archPattern = patterns.find(p => p.id === 'pattern-architecture-design');
    expect(archPattern).toBeDefined();
    expect(archPattern!.success_rate).toBeCloseTo(0.667, 2); // 2/3 completed
  });

  it('should assign confidence based on occurrences and success rate', () => {
    const patterns = extractPatterns(mockActions);

    const storyPattern = patterns.find(p => p.id === 'pattern-story-create');
    // 5 occurrences, 100% success = medium confidence (need 10+ for high)
    expect(storyPattern?.confidence).toBe('medium');
  });

  it('should ignore patterns with fewer than 3 occurrences', () => {
    const patterns = extractPatterns(mockActions);

    // implementation only has 2 occurrences
    const implPattern = patterns.find(p => p.id === 'pattern-implementation-generate');
    expect(implPattern).toBeUndefined();
  });
});

describe('computeCalibration', () => {
  it('should compute calibration by concept', () => {
    const calibration = computeCalibration(mockActions);

    expect(calibration.length).toBeGreaterThan(0);
  });

  it('should calculate effectiveness correctly', () => {
    const calibration = computeCalibration(mockActions);

    const storyCalibration = calibration.find(c => c.category === 'story');
    expect(storyCalibration).toBeDefined();
    expect(storyCalibration!.effectiveness).toBe(1.0); // 5/5

    const archCalibration = calibration.find(c => c.category === 'architecture');
    expect(archCalibration).toBeDefined();
    expect(archCalibration!.effectiveness).toBeCloseTo(0.667, 2); // 2/3
  });
});

describe('generateSkill', () => {
  it('should generate a skill from a pattern', () => {
    const pattern: LearnedPattern = {
      id: 'pattern-test',
      name: 'test pattern',
      occurrences: 10,
      contexts: ['testing'],
      success_rate: 0.9,
      key_decisions: ['Decision 1', 'Decision 2'],
      first_seen: '2026-01-01T00:00:00Z',
      last_seen: '2026-01-10T00:00:00Z',
      confidence: 'high',
    };

    const skill = generateSkill(pattern);

    expect(skill.name).toBe('skill-test');
    expect(skill.pattern_id).toBe('pattern-test');
    expect(skill.success_rate).toBe(0.9);
    expect(skill.content).toContain('test pattern');
    expect(skill.content).toContain('90.0%');
  });
});

describe('getEligiblePatterns', () => {
  it('should return patterns with 5+ occurrences and 80%+ success', () => {
    const patterns: LearnedPattern[] = [
      { id: 'p1', name: 'Good', occurrences: 10, contexts: [], success_rate: 0.9, key_decisions: [], first_seen: '', last_seen: '', confidence: 'high' },
      { id: 'p2', name: 'Low count', occurrences: 3, contexts: [], success_rate: 0.9, key_decisions: [], first_seen: '', last_seen: '', confidence: 'low' },
      { id: 'p3', name: 'Low success', occurrences: 10, contexts: [], success_rate: 0.5, key_decisions: [], first_seen: '', last_seen: '', confidence: 'medium' },
    ];

    const eligible = getEligiblePatterns(patterns);

    expect(eligible.length).toBe(1);
    expect(eligible[0].id).toBe('p1');
  });

  it('should return empty array when no patterns meet criteria', () => {
    const patterns: LearnedPattern[] = [
      { id: 'p1', name: 'Low', occurrences: 2, contexts: [], success_rate: 0.5, key_decisions: [], first_seen: '', last_seen: '', confidence: 'low' },
    ];

    const eligible = getEligiblePatterns(patterns);

    expect(eligible.length).toBe(0);
  });
});
