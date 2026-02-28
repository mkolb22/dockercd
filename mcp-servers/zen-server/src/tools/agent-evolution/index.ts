/**
 * Agent Evolution Module
 * Section-based evolutionary optimization for Claude Code subagents,
 * topology co-evolution, and workflow execution coordination.
 *
 * 15 tools:
 * - agent_parse              (quick)   Parse agent markdown → structured genome
 * - agent_assemble           (quick)   Genome → agent markdown
 * - agent_validate           (quick)   Validate genome structure
 * - agent_mutate             (30s)     Apply mutation operator to genome
 * - agent_compare            (quick)   Statistical comparison (Welch's t-test)
 * - agent_benchmark          (quick)   List/get benchmark tasks from catalog
 * - agent_evolve_start       (30s)     Start MAP-Elites evolution session
 * - agent_evolve_step        (30s)     Submit evaluation results, get next variants
 * - topology_classify        (quick)   Classify task complexity
 * - topology_evolve          (30s)     MAP-Elites topology co-evolution
 * - topology_select          (quick)   Select best topology for complexity
 * - topology_ablation        (long)    Section ablation analysis
 * - topology_skills          (long)    Skill impact analysis
 * - topology_execute_start   (quick)   Create execution from topology DAG
 * - topology_execute_node    (30s)     Manage node lifecycle (message bus)
 */

import * as fs from "fs";
import * as path from "path";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  successResponse,
  errorResponse,
  args as a,
} from "../../utils/responses.js";
import { createDispatcher, createModule } from "../../core/dispatcher.js";
import { createLazyLoader } from "../../utils/lazy.js";
import { config } from "../../core/config.js";

// Library imports
import { parseAgentTemplate } from "./lib/genome/parser.js";
import { assembleGenome } from "./lib/genome/assembler.js";
import { validateGenome } from "./lib/genome/schema.js";
import type {
  AgentGenome,
  CanonicalSectionId,
  ModelTierOrInherit,
} from "./lib/genome/schema.js";
import {
  ablateSection,
  swapSection,
  replaceSectionContent,
  mutateModel,
  addSkill,
  removeSkill,
} from "./lib/mutation/operators.js";
import { welchTTest, cohensD } from "./lib/benchmark/evaluator.js";
import {
  BENCHMARK_CATALOG,
  validateCatalog,
} from "./lib/benchmark/catalog.js";
import type { BenchmarkTask } from "./lib/benchmark/schema.js";
import { createRng } from "./lib/population/manager.js";
import { quantize } from "./lib/population/grid.js";
import type { AxisConfig } from "./lib/population/types.js";
import type { EvolutionSessionConfig, GridCell } from "./store.js";
import { AgentEvolutionStore } from "./store.js";

// Topology tools + execution tracker
import { topologyTools, registerTopologyHandlers } from "./topology-tools.js";
import { executionTools, registerExecutionHandlers } from "./execution-tracker.js";

// Config guard
import { withConfigGuard } from "../../utils/guards.js";
import type { HandlerFn } from "../../core/dispatcher.js";

const requireAgentEvolution = (handler: HandlerFn) =>
  withConfigGuard(
    (cfg) => cfg.agentEvolutionEnabled,
    "Agent evolution is disabled. Set ZEN_AGENT_EVOLUTION_ENABLED=true to enable.",
    handler,
  );

// ---------------------------------------------------------------------------
// Lazy singleton
// ---------------------------------------------------------------------------

