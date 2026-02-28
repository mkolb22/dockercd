/**
 * Topology MCP Tools
 * 5 tools exposing the topology library for MAS orchestration.
 *
 * - topology_classify    (quick)  Classify task complexity
 * - topology_evolve      (30s)    MAP-Elites topology co-evolution
 * - topology_select      (quick)  Select best topology for complexity
 * - topology_ablation    (long)   Section ablation analysis
 * - topology_skills      (long)   Skill impact analysis
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { Dispatcher, HandlerFn } from "../../core/dispatcher.js";
import {
  successResponse,
  errorResponse,
  args as a,
} from "../../utils/responses.js";
import { createLazyLoader } from "../../utils/lazy.js";

// Topology library imports
import {
  TaskComplexityClassifier,
  extractFeatures,
  scoreDifficulty,
  mapToComplexity,
  calculateConfidence,
} from "./lib/topology/classifier.js";
import type { ClassificationResult, TaskFeedback } from "./lib/topology/classifier.js";
import {
  seedPopulation,
  selectForComplexity,
  selectPortfolio,
  ConductorGrid,
  createComposite,
  mutateTopology,
  DEFAULT_CONDUCTOR_CONFIG,
} from "./lib/topology/conductor.js";
import type {
  ConductorConfig,
  CompositeElite,
  ConductorStats,
} from "./lib/topology/conductor.js";
import {
  computeDensity,
  topologicalSort,
  validateDAG,
} from "./lib/topology/dag.js";
import { scoreDagForComplexity } from "./lib/topology/mapping.js";
import type { WorkflowDAG, TaskComplexity, CompositeGenome, TopologyNode } from "./lib/topology/types.js";

// Store
import type { AgentEvolutionStore } from "./store.js";

// ---------------------------------------------------------------------------
// Classifier singleton (maintains history for signal fusion)
// ---------------------------------------------------------------------------

let classifierInstance: TaskComplexityClassifier | null = null;

function getClassifier(store: AgentEvolutionStore): TaskComplexityClassifier {
  if (classifierInstance) return classifierInstance;

  classifierInstance = new TaskComplexityClassifier();

  // Hydrate from persisted state
  const history = store.getRecentClassifications(500);
  const feedback = store.getAllFeedback();
  const thresholds = store.getClassifierConfig("adjusted_thresholds") as
    | { trivial: number; simple: number; medium: number; complex: number }
    | null;

  if (history.length > 0 || feedback.length > 0) {
    classifierInstance.importState({
      history: history.map((h) => ({
        id: h.id,
        query: h.query,
        difficulty: h.difficulty,
        complexity: h.complexity as TaskComplexity,
        confidence: h.confidence,
        features: h.features as ReturnType<typeof extractFeatures>,
        fusionMethod: h.fusionMethod as ClassificationResult["fusionMethod"],
        timestamp: h.createdAt,
      })),
      feedback: feedback.map((f) => ({
        classificationId: f.classificationId,
        actualDifficulty: f.actualDifficulty,
        outcome: f.outcome as TaskFeedback["outcome"],
        notes: f.notes ?? undefined,
      })),
      adjustedThresholds: thresholds,
    });
  }

  return classifierInstance;
}

// ---------------------------------------------------------------------------
// Conductor session cache (in-memory grids keyed by session ID)
// ---------------------------------------------------------------------------

const conductorGrids = new Map<string, ConductorGrid>();
const conductorRngs = new Map<string, () => number>();
const conductorPending = new Map<string, Map<string, CompositeGenome>>();

// Seeded PRNG (splitmix32 → xoshiro128**)
function createSeededRng(seed: number): () => number {
  let s = seed | 0;
  const splitmix = (): number => {
    s = (s + 0x9e3779b9) | 0;
    let z = s;
    z = (z ^ (z >>> 16)) * 0x85ebca6b;
    z = (z ^ (z >>> 13)) * 0xc2b2ae35;
    return (z ^ (z >>> 16)) >>> 0;
  };
  let a = splitmix(), b = splitmix(), c = splitmix(), d = splitmix();
  return (): number => {
    const t = (b << 9) | (b >>> 23);
    const result = ((t * 5) | 0) * 9;
    const u = b << 7;
    c ^= a; d ^= b; b ^= c; a ^= d;
    c ^= u; d = (d << 11) | (d >>> 21);
    return (result >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Shared helper: resolve agent content from markdown or file_path
// ---------------------------------------------------------------------------

async function resolveAgentContent(args: Record<string, unknown>): Promise<string | null> {
  const markdown = a.stringOptional(args, "markdown");
  if (markdown) return markdown;

  const filePath = a.stringOptional(args, "file_path");
  if (!filePath) return null;

  const fs = await import("fs");
  const path = await import("path");
  const { config } = await import("../../core/config.js");
  const resolved = path.default.isAbsolute(filePath)
    ? filePath
    : path.default.resolve(config().projectRoot, filePath);
  return fs.default.readFileSync(resolved, "utf-8");
}

// Lazy genome imports (shared by ablation and skills handlers)
const getGenomeTools = createLazyLoader(async () => {
  const [parser, operators, assembler] = await Promise.all([
    import("./lib/genome/parser.js"),
    import("./lib/mutation/operators.js"),
    import("./lib/genome/assembler.js"),
  ]);
  return {
    parseAgentTemplate: parser.parseAgentTemplate,
    ablateSection: operators.ablateSection,
    addSkill: operators.addSkill,
    removeSkill: operators.removeSkill,
    assembleGenome: assembler.assembleGenome,
  };
});

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const topologyTools: Tool[] = [
  {
    name: "topology_classify",
    description:
      "Classify a task into a complexity level (trivial/simple/medium/complex/expert). " +
      "Uses heuristic keyword analysis, historical feedback, and optional semantic signals. " +
      "The complexity level drives topology selection for multi-agent orchestration.",
    inputSchema: {
      type: "object" as const,
      properties: {
        action: {
          type: "string",
          enum: ["classify", "feedback", "stats", "adjust_thresholds"],
          description: "Action to perform (default: classify)",
        },
        query: {
          type: "string",
          description: "Task description to classify (for action=classify)",
        },
        context: {
          type: "string",
          description: "Additional context (for action=classify)",
        },
        classification_id: {
          type: "string",
          description: "Classification ID to provide feedback for (for action=feedback)",
        },
        actual_difficulty: {
          type: "number",
          description: "Actual observed difficulty 0-10 (for action=feedback)",
        },
        outcome: {
          type: "string",
          enum: ["success", "partial", "failure"],
          description: "Task outcome (for action=feedback)",
        },
        notes: {
          type: "string",
          description: "Optional notes (for action=feedback)",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "topology_evolve",
    description:
      "Run MAP-Elites co-evolution of workflow topologies. Evolves DAG structure " +
      "(nodes, edges, roles) and agent assignments. Produces a portfolio of topologies " +
      "optimized for different task complexity levels.",
    inputSchema: {
      type: "object" as const,
      properties: {
        action: {
          type: "string",
          enum: ["start", "step", "status", "portfolio"],
          description: "Action: start evolution, submit step results, check status, get portfolio",
        },
        session_id: {
          type: "string",
          description: "Conductor session ID (for step/status/portfolio)",
        },
        agent_pool: {
          type: "array",
          items: { type: "string" },
          description: "Available agent names for node assignment (for start)",
        },
        target_complexity: {
          type: "string",
          enum: ["trivial", "simple", "medium", "complex", "expert"],
          description: "Target complexity to optimize for (for start, default: medium)",
        },
        max_generations: {
          type: "number",
          description: "Maximum generations (default: 50)",
        },
        seed: {
          type: "number",
          description: "RNG seed for reproducibility",
        },
        seed_count: {
          type: "number",
          description: "Number of seed topologies (default: 5)",
        },
        fitness_results: {
          type: "array",
          items: {
            type: "object",
            properties: {
              composite_id: { type: "string" },
              fitness: { type: "number" },
            },
            required: ["composite_id", "fitness"],
          },
          description: "Fitness results for pending composites (for step)",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "topology_select",
    description:
      "Select the best evolved topology for a task complexity level. Returns the DAG " +
      "structure, agent assignments, density metrics, and execution plan (topological order). " +
      "Combines density-difficulty matching (60%) with fitness (40%).",
    inputSchema: {
      type: "object" as const,
      properties: {
        complexity: {
          type: "string",
          enum: ["trivial", "simple", "medium", "complex", "expert"],
          description: "Task complexity level (from topology_classify)",
        },
        session_id: {
          type: "string",
          description: "Conductor session to select from (default: latest completed)",
        },
      },
      required: ["complexity"],
    },
  },
  {
    name: "topology_ablation",
    description:
      "Analyze which genome sections have the highest impact on fitness by systematically " +
      "removing each one. Submit pre-computed fitness scores for the baseline and each " +
      "ablated variant. Returns ranked section impacts and mutation budget weights.",
    inputSchema: {
      type: "object" as const,
      properties: {
        action: {
          type: "string",
          enum: ["plan", "submit"],
          description: "plan: get ablation variants to evaluate; submit: submit fitness results",
        },
        markdown: { type: "string", description: "Agent markdown to analyze" },
        file_path: { type: "string", description: "Path to agent file" },
        baseline_fitness: {
          type: "number",
          description: "Baseline fitness score (for action=submit)",
        },
        section_results: {
          type: "array",
          items: {
            type: "object",
            properties: {
              section_id: { type: "string" },
              fitness: { type: "number" },
            },
            required: ["section_id", "fitness"],
          },
          description: "Fitness per ablated section (for action=submit)",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "topology_skills",
    description:
      "Analyze skill impact on agent fitness. Plan which skills to test adding/removing, " +
      "then submit fitness results for each variant. Returns recommended optimal skill set.",
    inputSchema: {
      type: "object" as const,
      properties: {
        action: {
          type: "string",
          enum: ["plan", "submit"],
          description: "plan: get skill variants to test; submit: submit fitness results",
        },
        markdown: { type: "string", description: "Agent markdown to analyze" },
        file_path: { type: "string", description: "Path to agent file" },
        candidates: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              comment: { type: "string" },
            },
            required: ["name"],
          },
          description: "Candidate skills to test adding (for action=plan)",
        },
        baseline_fitness: {
          type: "number",
          description: "Baseline fitness (for action=submit)",
        },
        removal_results: {
          type: "array",
          items: {
            type: "object",
            properties: {
              skill_name: { type: "string" },
              fitness: { type: "number" },
            },
            required: ["skill_name", "fitness"],
          },
          description: "Fitness after removing each skill (for action=submit)",
        },
        addition_results: {
          type: "array",
          items: {
            type: "object",
            properties: {
              skill_name: { type: "string" },
              fitness: { type: "number" },
            },
            required: ["skill_name", "fitness"],
          },
          description: "Fitness after adding each candidate (for action=submit)",
        },
      },
      required: ["action"],
    },
  },
];

// ---------------------------------------------------------------------------
// Per-tool handler functions
// ---------------------------------------------------------------------------

function handleClassify(getStore: () => AgentEvolutionStore): HandlerFn {
  return async (args) => {
    const action = a.string(args, "action", "classify");
    const store = getStore();

    switch (action) {
      case "classify": {
        const query = a.string(args, "query");
        if (!query) return errorResponse("query is required for action=classify");
        const context = a.stringOptional(args, "context");

        const classifier = getClassifier(store);
        const result = await classifier.classify(query, context);

        store.saveClassification({
          id: result.id,
          query: result.query,
          context: context ?? null,
          difficulty: result.difficulty,
          complexity: result.complexity,
          confidence: result.confidence,
          features: result.features,
          fusionMethod: result.fusionMethod,
        });

        return successResponse({
          id: result.id,
          complexity: result.complexity,
          difficulty: result.difficulty,
          confidence: result.confidence,
          fusion_method: result.fusionMethod,
          features: result.features,
        });
      }

      case "feedback": {
        const classificationId = a.string(args, "classification_id");
        const actualDifficulty = a.number(args, "actual_difficulty", -1);
        const outcome = a.string(args, "outcome");
        if (!classificationId) return errorResponse("classification_id is required");
        if (actualDifficulty < 0) return errorResponse("actual_difficulty is required (0-10)");
        if (!outcome) return errorResponse("outcome is required (success/partial/failure)");

        const notes = a.stringOptional(args, "notes");
        const feedback: TaskFeedback = {
          classificationId,
          actualDifficulty,
          outcome: outcome as TaskFeedback["outcome"],
          notes,
        };

        const classifier = getClassifier(store);
        classifier.addFeedback(feedback);
        store.saveFeedback({
          classificationId,
          actualDifficulty,
          outcome,
          notes: notes ?? null,
        });

        return successResponse({
          recorded: true,
          feedback_count: classifier.feedbackCount,
        });
      }

      case "stats": {
        const classifier = getClassifier(store);
        return successResponse({
          classification_count: classifier.classificationCount,
          feedback_count: classifier.feedbackCount,
          accuracy: classifier.getAccuracy(),
          distribution: classifier.getDistribution(),
          effective_thresholds: classifier.effectiveThresholds,
        });
      }

      case "adjust_thresholds": {
        const classifier = getClassifier(store);
        const { thresholds, adjustments } = classifier.adjustThresholds();
        store.saveClassifierConfig("adjusted_thresholds", thresholds);

        return successResponse({
          thresholds,
          adjustments,
          adjustment_count: adjustments.length,
        });
      }

      default:
        return errorResponse(
          `Unknown action: ${action}. Supported: classify, feedback, stats, adjust_thresholds`,
        );
    }
  };
}

function handleEvolve(getStore: () => AgentEvolutionStore): HandlerFn {
  return async (args) => {
    const action = a.string(args, "action");
    const store = getStore();

    switch (action) {
      case "start": {
        const agentPool = a.array<string>(args, "agent_pool", DEFAULT_CONDUCTOR_CONFIG.agentPool as string[]);
        const targetComplexity = a.string(args, "target_complexity", "medium") as TaskComplexity;
        const maxGenerations = a.number(args, "max_generations", 50);
        const seed = a.number(args, "seed", Date.now());
        const seedCount = a.number(args, "seed_count", 5);

        const conductorConfig: ConductorConfig = {
          ...DEFAULT_CONDUCTOR_CONFIG,
          maxGenerations,
          seed,
          agentPool,
        };

        const rng = createSeededRng(seed);
        const seeds = seedPopulation(agentPool, rng, seedCount, targetComplexity);

        const grid = new ConductorGrid(conductorConfig);
        const session = store.createConductorSession(conductorConfig, targetComplexity);

        conductorGrids.set(session.id, grid);
        conductorRngs.set(session.id, rng);
        const pendingMap = new Map<string, CompositeGenome>();
        for (const s of seeds) {
          pendingMap.set(s.topology.id, s);
        }
        conductorPending.set(session.id, pendingMap);

        const pendingComposites = seeds.map((s) => ({
          id: s.topology.id,
          topology: s.topology,
          density: computeDensity(s.topology).compositeDensity,
          node_count: s.topology.nodes.length,
          agents: s.topology.nodes.map((n: TopologyNode) => `${n.id}:${n.agentName}`),
        }));

        return successResponse({
          session_id: session.id,
          target_complexity: targetComplexity,
          config: {
            max_generations: maxGenerations,
            seed,
            agent_pool: agentPool,
            seed_count: seedCount,
          },
          pending_composites: pendingComposites,
          instructions: [
            "Evaluate each composite topology by running tasks through the agent arrangement.",
            "For each composite, determine a fitness score (0-1).",
            "Submit results with topology_evolve action=step to advance.",
          ],
        });
      }

      case "step":
        return handleEvolveStep(store, args);

      case "status": {
        const sessionId = a.string(args, "session_id");
        if (!sessionId) return errorResponse("session_id is required");

        const session = store.getConductorSession(sessionId);
        if (!session) return errorResponse(`Session '${sessionId}' not found`);

        return successResponse({
          session_id: session.id,
          status: session.status,
          generation: session.generation,
          target_complexity: session.targetComplexity,
          total_evaluations: session.totalEvaluations,
          elites_count: (session.gridData as unknown[]).length,
          stats: session.stats,
        });
      }

      case "portfolio": {
        const sessionId = a.stringOptional(args, "session_id");
        let session;

        if (sessionId) {
          session = store.getConductorSession(sessionId);
        } else {
          session = store.getLatestConductorSession("completed");
        }

        if (!session) {
          return errorResponse(
            sessionId
              ? `Session '${sessionId}' not found`
              : "No completed conductor session found",
          );
        }

        const elites = session.gridData as CompositeElite[];
        const portfolio = selectPortfolio(elites);

        const result: Record<string, unknown> = {};
        for (const [complexity, elite] of portfolio) {
          result[complexity] = {
            composite_id: elite.compositeId,
            fitness: elite.fitness,
            density: elite.densityMetrics.compositeDensity,
            node_count: elite.composite.topology.nodes.length,
            topology: elite.composite.topology,
          };
        }

        return successResponse({
          session_id: session.id,
          portfolio: result,
          complexities_covered: Array.from(portfolio.keys()),
        });
      }

      default:
        return errorResponse(
          `Unknown action: ${action}. Supported: start, step, status, portfolio`,
        );
    }
  };
}

/**
 * Evolve step handler — extracted for readability.
 * Places fitness results into the MAP-Elites grid, generates next-generation
 * mutants, and updates session state.
 */
