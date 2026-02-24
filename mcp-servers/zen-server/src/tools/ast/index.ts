/**
 * AST Index Tools
 * Provides code intelligence through AST analysis
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { SupportedLanguage } from "../../core/types.js";
import { successResponse, errorResponse, args as a } from "../../utils/responses.js";
import { createDispatcher, createModule } from "../../core/dispatcher.js";
import { config } from "../../core/config.js";
import { createLazyLoader } from "../../utils/lazy.js";
import { ASTIndexer } from "./indexer.js";
import { IndexStore } from "./store.js";

const getStore = createLazyLoader(() => new IndexStore(config().indexPath));
const getIndexer = createLazyLoader(() => new ASTIndexer(config().projectRoot, getStore()));

export const tools: Tool[] = [
  {
    name: "index_project",
    description: "Build or rebuild the AST index for the project",
    inputSchema: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          description: "Specific paths to index (default: entire project)",
        },
        languages: {
          type: "array",
          items: { type: "string" },
          description:
            "Filter by language (typescript, javascript, python, go, rust, java, c)",
        },
        incremental: {
          type: "boolean",
          description: "Only index changed files (default: true)",
          default: true,
        },
      },
    },
  },
  {
    name: "find_symbol",
    description: "Find a symbol by name with fuzzy matching",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Symbol name to search for",
        },
        kind: {
          type: "string",
          enum: [
            "function",
            "class",
            "method",
            "variable",
            "interface",
            "type",
            "constant",
          ],
          description: "Filter by symbol kind",
        },
        limit: {
          type: "number",
          description: "Maximum results to return (default: 10)",
          default: 10,
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_symbol_info",
    description: "Get detailed information about a specific symbol",
    inputSchema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          description: "File path containing the symbol",
        },
        symbol: {
          type: "string",
          description: "Symbol name",
        },
        includeBody: {
          type: "boolean",
          description: "Include the symbol's source code",
          default: false,
        },
      },
      required: ["file", "symbol"],
    },
  },
  {
    name: "find_references",
    description: "Find all references to a symbol",
    inputSchema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          description: "File path containing the symbol definition",
        },
        symbol: {
          type: "string",
          description: "Symbol name to find references for",
        },
        includeDefinition: {
          type: "boolean",
          description: "Include the definition in results",
          default: false,
        },
      },
      required: ["file", "symbol"],
    },
  },
  {
    name: "get_call_graph",
    description: "Get the call graph for a function or method",
    inputSchema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          description: "File path containing the function",
        },
        symbol: {
          type: "string",
          description: "Function/method name",
        },
        depth: {
          type: "number",
          description: "How deep to traverse the call graph (default: 2)",
          default: 2,
        },
        direction: {
          type: "string",
          enum: ["callers", "callees", "both"],
          description: "Direction to traverse (default: both)",
          default: "both",
        },
      },
      required: ["file", "symbol"],
    },
  },
  {
    name: "find_implementations",
    description: "Find implementations of an interface or abstract class",
    inputSchema: {
      type: "object",
      properties: {
        interface: {
          type: "string",
          description: "Interface or abstract class name",
        },
        file: {
          type: "string",
          description:
            "File containing the interface (optional, helps disambiguate)",
        },
      },
      required: ["interface"],
    },
  },
  {
    name: "get_file_symbols",
    description: "Get all symbols defined in a file",
    inputSchema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          description: "File path to get symbols from",
        },
        depth: {
          type: "number",
          description: "Nesting depth to include (default: 1 for top-level only)",
          default: 1,
        },
      },
      required: ["file"],
    },
  },
  {
    name: "search_by_signature",
    description: "Search for functions/methods by their signature pattern",
    inputSchema: {
      type: "object",
      properties: {
        params: {
          type: "array",
          items: { type: "string" },
          description: "Parameter types to match (e.g., ['string', 'number'])",
        },
        returnType: {
          type: "string",
          description: "Return type to match",
        },
        limit: {
          type: "number",
          description: "Maximum results (default: 10)",
          default: 10,
        },
      },
    },
  },
];

const dispatcher = createDispatcher();

dispatcher
  .registerVeryLong("index_project", async (args) => {
    const result = await getIndexer().indexProject({
      paths: a.array<string>(args, "paths"),
      languages: a.array<SupportedLanguage>(args, "languages"),
      incremental: a.boolean(args, "incremental", true),
    });
    return successResponse(result);
  })
  .registerQuick("find_symbol", async (args) => {
    const symbols = getStore().findSymbol({
      query: a.string(args, "query"),
      kind: a.stringOptional(args, "kind"),
      limit: a.number(args, "limit", 10),
    });
    return successResponse(symbols);
  })
  .registerQuick("get_symbol_info", async (args) => {
    const info = getStore().getSymbolInfo({
      file: a.string(args, "file"),
      symbol: a.string(args, "symbol"),
      includeBody: a.boolean(args, "includeBody", false),
      projectRoot: config().projectRoot,
    });
    return successResponse(info);
  })
  .registerQuick("find_references", async (args) => {
    const refs = getStore().findReferences({
      file: a.string(args, "file"),
      symbol: a.string(args, "symbol"),
      includeDefinition: a.boolean(args, "includeDefinition", false),
    });
    return successResponse(refs);
  })
  .registerQuick("get_call_graph", async (args) => {
    const graph = getStore().getCallGraph({
      file: a.string(args, "file"),
      symbol: a.string(args, "symbol"),
      depth: a.number(args, "depth", 2),
      direction: (a.stringOptional(args, "direction") as "callers" | "callees" | "both") ?? "both",
    });
    return successResponse(graph);
  })
  .registerQuick("find_implementations", async (args) => {
    const impls = getStore().findImplementations({
      interface: a.string(args, "interface"),
      file: a.stringOptional(args, "file"),
    });
    return successResponse(impls);
  })
  .registerQuick("get_file_symbols", async (args) => {
    const symbols = getStore().getFileSymbols({
      file: a.string(args, "file"),
      depth: a.number(args, "depth", 1),
    });
    return successResponse(symbols);
  })
  .registerQuick("search_by_signature", async (args) => {
    const matches = getStore().searchBySignature({
      params: a.array<string>(args, "params"),
      returnType: a.stringOptional(args, "returnType"),
      limit: a.number(args, "limit", 10),
    });
    return successResponse(matches);
  });

export const astModule = createModule(tools, dispatcher);
