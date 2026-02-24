/**
 * Tests for security validation (SEC-001 through SEC-005).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  validateId,
  validatePathWithinKoan,
  sanitizeForTerminal,
  redactAction,
  checkDatasetSize,
} from './security.js';

describe('Security Validators', () => {
  describe('SEC-001: validateId', () => {
    it('should accept valid alphanumeric IDs', () => {
      expect(() => validateId('flow-001', 'flow_id')).not.toThrow();
      expect(() => validateId('action_123', 'action_id')).not.toThrow();
      expect(() => validateId('abc123-xyz_789', 'id')).not.toThrow();
    });

    it('should reject IDs with invalid characters', () => {
      expect(() => validateId('../etc/passwd', 'flow_id')).toThrow(/Invalid flow_id/);
      expect(() => validateId('flow/001', 'flow_id')).toThrow(/Invalid flow_id/);
      expect(() => validateId('flow:001', 'flow_id')).toThrow(/Invalid flow_id/);
      expect(() => validateId('flow@001', 'flow_id')).toThrow(/Invalid flow_id/);
      expect(() => validateId('flow 001', 'flow_id')).toThrow(/Invalid flow_id/);
    });

    it('should provide helpful error messages', () => {
      try {
        validateId('bad/id', 'flow_id');
      } catch (error) {
        expect((error as Error).message).toContain('Invalid flow_id');
        expect((error as Error).message).toContain('alphanumeric');
      }
    });
  });

  describe('SEC-002: validatePathWithinKoan', () => {
    it('should accept paths within koan/', () => {
      const projectRoot = '/home/user/project';
      expect(validatePathWithinKoan('/home/user/project/koan/stories/story-001.yaml', projectRoot)).toBe(true);
      expect(validatePathWithinKoan('/home/user/project/koan/provenance/actions/action-001.yaml', projectRoot)).toBe(true);
    });

    it('should reject path traversal attempts', () => {
      const projectRoot = '/home/user/project';
      expect(validatePathWithinKoan('/home/user/project/koan/../../../etc/passwd', projectRoot)).toBe(false);
      expect(validatePathWithinKoan('../../../etc/passwd', projectRoot)).toBe(false);
    });

    it('should reject absolute paths outside koan/', () => {
      const projectRoot = '/home/user/project';
      expect(validatePathWithinKoan('/etc/passwd', projectRoot)).toBe(false);
      expect(validatePathWithinKoan('/home/user/other/file.yaml', projectRoot)).toBe(false);
    });
  });

  describe('SEC-003: sanitizeForTerminal', () => {
    it('should strip ANSI escape sequences', () => {
      expect(sanitizeForTerminal('\x1b[31mred text\x1b[0m')).toBe('red text');
      expect(sanitizeForTerminal('\x1b[1mbold\x1b[22m normal')).toBe('bold normal');
      expect(sanitizeForTerminal('no \x1b[32mcolor\x1b[0m codes')).toBe('no color codes');
    });

    it('should handle text without ANSI codes', () => {
      expect(sanitizeForTerminal('plain text')).toBe('plain text');
      expect(sanitizeForTerminal('')).toBe('');
    });

    it('should handle non-string inputs', () => {
      expect(sanitizeForTerminal(123 as any)).toBe('123');
      expect(sanitizeForTerminal(null as any)).toBe('null');
    });
  });

  describe('SEC-004: redactAction', () => {
    it('should redact action_id', () => {
      const action = {
        action_id: 'action-12345678-full',
        flow_id: 'flow-001',
        outputs: { artifact_path: '/path/to/artifact.yaml' },
      };

      const redacted = redactAction(action);
      expect(redacted.action_id).toBe('action-1***');
      expect(redacted.action_id.length).toBeLessThan(action.action_id.length);
    });

    it('should redact flow_id', () => {
      const action = {
        action_id: 'action-001',
        flow_id: 'flow-12345678-full',
      };

      const redacted = redactAction(action);
      expect(redacted.flow_id).toBe('flow-123***');
    });

    it('should redact artifact_path', () => {
      const action = {
        action_id: 'action-001',
        outputs: { artifact_path: '/sensitive/path/file.yaml' },
      };

      const redacted = redactAction(action);
      expect(redacted.outputs?.artifact_path).toBe('***REDACTED***');
    });

    it('should handle actions without flow_id or outputs', () => {
      const action = {
        action_id: 'action-001',
      };

      const redacted = redactAction(action);
      expect(redacted.action_id).toBe('action-0***');
      expect(redacted.flow_id).toBeUndefined();
      expect(redacted.outputs).toBeUndefined();
    });
  });

  describe('SEC-005: checkDatasetSize', () => {
    let consoleWarn: typeof console.warn;
    let processExit: typeof process.exit;

    beforeEach(() => {
      consoleWarn = console.warn;
      processExit = process.exit;

      console.warn = vi.fn();
      process.exit = vi.fn() as any;
    });

    afterEach(() => {
      console.warn = consoleWarn;
      process.exit = processExit;
    });

    it('should allow small datasets without warning', () => {
      checkDatasetSize(100, false);
      expect(console.warn).not.toHaveBeenCalled();
      expect(process.exit).not.toHaveBeenCalled();
    });

    it('should allow datasets at threshold', () => {
      checkDatasetSize(1000, false);
      expect(console.warn).not.toHaveBeenCalled();
      expect(process.exit).not.toHaveBeenCalled();
    });

    it('should warn and exit for large datasets without --force', () => {
      checkDatasetSize(1500, false);
      expect(console.warn).toHaveBeenCalled();
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it('should allow large datasets with --force flag', () => {
      checkDatasetSize(1500, true);
      expect(console.warn).not.toHaveBeenCalled();
      expect(process.exit).not.toHaveBeenCalled();
    });

    it('should provide helpful warning message', () => {
      checkDatasetSize(2000, false);
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('2000 actions found')
      );
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('--force')
      );
    });
  });
});
