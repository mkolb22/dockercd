/**
 * Test Generator Tools
 * Provides automated test generation, execution, and coverage analysis
 */

import * as fs from "fs";
import * as path from "path";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { successResponse, errorResponse, args as a } from "../../utils/responses.js";
import { createDispatcher, createModule } from "../../core/dispatcher.js";
import { config } from "../../core/config.js";
import {
  analyzeForTests,
  generateTestTemplate,
  suggestTestCases,
  detectTestFramework,
  type TestSpec,
  type TestFramework,
} from "./generator.js";
import { runTests, getTestCommand } from "../../utils/execution.js";
import { analyzeCoverage, findUntestedFiles, suggestTestsForCode } from "./analyzer.js";

export const tools: Tool[] = [
  {
    name: "generate_unit_tests",
    description:
      "Analyze source code and generate unit test templates with suggested test cases",
    inputSchema: {
      type: "object",
      properties: {
        sourceFile: {
          type: "string",
          description: "Path to the source file to generate tests for",
        },
        code: {
          type: "string",
          description: "Source code content (alternative to sourceFile)",
        },
        language: {
          type: "string",
          enum: ["typescript", "javascript", "python", "go", "rust"],
          description: "Programming language",
        },
        framework: {
          type: "string",
          enum: ["jest", "vitest", "pytest", "go-test", "mocha"],
          description: "Test framework to use (auto-detected if not specified)",
        },
        coverageTarget: {
          type: "number",
          description: "Target coverage percentage (default: 80)",
          default: 80,
        },
      },
      required: ["language"],
    },
  },
  {
    name: "generate_integration_tests",
    description: "Generate integration tests for a module or API endpoint",
    inputSchema: {
      type: "object",
      properties: {
        entryPoint: {
          type: "string",
          description: "Main entry point or API endpoint to test",
        },
        dependencies: {
          type: "array",
          items: { type: "string" },
          description: "Dependencies that should be mocked",
        },
        scenarios: {
          type: "array",
          items: { type: "string" },
          description: "Specific scenarios to test",
        },
        language: {
          type: "string",
          description: "Programming language",
        },
      },
      required: ["entryPoint", "language"],
    },
  },
  {
    name: "run_tests",
    description: "Execute tests and return structured results with pass/fail counts",
    inputSchema: {
      type: "object",
      properties: {
        testCommand: {
          type: "string",
          description: "Test command to run (e.g., 'npm test', 'pytest')",
        },
        cwd: {
          type: "string",
          description: "Working directory (default: project root)",
        },
        coverage: {
          type: "boolean",
          description: "Run with coverage reporting",
          default: false,
        },
        filter: {
          type: "string",
          description: "Filter to run specific tests",
        },
        timeout: {
          type: "number",
          description: "Timeout in milliseconds (default: 120000)",
          default: 120000,
        },
      },
    },
  },
  {
    name: "analyze_coverage",
    description: "Analyze test coverage and identify gaps that need more tests",
    inputSchema: {
      type: "object",
      properties: {
        coverageDir: {
          type: "string",
          description: "Path to coverage directory (default: coverage/)",
        },
      },
    },
  },
  {
    name: "find_untested_files",
    description: "Find source files that don't have corresponding test files",
    inputSchema: {
      type: "object",
      properties: {
        sourceGlob: {
          type: "string",
          description: "Glob pattern for source files",
          default: "src/**/*.{ts,tsx,js,jsx}",
        },
        testGlob: {
          type: "string",
          description: "Glob pattern for test files",
          default: "**/*.{test,spec}.{ts,tsx,js,jsx}",
        },
        cwd: {
          type: "string",
          description: "Working directory for file search (default: project root)",
        },
      },
    },
  },
  {
    name: "suggest_tests",
    description: "Analyze code and suggest what types of tests should be written",
    inputSchema: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "Code to analyze",
        },
        file: {
          type: "string",
          description: "File path to analyze (alternative to code)",
        },
        language: {
          type: "string",
          description: "Programming language",
        },
      },
      required: ["language"],
    },
  },
  {
    name: "get_test_command",
    description: "Get the appropriate test command for the project",
    inputSchema: {
      type: "object",
      properties: {
        framework: {
          type: "string",
          description: "Test framework (auto-detected if not specified)",
        },
        coverage: {
          type: "boolean",
          description: "Include coverage flag",
          default: false,
        },
        filter: {
          type: "string",
          description: "Test name filter",
        },
        cwd: {
          type: "string",
          description: "Working directory for framework detection (default: project root)",
        },
      },
    },
  },
];

