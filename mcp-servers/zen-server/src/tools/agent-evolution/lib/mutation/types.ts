/**
 * Types for the mutation operator module.
 *
 * Separated from operators for clean dependency management:
 * consumers can import types without pulling in operator implementations.
 */

import type { AgentGenome, CanonicalSectionId } from '../genome/schema.js';

// ---------------------------------------------------------------------------
// Mutation classification
// ---------------------------------------------------------------------------

/** Discriminated mutation kinds for tracking and analysis. */
export type MutationKind =
  | 'ablate_section'
  | 'swap_section'
  | 'replace_content'
  | 'rewrite_section'
  | 'mutate_model'
  | 'add_skill'
  | 'remove_skill';

// ---------------------------------------------------------------------------
// Mutation result
// ---------------------------------------------------------------------------

/**
 * Result of applying a mutation operator.
 *
 * Tracks what changed (or didn't) for the evolution feedback loop.
 * The OPRO-style refinement step uses mutation descriptions and
 * affected sections to learn which changes improve fitness.
 */
export interface MutationResult {
  /** The resulting genome (original if mutation was a no-op). */
  readonly genome: AgentGenome;

  /** Whether a mutation was actually applied (false = no-op). */
  readonly applied: boolean;

  /** What kind of mutation was attempted. */
  readonly kind: MutationKind;

  /** Human-readable description of the change. */
  readonly description: string;

  /** Canonical section IDs that were modified. */
  readonly affectedSections: readonly (CanonicalSectionId | 'custom')[];
}

// ---------------------------------------------------------------------------
// LLM provider abstraction
// ---------------------------------------------------------------------------

/**
 * Minimal LLM completion function for section rewriting.
 *
 * Accepts a prompt string and returns the LLM's completion.
 * Designed for easy mocking in tests.
 */
export type LLMCompleteFn = (prompt: string) => Promise<string>;
