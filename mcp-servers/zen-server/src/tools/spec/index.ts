/**
 * Spec Module
 * ZenSpec specification DSL for type-safe code generation.
 * Saves structured specs and transforms them into Claude prompts.
 *
 * 6 tools: spec_save, spec_get, spec_list, spec_generate, spec_export, spec_import
 */

import * as fs from "fs";
import * as path from "path";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { successResponse, errorResponse, args as a } from "../../utils/responses.js";
import { createDispatcher, createModule } from "../../core/dispatcher.js";
import { createLazyLoader } from "../../utils/lazy.js";
import { config } from "../../core/config.js";
import { resolvePath, ensureDir } from "../../utils/project.js";
import { SpecStore } from "./store.js";
import { generateSpecPrompt, getLangConfig } from "./generator.js";
import type { SpecData, SpecTargetLanguage, PortableSpec } from "./types.js";

const dispatcher = createDispatcher();
const getStore = createLazyLoader(() => new SpecStore(config().stateDbPath));

// ─── Tool Definitions ────────────────────────────────────

export const tools: Tool[] = [
  {
    name: "zen_spec_save",
    description:
      "Save or update a ZenSpec specification. Defines types, functions with contracts (pre/post conditions, effects), and properties for code generation.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Spec ID to update (omit for new spec)",
        },
        name: {
          type: "string",
          description: "Spec name (e.g., 'string-utils', 'auth-service')",
        },
        data: {
          type: "object",
          description: "Full SpecData object with name, description, functions, types, properties, target_language",
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            target_language: {
              type: "string",
              enum: ["go", "swift", "rust", "typescript", "python"],
            },
            types: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  fields: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        type: { type: "string" },
                        description: { type: "string" },
                        constraints: { type: "string" },
                      },
                      required: ["name", "type"],
                    },
                  },
                  description: { type: "string" },
                },
                required: ["name", "fields"],
              },
            },
            functions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  params: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        type: { type: "string" },
                        description: { type: "string" },
                        constraints: { type: "string" },
                      },
                      required: ["name", "type"],
                    },
                  },
                  returns: { type: "string" },
                  errors: { type: "array", items: { type: "string" } },
                  effects: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        type: { type: "string", enum: ["io", "network", "database", "filesystem", "none"] },
                        description: { type: "string" },
                      },
                      required: ["type"],
                    },
                  },
                  requires: { type: "array", items: { type: "string" } },
                  ensures: { type: "array", items: { type: "string" } },
                  description: { type: "string" },
                },
                required: ["name", "params", "returns"],
              },
            },
            properties: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  description: { type: "string" },
                  forall: { type: "array", items: { type: "string" } },
                  body: { type: "string" },
                },
                required: ["name", "description", "body"],
              },
            },
          },
          required: ["name", "description", "target_language", "functions"],
        },
      },
      required: ["name", "data"],
    },
  },
  {
    name: "zen_spec_get",
    description: "Get a spec by ID, by name, or the latest spec.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Spec ID" },
        name: { type: "string", description: "Spec name (returns latest matching)" },
        latest: { type: "boolean", description: "If true, get the most recent spec" },
      },
    },
  },
  {
    name: "zen_spec_list",
    description: "List specs with optional filters.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["draft", "ready", "generating", "generated", "verified"],
          description: "Filter by status",
        },
        target_language: {
          type: "string",
          enum: ["go", "swift", "rust", "typescript", "python"],
          description: "Filter by target language",
        },
        limit: {
          type: "number",
          description: "Maximum results (default: 20)",
        },
      },
    },
  },
  {
    name: "zen_spec_generate",
    description:
      "Generate a structured code generation prompt from a spec. Returns a prompt that Claude uses to produce verified code in the target language.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Spec ID to generate from",
        },
        target_language: {
          type: "string",
          enum: ["go", "swift", "rust", "typescript", "python"],
          description: "Override the spec's target language",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "zen_spec_export",
    description:
      "Export spec(s) to a portable JSON file. Strips internal fields (id, timestamps) so specs can be shared across projects.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Export a single spec by ID",
        },
        name: {
          type: "string",
          description: "Export a single spec by name",
        },
        all: {
          type: "boolean",
          description: "Export all specs",
        },
        file_path: {
          type: "string",
          description: "Output file path (relative to project root or absolute). E.g., 'specs/my-specs.zenspec.json'",
        },
      },
      required: ["file_path"],
    },
  },
  {
    name: "zen_spec_import",
    description:
      "Import spec(s) from a portable JSON file. Generates new IDs for each imported spec.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Input file path (relative to project root or absolute)",
        },
        overwrite: {
          type: "boolean",
          description: "If true, overwrite specs with matching names. Default: false (skip existing).",
        },
      },
      required: ["file_path"],
    },
  },
];

// ─── Handlers ────────────────────────────────────────────

