/**
 * Evolve Module
 * Orchestrated prompt evolution where Claude drives mutation/evaluation
 * and zen-server manages state, selection, and convergence.
 *
 * 4 tools: evolve_start, evolve_submit, evolve_status, evolve_best
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { successResponse, errorResponse, args as a } from "../../utils/responses.js";
import { createDispatcher, createModule } from "../../core/dispatcher.js";
import { createLazyLoader } from "../../utils/lazy.js";
import { requireEvolve } from "../../utils/guards.js";
import { config } from "../../core/config.js";
import { EvolveStore } from "./store.js";
import {
  tournamentSelect,
  getElites,
  checkConvergence,
  buildMutationInstructions,
} from "./algorithm.js";
import type { TestCase } from "./types.js";

const dispatcher = createDispatcher();
const getStore = createLazyLoader(() => new EvolveStore(config().stateDbPath));

/** Build fitness history (best score per generation, sorted by generation). */
function buildFitnessHistory(store: EvolveStore, sessionId: string): number[] {
  const allVariants = store.getVariants(sessionId);
  const fitnessByGen = new Map<number, number>();
  for (const v of allVariants) {
    const current = fitnessByGen.get(v.generation) ?? 0;
    if ((v.fitnessScore ?? 0) > current) {
      fitnessByGen.set(v.generation, v.fitnessScore ?? 0);
    }
  }
  return Array.from(fitnessByGen.entries())
    .sort(([a], [b]) => a - b)
    .map(([, f]) => f);
}

// ─── Tool Definitions ────────────────────────────────────

export const tools: Tool[] = [
  {
    name: "evolve_start",
    description:
      "Create an evolution session for prompt optimization. Returns instructions for Claude to generate and evaluate variant prompts.",
    inputSchema: {
      type: "object",
      properties: {
        concept_name: {
          type: "string",
          description: "What's being optimized (e.g., 'code-review-prompt')",
        },
        initial_prompt: {
          type: "string",
          description: "Starting prompt to evolve",
        },
        test_cases: {
          type: "array",
          items: {
            type: "object",
            properties: {
              input: { type: "string" },
              expected: { type: "string" },
            },
            required: ["input", "expected"],
          },
          description: "Fitness evaluation criteria",
        },
        population_size: {
          type: "number",
          description: "Variants per generation (default: 5)",
        },
        max_generations: {
          type: "number",
          description: "Maximum generations (default: 10)",
        },
        mutation_rate: {
          type: "number",
          description: "Mutation rate 0-1 (default: 0.7)",
        },
      },
      required: ["concept_name", "initial_prompt", "test_cases"],
    },
  },
  {
    name: "evolve_submit",
    description:
      "Submit evaluated variants and advance the evolution. Returns selection results and mutation instructions for the next generation, or convergence/completion status.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "Evolution session ID",
        },
        variants: {
          type: "array",
          items: {
            type: "object",
            properties: {
              prompt: { type: "string" },
              fitness_score: {
                type: "number",
                description: "Fitness score 0.0-1.0",
              },
              notes: {
                type: "string",
                description: "What worked/didn't",
              },
            },
            required: ["prompt", "fitness_score"],
          },
          description: "Evaluated variant prompts with fitness scores",
        },
      },
      required: ["session_id", "variants"],
    },
  },
  {
    name: "evolve_status",
    description: "Check evolution session progress and statistics.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "Evolution session ID",
        },
      },
      required: ["session_id"],
    },
  },
  {
    name: "evolve_best",
    description:
      "Get the winning variant from an evolution session. Returns the best prompt, its fitness score, and improvement over the initial prompt.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "Evolution session ID",
        },
      },
      required: ["session_id"],
    },
  },
];

// ─── Handlers ────────────────────────────────────────────

