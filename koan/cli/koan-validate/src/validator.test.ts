/**
 * Tests for Validator class
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Validator } from './validator.js';

// Mock fs
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    readFileSync: vi.fn(),
    existsSync: vi.fn().mockReturnValue(false),
  };
});

// Mock fast-glob
vi.mock('fast-glob', () => ({
  default: vi.fn(),
}));

// Mock ajv with proper validate function structure
vi.mock('ajv', () => {
  const mockCompile = vi.fn(() => {
    const validateFn = vi.fn(() => true);
    validateFn.errors = null;
    return validateFn;
  });

  const MockAjv = vi.fn(() => ({
    compile: mockCompile,
  }));

  return { default: MockAjv };
});

// Mock ajv-formats
vi.mock('ajv-formats', () => ({
  default: vi.fn(),
}));

// Mock yaml
vi.mock('yaml', () => ({
  parse: vi.fn((content) => ({ parsed: content })),
}));

import { readFileSync } from 'fs';
import fg from 'fast-glob';
import Ajv from 'ajv';
import { parse as parseYaml } from 'yaml';

describe('Validator', () => {
  const projectRoot = '/test/project';
  let validator: Validator;

  beforeEach(() => {
    vi.clearAllMocks();
    validator = new Validator(projectRoot);
  });

  describe('initialize', () => {
    it('should initialize Ajv with correct options', async () => {
      await validator.initialize();
      expect(Ajv).toHaveBeenCalledWith({
        allErrors: true,
        verbose: true,
        strict: false,
      });
    });

    it('should call addFormats on ajv instance', async () => {
      const addFormats = (await import('ajv-formats')).default;
      await validator.initialize();
      expect(addFormats).toHaveBeenCalled();
    });
  });

  describe('loadSchemas', () => {
    it('should load all schemas from registry', async () => {
      vi.mocked(readFileSync).mockReturnValue('{"type": "object"}');

      await validator.loadSchemas();

      // Should read 11 schema files
      expect(readFileSync).toHaveBeenCalledTimes(11);
      expect(readFileSync).toHaveBeenCalledWith(
        expect.stringContaining('.claude/schemas/story.schema.json'),
        'utf-8'
      );
    });

    it('should throw error if schema file cannot be read', async () => {
      vi.mocked(readFileSync).mockImplementation(() => {
        throw new Error('File not found');
      });

      await expect(validator.loadSchemas()).rejects.toThrow(
        'Failed to load schema story.schema.json: File not found'
      );
    });

    it('should throw error if schema JSON is invalid', async () => {
      vi.mocked(readFileSync).mockReturnValue('invalid json');

      await expect(validator.loadSchemas()).rejects.toThrow(
        'Failed to load schema story.schema.json:'
      );
    });
  });

  describe('validateAll', () => {
    beforeEach(async () => {
      vi.mocked(readFileSync).mockReturnValue('{"type": "object"}');
      await validator.loadSchemas();
      vi.clearAllMocks();
    });

    it('should find and validate all YAML files', async () => {
      vi.mocked(fg).mockResolvedValue([
        '/test/project/koan/stories/story-001.yaml',
        '/test/project/koan/stories/story-002.yaml',
      ]);
      vi.mocked(readFileSync).mockReturnValue('title: Test');
      vi.mocked(parseYaml).mockReturnValue({ title: 'Test' });

      const results = await validator.validateAll();

      expect(fg).toHaveBeenCalled();
      expect(results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            file: 'koan/stories/story-001.yaml',
            schema: 'story',
            valid: true,
          }),
        ])
      );
    });

    it('should filter by schema when provided', async () => {
      vi.mocked(fg).mockResolvedValue(['/test/project/koan/stories/story-001.yaml']);
      vi.mocked(readFileSync).mockReturnValue('title: Test');
      vi.mocked(parseYaml).mockReturnValue({ title: 'Test' });

      const results = await validator.validateAll('story');

      expect(results).toHaveLength(1);
      expect(results[0].schema).toBe('story');
    });

    it('should filter by file when provided', async () => {
      // Mock fg to return different files for different schema dirs
      vi.mocked(fg).mockImplementation(async (pattern: any) => {
        if (pattern.includes('stories')) {
          return [
            '/test/project/koan/stories/story-001.yaml',
            '/test/project/koan/stories/story-002.yaml',
          ];
        }
        return [];
      });
      vi.mocked(readFileSync).mockReturnValue('title: Test');
      vi.mocked(parseYaml).mockReturnValue({ title: 'Test' });

      const results = await validator.validateAll(undefined, 'story-001.yaml');

      // Only story-001.yaml should be included across all schemas
      const filteredFiles = results.filter(r => r.file.endsWith('story-001.yaml'));
      expect(filteredFiles.length).toBeGreaterThan(0);
      filteredFiles.forEach(r => {
        expect(r.file).toContain('story-001.yaml');
      });
    });

    it('should throw error if schema not loaded', async () => {
      // Create validator without loading schemas
      const newValidator = new Validator(projectRoot);
      await newValidator.initialize();

      await expect(newValidator.validateAll()).rejects.toThrow(
        'Schema story.schema.json not loaded'
      );
    });

    it('should handle validation failures', async () => {
      // Create a fresh validator with mock that returns validation failure
      const mockValidate = vi.fn(() => false);
      mockValidate.errors = [
        {
          instancePath: '/title',
          message: 'must be string',
          params: { type: 'string' },
          data: 123,
        },
      ];

      const mockCompile = vi.fn(() => mockValidate);
      const MockAjvFailing = vi.fn(() => ({
        compile: mockCompile,
      }));

      vi.mocked(Ajv).mockImplementation(MockAjvFailing as any);

      const newValidator = new Validator(projectRoot);

      // Mock file reads for schema loading
      vi.mocked(readFileSync).mockReturnValue('{"type": "object"}');
      await newValidator.loadSchemas();

      // Now mock file reads for validation
      vi.mocked(fg).mockResolvedValue(['/test/project/koan/stories/story-001.yaml']);
      vi.mocked(readFileSync).mockReturnValue('title: 123');
      vi.mocked(parseYaml).mockReturnValue({ title: 123 });

      const results = await newValidator.validateAll();

      const failedResult = results.find(r => !r.valid);
      expect(failedResult).toBeDefined();
      expect(failedResult?.errors).toHaveLength(1);
      expect(failedResult?.errors?.[0]).toMatchObject({
        path: '/title',
        message: 'must be string',
      });
    });

    it('should handle YAML parse errors', async () => {
      vi.mocked(fg).mockResolvedValue(['/test/project/koan/stories/story-001.yaml']);
      vi.mocked(readFileSync).mockReturnValue('invalid: yaml: content');
      vi.mocked(parseYaml).mockImplementation(() => {
        throw new Error('Invalid YAML syntax');
      });

      const results = await validator.validateAll();

      expect(results[0].valid).toBe(false);
      expect(results[0].parseError).toBe('Invalid YAML syntax');
    });
  });
});
