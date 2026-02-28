/**
 * Test Generator - Generates test code based on source code analysis
 */

import * as fs from "fs";
import * as path from "path";

export interface TestSpec {
  name: string;
  description: string;
  type: "unit" | "integration" | "e2e";
  targetFunction?: string;
  targetClass?: string;
  assertions: Array<{
    description: string;
    input?: string;
    expectedOutput?: string;
    expectation: string;
  }>;
}

export interface GeneratedTest {
  filename: string;
  content: string;
  framework: string;
  language: string;
  specs: TestSpec[];
}

export type TestFramework =
  | "jest"
  | "vitest"
  | "pytest"
  | "go-test"
  | "rust-test"
  | "mocha";

/**
 * Analyze source code to extract testable elements
 */
export function analyzeForTests(
  code: string,
  language: string
): {
  functions: Array<{
    name: string;
    params: string[];
    returnType?: string;
    isAsync: boolean;
    isExported: boolean;
  }>;
  classes: Array<{
    name: string;
    methods: string[];
    isExported: boolean;
  }>;
  exports: string[];
} {
  const result = {
    functions: [] as Array<{
      name: string;
      params: string[];
      returnType?: string;
      isAsync: boolean;
      isExported: boolean;
    }>,
    classes: [] as Array<{
      name: string;
      methods: string[];
      isExported: boolean;
    }>,
    exports: [] as string[],
  };

  switch (language.toLowerCase()) {
    case "typescript":
    case "javascript": {
      // Find exported functions (handles generics like function foo<T>(...))
      const funcRegex =
        /^\s*(export\s+)?(async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*:\s*([^{]+))?/gm;
      let match;
      while ((match = funcRegex.exec(code)) !== null) {
        const isExported = !!match[1];
        result.functions.push({
          name: match[3],
          params: match[4]
            .split(",")
            .map((p) => p.trim())
            .filter(Boolean),
          returnType: match[5]?.trim(),
          isAsync: !!match[2],
          isExported,
        });
        if (isExported) result.exports.push(match[3]);
      }

      // Find arrow functions
      const arrowRegex =
        /(export\s+)?(?:const|let)\s+(\w+)\s*=\s*(async\s+)?\([^)]*\)\s*(?::\s*([^=]+))?\s*=>/g;
      while ((match = arrowRegex.exec(code)) !== null) {
        const isExported = !!match[1];
        result.functions.push({
          name: match[2],
          params: [],
          returnType: match[4]?.trim(),
          isAsync: !!match[3],
          isExported,
        });
        if (isExported) result.exports.push(match[2]);
      }

      // Find classes
      const classRegex = /^\s*(export\s+)?class\s+(\w+)/gm;
      while ((match = classRegex.exec(code)) !== null) {
        const isExported = !!match[1];
        const className = match[2];

        // Find methods in class
        const classStart = match.index;
        let braceCount = 0;
        let classEnd = classStart;
        let foundStart = false;

        for (let i = classStart; i < code.length; i++) {
          if (code[i] === "{") {
            braceCount++;
            foundStart = true;
          } else if (code[i] === "}") {
            braceCount--;
            if (foundStart && braceCount === 0) {
              classEnd = i;
              break;
            }
          }
        }

        const classBody = code.slice(classStart, classEnd);
        const methodRegex = /(?:async\s+)?(\w+)\s*(?:<[^>]*>)?\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*{/g;
        const methods: string[] = [];
        const jsKeywords = new Set([
          "if", "else", "for", "while", "do", "switch", "case",
          "try", "catch", "finally", "throw", "return", "new",
          "typeof", "instanceof", "in", "of", "with", "class",
          "function", "delete", "void", "yield", "await",
        ]);
        let methodMatch;
        while ((methodMatch = methodRegex.exec(classBody)) !== null) {
          if (
            methodMatch[1] !== "constructor" &&
            !methodMatch[1].startsWith("_") &&
            !jsKeywords.has(methodMatch[1])
          ) {
            methods.push(methodMatch[1]);
          }
        }

        result.classes.push({
          name: className,
          methods,
          isExported,
        });
        if (isExported) result.exports.push(className);
      }
      break;
    }

    case "python": {
      // Find functions
      const funcRegex = /def\s+(\w+)\s*\(([^)]*)\)(?:\s*->\s*([^:]+))?:/g;
      let match;
      while ((match = funcRegex.exec(code)) !== null) {
        const isPrivate = match[1].startsWith("_");
        result.functions.push({
          name: match[1],
          params: match[2]
            .split(",")
            .map((p) => p.trim().split(":")[0].trim())
            .filter(Boolean),
          returnType: match[3]?.trim(),
          isAsync: code.slice(match.index - 10, match.index).includes("async"),
          isExported: !isPrivate,
        });
        if (!isPrivate) result.exports.push(match[1]);
      }

      // Find classes
      const classRegex = /class\s+(\w+)(?:\([^)]*\))?:/g;
      while ((match = classRegex.exec(code)) !== null) {
        const className = match[1];
        const isPrivate = className.startsWith("_");

        // Find methods
        const methodRegex = new RegExp(`def\\s+(\\w+)\\s*\\(self[^)]*\\)`, "g");
        const methods: string[] = [];
        let methodMatch;
        while ((methodMatch = methodRegex.exec(code)) !== null) {
          if (
            !methodMatch[1].startsWith("_") &&
            methodMatch[1] !== "__init__"
          ) {
            methods.push(methodMatch[1]);
          }
        }

        result.classes.push({
          name: className,
          methods,
          isExported: !isPrivate,
        });
        if (!isPrivate) result.exports.push(className);
      }
      break;
    }

    case "go": {
      // Find exported functions (capitalized)
      const funcRegex = /func\s+(\w+)\s*\(([^)]*)\)(?:\s*\(([^)]*)\)|\s*(\w+))?/g;
      let match;
      while ((match = funcRegex.exec(code)) !== null) {
        const name = match[1];
        const isExported = name[0] === name[0].toUpperCase();
        result.functions.push({
          name,
          params: match[2]
            .split(",")
            .map((p) => p.trim())
            .filter(Boolean),
          returnType: match[3] || match[4],
          isAsync: false,
          isExported,
        });
        if (isExported) result.exports.push(name);
      }
      break;
    }
  }

  return result;
}

