/**
 * Compete Module
 * Competitive evaluation framework: Zen-assisted vs vanilla Claude Code.
 * Dual-arm experiments with statistical analysis (Welch's t-test, Cohen's d)
 * and systematic tool ablation to identify the minimal effective toolset.
 *
 * 6 tools: compete_start, compete_submit, compete_status, compete_results,
 *          compete_ablate_start, compete_ablate_submit
 */

import * as fs from "fs";
import * as path from "path";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { successResponse, errorResponse, args as a } from "../../utils/responses.js";
import { createDispatcher, createModule } from "../../core/dispatcher.js";
import { createLazyLoader } from "../../utils/lazy.js";
import { requireCompete } from "../../utils/guards.js";
import { config } from "../../core/config.js";
import { CompeteStore } from "./store.js";
import { SpecStore } from "../spec/store.js";
import { generateSpecPrompt } from "../spec/generator.js";
import { computeComposite, buildSummary, analyzeAblation, mean } from "./evaluator.js";
import type { FitnessScores, CompeteArm, ToolCategory } from "./types.js";

const dispatcher = createDispatcher();
const getStore = createLazyLoader(() => new CompeteStore(config().stateDbPath));
const getSpecStore = createLazyLoader(() => new SpecStore(config().stateDbPath));

// ─── Tool Category → Tool Names ─────────────────────────

const TOOL_CATEGORIES: Record<ToolCategory, string[]> = {
  ast: [
    "index_project", "find_symbol", "get_symbol_info", "find_references",
    "get_call_graph", "find_implementations", "get_file_symbols", "search_by_signature",
  ],
  semantic: [
    "embed_project", "semantic_search", "find_similar_code", "get_embedding_stats",
  ],
  memory: [
    "memory_store", "memory_recall", "memory_evolve", "memory_link",
    "memory_forget", "memory_graph", "memory_stats",
  ],
  framework: [
    "zen_get_concept", "zen_get_workflow", "zen_get_agent_prompt", "zen_get_skills",
    "zen_plan_workflow", "zen_start_workflow", "zen_advance_workflow",
    "zen_evaluate_sync", "zen_get_workflow_state", "zen_framework_status", "zen_reload_framework",
  ],
  spec: [
    "zen_spec_save", "zen_spec_get", "zen_spec_list", "zen_spec_generate",
    "zen_spec_export", "zen_spec_import",
  ],
  all: [], // populated dynamically
};

// Populate 'all' with every tool across categories
TOOL_CATEGORIES.all = Object.entries(TOOL_CATEGORIES)
  .filter(([k]) => k !== "all")
  .flatMap(([, tools]) => tools);

// Ablatable categories (excludes 'all')
const ABLATABLE_CATEGORIES: ToolCategory[] = ["ast", "semantic", "memory", "framework", "spec"];

// ─── Helpers ─────────────────────────────────────────────

function readZenManagedBlock(projectRoot: string): string | null {
  const claudeMdPath = path.join(projectRoot, "CLAUDE.md");
  try {
    const content = fs.readFileSync(claudeMdPath, "utf-8");
    const startMarker = "<!-- zen:managed:start";
    const endMarker = "<!-- zen:managed:end -->";
    const startIdx = content.indexOf(startMarker);
    const endIdx = content.indexOf(endMarker);
    if (startIdx === -1 || endIdx === -1) return null;
    return content.slice(startIdx, endIdx + endMarker.length);
  } catch {
    return null;
  }
}

