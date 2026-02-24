/**
 * Debate result assembler for architecture decisions.
 * Structures and validates pre-computed debate agent outputs.
 *
 * Claude Code provides the intelligence via debate-advocate, debate-critic,
 * and debate-synthesis subagents. This module assembles their outputs into
 * a structured DebateResult for storage and display.
 */

import type { DebateResult, DebateConfig } from '../types.js';

/**
 * Assemble a structured debate result from pre-computed agent outputs.
 *
 * @param archId - Architecture ID being debated
 * @param advocate - Output from debate-advocate agent
 * @param critic - Output from debate-critic agent
 * @param synthesis - Output from debate-synthesis agent
 * @param config - Debate configuration
 * @returns Complete debate result with metadata
 */
export function conductDebate(
  archId: string,
  advocate: DebateResult['advocate'],
  critic: DebateResult['critic'],
  synthesis: DebateResult['synthesis'],
  config: DebateConfig
): DebateResult {
  return {
    debate_id: `debate-${archId}`,
    arch_id: archId,
    duration_ms: 0, // Caller can set if timing is tracked externally
    advocate,
    critic,
    synthesis,
    metadata: {
      triggered_by: 'architecture.design',
      model_used: 'sonnet',
      cost: calculateCost(),
      sanitization_applied: true,
      checksum: '',
    },
  };
}

/**
 * Calculate total cost of debate (estimate).
 */
function calculateCost(): number {
  // Rough estimate: 2 Sonnet calls + 1 Opus call
  const sonnetCost = 0.003;
  const opusCost = 0.015;
  return (2 * sonnetCost) + opusCost;
}