const getStore = createLazyLoader(
  () => new AgentEvolutionStore(config().stateDbPath),
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse genome from markdown string or JSON object. */
function resolveGenome(args: Record<string, unknown>): AgentGenome {
  const markdown = a.stringOptional(args, "markdown");
  const genome = a.object<AgentGenome>(args, "genome");
  const filePath = a.stringOptional(args, "file_path");

  if (markdown) {
    return parseAgentTemplate(markdown);
  }
  if (genome) {
    return genome;
  }
  if (filePath) {
    const resolved = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(config().projectRoot, filePath);
    const content = fs.readFileSync(resolved, "utf-8");
    return parseAgentTemplate(content);
  }
  throw new Error("Provide one of: markdown, genome, or file_path");
}

/** Available non-LLM mutation kinds. */
const PURE_MUTATIONS = [
  "ablate_section",
  "swap_section",
  "replace_content",
  "mutate_model",
  "add_skill",
  "remove_skill",
] as const;

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const tools: Tool[] = [
  {
    name: "agent_parse",
    description:
      "Parse agent markdown (with YAML frontmatter and sections) into a structured genome object. " +
      "The genome can then be mutated, validated, and reassembled.",
    inputSchema: {
      type: "object" as const,
      properties: {
        markdown: {
          type: "string",
          description: "Agent markdown content to parse",
        },
        file_path: {
          type: "string",
          description: "Path to agent markdown file (relative to project root or absolute)",
        },
      },
    },
  },
  {
    name: "agent_assemble",
    description:
      "Assemble a genome object back into markdown text (YAML frontmatter + sections).",
    inputSchema: {
      type: "object" as const,
      properties: {
        genome: {
          type: "object",
          description: "The genome object to assemble into markdown",
        },
      },
      required: ["genome"],
    },
  },
  {
    name: "agent_validate",
    description:
      "Validate a genome structure. Returns errors and warnings about missing fields, " +
      "invalid values, and structural issues.",
    inputSchema: {
      type: "object" as const,
      properties: {
        markdown: { type: "string", description: "Agent markdown to parse and validate" },
        genome: { type: "object", description: "Pre-parsed genome object to validate" },
        file_path: { type: "string", description: "Path to agent file" },
      },
    },
  },
  {
    name: "agent_mutate",
    description:
      "Apply a mutation operator to an agent genome. " +
      "Supported kinds: ablate_section, replace_content, mutate_model, add_skill, remove_skill. " +
      "Returns the mutated genome and assembled markdown.",
    inputSchema: {
      type: "object" as const,
      properties: {
        markdown: { type: "string", description: "Agent markdown (alternative to genome)" },
        genome: { type: "object", description: "Pre-parsed genome object" },
        file_path: { type: "string", description: "Path to agent file" },
        kind: {
          type: "string",
          description: "Mutation kind",
          enum: [...PURE_MUTATIONS],
        },
        section_id: {
          type: "string",
          description: "Target section ID (for ablate_section, replace_content)",
        },
        new_content: {
          type: "string",
          description: "Replacement content (for replace_content)",
        },
        new_model: {
          type: "string",
          description: "New model tier (for mutate_model): opus, sonnet, haiku, inherit",
        },
        skill_name: {
          type: "string",
          description: "Skill name (for add_skill, remove_skill)",
        },
        skill_comment: {
          type: "string",
          description: "Skill comment (for add_skill)",
        },
      },
      required: ["kind"],
    },
  },
  {
    name: "agent_compare",
    description:
      "Statistical comparison of two sample sets using Welch's t-test and Cohen's d effect size. " +
      "Use for comparing fitness scores between agent variants.",
    inputSchema: {
      type: "object" as const,
      properties: {
        samples_a: {
          type: "array",
          items: { type: "number" },
          description: "Fitness scores for variant A",
        },
        samples_b: {
          type: "array",
          items: { type: "number" },
          description: "Fitness scores for variant B",
        },
        alpha: {
          type: "number",
          description: "Significance level (default: 0.05)",
        },
      },
      required: ["samples_a", "samples_b"],
    },
  },
  {
    name: "agent_benchmark",
    description:
      "List or retrieve benchmark tasks from the built-in catalog. " +
      "Tasks are organized by target agent, category, and difficulty.",
    inputSchema: {
      type: "object" as const,
      properties: {
        action: {
          type: "string",
          enum: ["list", "get", "validate"],
          description: "Action: list all tasks, get a specific task, or validate the catalog",
        },
        task_id: {
          type: "string",
          description: "Task ID to retrieve (for action=get)",
        },
        target_agent: {
          type: "string",
          description: "Filter by target agent name (for action=list)",
        },
        category: {
          type: "string",
          description: "Filter by category (for action=list)",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "agent_evolve_start",
    description:
      "Start a MAP-Elites evolution session. Parses the seed genome, initializes the " +
      "quality-diversity grid, and generates the first batch of mutant variants for evaluation.",
    inputSchema: {
      type: "object" as const,
      properties: {
        seed_markdown: {
          type: "string",
          description: "Markdown of the seed agent genome",
        },
        seed_file: {
          type: "string",
          description: "Path to seed agent file (alternative to seed_markdown)",
        },
        batch_size: {
          type: "number",
          description: "Number of variants per generation (default: 5)",
        },
        max_generations: {
          type: "number",
          description: "Maximum generations (default: 20)",
        },
        seed: {
          type: "number",
          description: "RNG seed for reproducibility (default: 42)",
        },
        grid_bins: {
          type: "number",
          description: "Grid resolution per axis (default: 10)",
        },
      },
    },
  },
  {
    name: "agent_evolve_step",
    description:
      "Submit evaluation results for pending variants and advance the evolution. " +
      "Returns the next batch of variants to evaluate, or completes the session.",
    inputSchema: {
      type: "object" as const,
      properties: {
        session_id: {
          type: "string",
          description: "Evolution session ID",
        },
        results: {
          type: "array",
          items: {
            type: "object",
            properties: {
              variant_id: { type: "string" },
              fitness: { type: "number", description: "Fitness score (0-1)" },
              cost: { type: "number", description: "Cost in USD" },
            },
            required: ["variant_id", "fitness", "cost"],
          },
          description: "Evaluation results for pending variants",
        },
      },
      required: ["session_id", "results"],
    },
  },
];

// ---------------------------------------------------------------------------
// Dispatcher + handlers
// ---------------------------------------------------------------------------

const dispatcher = createDispatcher();

// ─── agent_parse ─────────────────────────────────────────

dispatcher.registerQuick(
  "agent_parse",
  requireAgentEvolution(async (args) => {
    const genome = resolveGenome(args);
    return successResponse({
      agent_name: genome.agentName,
      frontmatter: genome.frontmatter,
      title: genome.title,
      sections: genome.sections.map((s) => ({
        id: s.id,
        heading: s.heading,
        level: s.level,
        content_length: s.content.length,
        content_preview: s.content.slice(0, 200),
      })),
      section_count: genome.sections.length,
      skill_count: genome.frontmatter.skills.length,
    });
  }),
);

// ─── agent_assemble ──────────────────────────────────────

dispatcher.registerQuick(
  "agent_assemble",
  requireAgentEvolution(async (args) => {
    const genome = a.object<AgentGenome>(args, "genome");
    if (!genome) return errorResponse("genome is required");

    const markdown = assembleGenome(genome);
    return successResponse({
      markdown,
      length: markdown.length,
      sections: genome.sections?.length ?? 0,
    });
  }),
);

// ─── agent_validate ──────────────────────────────────────

dispatcher.registerQuick(
  "agent_validate",
  requireAgentEvolution(async (args) => {
    const genome = resolveGenome(args);
    const result = validateGenome(genome);
    return successResponse({
      valid: result.valid,
      errors: result.errors,
      warnings: result.warnings,
      agent_name: genome.agentName,
      section_count: genome.sections.length,
    });
  }),
);

// ─── agent_mutate ────────────────────────────────────────

dispatcher.register(
  "agent_mutate",
  requireAgentEvolution(async (args) => {
    const genome = resolveGenome(args);
    const kind = a.string(args, "kind");

    switch (kind) {
      case "ablate_section": {
        const sectionId = a.string(args, "section_id") as CanonicalSectionId;
        if (!sectionId) return errorResponse("section_id is required for ablate_section");
        const result = ablateSection(genome, sectionId);
        return successResponse({
          applied: result.applied,
          kind: result.kind,
          description: result.description,
          markdown: result.applied ? assembleGenome(result.genome) : null,
          genome: result.applied ? result.genome : null,
        });
      }

      case "replace_content": {
        const sectionId = a.string(args, "section_id") as CanonicalSectionId;
        const newContent = a.string(args, "new_content");
        if (!sectionId) return errorResponse("section_id is required for replace_content");
        if (!newContent) return errorResponse("new_content is required for replace_content");
        const result = replaceSectionContent(genome, sectionId, newContent);
        return successResponse({
          applied: result.applied,
          kind: result.kind,
          description: result.description,
          markdown: result.applied ? assembleGenome(result.genome) : null,
          genome: result.applied ? result.genome : null,
        });
      }

      case "mutate_model": {
        const newModel = a.string(args, "new_model") as ModelTierOrInherit;
        if (!newModel) return errorResponse("new_model is required for mutate_model");
        const result = mutateModel(genome, newModel);
        return successResponse({
          applied: result.applied,
          kind: result.kind,
          description: result.description,
          markdown: result.applied ? assembleGenome(result.genome) : null,
          genome: result.applied ? result.genome : null,
        });
      }

      case "add_skill": {
        const name = a.string(args, "skill_name");
        if (!name) return errorResponse("skill_name is required for add_skill");
        const comment = a.string(args, "skill_comment", "");
        const result = addSkill(genome, { name, comment });
        return successResponse({
          applied: result.applied,
          kind: result.kind,
          description: result.description,
          markdown: result.applied ? assembleGenome(result.genome) : null,
          genome: result.applied ? result.genome : null,
        });
      }

      case "remove_skill": {
        const name = a.string(args, "skill_name");
        if (!name) return errorResponse("skill_name is required for remove_skill");
        const result = removeSkill(genome, name);
        return successResponse({
          applied: result.applied,
          kind: result.kind,
          description: result.description,
          markdown: result.applied ? assembleGenome(result.genome) : null,
          genome: result.applied ? result.genome : null,
        });
      }

      default:
        return errorResponse(
          `Unknown mutation kind: ${kind}. Supported: ${PURE_MUTATIONS.join(", ")}`,
        );
    }
  }),
);

// ─── agent_compare ───────────────────────────────────────

dispatcher.registerQuick(
  "agent_compare",
  requireAgentEvolution(async (args) => {
    const samplesA = a.array<number>(args, "samples_a");
    const samplesB = a.array<number>(args, "samples_b");
    const alpha = a.number(args, "alpha", 0.05);

    if (samplesA.length < 2) return errorResponse("samples_a needs at least 2 values");
    if (samplesB.length < 2) return errorResponse("samples_b needs at least 2 values");

    const tTest = welchTTest(samplesA, samplesB);
    const effectSize = cohensD(samplesA, samplesB);
    const significant = tTest.pValue < alpha;

    const meanA = samplesA.reduce((s, v) => s + v, 0) / samplesA.length;
    const meanB = samplesB.reduce((s, v) => s + v, 0) / samplesB.length;

    return successResponse({
      t_statistic: tTest.tStatistic,
      p_value: tTest.pValue,
      degrees_of_freedom: tTest.degreesOfFreedom,
      effect_size: effectSize,
      significant,
      alpha,
      mean_a: meanA,
      mean_b: meanB,
      mean_difference: meanB - meanA,
      n_a: samplesA.length,
      n_b: samplesB.length,
      interpretation: significant
        ? Math.abs(effectSize) < 0.2
          ? "Statistically significant but negligible effect"
          : Math.abs(effectSize) < 0.5
            ? "Small but significant effect"
            : Math.abs(effectSize) < 0.8
              ? "Medium significant effect"
              : "Large significant effect"
        : "Not statistically significant",
    });
  }),
);

// ─── agent_benchmark ─────────────────────────────────────

dispatcher.registerQuick(
  "agent_benchmark",
  requireAgentEvolution(async (args) => {
    const action = a.string(args, "action");

    switch (action) {
      case "list": {
        const targetAgent = a.stringOptional(args, "target_agent");
        const category = a.stringOptional(args, "category");

        let tasks: readonly BenchmarkTask[] = BENCHMARK_CATALOG;
        if (targetAgent) {
          tasks = tasks.filter((t) => t.targetAgent === targetAgent);
        }
        if (category) {
          tasks = tasks.filter((t) => t.category === category);
        }

        return successResponse({
          total: tasks.length,
          tasks: tasks.map((t) => ({
            id: t.id,
            name: t.name,
            target_agent: t.targetAgent,
            category: t.category,
            difficulty: t.difficulty,
            criteria_count: t.criteria.length,
          })),
        });
      }

      case "get": {
        const taskId = a.string(args, "task_id");
        if (!taskId) return errorResponse("task_id is required for action=get");

        const task = BENCHMARK_CATALOG.find((t) => t.id === taskId);
        if (!task) return errorResponse(`Task '${taskId}' not found`);

        return successResponse(task);
      }

      case "validate": {
        const result = validateCatalog();
        return successResponse({
          valid: result.valid,
          errors: result.errors,
          task_count: BENCHMARK_CATALOG.length,
        });
      }

      default:
        return errorResponse(`Unknown action: ${action}. Supported: list, get, validate`);
    }
  }),
);

// ─── agent_evolve_start ──────────────────────────────────

dispatcher.register(
  "agent_evolve_start",
  requireAgentEvolution(async (args) => {
    // Parse seed genome
    let seedMarkdown = a.stringOptional(args, "seed_markdown");
    const seedFile = a.stringOptional(args, "seed_file");

    if (!seedMarkdown && seedFile) {
      const resolved = path.isAbsolute(seedFile)
        ? seedFile
        : path.resolve(config().projectRoot, seedFile);
      seedMarkdown = fs.readFileSync(resolved, "utf-8");
    }
    if (!seedMarkdown) {
      return errorResponse("Provide seed_markdown or seed_file");
    }

    const seedGenome = parseAgentTemplate(seedMarkdown);
    const validation = validateGenome(seedGenome);
    if (!validation.valid) {
      return errorResponse(`Invalid seed genome: ${validation.errors.join("; ")}`);
    }

    // Session config
    const sessionConfig: EvolutionSessionConfig = {
      batchSize: a.number(args, "batch_size", 5),
      maxGenerations: a.number(args, "max_generations", 20),
      seed: a.number(args, "seed", 42),
      gridBinsX: a.number(args, "grid_bins", 10),
      gridBinsY: a.number(args, "grid_bins", 10),
      costMin: 0.0005,
      costMax: 0.10,
    };

    // Create session
    const store = getStore();
    const session = store.createSession(seedMarkdown, sessionConfig);

    // Generate first batch of mutations
    const rng = createRng(sessionConfig.seed);
    const variants = generateMutationBatch(
      seedGenome,
      seedMarkdown,
      sessionConfig.batchSize,
      rng,
    );

    // Persist pending variants
    const pending = store.insertVariants(session.id, 0, variants);

    return successResponse({
      session_id: session.id,
      seed_agent: seedGenome.agentName,
      seed_sections: seedGenome.sections.length,
      seed_skills: seedGenome.frontmatter.skills.length,
      config: sessionConfig,
      generation: 0,
      variants: pending.map((v) => ({
        id: v.id,
        mutation_kind: v.mutationKind,
        mutation_desc: v.mutationDesc,
        markdown: v.markdown,
      })),
      instructions: [
        "Evaluate each variant by executing it against your benchmark tasks.",
        "For each variant, determine a fitness score (0-1) and cost (USD).",
        "Submit results with agent_evolve_step to advance to the next generation.",
      ],
    });
  }),
);

// ─── agent_evolve_step ───────────────────────────────────

dispatcher.register(
  "agent_evolve_step",
  requireAgentEvolution(async (args) => {
    const sessionId = a.string(args, "session_id");
    if (!sessionId) return errorResponse("session_id is required");

    const results = a.array<{
      variant_id: string;
      fitness: number;
      cost: number;
    }>(args, "results");

    if (!results.length) return errorResponse("results must contain at least one entry");

    const store = getStore();
    const session = store.getSession(sessionId);
    if (!session) return errorResponse(`Session '${sessionId}' not found`);
    if (session.status !== "active") {
      return errorResponse(`Session is '${session.status}', not active`);
    }

    // Submit evaluation results
    for (const r of results) {
      store.submitResult(r.variant_id, r.fitness, r.cost);
    }

    // Place evaluated variants into grid
    const evaluated = store.getEvaluatedVariants(sessionId, session.generation);
    const gridData = [...session.gridData];
    let bestFitness = session.bestFitness;
    let bestMarkdown = session.bestMarkdown;

    for (const v of evaluated) {
      if (v.fitness === null || v.cost === null) continue;

      const costAxis: AxisConfig = {
        bins: session.config.gridBinsX,
        min: session.config.costMin,
        max: session.config.costMax,
        scale: "log",
      };
      const qualityAxis: AxisConfig = {
        bins: session.config.gridBinsY,
        min: 0,
        max: 1,
        scale: "linear",
      };
      const x = quantize(v.cost, costAxis);
      const y = quantize(v.fitness, qualityAxis);
      const cellIdx = gridData.findIndex((c) => c.x === x && c.y === y);

      if (cellIdx === -1) {
        // New cell
        gridData.push({
          x,
          y,
          fitness: v.fitness,
          cost: v.cost,
          markdown: v.markdown,
          generation: session.generation,
        });
      } else if (v.fitness > gridData[cellIdx].fitness) {
        // Replace elite
        gridData[cellIdx] = {
          x,
          y,
          fitness: v.fitness,
          cost: v.cost,
          markdown: v.markdown,
          generation: session.generation,
        };
      }

      if (v.fitness > bestFitness) {
        bestFitness = v.fitness;
        bestMarkdown = v.markdown;
      }
    }

    // Compute generation stats
    const genStats = {
      generation: session.generation,
      filledCells: gridData.length,
      bestFitness,
      meanFitness:
        gridData.length > 0
          ? gridData.reduce((s, c) => s + c.fitness, 0) / gridData.length
          : 0,
      variantsEvaluated: evaluated.length,
    };
    const stats = [...session.stats, genStats];

    const nextGeneration = session.generation + 1;
    const isComplete = nextGeneration >= session.config.maxGenerations;

    // Update session
    store.updateSession(sessionId, {
      gridData,
      generation: nextGeneration,
      status: isComplete ? "completed" : "active",
      bestFitness,
      bestMarkdown,
      stats,
    });

    if (isComplete) {
      return successResponse({
        status: "completed",
        generation: nextGeneration,
        stats: genStats,
        best_fitness: bestFitness,
        best_markdown: bestMarkdown,
        grid_size: gridData.length,
        total_cells: session.config.gridBinsX * session.config.gridBinsY,
        coverage: gridData.length / (session.config.gridBinsX * session.config.gridBinsY),
        stats_history: stats,
      });
    }

    // Generate next batch of mutations from grid elites
    const rng = createRng(session.config.seed + nextGeneration);
    const nextVariants = generateMutationBatchFromGrid(
      gridData,
      session.seedMarkdown,
      session.config.batchSize,
      rng,
    );

    const pending = store.insertVariants(sessionId, nextGeneration, nextVariants);

    return successResponse({
      status: "active",
      generation: nextGeneration,
      stats: genStats,
      best_fitness: bestFitness,
      grid_size: gridData.length,
      variants: pending.map((v) => ({
        id: v.id,
        mutation_kind: v.mutationKind,
        mutation_desc: v.mutationDesc,
        markdown: v.markdown,
      })),
    });
  }),
);

// ─── Topology + Execution handlers ───────────────────────

registerTopologyHandlers(dispatcher, getStore, requireAgentEvolution);
registerExecutionHandlers(dispatcher, getStore, requireAgentEvolution);

// ---------------------------------------------------------------------------
// Mutation batch generation
// ---------------------------------------------------------------------------

/** Available pure mutation generators. */
function generateMutationBatch(
  genome: AgentGenome,
  markdown: string,
  batchSize: number,
  rng: () => number,
): Array<{ markdown: string; mutationKind: string; mutationDesc: string }> {
  const results: Array<{ markdown: string; mutationKind: string; mutationDesc: string }> = [];
  const sections = genome.sections;

  for (let i = 0; i < batchSize; i++) {
    const roll = rng();

    if (sections.length > 0 && roll < 0.4) {
      // Ablate a random section
      const idx = Math.floor(rng() * sections.length);
      const sectionId = sections[idx].id as CanonicalSectionId;
      const result = ablateSection(genome, sectionId);
      if (result.applied) {
        results.push({
          markdown: assembleGenome(result.genome),
          mutationKind: result.kind,
          mutationDesc: result.description,
        });
        continue;
      }
    }

    if (sections.length > 0 && roll < 0.6) {
      // Replace section content with trimmed version
      const idx = Math.floor(rng() * sections.length);
      const section = sections[idx];
      const lines = section.content.split("\n");
      if (lines.length > 2) {
        // Randomly trim some lines to create a variation
        const keepCount = Math.max(1, Math.floor(lines.length * (0.5 + rng() * 0.4)));
        const trimmed = lines.slice(0, keepCount).join("\n");
        const result = replaceSectionContent(genome, section.id as CanonicalSectionId, trimmed);
        if (result.applied) {
          results.push({
            markdown: assembleGenome(result.genome),
            mutationKind: result.kind,
            mutationDesc: result.description,
          });
          continue;
        }
      }
    }

    if (roll < 0.75) {
      // Model mutation
      const models: ModelTierOrInherit[] = ["opus", "sonnet", "haiku"];
      const current = genome.frontmatter.model;
      const candidates = models.filter((m) => m !== current);
      const newModel = candidates[Math.floor(rng() * candidates.length)];
      const result = mutateModel(genome, newModel);
      if (result.applied) {
        results.push({
          markdown: assembleGenome(result.genome),
          mutationKind: result.kind,
          mutationDesc: result.description,
        });
        continue;
      }
    }

    if (genome.frontmatter.skills.length > 0 && roll < 0.9) {
      // Remove a random skill
      const skills = genome.frontmatter.skills;
      const skill = skills[Math.floor(rng() * skills.length)];
      const result = removeSkill(genome, skill.name);
      if (result.applied) {
        results.push({
          markdown: assembleGenome(result.genome),
          mutationKind: result.kind,
          mutationDesc: result.description,
        });
        continue;
      }
    }

    // Fallback: use original with model change
    const fallbackModels: ModelTierOrInherit[] = ["opus", "sonnet", "haiku"];
    const fallbackModel = fallbackModels[Math.floor(rng() * fallbackModels.length)];
    const fallbackResult = mutateModel(genome, fallbackModel);
    results.push({
      markdown: assembleGenome(fallbackResult.genome),
      mutationKind: fallbackResult.kind,
      mutationDesc: fallbackResult.applied
        ? fallbackResult.description
        : "No mutation applied (identity variant)",
    });
  }

  return results;
}

/** Generate mutations from grid elites (parents). */
function generateMutationBatchFromGrid(
  gridData: GridCell[],
  seedMarkdown: string,
  batchSize: number,
  rng: () => number,
): Array<{ markdown: string; mutationKind: string; mutationDesc: string }> {
  if (gridData.length === 0) {
    // No elites yet — mutate seed
    const genome = parseAgentTemplate(seedMarkdown);
    return generateMutationBatch(genome, seedMarkdown, batchSize, rng);
  }

  const results: Array<{ markdown: string; mutationKind: string; mutationDesc: string }> = [];

  for (let i = 0; i < batchSize; i++) {
    // Select random parent from grid
    const parentIdx = Math.floor(rng() * gridData.length);
    const parent = gridData[parentIdx];
    const parentGenome = parseAgentTemplate(parent.markdown);

    // Generate single mutation
    const batch = generateMutationBatch(parentGenome, parent.markdown, 1, rng);
    results.push(...batch);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Module export
// ---------------------------------------------------------------------------

export const agentEvolutionModule = createModule(
  [...tools, ...topologyTools, ...executionTools],
  dispatcher,
);