/**
 * Generate test template based on framework
 */
export function generateTestTemplate(
  framework: TestFramework,
  specs: TestSpec[],
  sourceFile: string
): GeneratedTest {
  const basename = path.basename(sourceFile, path.extname(sourceFile));

  switch (framework) {
    case "jest":
    case "vitest": {
      const imports =
        framework === "vitest"
          ? `import { describe, it, expect, vi } from 'vitest';`
          : "";

      const testBlocks = specs.map((spec) => {
        const assertions = spec.assertions
          .map(
            (a) => `
    it('${a.description}', ${spec.type === "unit" ? "" : "async "}() => {
      // Arrange
      ${a.input ? `const input = ${a.input};` : "// Setup test data"}

      // Act
      ${a.expectedOutput ? `const result = ${spec.targetFunction || spec.targetClass}(${a.input ? "input" : ""});` : "// Execute the function"}

      // Assert
      ${a.expectation}
    });`
          )
          .join("\n");

        return `
describe('${spec.name}', () => {
  ${spec.description ? `// ${spec.description}` : ""}
  ${assertions}
});`;
      });

      return {
        filename: `${basename}.test.ts`,
        content: `${imports}
import { ${specs.map((s) => s.targetFunction || s.targetClass).filter(Boolean).join(", ")} } from './${basename}';

${testBlocks.join("\n\n")}
`,
        framework,
        language: "typescript",
        specs,
      };
    }

    case "pytest": {
      const testBlocks = specs.map((spec) => {
        const assertions = spec.assertions
          .map(
            (a) => `
def test_${a.description.toLowerCase().replace(/\s+/g, "_")}():
    """${a.description}"""
    # Arrange
    ${a.input ? `input_data = ${a.input}` : "# Setup test data"}

    # Act
    ${a.expectedOutput ? `result = ${spec.targetFunction || spec.targetClass}(${a.input ? "input_data" : ""})` : "# Execute the function"}

    # Assert
    ${a.expectation}
`
          )
          .join("\n");

        return `
# ${spec.name}
# ${spec.description || ""}
${assertions}`;
      });

      return {
        filename: `test_${basename}.py`,
        content: `import pytest
from ${basename} import ${specs.map((s) => s.targetFunction || s.targetClass).filter(Boolean).join(", ")}

${testBlocks.join("\n\n")}
`,
        framework,
        language: "python",
        specs,
      };
    }

    case "go-test": {
      const testBlocks = specs.map((spec) => {
        const assertions = spec.assertions
          .map(
            (a) => `
func Test${spec.targetFunction || spec.targetClass}_${a.description.replace(/\s+/g, "")}(t *testing.T) {
    // Arrange
    ${a.input ? `input := ${a.input}` : "// Setup test data"}

    // Act
    ${a.expectedOutput ? `result := ${spec.targetFunction || spec.targetClass}(${a.input ? "input" : ""})` : "// Execute the function"}

    // Assert
    ${a.expectation}
}
`
          )
          .join("\n");

        return assertions;
      });

      return {
        filename: `${basename}_test.go`,
        content: `package main

import (
    "testing"
)

${testBlocks.join("\n\n")}
`,
        framework,
        language: "go",
        specs,
      };
    }

    case "mocha": {
      const testBlocks = specs.map((spec) => {
        const assertions = spec.assertions
          .map(
            (a) => `
    it('${a.description}', ${spec.type === "unit" ? "" : "async "}function() {
      // Arrange
      ${a.input ? `const input = ${a.input};` : "// Setup test data"}

      // Act
      ${a.expectedOutput ? `const result = ${spec.targetFunction || spec.targetClass}(${a.input ? "input" : ""});` : "// Execute the function"}

      // Assert
      ${a.expectation.replace(/expect\(([^)]+)\)\.toBe\(([^)]+)\)/g, "assert.strictEqual($1, $2)").replace(/expect\(([^)]+)\)\.toBeDefined\(\)/g, "assert.ok($1 !== undefined)").replace(/expect\(([^)]+)\)\.toEqual\(([^)]+)\)/g, "assert.deepStrictEqual($1, $2)")}
    });`
          )
          .join("\n");

        return `
  describe('${spec.name}', function() {
    ${spec.description ? `// ${spec.description}` : ""}
    ${assertions}
  });`;
      });

      return {
        filename: `${basename}.test.js`,
        content: `const assert = require('assert');