async function handleEvolveStep(
  store: AgentEvolutionStore,
  args: Record<string, unknown>,
) {
  const sessionId = a.string(args, "session_id");
  if (!sessionId) return errorResponse("session_id is required");

  const fitnessResults = a.array<{ composite_id: string; fitness: number }>(
    args,
    "fitness_results",
  );
  if (!fitnessResults.length) return errorResponse("fitness_results must not be empty");

  const session = store.getConductorSession(sessionId);
  if (!session) return errorResponse(`Session '${sessionId}' not found`);
  if (session.status !== "active") {
    return errorResponse(`Session is '${session.status}', not active`);
  }

  // Get or recreate grid
  let grid = conductorGrids.get(sessionId);
  const config = session.config as ConductorConfig;
  if (!grid) {
    grid = new ConductorGrid(config);
    for (const elite of session.gridData as CompositeElite[]) {
      grid.tryPlace(
        elite.composite,
        elite.fitness,
        elite.densityMetrics,
        elite.compositeId,
        elite.generation,
        elite.parentId,
      );
    }
    conductorGrids.set(sessionId, grid);
  }

  let rng = conductorRngs.get(sessionId);
  if (!rng) {
    rng = createSeededRng((config.seed ?? 42) + session.generation);
    conductorRngs.set(sessionId, rng);
  }

  // Place fitness results into grid
  const pendingMap = conductorPending.get(sessionId) ?? new Map<string, CompositeGenome>();
  const stepResults: Array<{ id: string; fitness: number; placed: string }> = [];

  for (const result of fitnessResults) {
    const composite = pendingMap.get(result.composite_id);
    const metrics = composite
      ? computeDensity(composite.topology)
      : { compositeDensity: 0 } as any;
    const outcome = composite
      ? grid.tryPlace(composite, result.fitness, metrics, result.composite_id, session.generation, null)
      : "skipped";

    store.insertConductorStep({
      sessionId,
      generation: session.generation,
      parentId: null,
      childId: result.composite_id,
      mutationType: "topology",
      mutationDesc: "evaluated",
      fitness: result.fitness,
      density: metrics.compositeDensity ?? 0,
      coordX: 0,
      coordY: 0,
      outcome: String(outcome),
    });

    stepResults.push({
      id: result.composite_id,
      fitness: result.fitness,
      placed: String(outcome),
    });

    pendingMap.delete(result.composite_id);
  }

  const nextGen = session.generation + 1;
  const isComplete = nextGen >= (config.maxGenerations ?? 50);
  const allElites = grid.allElites();
  const stats = grid.getStats(nextGen, session.totalEvaluations + fitnessResults.length);

  // Generate next batch of topology mutations
  const nextComposites: Array<{
    id: string;
    topology: WorkflowDAG;
    density: number;
    node_count: number;
    agents: string[];
  }> = [];

  if (!isComplete && allElites.length > 0) {
    pendingMap.clear();
    for (let i = 0; i < 5; i++) {
      const parent = allElites[Math.floor(rng() * allElites.length)];
      const { composite: mutatedComposite } = mutateTopology(parent.composite, rng, config.agentPool as string[]);
      const metrics = computeDensity(mutatedComposite.topology);
      const mutantId = `mut-${nextGen}-${i}-${Date.now().toString(36)}`;
      const mutantWithId: CompositeGenome = {
        ...mutatedComposite,
        topology: { ...mutatedComposite.topology, id: mutantId },
      };
      pendingMap.set(mutantId, mutantWithId);
      nextComposites.push({
        id: mutantId,
        topology: mutantWithId.topology,
        density: metrics.compositeDensity,
        node_count: mutantWithId.topology.nodes.length,
        agents: mutantWithId.topology.nodes.map((n: TopologyNode) => `${n.id}:${n.agentName}`),
      });
    }
  }

  // Update session
  store.updateConductorSession(sessionId, {
    generation: nextGen,
    status: isComplete ? "completed" : "active",
    totalEvaluations: session.totalEvaluations + fitnessResults.length,
    gridData: [...allElites],
    stats: [...(session.stats as ConductorStats[]), stats],
  });

  if (isComplete) {
    conductorGrids.delete(sessionId);
    conductorRngs.delete(sessionId);
    conductorPending.delete(sessionId);
  }

  return successResponse({
    status: isComplete ? "completed" : "active",
    generation: nextGen,
    stats,
    step_results: stepResults,
    pending_composites: nextComposites,
    elites_count: allElites.length,
  });
}

