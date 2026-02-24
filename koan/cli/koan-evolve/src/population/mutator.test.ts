/**
 * Tests for Mutator (mutation and crossover)
 */

import { describe, it, expect } from 'vitest';
import {
  buildMutationPrompt,
  buildCrossoverPrompt,
  validateMutatedContent,
  type MutationConfig,
  type CrossoverConfig,
} from './mutator.js';
import type { PromptVariant } from './manager.js';

describe('Mutator', () => {
  const baseVariant: PromptVariant = {
    variant_id: 'variant-00',
    created_at: new Date().toISOString(),
    fitness_at_creation: null,
    status: 'active',
    checksum: 'abc123',
    content: `# Story Concept

You are the story concept agent. Your role is to capture user requirements.

## Purpose
Transform user requests into structured story artifacts.

## Actions
1. Extract acceptance criteria
2. Identify dependencies
3. Document edge cases
`,
  };

  describe('buildMutationPrompt', () => {
    it('should build prompt with focus and failures', () => {
      const config: MutationConfig = {
        model: 'sonnet',
        focus: 'improve acceptance criteria clarity',
        recentFailures: [
          'Acceptance criteria too vague',
          'Missing edge cases',
        ],
      };

      const prompt = buildMutationPrompt(baseVariant, config);

      expect(prompt).toContain('You are a prompt engineer');
      expect(prompt).toContain('CURRENT PROMPT:');
      expect(prompt).toContain('# Story Concept');
      expect(prompt).toContain('RECENT FAILURES:');
      expect(prompt).toContain('Acceptance criteria too vague');
      expect(prompt).toContain('Missing edge cases');
      expect(prompt).toContain('MUTATION FOCUS:');
      expect(prompt).toContain('improve acceptance criteria clarity');
    });

    it('should handle empty failures gracefully', () => {
      const config: MutationConfig = {
        model: 'sonnet',
        focus: 'general improvement',
        recentFailures: [],
      };

      const prompt = buildMutationPrompt(baseVariant, config);

      expect(prompt).toContain('No specific failures noted');
    });
  });

  describe('buildCrossoverPrompt', () => {
    it('should build prompt with two variants and fitness scores', () => {
      const variantA: PromptVariant = {
        ...baseVariant,
        variant_id: 'variant-01',
        content: '# Variant A\nApproach A content',
      };

      const variantB: PromptVariant = {
        ...baseVariant,
        variant_id: 'variant-02',
        content: '# Variant B\nApproach B content',
      };

      const config: CrossoverConfig = {
        model: 'sonnet',
        variantA,
        variantB,
        fitnessA: 0.82,
        fitnessB: 0.79,
      };

      const prompt = buildCrossoverPrompt(config);

      expect(prompt).toContain('You are a prompt engineer combining');
      expect(prompt).toContain('VARIANT A (fitness: 0.820)');
      expect(prompt).toContain('VARIANT B (fitness: 0.790)');
      expect(prompt).toContain('# Variant A');
      expect(prompt).toContain('# Variant B');
      expect(prompt).toContain('Output only the combined prompt');
    });
  });

  describe('validateMutatedContent', () => {
    it('should accept valid markdown content', () => {
      const content = `# Valid Content

This is a valid prompt with proper structure.

## Section 1
Content here.

## Section 2
More content.
`;

      const result = validateMutatedContent(content);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject content that is too short', () => {
      const content = 'Too short';

      const result = validateMutatedContent(content);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Content too short (< 100 characters)');
    });

    it('should detect placeholder text', () => {
      const content = `# Content

[PLACEHOLDER: This is not real content]

More text to meet minimum length requirement here and there and everywhere.
`;

      const result = validateMutatedContent(content);

      // Check that placeholder text is detected as invalid
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      const hasPlaceholderError = result.errors.some(e => e.toLowerCase().includes('placeholder'));
      expect(hasPlaceholderError).toBe(true);
    });

    it('should detect missing markdown structure', () => {
      const content = 'Just plain text without any headers or structure but long enough to pass length check so we add more text here.';

      const result = validateMutatedContent(content);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('markdown structure'))).toBe(true);
    });
  });
});
