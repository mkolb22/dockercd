/**
 * Repairer Tests
 * Tests for RepairStore CRUD operations and pure functions (selectStrategy, hashCode)
 */

import { describe, it, expect } from 'vitest';
import { RepairStore, selectStrategy, hashCode } from './repairer.js';
import { useStoreHarness } from '../../test-utils/store-harness.js';

describe('RepairStore', () => {
  const t = useStoreHarness('repair', (p) => new RepairStore(p));

  describe('recordAttempt', () => {
    it('should insert a repair attempt and return an ID', () => {
      const id = t.store.recordAttempt(
        'abc123', 'const x = 1 +', 'SyntaxError', 'Unexpected end of input',
        'syntax_error', 'Add missing operand', 1,
      );
      expect(id).toBeGreaterThan(0);
    });

    it('should store all fields correctly', () => {
      const id = t.store.recordAttempt(
        'hash1', 'let y: number = "oops"', 'TypeError', 'Type string not assignable',
        'type_error', 'Fix type annotation', 2,
      );

      const repairs = t.store.findSimilarRepairs('TypeError');
      // Not resolved yet, so shouldn't appear
      expect(repairs).toHaveLength(0);

      t.store.markResolved(id, 'let y: number = 42');
      const resolved = t.store.findSimilarRepairs('TypeError');
      expect(resolved).toHaveLength(1);
      expect(resolved[0].strategy).toBe('type_error');
      expect(resolved[0].fixedCode).toBe('let y: number = 42');
    });
  });

  describe('markResolved', () => {
    it('should mark a repair as resolved with fixed code', () => {
      const id = t.store.recordAttempt(
        'h1', 'bad code', 'SyntaxError', 'parse error',
        'syntax_error', 'fix it', 1,
      );

      t.store.markResolved(id, 'good code');
      const repairs = t.store.findSimilarRepairs('SyntaxError');
      expect(repairs).toHaveLength(1);
      expect(repairs[0].fixedCode).toBe('good code');
    });
  });

  describe('findSimilarRepairs', () => {
    it('should find repairs by errorType', () => {
      for (let i = 0; i < 3; i++) {
        const id = t.store.recordAttempt(
          `h${i}`, `code${i}`, 'ImportError', `Cannot find module_${i}`,
          'import_error', `Fix import ${i}`, 1,
        );
        t.store.markResolved(id, `fixed_${i}`);
      }
      // Add one with a different error type
      const otherId = t.store.recordAttempt('hx', 'codex', 'TypeError', 'wrong type', 'type_error', 'fix type', 1);
      t.store.markResolved(otherId, 'fixed_x');

      const importRepairs = t.store.findSimilarRepairs('ImportError');
      expect(importRepairs).toHaveLength(3);

      const typeRepairs = t.store.findSimilarRepairs('TypeError');
      expect(typeRepairs).toHaveLength(1);
    });

    it('should respect the limit parameter', () => {
      for (let i = 0; i < 5; i++) {
        const id = t.store.recordAttempt(
          `h${i}`, `code${i}`, 'RuntimeError', `err${i}`,
          'runtime_error', `fix${i}`, 1,
        );
        t.store.markResolved(id, `fixed${i}`);
      }

      const limited = t.store.findSimilarRepairs('RuntimeError', 2);
      expect(limited).toHaveLength(2);
    });

    it('should only return resolved repairs', () => {
      t.store.recordAttempt('h1', 'code1', 'SyntaxError', 'err1', 'syntax_error', 'fix1', 1);
      const repairs = t.store.findSimilarRepairs('SyntaxError');
      expect(repairs).toHaveLength(0);
    });
  });

  describe('addPattern + getRepairPattern', () => {
    it('should round-trip a pattern', () => {
      t.store.addPattern('missing_import_*', 'Add import statement for $1', 'typescript');

      const pattern = t.store.getRepairPattern('missing_import_*');
      expect(pattern).not.toBeNull();
      expect(pattern!.fixPattern).toBe('Add import statement for $1');
      // addPattern inserts with success_count=1, failure_count=0
      expect(pattern!.successRate).toBe(1);
    });

    it('should return null for unknown pattern', () => {
      const pattern = t.store.getRepairPattern('nonexistent');
      expect(pattern).toBeNull();
    });
  });

  describe('updatePatternOutcome', () => {
    it('should increment success count', () => {
      t.store.addPattern('err_pattern', 'fix_pattern', 'typescript');

      t.store.updatePatternOutcome('err_pattern', true);
      const pattern = t.store.getRepairPattern('err_pattern');
      // Started with success_count=1, now 2 successes, 0 failures
      expect(pattern!.successRate).toBe(1);
    });

    it('should increment failure count and adjust success rate', () => {
      t.store.addPattern('err_pattern', 'fix_pattern', 'typescript');

      t.store.updatePatternOutcome('err_pattern', false);
      const pattern = t.store.getRepairPattern('err_pattern');
      // 1 success (from addPattern) + 1 failure = 50%
      expect(pattern!.successRate).toBe(0.5);
    });

    it('should track mixed outcomes correctly', () => {
      t.store.addPattern('mixed_err', 'mixed_fix', 'python');
      // addPattern starts with success=1, failure=0
      t.store.updatePatternOutcome('mixed_err', true);  // success=2
      t.store.updatePatternOutcome('mixed_err', true);  // success=3
      t.store.updatePatternOutcome('mixed_err', false); // failure=1

      const pattern = t.store.getRepairPattern('mixed_err');
      expect(pattern!.successRate).toBe(3 / 4);
    });
  });
});