function handleSelect(getStore: () => AgentEvolutionStore): HandlerFn {
  return async (args) => {
    const complexity = a.string(args, "complexity") as TaskComplexity;
    if (!complexity) return errorResponse("complexity is required");

    const sessionId = a.stringOptional(args, "session_id");
    const store = getStore();

    let session;
    if (sessionId) {
      session = store.getConductorSession(sessionId);
    } else {
      session = store.getLatestConductorSession("completed");
    }

    if (!session) {
      return errorResponse(
        sessionId
          ? `Session '${sessionId}' not found`
          : "No completed conductor session found. Run topology_evolve first.",
      );
    }

    const elites = session.gridData as CompositeElite[];
    if (elites.length === 0) {
      return errorResponse("No elites in session. Evolution may not have produced any valid topologies.");
    }

    const selected = selectForComplexity(elites, complexity);
    if (!selected) {
      return errorResponse(`No topology found for complexity '${complexity}'`);
    }

    const dag = selected.composite.topology;
    const validation = validateDAG(dag);
    const sortOrder = validation.valid ? topologicalSort(dag) : [];

    return successResponse({
      composite_id: selected.compositeId,
      fitness: selected.fitness,
      density: selected.densityMetrics,
      topology: dag,
      execution_plan: sortOrder,
      agent_assignments: Object.fromEntries(
        dag.nodes.map((n) => [n.id, n.agentName]),
      ),
      dag_valid: validation.valid,
      node_count: dag.nodes.length,
      edge_count: dag.edges.length,
    });
  };
}

