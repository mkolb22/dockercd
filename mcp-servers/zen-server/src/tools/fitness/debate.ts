/**
 * Debate synthesis logic.
 * Assembles advocate/critic/synthesis outputs into DebateResult.
 * Intelligence delegated to Claude Code subagents.
 */

import type {
  AdvocateOutput,
  CriticOutput,
  SynthesisOutput,
  DebateResult,
} from "./types.js";
import { generateId } from "../../utils/ids.js";

/**
 * Assemble a debate result from the three agent outputs.
 */
export function assembleDebate(
  archId: string,
  advocate: AdvocateOutput,
  critic: CriticOutput,
  synthesis: SynthesisOutput,
  durationMs: number,
): DebateResult {
  return {
    debate_id: generateId("debate"),
    arch_id: archId,
    duration_ms: durationMs,
    advocate,
    critic,
    synthesis,
    metadata: {
      triggered_by: "zen_fitness_debate",
      model_used: "multi-agent",
      cost: estimateDebateCost(),
    },
  };
}

/**
 * Estimate debate cost (2x Sonnet + 1x Opus).
 */
export function estimateDebateCost(): number {
  const sonnetCost = 0.003; // ~1K tokens at Sonnet rate
  const opusCost = 0.015;   // ~1K tokens at Opus rate
  return 2 * sonnetCost + opusCost;
}