const { ${specs.map((s) => s.targetFunction || s.targetClass).filter(Boolean).join(", ")} } = require('./${basename}');

describe('${basename}', function() {
${testBlocks.join("\n\n")}
});
`,
        framework,
        language: "javascript",
        specs,
      };
    }

    case "rust-test": {
      const testBlocks = specs.map((spec) => {
        const assertions = spec.assertions
          .map(
            (a) => `
    #[test]
    fn test_${(spec.targetFunction || spec.targetClass || "").toLowerCase()}_${a.description.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "")}() {
        // Arrange
        ${a.input ? `let input = ${a.input};` : "// Setup test data"}

        // Act
        ${a.expectedOutput ? `let result = ${spec.targetFunction || spec.targetClass}(${a.input ? "input" : ""});` : "// Execute the function"}

        // Assert
        ${a.expectation.replace(/expect\(([^)]+)\)\.toBe\(([^)]+)\)/g, "assert_eq!($1, $2)").replace(/expect\(([^)]+)\)\.toBeDefined\(\)/g, "assert!($1.is_some())").replace(/expect\(([^)]+)\)\.toEqual\(([^)]+)\)/g, "assert_eq!($1, $2)")}
    }`
          )
          .join("\n");

        return `
// Tests for ${spec.name}
// ${spec.description || ""}
${assertions}`;
      });

      return {
        filename: `${basename}_test.rs`,
        content: `#[cfg(test)]
