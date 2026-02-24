import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { parseYamlFile, parseYamlFileSync } from './parser.js';

const fixturesDir = join(import.meta.dirname, '..', 'tests', 'fixtures');

describe('parseYamlFile (async)', () => {
  it('parses valid YAML file', async () => {
    const result = await parseYamlFile<{ name: string; value: number }>(
      join(fixturesDir, 'valid-simple.yaml'),
    );
    expect(result).not.toBeNull();
    expect(result!.name).toBe('test');
    expect(result!.value).toBe(42);
    expect(result!.nested).toEqual({ key: 'data' });
  });

  it('returns null for missing file', async () => {
    const result = await parseYamlFile(join(fixturesDir, 'nonexistent.yaml'));
    expect(result).toBeNull();
  });

  it('returns null for malformed YAML', async () => {
    const result = await parseYamlFile(join(fixturesDir, 'malformed.yaml'));
    expect(result).toBeNull();
  });
});

describe('parseYamlFileSync', () => {
  it('parses valid YAML file', () => {
    const result = parseYamlFileSync<{ name: string; value: number }>(
      join(fixturesDir, 'valid-simple.yaml'),
    );
    expect(result).not.toBeNull();
    expect(result!.name).toBe('test');
    expect(result!.value).toBe(42);
  });

  it('returns null for missing file', () => {
    const result = parseYamlFileSync(join(fixturesDir, 'nonexistent.yaml'));
    expect(result).toBeNull();
  });

  it('returns null for malformed YAML', () => {
    const result = parseYamlFileSync(join(fixturesDir, 'malformed.yaml'));
    expect(result).toBeNull();
  });
});