describe('selectStrategy', () => {
  it('should select type_error for TypeError', () => {
    const result = selectStrategy('TypeError', 'Cannot read property', 'typescript');
    expect(result.strategy).toBe('type_error');
  });

  it('should select syntax_error for SyntaxError', () => {
    const result = selectStrategy('SyntaxError', 'Unexpected token', 'javascript');
    expect(result.strategy).toBe('syntax_error');
  });

  it('should select syntax_error for parse errors', () => {
    const result = selectStrategy('ParseError', 'failed to parse', 'typescript');
    expect(result.strategy).toBe('syntax_error');
  });

  it('should select import_error for module errors', () => {
    const result = selectStrategy('ModuleNotFound', 'Cannot find module', 'typescript');
    expect(result.strategy).toBe('import_error');
  });

  it('should select reference_error for ReferenceError', () => {
    const result = selectStrategy('ReferenceError', 'x is not defined', 'javascript');
    expect(result.strategy).toBe('reference_error');
  });

  it('should select test_failure for assertion errors', () => {
    const result = selectStrategy('AssertionError', 'expected 1 to equal 2', 'typescript');
    expect(result.strategy).toBe('test_failure');
  });

  it('should fall back to runtime_error for unknown types', () => {
    const result = selectStrategy('SomeUnknownError', 'something went wrong', 'go');
    expect(result.strategy).toBe('runtime_error');
  });

  it('should include a prompt in the result', () => {
    const result = selectStrategy('TypeError', 'mismatch', 'typescript');
    expect(result.prompt).toBeTruthy();
    expect(result.prompt.length).toBeGreaterThan(10);
  });
});

describe('hashCode', () => {
  it('should return a deterministic hash', () => {
    const hash1 = hashCode('const x = 1;');
    const hash2 = hashCode('const x = 1;');
    expect(hash1).toBe(hash2);
  });

  it('should return different hashes for different inputs', () => {
    const hash1 = hashCode('const x = 1;');
    const hash2 = hashCode('const y = 2;');
    expect(hash1).not.toBe(hash2);
  });

  it('should return a hex string', () => {
    const hash = hashCode('test code');
    expect(hash).toMatch(/^-?[0-9a-f]+$/);
  });

  it('should handle empty string', () => {
    const hash = hashCode('');
    expect(hash).toBe('0');
  });
});