function buildEvaluationInstructions(): string {
  return [
    "## Evaluation Instructions",
    "",
    "After the code is generated, score each dimension from 0.0 to 1.0:",
    "",
    "### correctness (weight: 0.30)",
    "Run `go test -race -count=1 ./...` — score = tests passed / total tests.",
    "If race detector fires, multiply score by 0.5.",
    "",
    "### contracts (weight: 0.20)",
    "Run property-based tests with `go test -run TestProperty ./...`.",
    "Score = properties verified / total properties in spec.",
    "",
    "### security (weight: 0.20)",
    "Run `gosec ./...` — score = 1 - (findings / 20), clamped to [0, 1].",
    "Each finding reduces score by 0.05.",
    "",
    "### performance (weight: 0.10)",
    "Run `go test -bench=. -benchmem ./...` — normalize ns/op against a baseline.",
    "Score = baseline_ns / actual_ns, clamped to [0, 1].",
    "",
    "### complexity (weight: 0.10)",
    "Run `gocyclo -avg .` — score = 1 - (avg_complexity / 20), clamped to [0, 1].",
    "Lower complexity scores better.",
    "",
    "### lint (weight: 0.10)",
    "Run `go vet ./...` and `staticcheck ./...` — score = 1 - (findings / 10), clamped to [0, 1].",
    "",
    "Submit scores via `compete_submit` with the session_id, round number, and arm.",
  ].join("\n");
}

function buildAblationPrompt(
  specPrompt: string,
  zenBlock: string,
  disabledCategory: ToolCategory,
): string {
  const disabledTools = TOOL_CATEGORIES[disabledCategory] ?? [];

  return [
    specPrompt,
    "",
    "---",
    "",
    zenBlock,
    "",
    "---",
    "",
    `## Ablation: ${disabledCategory} tools DISABLED`,
    "",
    "Follow the CLAUDE.md instructions above, EXCEPT do NOT use any of the following tools:",
    ...disabledTools.map((t) => `- ${t}`),
    "",
    "Use all other available zen MCP tools to produce the highest quality implementation.",
    "The goal is to determine whether the disabled tool category measurably contributes to code quality.",
  ].join("\n");
}

// ─── Fitness Scores Schema (reused across tools) ────────

const fitnessScoresSchema = {
  type: "object" as const,
  properties: {
    correctness: { type: "number" as const, description: "0-1: go test pass rate + race detector" },
    contracts: { type: "number" as const, description: "0-1: property-based test pass rate" },
    security: { type: "number" as const, description: "0-1: gosec findings (inverted)" },
    performance: { type: "number" as const, description: "0-1: benchmark ns/op (normalized)" },
    complexity: { type: "number" as const, description: "0-1: gocyclo avg (inverted)" },
    lint: { type: "number" as const, description: "0-1: go vet + staticcheck findings (inverted)" },
  },
  required: ["correctness", "contracts", "security", "performance", "complexity", "lint"],
};

// ─── Tool Definitions ────────────────────────────────────

export const tools: Tool[] = [
  {
    name: "compete_start",
    description:
      "Start a competitive evaluation session. Generates control (no zen tools) and treatment (full zen tools) prompts from a ZenSpec.",
    inputSchema: {
      type: "object",
      properties: {
        spec_id: {
          type: "string",
          description: "ZenSpec ID to use as the basis for evaluation",
        },
        rounds: {
          type: "number",
          description: "Number of rounds per arm (default: 5)",
        },
        significance: {
          type: "number",
          description: "Significance level for t-test (default: 0.05)",
        },
      },
      required: ["spec_id"],
    },
  },
  {
    name: "compete_submit",
    description:
      "Submit scores for one arm of one round. When both arms of all rounds are submitted, returns statistical analysis.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "Competition session ID",
        },
        round: {
          type: "number",
          description: "Round number (1-indexed)",
        },
        arm: {
          type: "string",
          enum: ["control", "treatment"],
          description: "Which arm this submission is for",
        },
        scores: {
          ...fitnessScoresSchema,
          description: "Fitness scores for this round/arm",
        },
        raw_metrics: {
          type: "string",
          description: "Optional raw Go toolchain output (JSON string)",
        },
      },
      required: ["session_id", "round", "arm", "scores"],
    },
  },
  {
    name: "compete_status",
    description: "Get current competition status: rounds completed, running means, progress.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "Competition session ID",
        },
      },
      required: ["session_id"],
    },
  },
  {
    name: "compete_results",
    description:
      "Get full statistical results: p-values, effect sizes, per-dimension analysis, and winner declaration.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "Competition session ID",
        },
      },
      required: ["session_id"],
    },
  },
  {
    name: "compete_ablate_start",
    description:
      "Start ablation testing after treatment wins. Tests each tool category individually to find the minimal effective toolset.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "Competition session ID (must be completed with treatment winner)",
        },
        rounds_per_category: {
          type: "number",
          description: "Rounds per ablated category (default: 3)",
        },
      },
      required: ["session_id"],
    },
  },
  {
    name: "compete_ablate_submit",
    description:
      "Submit scores for an ablation run. When all categories are complete, returns the ablation summary with recommendations.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "Competition session ID",
        },
        disabled_category: {
          type: "string",
          enum: ["ast", "semantic", "memory", "framework", "spec"],
          description: "Which tool category was disabled for this run",
        },
        round: {
          type: "number",
          description: "Ablation round number (1-indexed)",
        },
        scores: {
          ...fitnessScoresSchema,
          description: "Fitness scores with this category disabled",
        },
      },
      required: ["session_id", "disabled_category", "round", "scores"],
    },
  },
];