dispatcher
  .register(
    "evolve_start",
    requireEvolve(async (args) => {
      const conceptName = a.string(args, "concept_name");
      const initialPrompt = a.string(args, "initial_prompt");
      const testCases = a.array<TestCase>(args, "test_cases");
      const populationSize = a.number(args, "population_size", 5);
      const maxGenerations = a.number(args, "max_generations", 10);
      const mutationRate = a.number(args, "mutation_rate", 0.7);

      if (!conceptName) return errorResponse("concept_name is required");
      if (!initialPrompt) return errorResponse("initial_prompt is required");
      if (!testCases.length) return errorResponse("test_cases must contain at least one test case");

      const store = getStore();
      const session = store.createSession(conceptName, initialPrompt, testCases, {
        populationSize,
        maxGenerations,
        mutationRate,
      });

      const instructions = [
        `Generate ${populationSize} variant prompts for "${conceptName}".`,
        `Start from this initial prompt: "${initialPrompt.slice(0, 200)}${initialPrompt.length > 200 ? "..." : ""}"`,
        ``,
        `Evaluate each variant against these test cases:`,
        ...testCases.map((tc, i) => `  ${i + 1}. Input: "${tc.input}" → Expected: "${tc.expected}"`),
        ``,
        `For each variant, assign a fitness_score from 0.0 to 1.0 based on how well it meets the expected outputs.`,
        `Then call evolve_submit with the session_id and scored variants.`,
      ].join("\n");

      return successResponse({
        session_id: session.id,
        generation: 0,
        instructions,
      });
    }),
  )
  .register(
    "evolve_submit",
    requireEvolve(async (args) => {
      const sessionId = a.string(args, "session_id");
      if (!sessionId) return errorResponse("session_id is required");

      const variants = a.array<{ prompt: string; fitness_score: number; notes?: string }>(
        args,
        "variants",
      );
      if (!variants.length) return errorResponse("variants must contain at least one variant");

      const store = getStore();
      const session = store.getSession(sessionId);
      if (!session) return errorResponse(`Session "${sessionId}" not found`);
      if (session.status !== "active") {
        return errorResponse(`Session is ${session.status}, not active`);
      }

      // Insert variants for current generation
      const nextGen = session.currentGeneration + 1;
      const inserted = store.insertVariants(
        sessionId,
        nextGen,
        variants.map((v) => ({
          prompt: v.prompt,
          fitnessScore: v.fitness_score,
          notes: v.notes,
        })),
      );

      // Find best variant across all generations
      const bestVariant = store.getBestVariant(sessionId);
      const bestFitness = bestVariant?.fitnessScore ?? 0;

      // Build fitness history for convergence check
      const fitnessHistory = buildFitnessHistory(store, sessionId);

      // Check convergence and max generations
      const converged = checkConvergence(fitnessHistory);
      const maxReached = nextGen >= session.config.maxGenerations;
      const status = converged ? "converged" : maxReached ? "completed" : "active";

      // Update session
      store.updateSession(sessionId, {
        currentGeneration: nextGen,
        status,
        bestFitness,
        bestVariantId: bestVariant?.id ?? null,
      });

      if (status !== "active") {
        return successResponse({
          generation: nextGen,
          best_fitness: bestFitness,
          status,
          message:
            status === "converged"
              ? `Evolution converged at generation ${nextGen}. Call evolve_best to get the winning prompt.`
              : `Reached maximum generations (${session.config.maxGenerations}). Call evolve_best to get the winning prompt.`,
        });
      }

      // Select parents for next generation
      const genVariants = inserted;
      const elites = getElites(genVariants, 2);
      const parents = tournamentSelect(genVariants, session.config.populationSize);

      // Deduplicate parents with elites
      const parentSet = new Map<string, typeof parents[0]>();
      for (const e of elites) parentSet.set(e.id, e);
      for (const p of parents) parentSet.set(p.id, p);
      const uniqueParents = Array.from(parentSet.values()).slice(0, session.config.populationSize);

      const { parents: parentInfo, instructions } = buildMutationInstructions(
        uniqueParents,
        session.conceptName,
        session.config.populationSize,
      );

      return successResponse({
        generation: nextGen,
        best_fitness: bestFitness,
        status: "active",
        parents: parentInfo,
        instructions,
      });
    }),
  )
  .registerQuick(
    "evolve_status",
    requireEvolve(async (args) => {
      const sessionId = a.string(args, "session_id");
      if (!sessionId) return errorResponse("session_id is required");

      const store = getStore();
      const session = store.getSession(sessionId);
      if (!session) return errorResponse(`Session "${sessionId}" not found`);

      const variantCount = store.getVariantCount(sessionId);

      // Build fitness history for convergence window display
      const fitnessHistory = buildFitnessHistory(store, sessionId);

      const initialFitness = fitnessHistory[0] ?? 0;
      const improvementPct =
        initialFitness > 0
          ? ((session.bestFitness - initialFitness) / initialFitness) * 100
          : 0;

      return successResponse({
        session_id: session.id,
        concept_name: session.conceptName,
        status: session.status,
        current_generation: session.currentGeneration,
        max_generations: session.config.maxGenerations,
        best_fitness: session.bestFitness,
        improvement_pct: Math.round(improvementPct * 10) / 10,
        variants_evaluated: variantCount,
        convergence_window: fitnessHistory.slice(-3),
      });
    }),
  )
  .registerQuick(
    "evolve_best",
    requireEvolve(async (args) => {
      const sessionId = a.string(args, "session_id");
      if (!sessionId) return errorResponse("session_id is required");

      const store = getStore();
      const session = store.getSession(sessionId);
      if (!session) return errorResponse(`Session "${sessionId}" not found`);

      const bestVariant = store.getBestVariant(sessionId);
      if (!bestVariant) {
        return errorResponse("No variants found. Submit variants first with evolve_submit.");
      }

      const variantCount = store.getVariantCount(sessionId);

      // Calculate improvement over initial
      const allVariants = store.getVariants(sessionId);
      const gen1Variants = allVariants.filter((v) => v.generation === 1);
      const initialBestFitness = gen1Variants.length > 0
        ? Math.max(...gen1Variants.map((v) => v.fitnessScore ?? 0))
        : 0;
      const improvementPct =
        initialBestFitness > 0
          ? ((bestVariant.fitnessScore! - initialBestFitness) / initialBestFitness) * 100
          : 0;

      return successResponse({
        prompt: bestVariant.prompt,
        fitness_score: bestVariant.fitnessScore,
        generation: bestVariant.generation,
        improvement_pct: Math.round(improvementPct * 10) / 10,
        initial_prompt: session.initialPrompt,
        total_variants_evaluated: variantCount,
      });
    }),
  );

export const evolveModule = createModule(tools, dispatcher);
