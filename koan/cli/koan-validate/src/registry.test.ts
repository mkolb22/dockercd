/**
 * Tests for schema registry
 */

import { describe, it, expect } from 'vitest';
import { SCHEMA_REGISTRY } from './registry.js';

describe('SCHEMA_REGISTRY', () => {
  it('should have exactly 11 entries', () => {
    expect(SCHEMA_REGISTRY).toHaveLength(11);
  });

  it('should have all required fields for each entry', () => {
    for (const entry of SCHEMA_REGISTRY) {
      expect(entry).toHaveProperty('dir');
      expect(entry).toHaveProperty('schemaFile');
      expect(typeof entry.dir).toBe('string');
      expect(typeof entry.schemaFile).toBe('string');
      expect(entry.dir.length).toBeGreaterThan(0);
      expect(entry.schemaFile.length).toBeGreaterThan(0);
    }
  });

  it('should have unique directory names', () => {
    const dirs = SCHEMA_REGISTRY.map((e) => e.dir);
    const uniqueDirs = new Set(dirs);
    expect(uniqueDirs.size).toBe(dirs.length);
  });

  it('should have unique schema file names', () => {
    const schemaFiles = SCHEMA_REGISTRY.map((e) => e.schemaFile);
    const uniqueSchemaFiles = new Set(schemaFiles);
    expect(uniqueSchemaFiles.size).toBe(schemaFiles.length);
  });

  it('should have glob pattern for provenance entry', () => {
    const provenanceEntry = SCHEMA_REGISTRY.find((e) => e.dir === 'provenance');
    expect(provenanceEntry).toBeDefined();
    expect(provenanceEntry?.glob).toBe('provenance/actions/*.yaml');
  });

  it('should have all expected schema types', () => {
    const expectedDirs = [
      'stories',
      'architecture',
      'implementations',
      'provenance',
      'reviews',
      'tasks',
      'slo',
      'retrospectives',
      'verifications',
      'plans',
      'explorations',
    ];
    const actualDirs = SCHEMA_REGISTRY.map((e) => e.dir);
    expect(actualDirs.sort()).toEqual(expectedDirs.sort());
  });
});
