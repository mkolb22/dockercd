/**
 * Tests for CLI entry point
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Must mock commander before importing index
vi.mock('commander', () => {
  let capturedAction: any;
  return {
    Command: vi.fn().mockImplementation(() => ({
      name: vi.fn().mockReturnThis(),
      description: vi.fn().mockReturnThis(),
      version: vi.fn().mockReturnThis(),
      option: vi.fn().mockReturnThis(),
      action: vi.fn(function (fn: any) { capturedAction = fn; return this; }),
      parse: vi.fn(),
      _getCapturedAction: () => capturedAction,
    })),
  };
});

// Mock dependencies
vi.mock('@zen/koan-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zen/koan-core')>();
  return {
    ...actual,
    findProjectRoot: vi.fn(),
    requireProjectRoot: vi.fn(),
    wrapCliAction: vi.fn((fn) => fn),
    createCommand: vi.fn((_name, _desc, handler) => {
      const cmd: any = { _handler: handler };
      cmd.description = vi.fn().mockReturnValue(cmd);
      cmd.version = vi.fn().mockReturnValue(cmd);
      cmd.option = vi.fn().mockReturnValue(cmd);
      cmd.action = vi.fn().mockReturnValue(cmd);
      return cmd;
    }),
  };
});

vi.mock('./validator.js', () => ({
  Validator: vi.fn(),
}));

vi.mock('./formatter.js', () => ({
  formatDefault: vi.fn(),
  formatVerbose: vi.fn(),
  formatJson: vi.fn(),
}));

import { requireProjectRoot } from '@zen/koan-core';
import { Validator } from './validator.js';
import { formatDefault, formatVerbose, formatJson } from './formatter.js';
import type { ValidationResult } from './types.js';

// Import after mocks are set up
const { createValidateCommand } = await import('./index.js');

// Extract the handler from createCommand — it receives (options, projectRoot)
function getHandler(): (options: any, projectRoot: string) => Promise<void> {
  const cmd = createValidateCommand() as any;
  return cmd._handler;
}

describe('run', () => {
  let consoleErrorSpy: any;
  let processExitSpy: any;
  let mockValidator: any;
  let handler: (options: any, projectRoot: string) => Promise<void>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

    mockValidator = {
      loadSchemas: vi.fn().mockResolvedValue(undefined),
      validateAll: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(Validator).mockClear().mockImplementation(() => mockValidator);
    vi.mocked(requireProjectRoot).mockClear().mockReturnValue('/test/project');
    vi.mocked(formatDefault).mockClear();
    vi.mocked(formatVerbose).mockClear();
    vi.mocked(formatJson).mockClear();

    handler = getHandler();
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it('should propagate loadSchemas errors', async () => {
    mockValidator.loadSchemas.mockRejectedValue(new Error('Schema not found'));

    await expect(handler({}, '/test/project')).rejects.toThrow('Schema not found');
  });

  it('should exit with code 0 when all validations pass', async () => {
    const validResults: ValidationResult[] = [
      { file: 'koan/stories/story-001.yaml', schema: 'story', valid: true },
    ];
    mockValidator.validateAll.mockResolvedValue(validResults);

    await handler({}, '/test/project');

    expect(processExitSpy).toHaveBeenCalledWith(0);
    expect(formatDefault).toHaveBeenCalledWith(validResults);
  });

  it('should exit with code 1 when some validations fail', async () => {
    const failedResults: ValidationResult[] = [
      { file: 'koan/stories/story-001.yaml', schema: 'story', valid: false, errors: [] },
    ];
    mockValidator.validateAll.mockResolvedValue(failedResults);

    await handler({}, '/test/project');

    expect(processExitSpy).toHaveBeenCalledWith(1);
    expect(formatDefault).toHaveBeenCalledWith(failedResults);
  });

  it('should call formatJson when json option is true', async () => {
    const results: ValidationResult[] = [
      { file: 'koan/stories/story-001.yaml', schema: 'story', valid: true },
    ];
    mockValidator.validateAll.mockResolvedValue(results);

    await handler({ json: true }, '/test/project');

    expect(processExitSpy).toHaveBeenCalledWith(0);
    expect(formatJson).toHaveBeenCalledWith(results);
    expect(formatDefault).not.toHaveBeenCalled();
    expect(formatVerbose).not.toHaveBeenCalled();
  });

  it('should call formatVerbose when verbose option is true', async () => {
    const results: ValidationResult[] = [
      { file: 'koan/stories/story-001.yaml', schema: 'story', valid: true },
    ];
    mockValidator.validateAll.mockResolvedValue(results);

    await handler({ verbose: true }, '/test/project');

    expect(processExitSpy).toHaveBeenCalledWith(0);
    expect(formatVerbose).toHaveBeenCalledWith(results);
    expect(formatDefault).not.toHaveBeenCalled();
    expect(formatJson).not.toHaveBeenCalled();
  });

  it('should pass schema filter to validateAll', async () => {
    mockValidator.validateAll.mockResolvedValue([]);

    await handler({ schema: 'story' }, '/test/project');

    expect(processExitSpy).toHaveBeenCalledWith(0);
    expect(mockValidator.validateAll).toHaveBeenCalledWith('story', undefined);
  });

  it('should pass file filter to validateAll', async () => {
    mockValidator.validateAll.mockResolvedValue([]);

    await handler({ file: 'story-001.yaml' }, '/test/project');

    expect(processExitSpy).toHaveBeenCalledWith(0);
    expect(mockValidator.validateAll).toHaveBeenCalledWith(undefined, 'story-001.yaml');
  });

  it('should propagate unexpected errors', async () => {
    mockValidator.validateAll.mockRejectedValue(new Error('Unexpected error'));

    await expect(handler({}, '/test/project')).rejects.toThrow('Unexpected error');
  });

  it('should propagate non-Error throws', async () => {
    mockValidator.validateAll.mockRejectedValue('String error');

    await expect(handler({}, '/test/project')).rejects.toBe('String error');
  });
});
