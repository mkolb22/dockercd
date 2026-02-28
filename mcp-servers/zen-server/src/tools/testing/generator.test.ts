/**
 * Test Generator Tests
 * Pure function tests for code analysis and test template generation
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  analyzeForTests,
  suggestTestCases,
  detectTestFramework,
  generateTestTemplate,
} from './generator.js';

describe('analyzeForTests', () => {
  describe('TypeScript/JavaScript', () => {
    it('should detect exported functions', () => {
      const code = `
export function createUser(name: string, email: string): User {
  return { name, email };
}

function privateHelper() {}
`;
      const result = analyzeForTests(code, 'typescript');
      expect(result.functions).toHaveLength(2);

      const exported = result.functions.find((f) => f.name === 'createUser');
      expect(exported).toBeDefined();
      expect(exported!.isExported).toBe(true);
      expect(exported!.params).toHaveLength(2);
      expect(exported!.isAsync).toBe(false);

      const priv = result.functions.find((f) => f.name === 'privateHelper');
      expect(priv!.isExported).toBe(false);
    });

    it('should detect async functions', () => {
      const code = `export async function fetchData(url: string): Promise<Response> { return fetch(url); }`;
      const result = analyzeForTests(code, 'typescript');
      expect(result.functions[0].isAsync).toBe(true);
      expect(result.functions[0].name).toBe('fetchData');
    });

    it('should detect exported arrow functions', () => {
      const code = `export const multiply = (a: number, b: number): number => a * b;`;
      const result = analyzeForTests(code, 'javascript');
      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe('multiply');
      expect(result.functions[0].isExported).toBe(true);
    });

    it('should detect classes and methods', () => {
      const code = `
export class UserService {
  constructor(private db: Database) {}

  getUser(id: string): User {
    return this.db.find(id);
  }

  async deleteUser(id: string): Promise<void> {
    await this.db.delete(id);
  }

  _privateMethod() {}
}
`;
      const result = analyzeForTests(code, 'typescript');
      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe('UserService');
      expect(result.classes[0].isExported).toBe(true);
      // Methods exclude constructor and _private
      expect(result.classes[0].methods).toContain('getUser');
      expect(result.classes[0].methods).toContain('deleteUser');
      expect(result.classes[0].methods).not.toContain('constructor');
      expect(result.classes[0].methods).not.toContain('_privateMethod');
    });

    it('should track exports', () => {
      const code = `
export function foo() {}
export class Bar {}
function baz() {}
`;
      const result = analyzeForTests(code, 'typescript');
      expect(result.exports).toContain('foo');
      expect(result.exports).toContain('Bar');
      expect(result.exports).not.toContain('baz');
    });
  });

  describe('Python', () => {
    it('should detect functions', () => {
      const code = `
def process_data(input_data: list, threshold: float) -> dict:
    return {"result": len(input_data)}

def _private_helper():
    pass
`;
      const result = analyzeForTests(code, 'python');
      expect(result.functions).toHaveLength(2);

      const pub = result.functions.find((f) => f.name === 'process_data');
      expect(pub).toBeDefined();
      expect(pub!.isExported).toBe(true);
      expect(pub!.params.length).toBeGreaterThanOrEqual(2);
      expect(pub!.returnType).toBe('dict');

      const priv = result.functions.find((f) => f.name === '_private_helper');
      expect(priv!.isExported).toBe(false);
    });

    it('should detect classes', () => {
      const code = `
class DataProcessor:
    def process(self, data):
        pass

    def validate(self, data):
        pass

    def __init__(self, config):
        self.config = config

    def _internal(self):
        pass
`;
      const result = analyzeForTests(code, 'python');
      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe('DataProcessor');
      expect(result.classes[0].methods).toContain('process');
      expect(result.classes[0].methods).toContain('validate');
      expect(result.classes[0].methods).not.toContain('__init__');
      expect(result.classes[0].methods).not.toContain('_internal');
    });
  });

  describe('Go', () => {
    it('should detect exported functions', () => {
      const code = `
func ProcessData(input []byte) (string, error) {
    return string(input), nil
}

func helperFunc(x int) int {
    return x * 2
}
`;
      const result = analyzeForTests(code, 'go');
      expect(result.functions).toHaveLength(2);

      const exported = result.functions.find((f) => f.name === 'ProcessData');
      expect(exported!.isExported).toBe(true);

      const unexported = result.functions.find((f) => f.name === 'helperFunc');
      expect(unexported!.isExported).toBe(false);
    });
  });
});

describe('suggestTestCases', () => {
  it('should generate a basic test spec', () => {
    const spec = suggestTestCases('calculate', ['a: number', 'b: number'], 'number');
    expect(spec.name).toBe('calculate');
    expect(spec.type).toBe('unit');
    expect(spec.targetFunction).toBe('calculate');
    expect(spec.assertions.length).toBeGreaterThan(0);
  });

  it('should include edge cases for string params', () => {
    const spec = suggestTestCases('greet', ['name: string'], 'string');
    const descriptions = spec.assertions.map((a) => a.description);
    expect(descriptions.some((d) => d.includes('empty string'))).toBe(true);
  });

  it('should include edge cases for number params', () => {
    const spec = suggestTestCases('add', ['a: number', 'b: number'], 'number');
    const descriptions = spec.assertions.map((a) => a.description);
    expect(descriptions.some((d) => d.includes('zero'))).toBe(true);
    expect(descriptions.some((d) => d.includes('negative'))).toBe(true);
  });

  it('should include edge cases for array params', () => {
    const spec = suggestTestCases('sort', ['items: number[]'], 'number[]');
    const descriptions = spec.assertions.map((a) => a.description);
    expect(descriptions.some((d) => d.includes('empty array'))).toBe(true);
  });

  it('should include null/undefined handling for functions with params', () => {
    const spec = suggestTestCases('process', ['data: string'], 'void');
    const descriptions = spec.assertions.map((a) => a.description);
    expect(descriptions.some((d) => d.includes('null'))).toBe(true);
  });

  it('should use Arrange-Act-Assert pattern', () => {
    const spec = suggestTestCases('compute', ['x: number'], 'number');
    for (const assertion of spec.assertions) {
      expect(assertion.expectation).toBeTruthy();
    }
  });
});

describe('detectTestFramework', () => {
  it('should detect vitest from package.json', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-test-'));
    try {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ devDependencies: { vitest: '^1.0.0' } }),
      );
      expect(detectTestFramework(tmpDir)).toBe('vitest');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should detect jest from package.json', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-test-'));
    try {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ devDependencies: { jest: '^29.0.0' } }),
      );
      expect(detectTestFramework(tmpDir)).toBe('jest');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should detect pytest from pytest.ini', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-test-'));
    try {
      fs.writeFileSync(path.join(tmpDir, 'pytest.ini'), '[pytest]\n');
      expect(detectTestFramework(tmpDir)).toBe('pytest');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should detect go-test from go.mod', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-test-'));
    try {
      fs.writeFileSync(path.join(tmpDir, 'go.mod'), 'module example.com/test\n');
      expect(detectTestFramework(tmpDir)).toBe('go-test');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should default to jest', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-test-'));
    try {
      expect(detectTestFramework(tmpDir)).toBe('jest');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('generateTestTemplate', () => {
  const sampleSpec = {
    name: 'add',
    description: 'Tests for add function',
    type: 'unit' as const,
    targetFunction: 'add',
    assertions: [
      {
        description: 'should add two numbers',
        input: '1, 2',
        expectedOutput: '3',
        expectation: 'expect(result).toBe(3);',
      },
    ],
  };

  it('should generate vitest template with import', () => {
    const result = generateTestTemplate('vitest', [sampleSpec], 'src/math.ts');
    expect(result.filename).toBe('math.test.ts');
    expect(result.framework).toBe('vitest');
    expect(result.language).toBe('typescript');
    expect(result.content).toContain("import { describe, it, expect, vi } from 'vitest'");
    expect(result.content).toContain("describe('add'");
    expect(result.content).toContain("it('should add two numbers'");
  });

  it('should generate jest template without vitest import', () => {
    const result = generateTestTemplate('jest', [sampleSpec], 'src/math.ts');
    expect(result.content).not.toContain('vitest');
    expect(result.content).toContain("describe('add'");
  });

  it('should generate pytest template', () => {
    const result = generateTestTemplate('pytest', [sampleSpec], 'src/math.py');
    expect(result.filename).toBe('test_math.py');
    expect(result.framework).toBe('pytest');
    expect(result.language).toBe('python');
    expect(result.content).toContain('import pytest');
    expect(result.content).toContain('def test_');
  });

  it('should generate go-test template', () => {
    const result = generateTestTemplate('go-test', [sampleSpec], 'math.go');
    expect(result.filename).toBe('math_test.go');
    expect(result.framework).toBe('go-test');
    expect(result.language).toBe('go');
    expect(result.content).toContain('package main');
    expect(result.content).toContain('"testing"');
    expect(result.content).toContain('func Test');
  });

  it('should generate mocha template', () => {
    const result = generateTestTemplate('mocha', [sampleSpec], 'src/math.js');
    expect(result.filename).toBe('math.test.js');
    expect(result.framework).toBe('mocha');
    expect(result.content).toContain("require('assert')");
    expect(result.content).toContain("describe('math'");
  });
});
