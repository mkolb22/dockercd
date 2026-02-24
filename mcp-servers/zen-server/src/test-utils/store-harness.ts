/**
 * Shared test harness for SQLite store tests.
 * Handles temp DB creation and teardown (including WAL/SHM cleanup).
 *
 * Registers beforeEach/afterEach hooks in the current describe scope.
 * Returns a ref object whose `.store` and `.dbPath` properties are
 * updated before each test, so tests access them via the ref.
 */

import { beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Sets up temporary SQLite database lifecycle for store tests.
 * Call inside a describe() block.
 *
 * Usage:
 *   describe('MyStore', () => {
 *     const t = useStoreHarness('my', (p) => new MyStore(p));
 *     it('works', () => { t.store.doSomething(); });
 *   });
 */
export function useStoreHarness<T extends { close(): void }>(
  prefix: string,
  factory: (dbPath: string) => T
) {
  const ref: { store: T; dbPath: string } = {} as any;

  beforeEach(() => {
    ref.dbPath = path.join(
      os.tmpdir(),
      `${prefix}-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.db`
    );
    ref.store = factory(ref.dbPath);
  });

  afterEach(() => {
    ref.store.close();
    for (const suffix of ['', '-wal', '-shm']) {
      const p = ref.dbPath + suffix;
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  });

  return ref;
}

/**
 * Sets up a temporary directory with SQLite database for store tests.
 * For stores that require a directory (like StateStore).
 *
 * Usage:
 *   describe('StateStore', () => {
 *     const t = useStoreDirHarness('state', (dir) => new StateStore(path.join(dir, 'state.db')));
 *     it('works', () => { t.store.doSomething(); });
 *   });
 */
export function useStoreDirHarness<T extends { close(): void }>(
  prefix: string,
  factory: (tmpDir: string) => T
) {
  const ref: { store: T; tmpDir: string } = {} as any;

  beforeEach(() => {
    ref.tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-test-`));
    ref.store = factory(ref.tmpDir);
  });

  afterEach(() => {
    ref.store.close();
    fs.rmSync(ref.tmpDir, { recursive: true, force: true });
  });

  return ref;
}
