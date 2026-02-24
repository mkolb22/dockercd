/**
 * State Module
 * SQLite-backed operational state for health, events, checkpoints, and stories.
 * Provides 10 MCP tools including structured checkpoint save/restore.
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { successResponse, errorResponse, args as a } from "../../utils/responses.js";
import { createDispatcher, createModule } from "../../core/dispatcher.js";
import { createLazyLoader } from "../../utils/lazy.js";
import { requireState } from "../../utils/guards.js";
import { config } from "../../core/config.js";
import { StateStore } from "./store.js";
import type { HealthZone, CheckpointType, StoryStatus } from "./types.js";

const dispatcher = createDispatcher();
const getStore = createLazyLoader(() => new StateStore(config().stateDbPath));

// Tool definitions
export const tools: Tool[] = [
  {
    name: "zen_health_update",
    description:
      "Update context health status. Replaces writing to koan/health/status.yaml. Called by hooks to track context usage.",
    inputSchema: {
      type: "object",
      properties: {
        context_usage_percent: {
          type: "number",
          description: "Current context usage percentage (0-100)",
        },
        zone: {
          type: "string",
          enum: ["green", "yellow", "red"],
          description: "Health zone based on context usage",
        },
      },
      required: ["context_usage_percent", "zone"],
    },
  },
  {
    name: "zen_health_get",
    description:
      "Get current context health status. Replaces reading koan/health/status.yaml.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "zen_event_log",
    description:
      "Log an operational event. Replaces writing to koan/events/processed/*.yaml. Used by hooks for session exits, context thresholds, concept completions.",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          description:
            "Event type (e.g., 'session_exit', 'context_threshold', 'concept_complete', 'error')",
        },
        data: {
          type: "object",
          description: "Event payload as JSON object",
        },
      },
      required: ["type"],
    },
  },
  {
    name: "zen_checkpoint_save",
    description:
      "Save a session checkpoint with optional structured context for intuitive restoration. Stores full checkpoint data in SQLite for atomic durability.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Checkpoint name (e.g., 'phase2-complete', 'pre-refactor')",
        },
        type: {
          type: "string",
          enum: ["safety", "commit", "milestone", "session_exit", "pre_compact", "manual"],
          description: "Checkpoint type classification",
        },
        data: {
          type: "object",
          description:
            "Full checkpoint content (task state, decisions, context)",
        },
        lessons: {
          type: "array",
          description: "What was learned during the session",
          items: {
            type: "object",
            properties: {
              insight: { type: "string", description: "What was learned" },
              context: { type: "string", description: "When/where this applied" },
              principle: { type: "string", description: "General principle to carry forward" },
            },
            required: ["insight"],
          },
        },
        dead_ends: {
          type: "array",
          description: "Approaches tried that failed — prevents re-deriving",
          items: {
            type: "object",
            properties: {
              attempted: { type: "string", description: "What was tried" },
              why_it_failed: { type: "string", description: "Why it didn't work" },
              lesson: { type: "string", description: "What to do instead" },
            },
            required: ["attempted", "why_it_failed"],
          },
        },
        warm_up_files: {
          type: "array",
          description: "Files to re-read on restore to rebuild intuition",
          items: {
            type: "object",
            properties: {
              path: { type: "string", description: "File path relative to project root" },
              reason: { type: "string", description: "Why this file matters" },
              sections: { type: "string", description: "Optional line ranges or section names to focus on" },
            },
            required: ["path", "reason"],
          },
        },
        restoration_prompt: {
          type: "string",
          description: "First-person briefing for future Claude (e.g., 'You were working on X. The key insight was Y.')",
        },
      },
      required: ["name", "type", "data"],
    },
  },
  {
    name: "zen_checkpoint_list",
    description:
      "List saved checkpoints. Replaces listing koan/session-state/ directory. Returns checkpoints ordered by creation time (newest first).",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["safety", "commit", "milestone", "session_exit", "pre_compact", "manual"],
          description: "Filter by checkpoint type",
        },
        limit: {
          type: "number",
          description: "Maximum number of checkpoints to return (default: 20)",
        },
      },
    },
  },
  {
    name: "zen_checkpoint_get",
    description:
      "Get a specific checkpoint by ID. Replaces reading koan/session-state/checkpoint-*.yaml. Returns full checkpoint data including restoration prompt.",
    inputSchema: {
      type: "object",
      properties: {
        checkpoint_id: {
          type: "string",
          description: "Checkpoint ID to retrieve",
        },
        latest: {
          type: "boolean",
          description: "If true, get the most recent checkpoint (ignores checkpoint_id)",
        },
        type: {
          type: "string",
          enum: ["safety", "commit", "milestone", "session_exit", "pre_compact", "manual"],
          description: "When used with latest=true, filter by type",
        },
      },
    },
  },
  {
    name: "zen_checkpoint_restore",
    description:
      "Restore from a checkpoint with progressive layered context. Returns structured layers (grounding, decisions, lessons, dead_ends, warm_up_files) and instructions for rebuilding intuition.",
    inputSchema: {
      type: "object",
      properties: {
        checkpoint_id: {
          type: "string",
          description: "Checkpoint ID to restore from",
        },
        latest: {
          type: "boolean",
          description: "If true, restore from the most recent checkpoint (ignores checkpoint_id)",
        },
        type: {
          type: "string",
          enum: ["safety", "commit", "milestone", "session_exit", "pre_compact", "manual"],
          description: "When used with latest=true, filter by type",
        },
      },
    },
  },
  {
    name: "zen_story_save",
    description:
      "Save or update a story in state.db. Replaces writing koan/stories/story-*.yaml. Used by the story concept to persist requirements.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Story ID (e.g., 'story-20260215-051900')",
        },
        title: {
          type: "string",
          description: "Short story title",
        },
        status: {
          type: "string",
          enum: ["draft", "ready", "in_progress", "completed", "cancelled"],
          description: "Story status (default: 'draft')",
        },
        data: {
          type: "object",
          description: "Full story data (summary, acceptance_criteria, scope, etc.)",
        },
      },
      required: ["id", "title", "data"],
    },
  },
  {
    name: "zen_story_get",
    description:
      "Get a story by ID from state.db. Replaces reading koan/stories/story-*.yaml.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Story ID to retrieve",
        },
        latest: {
          type: "boolean",
          description: "If true, get the most recent story (ignores id)",
        },
      },
    },
  },
  {
    name: "zen_story_list",
    description:
      "List stories from state.db. Returns stories ordered by update time (newest first).",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["draft", "ready", "in_progress", "completed", "cancelled"],
          description: "Filter by story status",
        },
        limit: {
          type: "number",
          description: "Maximum stories to return (default: 20)",
        },
      },
    },
  },
];

// Register handlers
dispatcher
  .registerQuick(
    "zen_health_update",
    requireState(async (args) => {
      const contextUsagePercent = a.number(args, "context_usage_percent", 0);
      const zone = a.string(args, "zone", "green") as HealthZone;

      if (!["green", "yellow", "red"].includes(zone)) {
        return errorResponse("zone must be 'green', 'yellow', or 'red'");
      }

      const store = getStore();
      const record = store.updateHealth(contextUsagePercent, zone);
      return successResponse(record);
    }),
  )
  .registerQuick(
    "zen_health_get",
    requireState(async () => {
      const store = getStore();
      const record = store.getHealth();

      if (!record) {
        return successResponse({
          contextUsagePercent: 0,
          zone: "green",
          updatedAt: null,
          message: "No health data recorded yet",
        });
      }

      return successResponse(record);
    }),
  )
  .registerQuick(
    "zen_event_log",
    requireState(async (args) => {
      const type = a.string(args, "type");
      if (!type) return errorResponse("type is required");
      const data = a.object<Record<string, unknown>>(args, "data") ?? {};

      const store = getStore();
      const record = store.logEvent(type, data);
      return successResponse(record);
    }),
  )
  .register(
    "zen_checkpoint_save",
    requireState(async (args) => {
      const name = a.string(args, "name");
      if (!name) return errorResponse("name is required");
      const type = a.string(args, "type", "manual") as CheckpointType;
      const data = a.object<Record<string, unknown>>(args, "data") ?? {};

      // Merge optional structured fields into data
      const lessons = a.arrayOptional(args, "lessons");
      const deadEnds = a.arrayOptional(args, "dead_ends");
      const warmUpFiles = a.arrayOptional(args, "warm_up_files");
      const restorationPrompt = a.stringOptional(args, "restoration_prompt");

      if (lessons?.length) data.lessons = lessons;
      if (deadEnds?.length) data.dead_ends = deadEnds;
      if (warmUpFiles?.length) data.warm_up_files = warmUpFiles;
      if (restorationPrompt) data.restoration_prompt = restorationPrompt;

      const store = getStore();
      const record = store.saveCheckpoint(name, type, data);
      return successResponse(record);
    }),
  )
  .registerQuick(
    "zen_checkpoint_list",
    requireState(async (args) => {
      const type = a.stringOptional(args, "type") as CheckpointType | undefined;
      const limit = a.number(args, "limit", 20);

      const store = getStore();
      const checkpoints = store.listCheckpoints({ type, limit });
      return successResponse({
        count: checkpoints.length,
        checkpoints,
      });
    }),
  )
  .registerQuick(
    "zen_checkpoint_get",
    requireState(async (args) => {
      const latest = a.boolean(args, "latest", false);

      if (latest) {
        const type = a.stringOptional(args, "type") as CheckpointType | undefined;
        const store = getStore();
        const checkpoint = store.getLatestCheckpoint(type);
        if (!checkpoint) {
          return errorResponse(
            type
              ? `No checkpoints found with type "${type}"`
              : "No checkpoints found",
          );
        }
        return successResponse(checkpoint);
      }

      const checkpointId = a.string(args, "checkpoint_id", "");
      if (!checkpointId) {
        return errorResponse("Either checkpoint_id or latest=true is required");
      }

      const store = getStore();
      const checkpoint = store.getCheckpoint(checkpointId);
      if (!checkpoint) {
        return errorResponse(`Checkpoint "${checkpointId}" not found`);
      }
      return successResponse(checkpoint);
    }),
  )
  .registerQuick(
    "zen_checkpoint_restore",
    requireState(async (args) => {
      const latest = a.boolean(args, "latest", false);
      let checkpoint;

      if (latest) {
        const type = a.stringOptional(args, "type") as CheckpointType | undefined;
        const store = getStore();
        checkpoint = store.getLatestCheckpoint(type);
        if (!checkpoint) {
          return errorResponse(
            type
              ? `No checkpoints found with type "${type}"`
              : "No checkpoints found",
          );
        }
      } else {
        const checkpointId = a.string(args, "checkpoint_id", "");
        if (!checkpointId) {
          return errorResponse("Either checkpoint_id or latest=true is required");
        }
        const store = getStore();
        checkpoint = store.getCheckpoint(checkpointId);
        if (!checkpoint) {
          return errorResponse(`Checkpoint "${checkpointId}" not found`);
        }
      }

      // Extract data and build progressive layers
      const d = (checkpoint.data ?? {}) as Record<string, unknown>;

      return successResponse({
        checkpoint: {
          id: checkpoint.id,
          name: checkpoint.name,
          type: checkpoint.type,
          createdAt: checkpoint.createdAt,
        },
        layers: {
          grounding: d.task_state ?? d,
          decisions: d.decisions ?? [],
          lessons: d.lessons ?? [],
          dead_ends: d.dead_ends ?? [],
          warm_up_files: d.warm_up_files ?? [],
        },
        restoration_prompt: d.restoration_prompt ?? null,
        instructions: [
          "Review grounding to understand project state",
          "Note decisions and reasoning — do not re-derive these",
          "Review lessons — these prevent repeating past mistakes",
          "Review dead ends — approaches that were tried and failed",
          "Reference memory/relationship.md from your system prompt for working style",
          "Read each file in warm_up_files using the Read tool (with line ranges if specified)",
          "Do NOT ask permission to read files — read them silently",
          "After reading, provide a brief synthesis confirming you understand the context",
        ],
      });
    }),
  )
  .registerQuick(
    "zen_story_save",
    requireState(async (args) => {
      const id = a.string(args, "id");
      if (!id) return errorResponse("id is required");
      const title = a.string(args, "title", "Untitled");
      const status = a.string(args, "status", "draft") as StoryStatus;
      const data = a.object<Record<string, unknown>>(args, "data") ?? {};

      const store = getStore();
      const record = store.saveStory(id, title, status, data);
      return successResponse(record);
    }),
  )
  .registerQuick(
    "zen_story_get",
    requireState(async (args) => {
      const latest = a.boolean(args, "latest", false);

      if (latest) {
        const store = getStore();
        const stories = store.listStories({ limit: 1 });
        if (stories.length === 0) {
          return errorResponse("No stories found");
        }
        return successResponse(stories[0]);
      }

      const id = a.string(args, "id", "");
      if (!id) {
        return errorResponse("Either id or latest=true is required");
      }

      const store = getStore();
      const story = store.getStory(id);
      if (!story) {
        return errorResponse(`Story "${id}" not found`);
      }
      return successResponse(story);
    }),
  )
  .registerQuick(
    "zen_story_list",
    requireState(async (args) => {
      const status = a.stringOptional(args, "status") as StoryStatus | undefined;
      const limit = a.number(args, "limit", 20);

      const store = getStore();
      const stories = store.listStories({ status, limit });
      return successResponse({
        count: stories.length,
        stories,
      });
    }),
  );

export const stateModule = createModule(tools, dispatcher);

// Export types and store
export * from "./types.js";
export { StateStore } from "./store.js";
