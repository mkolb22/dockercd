/**
 * Tests for CLI utility functions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleCliError, wrapCliAction } from './cli-utils.js';

describe('handleCliError', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it('should handle Error instances', () => {
    const error = new Error('Test error message');

    handleCliError(error);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error: Test error message')
    );
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('should handle string errors', () => {
    handleCliError('Plain string error');

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error: Plain string error')
    );
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('should handle unknown error types', () => {
    handleCliError({ custom: 'error object' });

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error: [object Object]')
    );
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('should handle null/undefined', () => {
    handleCliError(null);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error: null')
    );
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('should use custom exit code', () => {
    handleCliError(new Error('Custom exit'), 42);

    expect(processExitSpy).toHaveBeenCalledWith(42);
  });

  it('should format error message with Error prefix', () => {
    const error = new Error('Formatted error');

    handleCliError(error);

    // Check that the message has the "Error: " prefix
    const errorMessage = consoleErrorSpy.mock.calls[0][0];
    expect(errorMessage).toMatch(/Error: Formatted error/);
  });
});

describe('wrapCliAction', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it('should return result when action succeeds', async () => {
    const action = async () => 'success result';

    const result = await wrapCliAction(action)();

    expect(result).toBe('success result');
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  it('should handle errors thrown by action', async () => {
    const action = async () => {
      throw new Error('Action failed');
    };

    await wrapCliAction(action)();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error: Action failed')
    );
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('should handle async errors', async () => {
    const action = async () => {
      await Promise.resolve();
      throw new Error('Async error');
    };

    await wrapCliAction(action)();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error: Async error')
    );
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('should preserve return type', async () => {
    const action = async () => ({ data: 42 });

    const result = await wrapCliAction(action)();

    expect(result).toEqual({ data: 42 });
  });

  it('should handle non-Error throws', async () => {
    const action = async () => {
      throw 'string error';
    };

    await wrapCliAction(action)();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error: string error')
    );
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });
});