function handleAblation(): HandlerFn {
  return async (args) => {
    const action = a.string(args, "action");
    const tools = await getGenomeTools();

    switch (action) {
      case "plan": {
        const content = await resolveAgentContent(args);
        if (!content) return errorResponse("Provide markdown or file_path");

        const genome = tools.parseAgentTemplate(content);
        const sections = genome.sections;

        const variants = sections.map((s) => {
          const result = tools.ablateSection(genome, s.id as any);
          return {
            section_id: s.id,
            section_heading: s.heading,
            applied: result.applied,
            ablated_markdown: result.applied ? tools.assembleGenome(result.genome) : null,
          };
        });

        return successResponse({
          agent_name: genome.agentName,
          baseline_markdown: content,
          sections_to_ablate: variants.filter((v) => v.applied).length,
          total_sections: sections.length,
          variants,
          instructions: [
            "1. Evaluate the baseline_markdown to get baseline fitness.",
            "2. Evaluate each variant's ablated_markdown to get ablated fitness.",
            "3. Submit results with topology_ablation action=submit.",
          ],
        });
      }

      case "submit": {
        const baselineFitness = a.number(args, "baseline_fitness", -1);
        if (baselineFitness < 0) return errorResponse("baseline_fitness is required");

        const sectionResults = a.array<{ section_id: string; fitness: number }>(
          args,
          "section_results",
        );
        if (!sectionResults.length) return errorResponse("section_results must not be empty");

        const impacts = sectionResults.map((r) => {
          const delta = r.fitness - baselineFitness;
          return {
            section_id: r.section_id,
            fitness: r.fitness,
            fitness_delta: delta,
            impact_magnitude: Math.abs(delta),
            direction: delta < 0 ? "hurts_when_removed" : delta > 0 ? "improves_when_removed" : "no_effect",
          };
        });

        impacts.sort((a, b) => b.impact_magnitude - a.impact_magnitude);

        const totalImpact = impacts.reduce((sum, i) => sum + i.impact_magnitude, 0);
        const mutationWeights: Record<string, number> = {};
        for (const impact of impacts) {
          mutationWeights[impact.section_id] =
            totalImpact > 0 ? impact.impact_magnitude / totalImpact : 1 / impacts.length;
        }

        return successResponse({
          baseline_fitness: baselineFitness,
          impacts,
          mutation_weights: mutationWeights,
          sections_analyzed: sectionResults.length,
          significant_sections: impacts.filter((i) => i.impact_magnitude > 0.01).length,
          highest_impact: impacts[0] ?? null,
        });
      }

      default:
        return errorResponse(`Unknown action: ${action}. Supported: plan, submit`);
    }
  };
}