dispatcher
  .register("zen_spec_save", async (args) => {
    const name = a.string(args, "name");
    const data = a.object<SpecData>(args, "data");
    const id = a.stringOptional(args, "id");

    if (!name) return errorResponse("name is required");
    if (!data) return errorResponse("data is required");
    if (!data.functions?.length) return errorResponse("data.functions must contain at least one function");
    if (!data.target_language) return errorResponse("data.target_language is required");

    const store = getStore();
    const record = store.saveSpec(name, data, id);

    return successResponse({
      id: record.id,
      name: record.name,
      status: record.status,
      target_language: data.target_language,
      function_count: data.functions.length,
      type_count: data.types?.length ?? 0,
      property_count: data.properties?.length ?? 0,
      message: id
        ? `Spec "${name}" updated.`
        : `Spec "${name}" saved. Use zen_spec_generate to create a code generation prompt.`,
    });
  })
  .registerQuick("zen_spec_get", async (args) => {
    const id = a.stringOptional(args, "id");
    const name = a.stringOptional(args, "name");
    const latest = a.boolean(args, "latest", false);

    const store = getStore();
    let record;

    if (id) {
      record = store.getSpec(id);
    } else if (name) {
      record = store.getSpecByName(name);
    } else if (latest) {
      record = store.getLatestSpec();
    } else {
      return errorResponse("Provide id, name, or latest=true");
    }

    if (!record) return errorResponse("Spec not found");

    return successResponse(record);
  })
  .registerQuick("zen_spec_list", async (args) => {
    const status = a.stringOptional(args, "status") as SpecData["target_language"] | undefined;
    const targetLang = a.stringOptional(args, "target_language") as SpecTargetLanguage | undefined;
    const limit = a.number(args, "limit", 20);

    const store = getStore();
    const records = store.listSpecs({
      status: status as any,
      target_language: targetLang,
      limit,
    });

    return successResponse({
      count: records.length,
      specs: records.map((r) => ({
        id: r.id,
        name: r.name,
        status: r.status,
        target_language: r.data.target_language,
        function_count: r.data.functions.length,
        updatedAt: r.updatedAt,
      })),
    });
  })
  .register("zen_spec_export", async (args) => {
    const id = a.stringOptional(args, "id");
    const name = a.stringOptional(args, "name");
    const all = a.boolean(args, "all", false);
    const filePath = a.string(args, "file_path");

    if (!id && !name && !all) {
      return errorResponse("Provide id, name, or all=true to select specs to export");
    }

    const store = getStore();
    const specs: PortableSpec[] = [];

    if (all) {
      const records = store.listSpecs({ limit: 1000 });
      for (const r of records) {
        specs.push({ name: r.name, status: r.status, data: r.data });
      }
    } else if (id) {
      const record = store.getSpec(id);
      if (!record) return errorResponse(`Spec "${id}" not found`);
      specs.push({ name: record.name, status: record.status, data: record.data });
    } else if (name) {
      const record = store.getSpecByName(name);
      if (!record) return errorResponse(`Spec "${name}" not found`);
      specs.push({ name: record.name, status: record.status, data: record.data });
    }

    if (specs.length === 0) {
      return errorResponse("No specs found to export");
    }

    const resolved = resolvePath(config().projectRoot, filePath);
    ensureDir(path.dirname(resolved));
    await fs.promises.writeFile(resolved, JSON.stringify(specs, null, 2), "utf-8");

    return successResponse({
      file: resolved,
      count: specs.length,
      specs: specs.map((s) => s.name),
      message: `Exported ${specs.length} spec(s) to ${filePath}`,
    });
  })
  .register("zen_spec_import", async (args) => {
    const filePath = a.string(args, "file_path");
    const overwrite = a.boolean(args, "overwrite", false);

    const resolved = resolvePath(config().projectRoot, filePath);

    let content: string;
    try {
      content = await fs.promises.readFile(resolved, "utf-8");
    } catch {
      return errorResponse(`File not found: ${resolved}`);
    }

    let portable: PortableSpec[];
    try {
      const parsed = JSON.parse(content);
      portable = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return errorResponse("Invalid JSON in spec file");
    }

    const store = getStore();
    const imported: string[] = [];
    const skipped: string[] = [];
    const errors: string[] = [];

    for (const entry of portable) {
      // Validate required fields
      if (!entry.name || !entry.data?.name || !entry.data?.target_language || !entry.data?.functions?.length) {
        errors.push(`Invalid spec entry: missing required fields (name, data.name, data.target_language, data.functions)`);
        continue;
      }

      // Check for existing spec with same name
      const existing = store.getSpecByName(entry.name);
      if (existing && !overwrite) {
        skipped.push(entry.name);
        continue;
      }

      const record = store.saveSpec(entry.name, entry.data, existing && overwrite ? existing.id : undefined);
      imported.push(record.id);
    }

    return successResponse({
      imported: imported.length,
      skipped: skipped.length,
      errors: errors.length,
      imported_ids: imported,
      skipped_names: skipped,
      error_details: errors.length > 0 ? errors : undefined,
      message: `Imported ${imported.length} spec(s), skipped ${skipped.length}, errors ${errors.length}`,
    });
  })
  .register("zen_spec_generate", async (args) => {
    const id = a.string(args, "id");
    const langOverride = a.stringOptional(args, "target_language") as SpecTargetLanguage | undefined;

    if (!id) return errorResponse("id is required");

    const store = getStore();
    const record = store.getSpec(id);
    if (!record) return errorResponse(`Spec "${id}" not found`);

    // Apply language override if provided
    const specData = { ...record.data };
    if (langOverride) {
      specData.target_language = langOverride;
    }

    // Generate the prompt
    const prompt = generateSpecPrompt(specData);
    const langCfg = getLangConfig(specData.target_language);

    // Update status
    store.updateStatus(id, "generating");

    return successResponse({
      spec_id: record.id,
      spec_name: record.name,
      target_language: specData.target_language,
      test_framework: langCfg.testFramework,
      property_test_lib: langCfg.propertyTestLib,
      prompt,
      instructions: [
        `Use the prompt above to generate ${specData.target_language} code.`,
        `Implement all ${specData.functions.length} function(s) with their contracts.`,
        specData.properties?.length
          ? `Write ${specData.properties.length} property-based test(s) using ${langCfg.propertyTestLib}.`
          : null,
        `After generating, call zen_spec_save with the generated code to save it, or use zen_spec_get to review.`,
      ].filter(Boolean).join("\n"),
    });
  });

export const specModule = createModule(tools, dispatcher);
