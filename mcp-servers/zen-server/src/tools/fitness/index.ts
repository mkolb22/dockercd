/**
 * Fitness Module
 * 8 MCP tools for fitness tracking, population management, model routing,
 * budget enforcement, and debate orchestration.
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { successResponse, errorResponse, args as a } from "../../utils/responses.js";
import { createDispatcher, createModule } from "../../core/dispatcher.js";
import { createLazyLoader } from "../../utils/lazy.js";
import { requireFitness } from "../../utils/guards.js";
import { config } from "../../core/config.js";
import { generateId } from "../../utils/ids.js";
import { FitnessStore } from "./store.js";
import { computeFitness, rankVariants } from "./calculator.js";
import { buildMutationPrompt, buildCrossoverPrompt, mutate, crossover, validateMutatedContent } from "./population.js";
import { selectModel, getRecommendations } from "./router.js";
import { checkBudget, getBudgetStatus, detectAnomaly } from "./budget.js";
import { assembleDebate } from "./debate.js";
import type { Model, VariantStatus, BudgetLimits } from "./types.js";

const dispatcher = createDispatcher();
const getStore = createLazyLoader(() => new FitnessStore(config().stateDbPath));

export const tools: Tool[] = [
  {
    name: "zen_fitness_status",
    description: "Show evolution fitness status across all concepts. Lists current variant, fitness score, trend, and variant count per concept.",
    inputSchema: {
      type: "object",
      properties: {
        concept: { type: "string", description: "Filter to a specific concept" },
      },
    },
  },
  {
    name: "zen_fitness_update",
    description: "Update fitness scores from provenance data. Recomputes fitness for a variant based on action results.",
    inputSchema: {
      type: "object",
      properties: {
        concept: { type: "string", description: "Concept to update fitness for" },
        variant_id: { type: "string", description: "Variant ID to update" },
        actions: {
          type: "array",
          description: "Array of action results (status, error, timestamp, metadata)",
          items: { type: "object" },
        },
      },
      required: ["concept", "variant_id", "actions"],
    },
  },
  {
    name: "zen_fitness_mutate",
    description: "Generate a mutation prompt for creating a new prompt variant. Returns the mutation context; Claude Code generates the actual content.",
    inputSchema: {
      type: "object",
      properties: {
        concept: { type: "string", description: "Concept to mutate" },
        variant_id: { type: "string", description: "Source variant ID" },
        focus: { type: "string", description: "Mutation focus area" },
        content: { type: "string", description: "New variant content (if already generated)" },
        recent_failures: {
          type: "array",
          description: "Recent failure descriptions",
          items: { type: "string" },
        },
      },
      required: ["concept", "variant_id", "focus"],
    },
  },
  {
    name: "zen_fitness_crossover",
    description: "Generate a crossover variant from two parent prompts. Returns crossover context or saves the new variant if content provided.",
    inputSchema: {
      type: "object",
      properties: {
        concept: { type: "string", description: "Concept for crossover" },
        variant_a: { type: "string", description: "First parent variant ID" },
        variant_b: { type: "string", description: "Second parent variant ID" },
        content: { type: "string", description: "New variant content (if already generated)" },
      },
      required: ["concept", "variant_a", "variant_b"],
    },
  },
  {
    name: "zen_fitness_promote",
    description: "Promote a variant to be the default for a concept. Sets all other variants to archived.",
    inputSchema: {
      type: "object",
      properties: {
        concept: { type: "string", description: "Concept to promote within" },
        variant_id: { type: "string", description: "Variant ID to promote" },
      },
      required: ["concept", "variant_id"],
    },
  },
  {
    name: "zen_fitness_route",
    description: "Model routing optimization. Selects the optimal model for a concept-action pair, or lists cost-saving recommendations.",
    inputSchema: {
      type: "object",
      properties: {
        concept: { type: "string", description: "Concept for routing" },
        action: { type: "string", description: "Action for routing" },
        recommend: { type: "boolean", description: "If true, return optimization recommendations instead of a routing decision" },
      },
    },
  },
  {
    name: "zen_fitness_budget",
    description: "Budget enforcement and spend tracking. Check budget status, set limits, record spend, or detect anomalies.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["status", "check", "record", "set_limits"],
          description: "Budget action to perform",
        },
        estimated_cost: { type: "number", description: "Estimated cost to check (for action=check)" },
        concept: { type: "string", description: "Concept (for action=record)" },
        operation: { type: "string", description: "Operation name (for action=record)" },
        model: { type: "string", description: "Model used (for action=record)" },
        actual_cost: { type: "number", description: "Actual cost (for action=record)" },
        daily_limit: { type: "number", description: "Daily limit USD (for action=set_limits)" },
        weekly_limit: { type: "number", description: "Weekly limit USD (for action=set_limits)" },
        monthly_limit: { type: "number", description: "Monthly limit USD (for action=set_limits)" },
        per_operation_limit: { type: "number", description: "Per-operation limit USD (for action=set_limits)" },
      },
    },
  },
  {
    name: "zen_fitness_debate",
    description: "Multi-agent debate orchestration. Assembles and stores debate results from advocate, critic, and synthesis agent outputs.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["assemble", "list", "get"],
          description: "Debate action",
        },
        arch_id: { type: "string", description: "Architecture ID for the debate" },
        advocate: { type: "object", description: "Advocate agent output (for action=assemble)" },
        critic: { type: "object", description: "Critic agent output (for action=assemble)" },
        synthesis: { type: "object", description: "Synthesis agent output (for action=assemble)" },
        duration_ms: { type: "number", description: "Debate duration in ms (for action=assemble)" },
        debate_id: { type: "string", description: "Debate ID (for action=get)" },
        limit: { type: "number", description: "Max results (for action=list, default: 20)" },
      },
    },
  },
];

// ─── Handlers ──────────────────────────────────────────────────

dispatcher
  .register(
    "zen_fitness_status",
    requireFitness(async (args) => {
      const store = getStore();
      const concept = a.stringOptional(args, "concept");

      if (concept) {
        const state = store.loadFitnessState(concept);
        if (!state) return successResponse({ message: `No fitness data for concept: ${concept}` });
        return successResponse(state);
      }

      const overview = store.listConceptFitness();
      if (overview.length === 0) {
        return successResponse({ message: "No fitness data recorded yet" });
      }
      return successResponse({ concepts: overview });
    }),
  )
  .register(
    "zen_fitness_update",
    requireFitness(async (args) => {
      const concept = a.string(args, "concept");
      const variantId = a.string(args, "variant_id");
      const actions = a.array(args, "actions");

      if (!concept || !variantId) return errorResponse("concept and variant_id are required");
      if (actions.length === 0) return errorResponse("actions array is empty");

      const score = computeFitness(variantId, actions as any[]);
      const store = getStore();
      store.saveFitnessScore(concept, score);

      return successResponse({ concept, score });
    }),
  )
  .register(
    "zen_fitness_mutate",
    requireFitness(async (args) => {
      const concept = a.string(args, "concept");
      const variantId = a.string(args, "variant_id");
      const focus = a.string(args, "focus");
      const content = a.stringOptional(args, "content");
      const failures = a.array<string>(args, "recent_failures");

      if (!concept || !variantId || !focus) return errorResponse("concept, variant_id, and focus are required");

      const store = getStore();
      const sourceVariant = store.getVariant(concept, variantId);
      if (!sourceVariant) return errorResponse(`Variant ${variantId} not found for concept ${concept}`);

      const mutConfig = { focus, recentFailures: failures };

      if (content) {
        const validation = validateMutatedContent(content);
        if (!validation.valid) return errorResponse(`Invalid content: ${validation.errors.join(", ")}`);

        const newVariant = mutate(sourceVariant, content, mutConfig);
        newVariant.variant_id = generateId("var");
        store.saveVariant(concept, newVariant);

        return successResponse({
          message: "Variant created",
          variant_id: newVariant.variant_id,
          checksum: newVariant.checksum,
        });
      }

      return successResponse({
        message: "Mutation prompt generated. Use this to create the content, then call again with content parameter.",
        mutation_prompt: buildMutationPrompt(sourceVariant, mutConfig),
      });
    }),
  )
  .register(
    "zen_fitness_crossover",
    requireFitness(async (args) => {
      const concept = a.string(args, "concept");
      const variantAId = a.string(args, "variant_a");
      const variantBId = a.string(args, "variant_b");
      const content = a.stringOptional(args, "content");

      if (!concept || !variantAId || !variantBId) return errorResponse("concept, variant_a, variant_b are required");

      const store = getStore();
      const varA = store.getVariant(concept, variantAId);
      const varB = store.getVariant(concept, variantBId);
      if (!varA) return errorResponse(`Variant ${variantAId} not found`);
      if (!varB) return errorResponse(`Variant ${variantBId} not found`);

      const fitnessState = store.loadFitnessState(concept);
      const fitnessA = fitnessState?.variants.find((v) => v.variant_id === variantAId)?.fitness.current || 0;
      const fitnessB = fitnessState?.variants.find((v) => v.variant_id === variantBId)?.fitness.current || 0;

      const crossConfig = { variantA: varA, variantB: varB, fitnessA, fitnessB };

      if (content) {
        const validation = validateMutatedContent(content);
        if (!validation.valid) return errorResponse(`Invalid content: ${validation.errors.join(", ")}`);

        const newVariant = crossover(content, crossConfig);
        newVariant.variant_id = generateId("var");
        store.saveVariant(concept, newVariant);

        return successResponse({
          message: "Crossover variant created",
          variant_id: newVariant.variant_id,
          checksum: newVariant.checksum,
        });
      }

      return successResponse({
        message: "Crossover prompt generated. Use this to create content, then call again with content parameter.",
        crossover_prompt: buildCrossoverPrompt(crossConfig),
      });
    }),
  )
  .registerQuick(
    "zen_fitness_promote",
    requireFitness(async (args) => {
      const concept = a.string(args, "concept");
      const variantId = a.string(args, "variant_id");
      if (!concept || !variantId) return errorResponse("concept and variant_id are required");

      const store = getStore();
      const variant = store.getVariant(concept, variantId);
      if (!variant) return errorResponse(`Variant ${variantId} not found for concept ${concept}`);

      // Archive all other active variants
      const allVariants = store.loadVariants(concept, "active");
      for (const v of allVariants) {
        if (v.variant_id !== variantId) {
          store.updateVariantStatus(concept, v.variant_id, "archived");
        }
      }

      // Promote this variant
      store.updateVariantStatus(concept, variantId, "promoted");

      return successResponse({
        message: `Variant ${variantId} promoted for ${concept}`,
        archived: allVariants.filter((v) => v.variant_id !== variantId).length,
      });
    }),
  )
  .register(
    "zen_fitness_route",
    requireFitness(async (args) => {
      const store = getStore();
      const recommend = a.boolean(args, "recommend", false);

      if (recommend) {
        const perfState = store.loadPerformanceState();
        const recs = getRecommendations(perfState);
        return successResponse({
          recommendations: recs,
          total_potential_savings: recs.reduce((s, r) => s + r.potential_savings_per_run, 0),
        });
      }

      const concept = a.string(args, "concept", "");
      const action = a.string(args, "action", "");
      if (!concept || !action) return errorResponse("concept and action required for routing (or use recommend=true)");

      const perfState = store.loadPerformanceState();
      const decision = selectModel(perfState, concept, action);
      return successResponse(decision);
    }),
  )
  .register(
    "zen_fitness_budget",
    requireFitness(async (args) => {
      const store = getStore();
      const action = a.string(args, "action", "status");

      switch (action) {
        case "status": {
          const limits = store.loadBudgetLimits();
          const records = store.loadSpendRecords();
          const status = getBudgetStatus({ limits, spend_records: records });
          return successResponse({ limits, status });
        }
        case "check": {
          const cost = a.number(args, "estimated_cost", 0);
          if (cost <= 0) return errorResponse("estimated_cost must be positive");
          const limits = store.loadBudgetLimits();
          const records = store.loadSpendRecords();
          const result = checkBudget({ limits, spend_records: records }, cost);
          return successResponse(result);
        }
        case "record": {
          const concept = a.string(args, "concept", "");
          const op = a.string(args, "operation", "");
          const model = a.string(args, "model", "sonnet") as Model;
          const cost = a.number(args, "actual_cost", 0);
          if (!concept || !op || cost <= 0) return errorResponse("concept, operation, model, and actual_cost are required");

          store.recordSpend(concept, op, model, cost);

          // Check for anomaly
          const records = store.loadSpendRecords();
          const alert = detectAnomaly(records, concept, op, model, cost);
          return successResponse({ recorded: true, alert });
        }
        case "set_limits": {
          const current = store.loadBudgetLimits();
          const updates: Partial<BudgetLimits> = {};
          const daily = a.numberOptional(args, "daily_limit");
          const weekly = a.numberOptional(args, "weekly_limit");
          const monthly = a.numberOptional(args, "monthly_limit");
          const perOp = a.numberOptional(args, "per_operation_limit");
          if (daily !== undefined) updates.daily_limit_usd = daily;
          if (weekly !== undefined) updates.weekly_limit_usd = weekly;
          if (monthly !== undefined) updates.monthly_limit_usd = monthly;
          if (perOp !== undefined) updates.per_operation_limit_usd = perOp;
          const newLimits = { ...current, ...updates };
          store.saveBudgetLimits(newLimits);
          return successResponse({ message: "Budget limits updated", limits: newLimits });
        }
        default:
          return errorResponse(`Unknown budget action: ${action}. Use status, check, record, or set_limits.`);
      }
    }),
  )
  .register(
    "zen_fitness_debate",
    requireFitness(async (args) => {
      const store = getStore();
      const action = a.string(args, "action", "list");

      switch (action) {
        case "assemble": {
          const archId = a.string(args, "arch_id", "");
          if (!archId) return errorResponse("arch_id is required");

          const advocate = a.object(args, "advocate");
          const critic = a.object(args, "critic");
          const synthesis = a.object(args, "synthesis");
          if (!advocate || !critic || !synthesis) {
            return errorResponse("advocate, critic, and synthesis outputs are required");
          }

          const durationMs = a.number(args, "duration_ms", 0);
          const result = assembleDebate(archId, advocate as any, critic as any, synthesis as any, durationMs);
          store.saveDebate(result);
          return successResponse(result);
        }
        case "list": {
          const archId = a.stringOptional(args, "arch_id");
          const limit = a.number(args, "limit", 20);
          const debates = store.loadDebates(archId, limit);
          return successResponse({ count: debates.length, debates });
        }
        case "get": {
          const debateId = a.string(args, "debate_id", "");
          if (!debateId) return errorResponse("debate_id is required");
          const debates = store.loadDebates(undefined, 100);
          const found = debates.find((d) => d.debate_id === debateId);
          if (!found) return errorResponse(`Debate ${debateId} not found`);
          return successResponse(found);
        }
        default:
          return errorResponse(`Unknown debate action: ${action}. Use assemble, list, or get.`);
      }
    }),
  );

export const fitnessModule = createModule(tools, dispatcher);
export * from "./types.js";
export { FitnessStore } from "./store.js";
