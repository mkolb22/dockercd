/**
 * Mutator: Mutation and crossover operators for prompt variant state management.
 * Phase 5.2: Prompt Population
 *
 * Claude Code provides the intelligence (generates mutated/crossed content).
 * This module manages variant creation, validation, and storage.
 */

import crypto from 'node:crypto';
import type { PromptVariant } from './manager.js';

function contentChecksum(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

export interface MutationConfig {
  focus: string;
  recentFailures: string[];
}

export interface CrossoverConfig {
  variantA: PromptVariant;
  variantB: PromptVariant;
  fitnessA: number;
  fitnessB: number;
}

/**
 * Build mutation prompt context for the orchestrating agent.
 * Returns a structured prompt that Claude Code can use to generate the mutation.
 */
export function buildMutationPrompt(
  variant: PromptVariant,
  config: MutationConfig
): string {
  const failuresText = config.recentFailures.length > 0
    ? config.recentFailures.map((f, i) => `${i + 1}. ${f}`).join('\n')
    : 'No specific failures noted';

  return `You are a prompt engineer improving an AI agent prompt.

CURRENT PROMPT:
${variant.content}

RECENT FAILURES:
${failuresText}

MUTATION FOCUS:
${config.focus}

Generate an improved version of this prompt that addresses the failures while preserving the core functionality. Output only the improved prompt, no explanation. The prompt should:
- Maintain the same overall structure and format
- Address the specific issues noted in the mutation focus
- Preserve all critical instructions and safety guidelines
- Be clear, concise, and actionable

Improved prompt:`;
}

/**
 * Build crossover prompt context for the orchestrating agent.
 * Returns a structured prompt that Claude Code can use to generate the crossover.
 */
export function buildCrossoverPrompt(config: CrossoverConfig): string {
  return `You are a prompt engineer combining two successful AI agent prompts.

VARIANT A (fitness: ${config.fitnessA.toFixed(3)}):
${config.variantA.content}

VARIANT B (fitness: ${config.fitnessB.toFixed(3)}):
${config.variantB.content}

Combine the most effective elements from both prompts into a new prompt. Preserve instructions that contributed to higher fitness. The combined prompt should:
- Take the best structural elements from both variants
- Combine effective instructions from both sources
- Maintain clarity and consistency
- Preserve all critical safety guidelines

Output only the combined prompt, no explanation.

Combined prompt:`;
}

/**
 * Create a mutated variant from caller-provided content.
 */
export function mutate(
  variant: PromptVariant,
  content: string,
  config: MutationConfig
): PromptVariant {
  const newVariant: PromptVariant = {
    variant_id: '', // Will be set by caller
    parent: variant.variant_id,
    created_at: new Date().toISOString(),
    mutation_type: 'targeted',
    mutation_focus: config.focus,
    fitness_at_creation: null,
    status: 'active',
    checksum: '',
    content,
  };

  newVariant.checksum = contentChecksum(newVariant.content);

  return newVariant;
}

/**
 * Create a crossover variant from caller-provided content.
 */
export function crossover(
  content: string,
  config: CrossoverConfig
): PromptVariant {
  const newVariant: PromptVariant = {
    variant_id: '', // Will be set by caller
    created_at: new Date().toISOString(),
    mutation_type: 'crossover',
    fitness_at_creation: null,
    status: 'active',
    checksum: '',
    content,
  };

  newVariant.checksum = contentChecksum(newVariant.content);

  return newVariant;
}

/**
 * Validate that mutated content is valid markdown with expected structure
 */
export function validateMutatedContent(content: string): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Check minimum length
  if (content.length < 100) {
    errors.push('Content too short (< 100 characters)');
  }

  // Check for common issues (case-insensitive)
  if (/\[placeholder[^\]]*\]/i.test(content)) {
    errors.push('Content contains placeholder text');
  }

  // Check for markdown structure (should have headers or sections)
  if (!content.includes('#') && !content.includes('## ')) {
    errors.push('Content lacks markdown structure (no headers found)');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
