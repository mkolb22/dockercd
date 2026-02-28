/**
 * Pipeline Module
 * 2 MCP tools for pipeline composition and execution planning.
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { successResponse, errorResponse, args as a } from "../../utils/responses.js";
import { createDispatcher, createModule } from "../../core/dispatcher.js";
import { requirePipeline } from "../../utils/guards.js";
import { parsePipeline, validatePipeline, renderPipeline, KNOWN_CONCEPTS } from "./composer.js";
import { generatePlan } from "./planner.js";

const dispatcher = createDispatcher();

export const tools: Tool[] = [
  {
    name: "zen_compose",
    description: "Parse, validate, and render a pipeline DSL expression. DSL syntax: 'story | architecture | implementation'. Supports parallel(), model hints (:opus), pass counts ([2]), actions (.review), and annotations (@slo:standard).",
    inputSchema: {
      type: "object",
      properties: {
        dsl: { type: "string", description: "Pipeline DSL expression (e.g., 'story | architecture:opus | implementation')" },
        action: {
          type: "string",
          enum: ["parse", "validate", "render", "list_concepts"],
          description: "Action to perform (default: validate)",
        },
      },
    },
  },
  {
    name: "zen_flow_plan",
    description: "Generate an execution plan from a pipeline DSL expression. Returns steps with dependencies, preconditions, model assignments, and cost/duration estimates.",
    inputSchema: {
      type: "object",
      properties: {
        dsl: { type: "string", description: "Pipeline DSL expression" },
        story_id: { type: "string", description: "Story ID for precondition resolution" },
        from_step: { type: "number", description: "Start execution from this step number" },
      },
      required: ["dsl"],
    },
  },
];

// ─── Handlers ────────────────────────────────────────────────

dispatcher
  .register(
    "zen_compose",
    requirePipeline(async (args) => {
      const action = a.string(args, "action", "validate");

      if (action === "list_concepts") {
        return successResponse({
          concepts: [...KNOWN_CONCEPTS],
          aliases: {
            arch: "architecture", impl: "implementation", verify: "verification",
            docs: "documentation", sec: "security", retro: "retrospective",
            qa: "quality", ship: "version",
          },
          models: ["opus", "sonnet", "haiku"],
          syntax: {
            basic: "concept | concept | parallel(a, b) | concept",
            model_hint: "architecture:opus | implementation:sonnet",
            action: "quality.review | quality.test",
            passes: "verification[2]",
            annotation: "@slo:standard @errors:graceful",
          },
        });
      }

      const dsl = a.string(args, "dsl", "");
      if (!dsl) return errorResponse("dsl parameter is required");

      const pipeline = parsePipeline(dsl);

      if (action === "parse") {
        return successResponse({ pipeline });
      }

      const validation = validatePipeline(pipeline);

      if (action === "render") {
        return successResponse({
          pipeline,
          validation,
          rendered: renderPipeline(pipeline, validation),
        });
      }

      // Default: validate
      return successResponse({ pipeline, validation });
    }),
  )
  .register(
    "zen_flow_plan",
    requirePipeline(async (args) => {
      const dsl = a.string(args, "dsl", "");
      if (!dsl) return errorResponse("dsl parameter is required");

      const storyId = a.stringOptional(args, "story_id");
      const fromStep = a.numberOptional(args, "from_step");

      const pipeline = parsePipeline(dsl);
      const validation = validatePipeline(pipeline);

      if (!validation.valid) {
        return successResponse({
          message: "Pipeline has validation errors — plan not generated",
          validation,
        });
      }

      const plan = generatePlan(pipeline, validation, {
        storyId: storyId || undefined,
        fromStep: fromStep || undefined,
      });

      return successResponse(plan);
    }),
  );

export const pipelineModule = createModule(tools, dispatcher);
