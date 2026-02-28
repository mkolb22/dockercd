/**
 * Analytics Module
 * 7 MCP tools for cost analysis, benchmarks, drift detection, learning,
 * observability, timeline, and validation.
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { successResponse, errorResponse, args as a } from "../../utils/responses.js";
import { createDispatcher, createModule } from "../../core/dispatcher.js";
import { createLazyLoader } from "../../utils/lazy.js";
import { requireAnalytics } from "../../utils/guards.js";
import { config } from "../../core/config.js";
import { AnalyticsStore } from "./store.js";
import { computeCostAnalytics, computeBenchmarks } from "./aggregators.js";
import { computeLearningState, getEligiblePatterns, generateSkill } from "./learner.js";
import { compareDirectories } from "./drift.js";
import { loadPromptLogs, filterLogs, analyzePromptLogs } from "./observe.js";
import type { Concept, Model, ProvenanceFilter, TimelineEntry, TimelineView } from "./types.js";

const dispatcher = createDispatcher();
const getStore = createLazyLoader(() => new AnalyticsStore(config().stateDbPath));

export const tools: Tool[] = [
  {
    name: "zen_costs_analyze",
    description:
      "Cost breakdown by concept, model, flow, and date. Analyzes provenance events to show where spend is going.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Start date (ISO 8601)" },
        to: { type: "string", description: "End date (ISO 8601)" },
        concept: { type: "string", description: "Filter by concept" },
        model: { type: "string", description: "Filter by model (haiku, sonnet, opus)" },
        flow_id: { type: "string", description: "Filter by flow/workflow ID" },
      },
    },
  },
  {
    name: "zen_bench_metrics",
    description:
      "Performance benchmarks: duration, quality, failures, model usage, and trends. Aggregates provenance data into comprehensive metrics.",
    inputSchema: {
      type: "object",
      properties: {
        concept: { type: "string", description: "Filter by concept" },
        since: { type: "string", description: "Date to start from (ISO 8601)" },
        stories: {
          type: "number",
          description: "Number of recent stories for trend analysis (default: 0, no trends)",
        },
      },
    },
  },
  {
    name: "zen_drift_detect",
    description:
      "Detect configuration drift between .zen/templates/ and .claude/. Shows modified, missing, and added files.",
    inputSchema: {
      type: "object",
      properties: {
        template_dir: {
          type: "string",
          description: "Template directory (default: .zen/templates/)",
        },
        installed_dir: {
          type: "string",
          description: "Installed directory (default: .claude/)",
        },
      },
    },
  },
  {
    name: "zen_learn_analyze",
    description:
      "Extract recurring workflow patterns from provenance data. Computes success rates, calibration effectiveness, and generates skill templates for eligible patterns.",
    inputSchema: {
      type: "object",
      properties: {
        save: {
          type: "boolean",
          description: "Save learned patterns to DB (default: false, dry run)",
        },
        generate_skills: {
          type: "boolean",
          description: "Generate skill templates for eligible patterns (default: false)",
        },
      },
    },
  },
  {
    name: "zen_observe_analyze",
    description:
      "Prompt/token usage analytics from observability logs. Shows usage by concept, model, and session.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Start date filter (ISO 8601)" },
        to: { type: "string", description: "End date filter (ISO 8601)" },
        concept: { type: "string", description: "Filter by concept" },
      },
    },
  },
  {
    name: "zen_timeline_view",
    description:
      "Temporal workflow visualization from provenance. Shows ordered events with timing, costs, and flow grouping.",
    inputSchema: {
      type: "object",
      properties: {
        flow_id: { type: "string", description: "Filter to a specific workflow/flow" },
        concept: { type: "string", description: "Filter by concept" },
        from: { type: "string", description: "Start date (ISO 8601)" },
        to: { type: "string", description: "End date (ISO 8601)" },
        limit: { type: "number", description: "Max entries to return (default: 100)" },
      },
    },
  },
  {
    name: "zen_validate_config",
    description:
      "Validate configuration files and database integrity. Checks state.db and memory.db tables and data consistency.",
    inputSchema: {
      type: "object",
      properties: {
        check_state: {
          type: "boolean",
          description: "Check state.db integrity (default: true)",
        },
        check_memory: {
          type: "boolean",
          description: "Check memory.db integrity (default: true)",
        },
      },
    },
  },
];

// ─── Handlers ──────────────────────────────────────────────────

dispatcher
  .register(
    "zen_costs_analyze",
    requireAnalytics(async (args) => {
      const store = getStore();
      const filter = buildFilter(args);
      const actions = store.loadProvenance(filter);

      if (actions.length === 0) {
        return successResponse({ message: "No provenance actions found", filter });
      }

      return successResponse(computeCostAnalytics(actions));
    }),
  )
  .register(
    "zen_bench_metrics",
    requireAnalytics(async (args) => {
      const store = getStore();
      const filter: ProvenanceFilter = {};

      const concept = a.stringOptional(args, "concept");
      if (concept) filter.concepts = [concept as Concept];

      const since = a.stringOptional(args, "since");
      if (since) filter.dateRange = { from: new Date(since) };

      const actions = store.loadProvenance(filter);

      if (actions.length === 0) {
        return successResponse({ message: "No provenance actions found", filter });
      }

      const stories = a.number(args, "stories", 0);
      return successResponse(computeBenchmarks(actions, { stories }));
    }),
  )
  .register(
    "zen_drift_detect",
    requireAnalytics(async (args) => {
      const projectRoot = config().projectRoot;
      const templateDir = a.string(args, "template_dir", `${projectRoot}/.zen/templates`);
      const installedDir = a.string(args, "installed_dir", `${projectRoot}/.claude`);

      const report = compareDirectories(templateDir, installedDir);

      const summary = {
        modified: report.modified.length,
        missing: report.missing.length,
        added: report.added.length,
        in_sync: report.modified.length === 0 && report.missing.length === 0,
      };

      return successResponse({ summary, report });
    }),
  )
  .register(
    "zen_learn_analyze",
    requireAnalytics(async (args) => {
      const store = getStore();
      const actions = store.loadProvenance();

      if (actions.length === 0) {
        return successResponse({ message: "No provenance actions found" });
      }

      const state = computeLearningState(actions);
      const save = a.boolean(args, "save", false);
      const generateSkills = a.boolean(args, "generate_skills", false);

      if (save) {
        store.saveLearningState(state);
      }

      const eligible = getEligiblePatterns(state.patterns);
      const skills = generateSkills ? eligible.map(generateSkill) : [];

      return successResponse({
        patterns: state.patterns,
        calibrations: state.calibrations,
        eligible_for_skills: eligible.length,
        skills: skills.length > 0 ? skills : undefined,
        saved: save,
      });
    }),
  )
  .register(
    "zen_observe_analyze",
    requireAnalytics(async (args) => {
      const projectRoot = config().projectRoot;
      let entries = loadPromptLogs(projectRoot);

      const from = a.stringOptional(args, "from");
      const to = a.stringOptional(args, "to");
      const concept = a.stringOptional(args, "concept");

      if (from || to || concept) {
        entries = filterLogs(entries, { from, to, concept });
      }

      if (entries.length === 0) {
        return successResponse({ message: "No prompt logs found" });
      }

      return successResponse(analyzePromptLogs(entries));
    }),
  )
  .register(
    "zen_timeline_view",
    requireAnalytics(async (args) => {
      const store = getStore();
      const filter = buildFilter(args);
      const actions = store.loadProvenance(filter);
      const limit = a.number(args, "limit", 100);

      if (actions.length === 0) {
        return successResponse({ message: "No provenance actions found", filter });
      }

      const entries: TimelineEntry[] = actions.slice(0, limit).map((act) => ({
        action_id: act.action_id,
        timestamp: act.timestamp,
        concept: act.concept,
        action: act.action,
        status: act.status,
        model: act.model,
        duration_ms: act.duration_ms,
        cost_usd: act.cost?.cost_usd,
        flow_id: act.flow_id,
      }));

      const flowIds = [...new Set(entries.map((e) => e.flow_id).filter(Boolean) as string[])];
      const timestamps = entries.map((e) => e.timestamp).sort();

      const view: TimelineView = {
        entries,
        total_duration_ms: entries.reduce((s, e) => s + (e.duration_ms || 0), 0),
        total_cost: entries.reduce((s, e) => s + (e.cost_usd || 0), 0),
        flow_ids: flowIds,
        date_range: {
          from: timestamps[0] || "",
          to: timestamps[timestamps.length - 1] || "",
        },
      };

      return successResponse(view);
    }),
  )
  .register(
    "zen_validate_config",
    requireAnalytics(async (args) => {
      const cfg = config();
      const checkState = a.boolean(args, "check_state", true);
      const checkMemory = a.boolean(args, "check_memory", true);

      const errors: Array<{ db: string; table: string; message: string; severity: string }> = [];
      const warnings: Array<{ db: string; table: string; message: string; severity: string }> = [];

      if (checkState) {
        validateDb(cfg.stateDbPath, "state.db", [
          "health", "events", "checkpoints", "workflow_sessions", "stories",
        ], errors, warnings);
      }

      if (checkMemory) {
        validateDb(cfg.memoryDbPath, "memory.db", [
          "memories", "memory_embeddings", "links",
        ], errors, warnings);
      }

      return successResponse({
        valid: errors.length === 0,
        errors,
        warnings,
        databases_checked: [
          ...(checkState ? ["state.db"] : []),
          ...(checkMemory ? ["memory.db"] : []),
        ],
      });
    }),
  );

// ─── Helpers ──────────────────────────────────────────────────

function buildFilter(args: Record<string, unknown>): ProvenanceFilter {
  const filter: ProvenanceFilter = {};

  const from = a.stringOptional(args, "from");
  const to = a.stringOptional(args, "to");
  if (from || to) {
    filter.dateRange = {
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    };
  }

  const concept = a.stringOptional(args, "concept");
  if (concept) filter.concepts = [concept as Concept];

  const model = a.stringOptional(args, "model");
  if (model) filter.models = [model as Model];

  const flowId = a.stringOptional(args, "flow_id");
  if (flowId) filter.flowId = flowId;

  return filter;
}

function validateDb(
  dbPath: string,
  dbName: string,
  requiredTables: string[],
  errors: Array<{ db: string; table: string; message: string; severity: string }>,
  warnings: Array<{ db: string; table: string; message: string; severity: string }>,
): void {
  const fs = require("fs");
  if (!fs.existsSync(dbPath)) {
    errors.push({ db: dbName, table: "", message: `Database file not found: ${dbPath}`, severity: "error" });
    return;
  }

  try {
    const Database = require("better-sqlite3");
    const db = new Database(dbPath, { readonly: true });

    try {
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
      ).all() as Array<{ name: string }>;

      const tableNames = new Set(tables.map((t: { name: string }) => t.name));

      for (const required of requiredTables) {
        if (!tableNames.has(required)) {
          errors.push({
            db: dbName,
            table: required,
            message: `Required table '${required}' not found`,
            severity: "error",
          });
        }
      }

      // Check WAL mode
      const journal = db.pragma("journal_mode") as Array<{ journal_mode: string }>;
      if (journal[0]?.journal_mode !== "wal") {
        warnings.push({
          db: dbName,
          table: "",
          message: "Database not using WAL journal mode (recommended for concurrent access)",
          severity: "warning",
        });
      }

      // Check row counts for basic health
      for (const table of requiredTables) {
        if (tableNames.has(table)) {
          const count = db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number };
          if (count.c === 0) {
            warnings.push({
              db: dbName,
              table,
              message: `Table '${table}' is empty`,
              severity: "warning",
            });
          }
        }
      }
    } finally {
      db.close();
    }
  } catch (err) {
    errors.push({
      db: dbName,
      table: "",
      message: `Failed to open database: ${err instanceof Error ? err.message : String(err)}`,
      severity: "error",
    });
  }
}

export const analyticsModule = createModule(tools, dispatcher);
export * from "./types.js";
export { AnalyticsStore } from "./store.js";
