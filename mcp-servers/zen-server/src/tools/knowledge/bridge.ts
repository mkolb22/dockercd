/**
 * AST → Knowledge Graph Bridge
 * Reads structural data from AST index and populates the knowledge graph
 * with entities (symbols, files, modules) and relations (calls, contains, defined_in)
 */

import * as path from "path";
import type { Symbol, CallRelation } from "../../core/types.js";
import type { EntityType, RelationType } from "./types.js";
import type { KnowledgeStore } from "./store.js";
import { IndexStore } from "../ast/store.js";

/** Map AST symbol kinds to KG entity types */
function mapSymbolKind(kind: string): EntityType {
  switch (kind) {
    case "function": return "function";
    case "method": return "method";
    case "class": return "type";
    case "interface": return "interface";
    case "type": return "type";
    case "variable": return "variable";
    case "constant": return "variable";
    default: return "concept";
  }
}

/** Build a description from symbol metadata */
function symbolDescription(sym: Symbol): string {
  const parts: string[] = [];
  parts.push(`${sym.kind} in ${sym.file}:${sym.line}`);
  if (sym.signature) parts.push(`signature: ${sym.signature}`);
  if (sym.docstring) parts.push(sym.docstring.slice(0, 200));
  return parts.join(" — ");
}

/** Derive module name from file path (e.g. "src/tools/memory/store.ts" → "memory") */
function deriveModuleName(filePath: string): string {
  const parts = filePath.split("/");
  // Pattern: src/tools/<module>/... → use <module>
  const toolsIdx = parts.indexOf("tools");
  if (toolsIdx >= 0 && toolsIdx + 1 < parts.length) {
    return parts[toolsIdx + 1];
  }
  // Pattern: src/utils/... → "utils"
  const utilsIdx = parts.indexOf("utils");
  if (utilsIdx >= 0) return "utils";
  // Pattern: src/core/... → "core"
  const coreIdx = parts.indexOf("core");
  if (coreIdx >= 0) return "core";
  // Fallback: directory name of the file
  return parts.length >= 2 ? parts[parts.length - 2] : "root";
}

export interface BridgeResult {
  filesProcessed: number;
  symbolsIngested: number;
  filesIngested: number;
  modulesIngested: number;
  callRelationsIngested: number;
  containsRelationsIngested: number;
  definedInRelationsIngested: number;
}

/**
 * Ingest AST index data into the knowledge graph.
 *
 * Creates entities for:
 * - Every symbol (function, class, method, interface, type, variable)
 * - Every indexed file
 * - Every derived module (directory grouping)
 *
 * Creates relations for:
 * - calls: function A calls function B (from AST call graph)
 * - contains: file contains symbol
 * - defined_in: symbol defined in file
 * - contains: module contains file
 */
export function ingestAstToKg(
  astStore: IndexStore,
  kgStore: KnowledgeStore,
  embedFn: (text: string) => Promise<number[]>,
  options: { scope?: string } = {}
): Promise<BridgeResult> {
  return ingestAstToKgAsync(astStore, kgStore, embedFn, options);
}