function handleSkills(): HandlerFn {
  return async (args) => {
    const action = a.string(args, "action");
    const tools = await getGenomeTools();

    switch (action) {
      case "plan": {
        const content = await resolveAgentContent(args);
        if (!content) return errorResponse("Provide markdown or file_path");

        const genome = tools.parseAgentTemplate(content);
        const currentSkills = genome.frontmatter.skills;

        const candidates = a.array<{ name: string; comment?: string }>(args, "candidates", []);

        const removalVariants = currentSkills.map((skill) => {
          const result = tools.removeSkill(genome, skill.name);
          return {
            direction: "remove" as const,
            skill_name: skill.name,
            applied: result.applied,
            variant_markdown: result.applied ? tools.assembleGenome(result.genome) : null,
          };
        });

        const additionVariants = candidates.map((c) => {
          const result = tools.addSkill(genome, { name: c.name, comment: c.comment ?? "" });
          return {
            direction: "add" as const,
            skill_name: c.name,
            applied: result.applied,
            variant_markdown: result.applied ? tools.assembleGenome(result.genome) : null,
          };
        });

        return successResponse({
          agent_name: genome.agentName,
          baseline_markdown: content,
          current_skills: currentSkills,
          removal_variants: removalVariants.filter((v) => v.applied),
          addition_variants: additionVariants.filter((v) => v.applied),
          total_variants:
            removalVariants.filter((v) => v.applied).length +
            additionVariants.filter((v) => v.applied).length,
          instructions: [
            "1. Evaluate baseline_markdown to get baseline fitness.",
            "2. Evaluate each variant to get fitness per skill change.",
            "3. Submit results with topology_skills action=submit.",
          ],
        });
      }

      case "submit": {
        const baselineFitness = a.number(args, "baseline_fitness", -1);
        if (baselineFitness < 0) return errorResponse("baseline_fitness is required");

        const removalResults = a.array<{ skill_name: string; fitness: number }>(
          args,
          "removal_results",
          [],
        );
        const additionResults = a.array<{ skill_name: string; fitness: number }>(
          args,
          "addition_results",
          [],
        );

        if (!removalResults.length && !additionResults.length) {
          return errorResponse("Provide removal_results and/or addition_results");
        }

        const removalImpacts = removalResults.map((r) => ({
          skill_name: r.skill_name,
          direction: "remove" as const,
          fitness: r.fitness,
          fitness_delta: r.fitness - baselineFitness,
          impact: Math.abs(r.fitness - baselineFitness),
          recommendation: r.fitness < baselineFitness - 0.005
            ? "keep"
            : r.fitness > baselineFitness + 0.005
              ? "remove"
              : "neutral",
        }));

        const additionImpacts = additionResults.map((r) => ({
          skill_name: r.skill_name,
          direction: "add" as const,
          fitness: r.fitness,
          fitness_delta: r.fitness - baselineFitness,
          impact: Math.abs(r.fitness - baselineFitness),
          recommendation: r.fitness > baselineFitness + 0.01
            ? "add"
            : "skip",
        }));

        const keepSkills = removalImpacts
          .filter((r) => r.recommendation === "keep" || r.recommendation === "neutral")
          .map((r) => r.skill_name);
        const addSkillNames = additionImpacts
          .filter((r) => r.recommendation === "add")
          .map((r) => r.skill_name);

        return successResponse({
          baseline_fitness: baselineFitness,
          removal_impacts: removalImpacts,
          addition_impacts: additionImpacts,
          recommended_skills: {
            keep: keepSkills,
            add: addSkillNames,
            remove: removalImpacts
              .filter((r) => r.recommendation === "remove")
              .map((r) => r.skill_name),
          },
          total_analyzed: removalResults.length + additionResults.length,
        });
      }

      default:
        return errorResponse(`Unknown action: ${action}. Supported: plan, submit`);
    }
  };
}

// ---------------------------------------------------------------------------
// Handler registration
// ---------------------------------------------------------------------------

export function registerTopologyHandlers(
  dispatcher: Dispatcher,
  getStore: () => AgentEvolutionStore,
  requireGuard: (handler: HandlerFn) => HandlerFn,
): void {
  dispatcher.registerQuick("topology_classify", requireGuard(handleClassify(getStore)));
  dispatcher.register("topology_evolve", requireGuard(handleEvolve(getStore)));
  dispatcher.registerQuick("topology_select", requireGuard(handleSelect(getStore)));
  dispatcher.register("topology_ablation", requireGuard(handleAblation()));
  dispatcher.register("topology_skills", requireGuard(handleSkills()));
}
