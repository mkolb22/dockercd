/**
 * Types for the orchestrated prompt evolution module.
 * Claude drives evolution; zen-server manages state.
 */

export type EvolutionStatus = "active" | "converged" | "completed";

export interface EvolutionConfig {
  populationSize: number;
  maxGenerations: number;
  mutationRate: number;
}

export interface TestCase {
  input: string;
  expected: string;
}

export interface EvolutionSession {
  id: string;
  conceptName: string;
  initialPrompt: string;
  testCases: TestCase[];
  config: EvolutionConfig;
  currentGeneration: number;
  status: EvolutionStatus;
  bestFitness: number;
  bestVariantId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EvolutionVariant {
  id: string;
  sessionId: string;
  generation: number;
  prompt: string;
  fitnessScore: number | null;
  notes: string | null;
  parentId: string | null;
  createdAt: string;
}