async function ingestAstToKgAsync(
  astStore: IndexStore,
  kgStore: KnowledgeStore,
  embedFn: (text: string) => Promise<number[]>,
  options: { scope?: string }
): Promise<BridgeResult> {
  const result: BridgeResult = {
    filesProcessed: 0,
    symbolsIngested: 0,
    filesIngested: 0,
    modulesIngested: 0,
    callRelationsIngested: 0,
    containsRelationsIngested: 0,
    definedInRelationsIngested: 0,
  };

  // Track entity IDs for relation creation
  const symbolEntityIds = new Map<string, string>(); // "name:file" → entityId
  const fileEntityIds = new Map<string, string>();    // filePath → entityId
  const moduleEntityIds = new Map<string, string>();  // moduleName → entityId

  // 1. Get all symbols from AST index
  const allSymbols = astStore.getAllSymbols();
  const symbols = options.scope
    ? allSymbols.filter(s => s.file.startsWith(options.scope!))
    : allSymbols;

  // 2. Get all indexed files
  const allFiles = astStore.getIndexedFiles();
  const files = options.scope
    ? allFiles.filter(f => f.startsWith(options.scope!))
    : allFiles;

  // 3. Create file entities
  for (const filePath of files) {
    const fileName = path.basename(filePath);
    const id = kgStore.upsertEntity({
      name: filePath,
      entityType: "file",
      description: `Source file: ${filePath}`,
      properties: { path: filePath, basename: fileName },
    });
    fileEntityIds.set(filePath, id);

    const embedding = await embedFn(`file ${fileName} ${filePath}`);
    kgStore.insertEmbedding(id, embedding);

    result.filesIngested++;
  }

  // 4. Create module entities (derived from file paths)
  const moduleFiles = new Map<string, string[]>(); // moduleName → file paths
  for (const filePath of files) {
    const moduleName = deriveModuleName(filePath);
    if (!moduleFiles.has(moduleName)) {
      moduleFiles.set(moduleName, []);
    }
    moduleFiles.get(moduleName)!.push(filePath);
  }

  for (const [moduleName, memberFiles] of moduleFiles) {
    const id = kgStore.upsertEntity({
      name: moduleName,
      entityType: "module",
      description: `Module containing ${memberFiles.length} files`,
      properties: { fileCount: String(memberFiles.length) },
    });
    moduleEntityIds.set(moduleName, id);

    const embedding = await embedFn(`module ${moduleName}`);
    kgStore.insertEmbedding(id, embedding);

    result.modulesIngested++;

    // module → contains → file relations
    for (const filePath of memberFiles) {
      const fileId = fileEntityIds.get(filePath);
      if (fileId) {
        const relId = kgStore.insertRelation({
          sourceId: id,
          targetId: fileId,
          relationType: "contains",
          weight: 1.0,
          properties: {},
        });
        if (relId) result.containsRelationsIngested++;
      }
    }
  }

  // 5. Create symbol entities
  for (const sym of symbols) {
    const entityType = mapSymbolKind(sym.kind);
    const desc = symbolDescription(sym);
    const key = `${sym.name}:${sym.file}`;

    const id = kgStore.upsertEntity({
      name: sym.name,
      entityType,
      description: desc,
      properties: {
        file: sym.file,
        line: String(sym.line),
        kind: sym.kind,
        ...(sym.signature ? { signature: sym.signature } : {}),
        ...(sym.parent ? { parent: sym.parent } : {}),
      },
    });
    symbolEntityIds.set(key, id);

    const embedding = await embedFn(`${sym.kind} ${sym.name} ${sym.signature || ""} ${sym.docstring || ""}`);
    kgStore.insertEmbedding(id, embedding);

    result.symbolsIngested++;

    // symbol → defined_in → file
    const fileId = fileEntityIds.get(sym.file);
    if (fileId) {
      const relId = kgStore.insertRelation({
        sourceId: id,
        targetId: fileId,
        relationType: "defined_in",
        weight: 1.0,
        properties: {},
      });
      if (relId) result.definedInRelationsIngested++;
    }

    // file → contains → symbol
    if (fileId) {
      const relId = kgStore.insertRelation({
        sourceId: fileId,
        targetId: id,
        relationType: "contains",
        weight: 1.0,
        properties: {},
      });
      if (relId) result.containsRelationsIngested++;
    }

    // parent class → contains → method (for methods with a parent)
    if (sym.parent) {
      // Find the parent entity — look in same file first
      const parentKey = `${sym.parent}:${sym.file}`;
      const parentId = symbolEntityIds.get(parentKey);
      if (parentId) {
        const relId = kgStore.insertRelation({
          sourceId: parentId,
          targetId: id,
          relationType: "contains",
          weight: 1.0,
          properties: {},
        });
        if (relId) result.containsRelationsIngested++;
      }
    }
  }

  // 6. Create call relations from AST call graph
  const allCalls = astStore.getAllCalls();
  const calls = options.scope
    ? allCalls.filter(c => c.callerFile.startsWith(options.scope!))
    : allCalls;

  for (const call of calls) {
    // Resolve caller: look up by name+file
    const callerKey = `${call.caller}:${call.callerFile}`;
    const callerId = symbolEntityIds.get(callerKey);

    // Resolve callee: could be in any file, try name-only lookup
    // First try same file, then any file
    let calleeId: string | undefined;
    const calleeName = call.callee.includes(".") ? call.callee.split(".").pop()! : call.callee;

    // Try same file first
    const sameFileKey = `${calleeName}:${call.callerFile}`;
    calleeId = symbolEntityIds.get(sameFileKey);

    // If not found, try any file
    if (!calleeId) {
      for (const [key, id] of symbolEntityIds) {
        if (key.startsWith(`${calleeName}:`)) {
          calleeId = id;
          break;
        }
      }
    }

    // If not found, look up by name in the KG (may have been added previously)
    if (!calleeId) {
      const entity = kgStore.getEntityByName(calleeName);
      if (entity) calleeId = entity.id;
    }

    if (callerId && calleeId && callerId !== calleeId) {
      const relId = kgStore.insertRelation({
        sourceId: callerId,
        targetId: calleeId,
        relationType: "calls",
        weight: 1.0,
        properties: {},
      });
      if (relId) result.callRelationsIngested++;
    }
  }

  return result;
}
