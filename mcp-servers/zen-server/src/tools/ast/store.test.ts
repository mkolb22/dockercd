/**
 * IndexStore Tests
 * Tests for AST index store: symbols, references, calls, metadata
 */

import { describe, it, expect } from 'vitest';
import { IndexStore } from './store.js';
import { useStoreDirHarness } from '../../test-utils/store-harness.js';
import type { Symbol, Reference, CallRelation } from '../../core/types.js';

function makeSymbol(overrides: Partial<Symbol> = {}): Symbol {
  return {
    id: `sym-${Math.random().toString(36).slice(2, 6)}`,
    name: 'testFunc',
    kind: 'function',
    file: 'src/index.ts',
    line: 1,
    column: 0,
    endLine: 10,
    endColumn: 1,
    ...overrides,
  };
}

describe('IndexStore', () => {
  const t = useStoreDirHarness('ast-index', (dir) => new IndexStore(dir));

  describe('addSymbols + findSymbol', () => {
    it('should insert and find symbols by name', () => {
      t.store.addSymbols([
        makeSymbol({ id: 's1', name: 'createUser', kind: 'function', file: 'src/users.ts' }),
        makeSymbol({ id: 's2', name: 'deleteUser', kind: 'function', file: 'src/users.ts' }),
        makeSymbol({ id: 's3', name: 'UserService', kind: 'class', file: 'src/users.ts' }),
      ]);

      const results = t.store.findSymbol({ query: 'User' });
      expect(results.length).toBeGreaterThanOrEqual(3);
    });

    it('should find exact matches first', () => {
      t.store.addSymbols([
        makeSymbol({ id: 's1', name: 'connect', kind: 'function' }),
        makeSymbol({ id: 's2', name: 'connectToDb', kind: 'function' }),
        makeSymbol({ id: 's3', name: 'disconnectAll', kind: 'function' }),
      ]);

      const results = t.store.findSymbol({ query: 'connect' });
      expect(results[0].name).toBe('connect');
    });

    it('should filter by kind', () => {
      t.store.addSymbols([
        makeSymbol({ id: 's1', name: 'Logger', kind: 'class' }),
        makeSymbol({ id: 's2', name: 'createLogger', kind: 'function' }),
      ]);

      const classes = t.store.findSymbol({ query: 'Logger', kind: 'class' });
      expect(classes).toHaveLength(1);
      expect(classes[0].kind).toBe('class');
    });

    it('should respect limit', () => {
      t.store.addSymbols(
        Array.from({ length: 20 }, (_, i) =>
          makeSymbol({ id: `s${i}`, name: `func${i}`, kind: 'function' }),
        ),
      );

      const limited = t.store.findSymbol({ query: 'func', limit: 5 });
      expect(limited).toHaveLength(5);
    });
  });

  describe('getSymbolInfo', () => {
    it('should return symbol by file and name', () => {
      t.store.addSymbols([
        makeSymbol({ id: 's1', name: 'handleRequest', file: 'src/api.ts', line: 42, signature: '(req: Request): Response' }),
      ]);

      const info = t.store.getSymbolInfo({ file: 'src/api.ts', symbol: 'handleRequest' });
      expect(info).not.toBeNull();
      expect(info!.name).toBe('handleRequest');
      expect(info!.line).toBe(42);
      expect(info!.signature).toBe('(req: Request): Response');
    });

    it('should return null for nonexistent symbol', () => {
      const info = t.store.getSymbolInfo({ file: 'src/api.ts', symbol: 'nonexistent' });
      expect(info).toBeNull();
    });
  });

  describe('addReferences + findReferences', () => {
    it('should round-trip references', () => {
      const refs: Reference[] = [
        { symbolName: 'fetch', file: 'src/api.ts', line: 10, column: 5, context: 'const data = fetch(url)' },
        { symbolName: 'fetch', file: 'src/utils.ts', line: 20, column: 3, context: 'return fetch(endpoint)' },
        { symbolName: 'fetch', file: 'src/lib.ts', line: 5, column: 0, context: 'export { fetch }' },
      ];
      t.store.addReferences(refs);

      // Definition file is src/lib.ts; without includeDefinition, it's excluded
      const results = t.store.findReferences({ file: 'src/lib.ts', symbol: 'fetch' });
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.file !== 'src/lib.ts')).toBe(true);
    });

    it('should include definition when requested', () => {
      const refs: Reference[] = [
        { symbolName: 'log', file: 'src/logger.ts', line: 1, column: 0, context: 'export function log()' },
        { symbolName: 'log', file: 'src/app.ts', line: 5, column: 2, context: 'log("hello")' },
      ];
      t.store.addReferences(refs);

      const results = t.store.findReferences({ file: 'src/logger.ts', symbol: 'log', includeDefinition: true });
      expect(results).toHaveLength(2);
    });
  });

  describe('addCalls + getCallGraph', () => {
    it('should return callers', () => {
      const calls: CallRelation[] = [
        { caller: 'main', callerFile: 'src/index.ts', callee: 'handleRequest', line: 5, column: 2 },
        { caller: 'router', callerFile: 'src/router.ts', callee: 'handleRequest', line: 10, column: 4 },
      ];
      t.store.addCalls(calls);

      const graph = t.store.getCallGraph({
        file: 'src/api.ts',
        symbol: 'handleRequest',
        depth: 1,
        direction: 'callers',
      });
      expect(graph.callers).toHaveLength(2);
      expect(graph.callees).toHaveLength(0);
      expect(graph.callers[0].name).toBe('main');
    });

    it('should return callees', () => {
      const calls: CallRelation[] = [
        { caller: 'processData', callerFile: 'src/processor.ts', callee: 'validate', line: 5, column: 2 },
        { caller: 'processData', callerFile: 'src/processor.ts', callee: 'transform', line: 6, column: 2 },
      ];
      t.store.addCalls(calls);

      const graph = t.store.getCallGraph({
        file: 'src/processor.ts',
        symbol: 'processData',
        depth: 1,
        direction: 'callees',
      });
      expect(graph.callees).toHaveLength(2);
      expect(graph.callers).toHaveLength(0);
    });

    it('should return both callers and callees', () => {
      const calls: CallRelation[] = [
        { caller: 'main', callerFile: 'src/index.ts', callee: 'process', line: 5, column: 2 },
        { caller: 'process', callerFile: 'src/proc.ts', callee: 'save', line: 10, column: 4 },
      ];
      t.store.addCalls(calls);

      const graph = t.store.getCallGraph({
        file: 'src/proc.ts',
        symbol: 'process',
        depth: 1,
        direction: 'both',
      });
      expect(graph.callers).toHaveLength(1);
      expect(graph.callees).toHaveLength(1);
    });
  });

  describe('findImplementations', () => {
    it('should find classes implementing an interface', () => {
      t.store.addSymbols([
        makeSymbol({ id: 's1', name: 'UserRepo', kind: 'class', signature: 'class UserRepo implements Repository' }),
        makeSymbol({ id: 's2', name: 'PostRepo', kind: 'class', signature: 'class PostRepo extends BaseRepo implements Repository' }),
        makeSymbol({ id: 's3', name: 'Logger', kind: 'class', signature: 'class Logger' }),
      ]);

      const impls = t.store.findImplementations({ interface: 'Repository' });
      expect(impls).toHaveLength(2);
      expect(impls.map((s) => s.name).sort()).toEqual(['PostRepo', 'UserRepo']);
    });

    it('should find classes extending a base class', () => {
      t.store.addSymbols([
        makeSymbol({ id: 's1', name: 'SqlStore', kind: 'class', signature: 'class SqlStore extends BaseStore' }),
      ]);

      const impls = t.store.findImplementations({ interface: 'BaseStore' });
      expect(impls).toHaveLength(1);
      expect(impls[0].name).toBe('SqlStore');
    });
  });

  describe('getFileSymbols', () => {
    it('should return all symbols in a file', () => {
      t.store.addSymbols([
        makeSymbol({ id: 's1', name: 'MyClass', kind: 'class', file: 'src/main.ts', line: 1 }),
        makeSymbol({ id: 's2', name: 'myMethod', kind: 'method', file: 'src/main.ts', line: 5, parent: 'MyClass' }),
        makeSymbol({ id: 's3', name: 'helperFn', kind: 'function', file: 'src/main.ts', line: 20 }),
        makeSymbol({ id: 's4', name: 'otherFile', kind: 'function', file: 'src/other.ts', line: 1 }),
      ]);

      const all = t.store.getFileSymbols({ file: 'src/main.ts', depth: 0 });
      expect(all).toHaveLength(3);
    });

    it('should filter to top-level only with depth=1', () => {
      t.store.addSymbols([
        makeSymbol({ id: 's1', name: 'MyClass', kind: 'class', file: 'src/main.ts', line: 1 }),
        makeSymbol({ id: 's2', name: 'myMethod', kind: 'method', file: 'src/main.ts', line: 5, parent: 'MyClass' }),
        makeSymbol({ id: 's3', name: 'helperFn', kind: 'function', file: 'src/main.ts', line: 20 }),
      ]);

      const topLevel = t.store.getFileSymbols({ file: 'src/main.ts', depth: 1 });
      expect(topLevel).toHaveLength(2);
      expect(topLevel.every((s) => !s.parent)).toBe(true);
    });
  });

  describe('searchBySignature', () => {
    it('should find functions by param types', () => {
      t.store.addSymbols([
        makeSymbol({ id: 's1', name: 'add', kind: 'function', signature: '(a: number, b: number): number' }),
        makeSymbol({ id: 's2', name: 'greet', kind: 'function', signature: '(name: string): string' }),
        makeSymbol({ id: 's3', name: 'MyClass', kind: 'class', signature: 'class MyClass' }),
      ]);

      const results = t.store.searchBySignature({ params: ['number'] });
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('add');
    });

    it('should find functions by return type', () => {
      t.store.addSymbols([
        makeSymbol({ id: 's1', name: 'getCount', kind: 'function', signature: '(): number' }),
        makeSymbol({ id: 's2', name: 'getName', kind: 'function', signature: '(): string' }),
      ]);

      const results = t.store.searchBySignature({ returnType: 'string' });
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('getName');
    });

    it('should combine param and return type filters', () => {
      t.store.addSymbols([
        makeSymbol({ id: 's1', name: 'parse', kind: 'function', signature: '(input: string): number' }),
        makeSymbol({ id: 's2', name: 'format', kind: 'function', signature: '(input: string): string' }),
      ]);

      const results = t.store.searchBySignature({ params: ['string'], returnType: 'number' });
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('parse');
    });
  });

  describe('getMetadata + updateMetadata', () => {
    it('should return empty metadata initially', () => {
      const meta = t.store.getMetadata();
      expect(meta.lastUpdate).toBe('');
      expect(meta.totalFiles).toBe(0);
      expect(meta.totalSymbols).toBe(0);
      expect(meta.fileHashes).toEqual({});
    });

    it('should round-trip metadata', () => {
      t.store.updateMetadata({
        lastUpdate: '2026-01-01T00:00:00Z',
        totalFiles: 42,
        totalSymbols: 500,
        fileHashes: { 'src/index.ts': 'abc123', 'src/app.ts': 'def456' },
      });

      const meta = t.store.getMetadata();
      expect(meta.lastUpdate).toBe('2026-01-01T00:00:00Z');
      expect(meta.totalFiles).toBe(42);
      expect(meta.totalSymbols).toBe(500);
      expect(meta.fileHashes['src/index.ts']).toBe('abc123');
    });

    it('should allow partial updates', () => {
      t.store.updateMetadata({ totalFiles: 10 });
      t.store.updateMetadata({ totalSymbols: 100 });

      const meta = t.store.getMetadata();
      expect(meta.totalFiles).toBe(10);
      expect(meta.totalSymbols).toBe(100);
    });
  });

  describe('clearIndex', () => {
    it('should empty all tables', () => {
      t.store.addSymbols([makeSymbol({ id: 's1' })]);
      t.store.addReferences([{ symbolName: 'test', file: 'a.ts', line: 1, column: 0, context: 'test' }]);
      t.store.addCalls([{ caller: 'a', callerFile: 'a.ts', callee: 'b', line: 1, column: 0 }]);
      t.store.updateMetadata({ totalFiles: 5 });

      t.store.clearIndex();

      expect(t.store.findSymbol({ query: 'test' })).toHaveLength(0);
      expect(t.store.getMetadata().totalFiles).toBe(0);
    });
  });
});
