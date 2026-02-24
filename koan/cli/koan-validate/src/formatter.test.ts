/**
 * Tests for output formatters
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import chalk from 'chalk';
import { formatDefault, formatVerbose, formatJson } from './formatter.js';
import type { ValidationResult } from './types.js';

// Disable chalk colors for consistent test output
chalk.level = 0;

describe('formatDefault', () => {
  let consoleSpy: any;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('should handle empty results', () => {
    formatDefault([]);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('=== Koan Validation Results ==='));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No files found to validate.'));
  });

  it('should display valid results grouped by schema', () => {
    const results: ValidationResult[] = [
      { file: 'koan/stories/story-001.yaml', schema: 'story', valid: true },
      { file: 'koan/stories/story-002.yaml', schema: 'story', valid: true },
    ];
    formatDefault(results);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Schema: story'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Passed'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Overall Summary:'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Total files: 2'));
  });

  it('should display failed validation results', () => {
    const results: ValidationResult[] = [
      {
        file: 'koan/stories/story-001.yaml',
        schema: 'story',
        valid: false,
        errors: [
          { path: '/title', message: 'must be string' },
        ],
      },
    ];
    formatDefault(results);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Failed files:'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('story-001.yaml (1 errors)'));
  });

  it('should display parse errors', () => {
    const results: ValidationResult[] = [
      {
        file: 'koan/stories/story-001.yaml',
        schema: 'story',
        valid: false,
        parseError: 'Invalid YAML syntax',
      },
    ];
    formatDefault(results);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Failed files:'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('story-001.yaml (parse error)'));
  });

  it('should display mixed results with multiple schemas', () => {
    const results: ValidationResult[] = [
      { file: 'koan/stories/story-001.yaml', schema: 'story', valid: true },
      { file: 'koan/architecture/arch-001.yaml', schema: 'architecture', valid: false, errors: [] },
    ];
    formatDefault(results);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Schema: story'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Schema: architecture'));
  });
});

describe('formatVerbose', () => {
  let consoleSpy: any;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('should handle empty results', () => {
    formatVerbose([]);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('=== Koan Validation Results (Verbose) ==='));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No files found to validate.'));
  });

  it('should display valid results with checkmarks', () => {
    const results: ValidationResult[] = [
      { file: 'koan/stories/story-001.yaml', schema: 'story', valid: true },
    ];
    formatVerbose(results);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('✓ koan/stories/story-001.yaml'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Schema: story'));
  });

  it('should display failed results with X marks and errors', () => {
    const results: ValidationResult[] = [
      {
        file: 'koan/stories/story-001.yaml',
        schema: 'story',
        valid: false,
        errors: [
          {
            path: '/title',
            message: 'must be string',
            expected: '{"type":"string"}',
            actual: '123',
          },
        ],
      },
    ];
    formatVerbose(results);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('✗ koan/stories/story-001.yaml'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Validation Errors (1):'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Path: /title'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Message: must be string'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Expected: {"type":"string"}'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Actual: 123'));
  });

  it('should display parse errors', () => {
    const results: ValidationResult[] = [
      {
        file: 'koan/stories/story-001.yaml',
        schema: 'story',
        valid: false,
        parseError: 'Invalid YAML syntax at line 5',
      },
    ];
    formatVerbose(results);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('✗ koan/stories/story-001.yaml'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Parse Error:'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid YAML syntax at line 5'));
  });

  it('should display summary at the end', () => {
    const results: ValidationResult[] = [
      { file: 'koan/stories/story-001.yaml', schema: 'story', valid: true },
      { file: 'koan/stories/story-002.yaml', schema: 'story', valid: false, errors: [] },
    ];
    formatVerbose(results);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('=== Summary ==='));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Total files: 2'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Passed: 1'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Failed: 1'));
  });
});

describe('formatJson', () => {
  let consoleSpy: any;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('should output valid JSON with empty results', () => {
    formatJson([]);
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output).toEqual({
      results: [],
      summary: {
        total: 0,
        passed: 0,
        failed: 0,
        parseErrors: 0,
      },
    });
  });

  it('should output valid JSON with results and summary', () => {
    const results: ValidationResult[] = [
      { file: 'koan/stories/story-001.yaml', schema: 'story', valid: true },
      { file: 'koan/stories/story-002.yaml', schema: 'story', valid: false, errors: [] },
    ];
    formatJson(results);
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output.results).toHaveLength(2);
    expect(output.summary).toEqual({
      total: 2,
      passed: 1,
      failed: 1,
      parseErrors: 0,
    });
  });

  it('should count parse errors correctly', () => {
    const results: ValidationResult[] = [
      { file: 'koan/stories/story-001.yaml', schema: 'story', valid: true },
      { file: 'koan/stories/story-002.yaml', schema: 'story', valid: false, parseError: 'Bad YAML' },
    ];
    formatJson(results);
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output.summary).toEqual({
      total: 2,
      passed: 1,
      failed: 0,
      parseErrors: 1,
    });
  });
});
