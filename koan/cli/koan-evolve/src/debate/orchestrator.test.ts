/**
 * Tests for debate result assembler.
 */

import { describe, it, expect } from 'vitest';
import { conductDebate } from './orchestrator.js';
import type { DebateConfig, DebateResult } from '../types.js';

describe('conductDebate', () => {
  const defaultConfig: DebateConfig = {
    enabled: true,
    trigger_concepts: ['architecture'],
    timeout_seconds: 30,
    min_confidence_for_auto_accept: 0.85,
    require_human_approval_below: 0.70,
  };

  const mockAdvocate: DebateResult['advocate'] = {
    agent: 'debate-advocate',
    model: 'sonnet',
    proposed_approach: 'Use event-driven architecture',
    confidence: 0.85,
    key_arguments: [
      'Decouples components',
      'Scales horizontally',
      'Resilient to failures',
    ],
  };

  const mockCritic: DebateResult['critic'] = {
    agent: 'debate-critic',
    model: 'sonnet',
    confidence: 0.78,
    concerns: [
      {
        concern: 'Event ordering guarantees',
        severity: 'medium',
        suggestion: 'Add sequence numbers',
      },
    ],
    risk_assessment: 'medium',
  };

  const mockSynthesis: DebateResult['synthesis'] = {
    agent: 'debate-synthesis',
    model: 'opus',
    final_decision: 'Proceed with event-driven architecture plus ordering guarantees',
    confidence: 0.91,
    incorporated_concerns: ['Added sequence numbers per critic suggestion'],
    remaining_risks: ['Performance validation needed'],
    dissent_documented: false,
    dissent_summary: 'N/A',
    recommendation: 'proceed',
  };

  it('should assemble a complete debate result', () => {
    const result = conductDebate('arch-001', mockAdvocate, mockCritic, mockSynthesis, defaultConfig);

    expect(result.debate_id).toBe('debate-arch-001');
    expect(result.arch_id).toBe('arch-001');
    expect(result.advocate).toBeDefined();
    expect(result.critic).toBeDefined();
    expect(result.synthesis).toBeDefined();
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('should preserve agent identities', () => {
    const result = conductDebate('arch-002', mockAdvocate, mockCritic, mockSynthesis, defaultConfig);

    expect(result.advocate.agent).toBe('debate-advocate');
    expect(result.critic.agent).toBe('debate-critic');
    expect(result.synthesis.agent).toBe('debate-synthesis');
  });

  it('should pass through confidence scores', () => {
    const result = conductDebate('arch-003', mockAdvocate, mockCritic, mockSynthesis, defaultConfig);

    expect(result.advocate.confidence).toBe(0.85);
    expect(result.critic.confidence).toBe(0.78);
    expect(result.synthesis.confidence).toBe(0.91);
  });

  it('should track debate cost', () => {
    const result = conductDebate('arch-004', mockAdvocate, mockCritic, mockSynthesis, defaultConfig);

    expect(result.metadata.cost).toBeGreaterThan(0);
    expect(result.metadata.sanitization_applied).toBe(true);
  });

  it('should pass through actual agent content', () => {
    const result = conductDebate('arch-005', mockAdvocate, mockCritic, mockSynthesis, defaultConfig);

    expect(result.advocate.proposed_approach).toBe('Use event-driven architecture');
    expect(result.critic.concerns).toHaveLength(1);
    expect(result.synthesis.recommendation).toBe('proceed');
  });
});