mod tests {
    use super::*;
${testBlocks.join("\n\n")}
}
`,
        framework,
        language: "rust",
        specs,
      };
    }

    default:
      return {
        filename: `${basename}.test.ts`,
        content: `// Test file for ${basename}
// Framework: ${framework} (generic template)
`,
        framework: framework as TestFramework,
        language: "typescript",
        specs,
      };
  }
}

/**
 * Suggest test cases based on function analysis
 */
export function suggestTestCases(
  funcName: string,
  params: string[],
  returnType?: string
): TestSpec {
  const assertions: TestSpec["assertions"] = [];

  // Basic functionality test
  assertions.push({
    description: `should return expected result for valid input`,
    input: params.length > 0 ? "validInput" : undefined,
    expectedOutput: returnType ? "expectedResult" : undefined,
    expectation: "expect(result).toBeDefined();",
  });

  // Edge cases based on common patterns
  if (params.some((p) => p.includes("string") || p.includes("str"))) {
    assertions.push({
      description: "should handle empty string",
      input: '""',
      expectation: "expect(result).toBeDefined();",
    });
  }

  if (params.some((p) => p.includes("array") || p.includes("list") || p.includes("[]"))) {
    assertions.push({
      description: "should handle empty array",
      input: "[]",
      expectation: "expect(result).toBeDefined();",
    });
  }

  if (params.some((p) => p.includes("number") || p.includes("int"))) {
    assertions.push({
      description: "should handle zero",
      input: "0",
      expectation: "expect(result).toBeDefined();",
    });
    assertions.push({
      description: "should handle negative numbers",
      input: "-1",
      expectation: "expect(result).toBeDefined();",
    });
  }

  // Null/undefined handling
  if (params.length > 0) {
    assertions.push({
      description: "should handle null/undefined input gracefully",
      input: "null",
      expectation: "expect(() => result).not.toThrow();",
    });
  }

  return {
    name: funcName,
    description: `Tests for ${funcName}`,
    type: "unit",
    targetFunction: funcName,
    assertions,
  };
}

/**
 * Detect the appropriate test framework for a project.
 * Checks the given directory first, then walks up to find the nearest package.json.
 * Also checks for framework config files (vitest.config.*, jest.config.*, etc.).
 */
export function detectTestFramework(projectRoot: string): TestFramework {
  try {
    // Walk up from projectRoot to find the nearest package.json with test deps
    let dir = projectRoot;
    const root = path.parse(dir).root;
    while (dir !== root) {
      const result = detectFromDir(dir);
      if (result) return result;
      dir = path.dirname(dir);
    }
  } catch {
    // Ignore errors
  }

  return "jest"; // Default
}

function detectFromDir(dir: string): TestFramework | null {
  // Check for framework config files first (most specific signal)
  if (
    fs.existsSync(path.join(dir, "vitest.config.ts")) ||
    fs.existsSync(path.join(dir, "vitest.config.js")) ||
    fs.existsSync(path.join(dir, "vitest.config.mts"))
  ) {
    return "vitest";
  }
  if (
    fs.existsSync(path.join(dir, "jest.config.ts")) ||
    fs.existsSync(path.join(dir, "jest.config.js")) ||
    fs.existsSync(path.join(dir, "jest.config.json"))
  ) {
    return "jest";
  }

  // Check package.json dependencies
  const packageJsonPath = path.join(dir, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    const allDeps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };

    if (allDeps.vitest) return "vitest";
    if (allDeps.jest) return "jest";
    if (allDeps.mocha) return "mocha";
  }

  // Check for Python
  if (
    fs.existsSync(path.join(dir, "pytest.ini")) ||
    fs.existsSync(path.join(dir, "pyproject.toml"))
  ) {
    return "pytest";
  }

  // Check for Go
  if (fs.existsSync(path.join(dir, "go.mod"))) {
    return "go-test";
  }

  // Check for Rust
  if (fs.existsSync(path.join(dir, "Cargo.toml"))) {
    return "rust-test";
  }

  return null;
}