// ─── Handlers ────────────────────────────────────────────

dispatcher
  .register(
    "compete_start",
    requireCompete(async (args) => {
      const specId = a.string(args, "spec_id");
      const rounds = a.number(args, "rounds", 5);
      const significance = a.number(args, "significance", 0.05);

      if (!specId) return errorResponse("spec_id is required");
      if (rounds < 2) return errorResponse("rounds must be at least 2 for statistical significance");
      if (significance <= 0 || significance >= 1) return errorResponse("significance must be between 0 and 1");

      const specStore = getSpecStore();
      const spec = specStore.getSpec(specId);
      if (!spec) return errorResponse(`Spec "${specId}" not found. Use zen_spec_list to see available specs.`);

      const specPrompt = generateSpecPrompt(spec.data);

      const zenBlock = readZenManagedBlock(config().projectRoot);

      // Build control prompt: raw spec, no tools
      const controlPrompt = [
        specPrompt,
        "",
        "---",
        "",
        "## Instructions",
        "",
        "Implement directly from this specification.",
        "Do NOT use any external tools. Do NOT use any MCP tools.",
        "Generate the code purely from the specification above.",
        "Write idiomatic, production-quality code with full test coverage.",
      ].join("\n");

      // Build treatment prompt: spec + zen workflow instructions
      const treatmentPromptParts = [specPrompt, "", "---", ""];
      if (zenBlock) {
        treatmentPromptParts.push(zenBlock, "", "---", "");
      }
      treatmentPromptParts.push(
        "## Instructions",
        "",
        "Follow the CLAUDE.md instructions above exactly.",
        "Index the codebase first. Check existing specs. Search for patterns.",
        "Use all available zen MCP tools to produce the highest quality implementation.",
        "Write idiomatic, production-quality code with full test coverage.",
      );
      const treatmentPrompt = treatmentPromptParts.join("\n");

      const evaluationInstructions = buildEvaluationInstructions();

      const store = getStore();
      const competeConfig = {
        totalRounds: rounds,
        significanceLevel: significance,
        specId,
        targetLanguage: spec.data.target_language,
      };
      const session = store.createSession(specId, spec.name, competeConfig);

      return successResponse({
        session_id: session.id,
        spec_name: spec.name,
        target_language: spec.data.target_language,
        total_rounds: rounds,
        significance_level: significance,
        control_prompt: controlPrompt,
        treatment_prompt: treatmentPrompt,
        evaluation_instructions: evaluationInstructions,
        instructions: [
          `Competition started: ${rounds} rounds, α=${significance}`,
          "",
          "For each round (1 to " + rounds + "):",
          "  1. Launch a control arm subagent (worktree) with the control_prompt — NO zen tools",
          "  2. Launch a treatment arm subagent (worktree) with the treatment_prompt — full zen tools",
          "  3. Evaluate both outputs using the evaluation_instructions",
          "  4. Call compete_submit for each arm with the scored results",
          "",
          "After all rounds, compete_submit will return the statistical analysis.",
        ].join("\n"),
      });
    }),
  )
  .register(
    "compete_submit",
    requireCompete(async (args) => {
      const sessionId = a.string(args, "session_id");
      const round = a.number(args, "round", 0);
      const arm = a.string(args, "arm") as CompeteArm;
      const scores = a.object<FitnessScores>(args, "scores");
      const rawMetrics = a.stringOptional(args, "raw_metrics");

      if (!sessionId) return errorResponse("session_id is required");
      if (round < 1) return errorResponse("round must be >= 1");
      if (arm !== "control" && arm !== "treatment") return errorResponse('arm must be "control" or "treatment"');
      if (!scores) return errorResponse("scores is required");

      // Validate score ranges
      for (const dim of ["correctness", "contracts", "security", "performance", "complexity", "lint"] as const) {
        const val = scores[dim];
        if (typeof val !== "number" || val < 0 || val > 1) {
          return errorResponse(`scores.${dim} must be a number between 0 and 1`);
        }
      }

      const store = getStore();
      const session = store.getSession(sessionId);
      if (!session) return errorResponse(`Session "${sessionId}" not found`);
      if (session.status !== "active") return errorResponse(`Session is ${session.status}, not active`);
      if (round > session.config.totalRounds) {
        return errorResponse(`Round ${round} exceeds total rounds (${session.config.totalRounds})`);
      }

      // Check for duplicate submission
      const existingPair = store.getRoundPair(sessionId, round);
      if (arm === "control" && existingPair.control) {
        return errorResponse(`Control arm for round ${round} already submitted`);
      }
      if (arm === "treatment" && existingPair.treatment) {
        return errorResponse(`Treatment arm for round ${round} already submitted`);
      }

      const composite = computeComposite(scores);
      store.insertRound(sessionId, round, arm, scores, composite, rawMetrics);

      // Check if both arms submitted for this round
      const updatedPair = store.getRoundPair(sessionId, round);
      const roundComplete = !!updatedPair.control && !!updatedPair.treatment;

      if (roundComplete) {
        // Count complete rounds (both arms present)
        let completedRounds = 0;
        for (let r = 1; r <= session.config.totalRounds; r++) {
          const pair = store.getRoundPair(sessionId, r);
          if (pair.control && pair.treatment) completedRounds++;
        }

        store.updateSession(sessionId, { currentRound: completedRounds });

        // All rounds complete → compute summary
        if (completedRounds >= session.config.totalRounds) {
          const controlRounds = store.getRounds(sessionId, "control");
          const treatmentRounds = store.getRounds(sessionId, "treatment");
          const summary = buildSummary(controlRounds, treatmentRounds, session.config.significanceLevel);

          store.updateSession(sessionId, {
            status: "completed",
            winner: summary.overallWinner,
            summaryJson: JSON.stringify(summary),
          });

          return successResponse({
            status: "completed",
            round_submitted: round,
            arm,
            composite,
            summary,
            next_steps: summary.overallWinner === "treatment"
              ? "Treatment (zen tools) won. Run compete_ablate_start to identify which tool categories contributed."
              : summary.overallWinner === "control"
                ? "Control (no zen tools) won. Zen tools did not measurably improve code quality for this spec."
                : "Inconclusive — consider running more rounds or using a different spec.",
          });
        }

        return successResponse({
          status: "round_complete",
          round_submitted: round,
          rounds_completed: completedRounds,
          total_rounds: session.config.totalRounds,
          control_composite: updatedPair.control!.composite,
          treatment_composite: updatedPair.treatment!.composite,
        });
      }

      return successResponse({
        status: "arm_submitted",
        round_submitted: round,
        arm,
        composite,
        waiting_for: arm === "control" ? "treatment" : "control",
      });
    }),
  )
  .registerQuick(
    "compete_status",
    requireCompete(async (args) => {
      const sessionId = a.string(args, "session_id");
      if (!sessionId) return errorResponse("session_id is required");

      const store = getStore();
      const session = store.getSession(sessionId);
      if (!session) return errorResponse(`Session "${sessionId}" not found`);

      const controlRounds = store.getRounds(sessionId, "control");
      const treatmentRounds = store.getRounds(sessionId, "treatment");

      const controlComposites = controlRounds.map((r) => r.composite);
      const treatmentComposites = treatmentRounds.map((r) => r.composite);

      // Per-round comparison
      const roundComparisons: Array<{ round: number; control: number; treatment: number; delta: number }> = [];
      for (let r = 1; r <= session.config.totalRounds; r++) {
        const pair = store.getRoundPair(sessionId, r);
        if (pair.control && pair.treatment) {
          roundComparisons.push({
            round: r,
            control: pair.control.composite,
            treatment: pair.treatment.composite,
            delta: pair.treatment.composite - pair.control.composite,
          });
        }
      }

      return successResponse({
        session_id: session.id,
        spec_name: session.specName,
        status: session.status,
        current_round: session.currentRound,
        total_rounds: session.config.totalRounds,
        control_submitted: controlRounds.length,
        treatment_submitted: treatmentRounds.length,
        control_mean: controlComposites.length > 0 ? mean(controlComposites) : null,
        treatment_mean: treatmentComposites.length > 0 ? mean(treatmentComposites) : null,
        round_comparisons: roundComparisons,
        winner: session.winner,
      });
    }),
  )
  .registerQuick(
    "compete_results",
    requireCompete(async (args) => {
      const sessionId = a.string(args, "session_id");
      if (!sessionId) return errorResponse("session_id is required");

      const store = getStore();
      const session = store.getSession(sessionId);
      if (!session) return errorResponse(`Session "${sessionId}" not found`);

      if (session.status === "active") {
        return errorResponse("Competition still active. Submit all rounds first.");
      }

      if (session.summaryJson) {
        return successResponse({
          session_id: session.id,
          spec_name: session.specName,
          ...JSON.parse(session.summaryJson),
        });
      }

      // Recompute if somehow missing
      const controlRounds = store.getRounds(sessionId, "control");
      const treatmentRounds = store.getRounds(sessionId, "treatment");
      const summary = buildSummary(controlRounds, treatmentRounds, session.config.significanceLevel);

      return successResponse({
        session_id: session.id,
        spec_name: session.specName,
        ...summary,
      });
    }),
  )
  .register(
    "compete_ablate_start",
    requireCompete(async (args) => {
      const sessionId = a.string(args, "session_id");
      const roundsPerCategory = a.number(args, "rounds_per_category", 3);

      if (!sessionId) return errorResponse("session_id is required");
      if (roundsPerCategory < 2) return errorResponse("rounds_per_category must be at least 2");

      const store = getStore();
      const session = store.getSession(sessionId);
      if (!session) return errorResponse(`Session "${sessionId}" not found`);

      if (session.status !== "completed") {
        return errorResponse("Session must be completed before ablation. Run all competition rounds first.");
      }
      if (session.winner !== "treatment") {
        return errorResponse(
          `Ablation requires treatment to be the winner. Current winner: ${session.winner ?? "none"}. ` +
          "Ablation identifies which treatment tools contribute — it only makes sense when treatment wins.",
        );
      }

      // Get the spec for rebuilding prompts
      const specStore = getSpecStore();
      const spec = specStore.getSpec(session.specId);
      if (!spec) return errorResponse(`Original spec "${session.specId}" no longer exists`);

      const specPrompt = generateSpecPrompt(spec.data);
      const zenBlock = readZenManagedBlock(config().projectRoot);
      if (!zenBlock) {
        return errorResponse("Cannot find zen:managed block in CLAUDE.md — needed for ablation prompts");
      }

      // Update session status
      store.updateSession(sessionId, { status: "ablating" });

      // Generate per-category ablation prompts
      const ablationPlan: Record<string, { prompt: string; disabled_tools: string[] }> = {};
      for (const category of ABLATABLE_CATEGORIES) {
        ablationPlan[category] = {
          prompt: buildAblationPrompt(specPrompt, zenBlock, category),
          disabled_tools: TOOL_CATEGORIES[category],
        };
      }

      return successResponse({
        session_id: sessionId,
        categories: ABLATABLE_CATEGORIES,
        rounds_per_category: roundsPerCategory,
        total_ablation_runs: ABLATABLE_CATEGORIES.length * roundsPerCategory,
        ablation_plan: ablationPlan,
        evaluation_instructions: buildEvaluationInstructions(),
        instructions: [
          `Ablation testing started for ${ABLATABLE_CATEGORIES.length} categories × ${roundsPerCategory} rounds.`,
          "",
          "For each category in [" + ABLATABLE_CATEGORIES.join(", ") + "]:",
          `  For each round (1 to ${roundsPerCategory}):`,
          "    1. Launch a subagent (worktree) with the category's ablation prompt",
          "    2. Evaluate the output using the evaluation_instructions",
          "    3. Call compete_ablate_submit with the scores",
          "",
          "After all runs, compete_ablate_submit will return the ablation analysis.",
        ].join("\n"),
      });
    }),
  )
  .register(
    "compete_ablate_submit",
    requireCompete(async (args) => {
      const sessionId = a.string(args, "session_id");
      const disabledCategory = a.string(args, "disabled_category") as ToolCategory;
      const round = a.number(args, "round", 0);
      const scores = a.object<FitnessScores>(args, "scores");

      if (!sessionId) return errorResponse("session_id is required");
      if (!ABLATABLE_CATEGORIES.includes(disabledCategory as any)) {
        return errorResponse(`disabled_category must be one of: ${ABLATABLE_CATEGORIES.join(", ")}`);
      }
      if (round < 1) return errorResponse("round must be >= 1");
      if (!scores) return errorResponse("scores is required");

      // Validate score ranges
      for (const dim of ["correctness", "contracts", "security", "performance", "complexity", "lint"] as const) {
        const val = scores[dim];
        if (typeof val !== "number" || val < 0 || val > 1) {
          return errorResponse(`scores.${dim} must be a number between 0 and 1`);
        }
      }

      const store = getStore();
      const session = store.getSession(sessionId);
      if (!session) return errorResponse(`Session "${sessionId}" not found`);
      if (session.status !== "ablating") return errorResponse(`Session is ${session.status}, not ablating`);

      const composite = computeComposite(scores);
      store.insertAblationRun(sessionId, disabledCategory as ToolCategory, round, scores, composite);

      // Check if all ablation runs are complete
      const submittedCategories = store.getAblationCategories(sessionId);
      const allCategories = ABLATABLE_CATEGORIES.every((cat) => submittedCategories.includes(cat));

      // Count runs per category to check completion
      let allComplete = allCategories;
      if (allCategories) {
        for (const cat of ABLATABLE_CATEGORIES) {
          const runs = store.getAblationRuns(sessionId, cat as ToolCategory);
          // We don't enforce exact round count — just check we have enough data
          if (runs.length < 2) {
            allComplete = false;
            break;
          }
        }
      }

      if (allComplete) {
        // Build ablation analysis
        const treatmentRounds = store.getRounds(sessionId, "treatment");
        const allAblationRuns = store.getAblationRuns(sessionId);
        const ablationSummary = analyzeAblation(
          treatmentRounds,
          allAblationRuns,
          session.config.significanceLevel,
        );

        store.updateSession(sessionId, { status: "completed" });

        return successResponse({
          status: "ablation_complete",
          ablation_summary: ablationSummary,
          interpretation: [
            `Full treatment mean: ${ablationSummary.fullTreatmentMean.toFixed(4)}`,
            "",
            "Per-category results:",
            ...ablationSummary.results.map((r) =>
              `  ${r.category}: ${r.recommendation.toUpperCase()} (delta=${r.deltaFromFull.toFixed(4)}, p=${r.pValue.toFixed(4)}, d=${r.cohensD.toFixed(2)})`,
            ),
            "",
            `Minimal effective toolset: [${ablationSummary.minimalEffectiveToolset.join(", ")}]`,
          ].join("\n"),
        });
      }

      // Report progress
      const runsByCategory: Record<string, number> = {};
      for (const cat of ABLATABLE_CATEGORIES) {
        runsByCategory[cat] = store.getAblationRuns(sessionId, cat as ToolCategory).length;
      }

      return successResponse({
        status: "ablation_in_progress",
        submitted: { category: disabledCategory, round, composite },
        progress: runsByCategory,
        categories_remaining: ABLATABLE_CATEGORIES.filter((c) => !submittedCategories.includes(c)),
      });
    }),
  );

export const competeModule = createModule(tools, dispatcher);