const dispatcher = createDispatcher();

dispatcher
  .register("generate_unit_tests", async (args) => {
    const projectRoot = config().projectRoot;
    const sourceFile = a.stringOptional(args, "sourceFile");
    const codeInput = a.stringOptional(args, "code");
    const language = a.string(args, "language");
    let framework = a.stringOptional(args, "framework") as TestFramework | undefined;

    // Get code content
    let code = codeInput;
    if (!code && sourceFile) {
      const fullPath = path.isAbsolute(sourceFile)
        ? sourceFile
        : path.join(projectRoot, sourceFile);
      if (!fs.existsSync(fullPath)) {
        return errorResponse(`Source file not found: ${sourceFile}`);
      }
      code = fs.readFileSync(fullPath, "utf-8");
    }

    if (!code) {
      return errorResponse("Either sourceFile or code must be provided");
    }

    // Detect framework if not specified — use sourceFile's directory for detection
    if (!framework) {
      const detectDir = sourceFile
        ? path.dirname(path.isAbsolute(sourceFile) ? sourceFile : path.join(projectRoot, sourceFile))
        : projectRoot;
      framework = detectTestFramework(detectDir);
    }

    // Analyze code for testable elements
    const analysis = analyzeForTests(code, language);

    // Generate test specs for each function and class
    const specs: TestSpec[] = [];

    for (const func of analysis.functions) {
      if (func.isExported || analysis.exports.includes(func.name)) {
        specs.push(suggestTestCases(func.name, func.params, func.returnType));
      }
    }

    for (const cls of analysis.classes) {
      if (cls.isExported || analysis.exports.includes(cls.name)) {
        for (const method of cls.methods) {
          const spec = suggestTestCases(method, [], undefined);
          spec.targetClass = cls.name;
          spec.name = `${cls.name}.${method}`;
          specs.push(spec);
        }
      }
    }

    // Generate test file
    const generatedTest = generateTestTemplate(
      framework,
      specs,
      sourceFile || "source.ts"
    );

    return successResponse({
      analysis: {
        functions: analysis.functions.length,
        classes: analysis.classes.length,
        exports: analysis.exports,
      },
      generatedTest: {
        filename: generatedTest.filename,
        framework: generatedTest.framework,
        specsGenerated: specs.length,
        content: generatedTest.content,
      },
      specs,
    });
  })
  .register("generate_integration_tests", async (args) => {
    const entryPoint = a.string(args, "entryPoint");
    const dependencies = a.array<string>(args, "dependencies");
    const scenarios = a.array<string>(args, "scenarios");

    const mockSetup = dependencies.map((dep) => `// Mock ${dep}`).join("\n");

    const testCases =
      scenarios.length > 0
        ? scenarios
            .map(
              (scenario) => `
    it('${scenario}', async () => {
      // Arrange
      // TODO: Setup for ${scenario}

      // Act
      const result = await ${entryPoint}();

      // Assert
      expect(result).toBeDefined();
    });
`
            )
            .join("\n")
        : `
    it('should complete successfully', async () => {
      const result = await ${entryPoint}();
      expect(result).toBeDefined();
    });

    it('should handle errors gracefully', async () => {
      // TODO: Setup error condition
      await expect(${entryPoint}()).rejects.toThrow();
    });
`;

    const testContent = `
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('${entryPoint} Integration Tests', () => {
  beforeEach(() => {
    ${mockSetup}
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  ${testCases}
});
`;

    return successResponse({
      entryPoint,
      dependencies,
      scenarios: scenarios.length > 0 ? scenarios : ["success", "error"],
      generatedTest: {
        filename: `${entryPoint.replace(/[^a-zA-Z0-9]/g, "-")}.integration.test.ts`,
        content: testContent,
      },
    });
  })
  .registerLong("run_tests", async (args) => {
    const projectRoot = config().projectRoot;
    const testCommand = a.stringOptional(args, "testCommand");
    const cwdRaw = a.string(args, "cwd", projectRoot);
    const cwd = path.isAbsolute(cwdRaw) ? cwdRaw : path.join(projectRoot, cwdRaw);
    const coverage = a.boolean(args, "coverage", false);
    const filter = a.stringOptional(args, "filter");
    const timeout = a.number(args, "timeout", 120000);

    let command = testCommand;
    if (!command) {
      const framework = detectTestFramework(cwd);
      command = getTestCommand(framework, { coverage, filter });
    }

    const testResult = await runTests(command, cwd, { timeout });

    return successResponse({
      command,
      success: testResult.result.success,
      summary: {
        passed: testResult.passed,
        failed: testResult.failed,
        skipped: testResult.skipped,
        duration: `${(testResult.result.duration / 1000).toFixed(2)}s`,
        coverage: testResult.coverage ? `${testResult.coverage.toFixed(1)}%` : "not available",
      },
      failures: testResult.failures.slice(0, 10),
      hasMoreFailures: testResult.failures.length > 10,
    });
  })
  .registerQuick("analyze_coverage", async (args) => {
    const projectRoot = config().projectRoot;
    const coverageDir = a.stringOptional(args, "coverageDir");
    const report = await analyzeCoverage(projectRoot, coverageDir);

    return successResponse({
      summary: {
        total: `${report.totalCoverage.toFixed(1)}%`,
        lines: `${report.lineCoverage.toFixed(1)}%`,
        branches: `${report.branchCoverage.toFixed(1)}%`,
        functions: `${report.functionCoverage.toFixed(1)}%`,
      },
      gaps: report.gaps.slice(0, 20),
      suggestions: report.suggestions,
      meetsTarget: report.totalCoverage >= 80,
    });
  })
  .registerQuick("find_untested_files", async (args) => {
    const projectRoot = config().projectRoot;
    const cwdRaw = a.string(args, "cwd", projectRoot);
    const cwd = path.isAbsolute(cwdRaw) ? cwdRaw : path.join(projectRoot, cwdRaw);
    const sourceGlob = a.stringOptional(args, "sourceGlob");
    const testGlob = a.stringOptional(args, "testGlob");

    const untestedFiles = await findUntestedFiles(cwd, {
      sourceGlob,
      testGlob,
    });

    return successResponse({
      count: untestedFiles.length,
      files: untestedFiles.slice(0, 30),
      hasMore: untestedFiles.length > 30,
      suggestion:
        untestedFiles.length > 0
          ? `${untestedFiles.length} source files don't have tests. Consider adding test files for the most critical ones first.`
          : "All source files appear to have corresponding test files.",
    });
  })
  .register("suggest_tests", async (args) => {
    const projectRoot = config().projectRoot;
    let code = a.stringOptional(args, "code");
    const file = a.stringOptional(args, "file");
    const language = a.string(args, "language");

    if (!code && file) {
      const fullPath = path.isAbsolute(file) ? file : path.join(projectRoot, file);
      if (fs.existsSync(fullPath)) {
        code = fs.readFileSync(fullPath, "utf-8");
      }
    }

    if (!code) {
      return errorResponse("Either code or file must be provided");
    }

    const suggestions = suggestTestsForCode(code, language);
    const analysis = analyzeForTests(code, language);

    return successResponse({
      codeAnalysis: {
        functions: analysis.functions.map((f) => f.name),
        classes: analysis.classes.map((c) => c.name),
      },
      testSuggestions: suggestions,
      priorityOrder: suggestions
        .sort((a, b) => {
          const priorityOrder = { high: 0, medium: 1, low: 2 };
          return priorityOrder[a.priority] - priorityOrder[b.priority];
        })
        .map((s) => s.type),
    });
  })
  .registerQuick("get_test_command", async (args) => {
    const projectRoot = config().projectRoot;
    const cwdRaw = a.string(args, "cwd", projectRoot);
    const cwd = path.isAbsolute(cwdRaw) ? cwdRaw : path.join(projectRoot, cwdRaw);
    let framework = a.stringOptional(args, "framework");
    const coverage = a.boolean(args, "coverage", false);
    const filter = a.stringOptional(args, "filter");

    if (!framework) {
      framework = detectTestFramework(cwd);
    }

    const command = getTestCommand(framework, { coverage, filter });

    return successResponse({
      framework,
      command,
      withCoverage: coverage
        ? getTestCommand(framework, { coverage: true, filter })
        : undefined,
    });
  });

export const testingModule = createModule(tools, dispatcher);
