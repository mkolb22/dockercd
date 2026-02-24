/**
 * Evolution Algorithm
 * Tournament selection, elite preservation, and convergence detection.
 */

import type { EvolutionVariant } from "./types.js";

/**
 * Tournament selection: pick k random candidates, return the best.
 * Repeat `count` times to get multiple parents.
 */
export function tournamentSelect(
  variants: EvolutionVariant[],
  count: number,
  k: number = 3,
): EvolutionVariant[] {
  const parents: EvolutionVariant[] = [];
  for (let i = 0; i < count; i++) {
    const candidates: EvolutionVariant[] = [];
    for (let j = 0; j < k; j++) {
      candidates.push(variants[Math.floor(Math.random() * variants.length)]);
    }
    candidates.sort((a, b) => (b.fitnessScore ?? 0) - (a.fitnessScore ?? 0));
    parents.push(candidates[0]);
  }
  return parents;
}

/**
 * Get elite variants (top N by fitness) that always survive to the next generation.
 */
export function getElites(
  variants: EvolutionVariant[],
  count: number = 2,
): EvolutionVariant[] {
  return [...variants]
    .sort((a, b) => (b.fitnessScore ?? 0) - (a.fitnessScore ?? 0))
    .slice(0, count);
}

/**
 * Check if evolution has converged.
 * Converged = best fitness hasn't improved by more than `threshold`
 * for `window` consecutive generations.
 */
export function checkConvergence(
  fitnessHistory: number[],
  window: number = 3,
  threshold: number = 0.01,
): boolean {
  if (fitnessHistory.length < window + 1) return false;

  const recent = fitnessHistory.slice(-window);
  const baseline = fitnessHistory[fitnessHistory.length - window - 1];

  return recent.every((f) => f - baseline < threshold);
}

/**
 * Build mutation instructions for the next generation.
 * For each parent, identify weaknesses and create instructions.
 */
export function buildMutationInstructions(
  parents: EvolutionVariant[],
  conceptName: string,
  populationSize: number,
): { parents: Array<{ prompt: string; fitness: number; weaknesses: string }>; instructions: string } {
  const parentInfo = parents.map((p) => ({
    prompt: p.prompt,
    fitness: p.fitnessScore ?? 0,
    weaknesses: p.notes ?? "No specific weaknesses noted",
  }));

  const instructions = [
    `Generate ${populationSize} variant prompts for "${conceptName}".`,
    `Use these top-performing parents as starting points:`,
    ...parentInfo.map((p, i) =>
      `  Parent ${i + 1} (fitness: ${p.fitness.toFixed(2)}): "${p.prompt.slice(0, 100)}..."${p.weaknesses !== "No specific weaknesses noted" ? ` — Weakness: ${p.weaknesses}` : ""}`,
    ),
    ``,
    `For each variant:`,
    `1. Take a parent prompt and modify it to improve weaknesses`,
    `2. Keep the parts that scored well`,
    `3. Evaluate each variant against the test cases`,
    `4. Call evolve_submit with the scored variants`,
  ].join("\n");

  return { parents: parentInfo, instructions };
}
