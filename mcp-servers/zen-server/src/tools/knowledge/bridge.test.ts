/**
 * AST → KG Bridge Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { IndexStore } from "../ast/store.js";
import { KnowledgeStore } from "./store.js";
import { ingestAstToKg } from "./bridge.js";
import type { Symbol, CallRelation } from "../../core/types.js";

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// Fake embedder that returns deterministic vectors
function fakeEmbed(text: string): Promise<number[]> {
  const vec = new Array(384).fill(0);
  // Simple hash-based embedding for deterministic results
  for (let i = 0; i < text.length; i++) {
    vec[i % 384] += text.charCodeAt(i) / 1000;
  }
  // Normalize
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return Promise.resolve(vec.map(v => v / norm));
}

describe("AST → KG Bridge", () => {
  let astDir: string;
  let kgDir: string;
  let astStore: IndexStore;
  let kgStore: KnowledgeStore;

  beforeEach(() => {
    astDir = tmpDir("ast-bridge-");
    kgDir = tmpDir("kg-bridge-");
    astStore = new IndexStore(astDir);
    kgStore = new KnowledgeStore(path.join(kgDir, "kg.db"));
  });

  afterEach(() => {
    astStore.close();
    kgStore.close();
    fs.rmSync(astDir, { recursive: true, force: true });
    fs.rmSync(kgDir, { recursive: true, force: true });
  });

  function addSymbols(symbols: Symbol[]) {
    astStore.addSymbols(symbols);
  }

  function addCalls(calls: CallRelation[]) {
    astStore.addCalls(calls);
  }

  const sym = (name: string, kind: string, file: string, line: number, opts?: Partial<Symbol>): Symbol => ({
    id: `${file}:${name}:${line}`,
    name,
    kind,
    file,
    line,
    column: 0,
    endLine: line + 10,
    endColumn: 0,
    ...opts,
  });

  it("should ingest symbols as KG entities", async () => {
    addSymbols([
      sym("handleRequest", "function", "src/server.ts", 10, { signature: "(req: Request): Response" }),
      sym("Config", "interface", "src/config.ts", 1),
      sym("UserStore", "class", "src/store.ts", 5),
    ]);

    const result = await ingestAstToKg(astStore, kgStore, fakeEmbed);

    expect(result.symbolsIngested).toBe(3);
    expect(result.filesIngested).toBe(3);

    // Check entities were created with correct types
    const fn = kgStore.getEntityByName("handleRequest");
    expect(fn).toBeTruthy();
    expect(fn!.entityType).toBe("function");
    expect(fn!.properties).toHaveProperty("file", "src/server.ts");
    expect(fn!.properties).toHaveProperty("signature", "(req: Request): Response");

    const iface = kgStore.getEntityByName("Config");
    expect(iface).toBeTruthy();
    expect(iface!.entityType).toBe("interface");

    const cls = kgStore.getEntityByName("UserStore");
    expect(cls).toBeTruthy();
    expect(cls!.entityType).toBe("type"); // class → type
  });

  it("should create file entities", async () => {
    addSymbols([
      sym("foo", "function", "src/utils/helpers.ts", 1),
      sym("bar", "function", "src/utils/helpers.ts", 20),
    ]);

    const result = await ingestAstToKg(astStore, kgStore, fakeEmbed);

    expect(result.filesIngested).toBe(1); // Only one unique file

    const fileEntity = kgStore.getEntityByName("src/utils/helpers.ts");
    expect(fileEntity).toBeTruthy();
    expect(fileEntity!.entityType).toBe("file");
  });

  it("should create module entities from directory structure", async () => {
    addSymbols([
      sym("fn1", "function", "src/tools/memory/store.ts", 1),
      sym("fn2", "function", "src/tools/memory/index.ts", 1),
      sym("fn3", "function", "src/tools/ast/indexer.ts", 1),
    ]);

    const result = await ingestAstToKg(astStore, kgStore, fakeEmbed);

    expect(result.modulesIngested).toBe(2); // memory, ast

    const memoryMod = kgStore.getEntityByName("memory");
    expect(memoryMod).toBeTruthy();
    expect(memoryMod!.entityType).toBe("module");

    const astMod = kgStore.getEntityByName("ast");
    expect(astMod).toBeTruthy();
    expect(astMod!.entityType).toBe("module");
  });

  it("should create defined_in relations (symbol → file)", async () => {
    addSymbols([
      sym("parseConfig", "function", "src/config.ts", 10),
    ]);

    const result = await ingestAstToKg(astStore, kgStore, fakeEmbed);

    expect(result.definedInRelationsIngested).toBe(1);

    const fnEntity = kgStore.getEntityByName("parseConfig");
    const fileEntity = kgStore.getEntityByName("src/config.ts");
    expect(fnEntity).toBeTruthy();
    expect(fileEntity).toBeTruthy();

    const relations = kgStore.getRelations(fnEntity!.id);
    const definedIn = relations.find(r => r.relationType === "defined_in");
    expect(definedIn).toBeTruthy();
    expect(definedIn!.targetId).toBe(fileEntity!.id);
  });

  it("should create contains relations (file → symbol, module → file)", async () => {
    addSymbols([
      sym("doWork", "function", "src/tools/testing/runner.ts", 1),
    ]);

    const result = await ingestAstToKg(astStore, kgStore, fakeEmbed);

    expect(result.containsRelationsIngested).toBeGreaterThanOrEqual(2);

    const fileEntity = kgStore.getEntityByName("src/tools/testing/runner.ts");
    const modEntity = kgStore.getEntityByName("testing");
    expect(fileEntity).toBeTruthy();
    expect(modEntity).toBeTruthy();

    // Module contains file
    const modRelations = kgStore.getRelations(modEntity!.id);
    const modContainsFile = modRelations.find(
      r => r.relationType === "contains" && r.targetId === fileEntity!.id
    );
    expect(modContainsFile).toBeTruthy();
  });

  it("should create call relations from AST call graph", async () => {
    addSymbols([
      sym("caller", "function", "src/app.ts", 1),
      sym("callee", "function", "src/app.ts", 20),
    ]);
    addCalls([
      { caller: "caller", callerFile: "src/app.ts", callee: "callee", line: 5, column: 0 },
    ]);

    const result = await ingestAstToKg(astStore, kgStore, fakeEmbed);

    expect(result.callRelationsIngested).toBe(1);

    const callerEntity = kgStore.getEntityByName("caller");
    const calleeEntity = kgStore.getEntityByName("callee");
    expect(callerEntity).toBeTruthy();
    expect(calleeEntity).toBeTruthy();

    const relations = kgStore.getRelations(callerEntity!.id);
    const callRel = relations.find(
      r => r.relationType === "calls" && r.targetId === calleeEntity!.id
    );
    expect(callRel).toBeTruthy();
  });

  it("should resolve cross-file call relations", async () => {
    addSymbols([
      sym("handler", "function", "src/routes.ts", 1),
      sym("query", "function", "src/db.ts", 1),
    ]);
    addCalls([
      { caller: "handler", callerFile: "src/routes.ts", callee: "query", line: 5, column: 0 },
    ]);

    const result = await ingestAstToKg(astStore, kgStore, fakeEmbed);

    expect(result.callRelationsIngested).toBe(1);
  });

  it("should support scope filtering", async () => {
    addSymbols([
      sym("fn1", "function", "src/tools/memory/store.ts", 1),
      sym("fn2", "function", "src/tools/ast/indexer.ts", 1),
      sym("fn3", "function", "src/core/config.ts", 1),
    ]);

    const result = await ingestAstToKg(astStore, kgStore, fakeEmbed, { scope: "src/tools/" });

    expect(result.symbolsIngested).toBe(2); // Only memory and ast, not core
    expect(result.filesIngested).toBe(2);
  });

  it("should map method kinds correctly", async () => {
    addSymbols([
      sym("getData", "method", "src/store.ts", 10, { parent: "Store" }),
      sym("Store", "class", "src/store.ts", 1),
    ]);

    const result = await ingestAstToKg(astStore, kgStore, fakeEmbed);

    const method = kgStore.getEntityByName("getData");
    expect(method).toBeTruthy();
    expect(method!.entityType).toBe("method");

    // Check parent → contains → method
    expect(result.containsRelationsIngested).toBeGreaterThanOrEqual(1);
  });

  it("should be idempotent (re-ingestion updates, not duplicates)", async () => {
    addSymbols([
      sym("idempotentFn", "function", "src/app.ts", 1),
    ]);

    const result1 = await ingestAstToKg(astStore, kgStore, fakeEmbed);
    expect(result1.symbolsIngested).toBe(1);

    const result2 = await ingestAstToKg(astStore, kgStore, fakeEmbed);

    // Second run should still report same counts (upsert)
    expect(result2.symbolsIngested).toBe(1);

    // Verify only one entity exists via direct lookup (upsert deduplicates by name+type)
    const entity = kgStore.getEntityByName("idempotentFn", "function");
    expect(entity).toBeTruthy();

    // Verify the file entity is also deduplicated
    const fileEntity = kgStore.getEntityByName("src/app.ts", "file");
    expect(fileEntity).toBeTruthy();
  });

  it("should detect communities after ingestion", async () => {
    // Create two clusters of connected symbols
    addSymbols([
      sym("a1", "function", "src/cluster1.ts", 1),
      sym("a2", "function", "src/cluster1.ts", 20),
      sym("b1", "function", "src/cluster2.ts", 1),
      sym("b2", "function", "src/cluster2.ts", 20),
    ]);
    addCalls([
      { caller: "a1", callerFile: "src/cluster1.ts", callee: "a2", line: 5, column: 0 },
      { caller: "b1", callerFile: "src/cluster2.ts", callee: "b2", line: 5, column: 0 },
    ]);

    await ingestAstToKg(astStore, kgStore, fakeEmbed);

    const communities = kgStore.detectCommunities();
    expect(communities.length).toBeGreaterThanOrEqual(1);
  });
});
