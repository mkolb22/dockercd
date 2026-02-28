/**
 * Execution Loop / Repair Tools
 * Provides self-repair and iterative refinement capabilities for code
 */

import * as path from "path";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ExecutionResult } from "../../core/types.js";
import { successResponse, args as a } from "../../utils/responses.js";
import { createDispatcher, createModule } from "../../core/dispatcher.js";
import { config } from "../../core/config.js";
import { createLazyLoader } from "../../utils/lazy.js";
import { executeCode, runTests, parseError } from "../../utils/execution.js";
import {
  RepairStore,
  selectStrategy,
  generateRepairSuggestion,
  hashCode,
  REPAIR_STRATEGIES,
} from "./repairer.js";

const getStore = createLazyLoader(() => new RepairStore(config().stateDbPath));

export const tools: Tool[] = [
  {
    name: "run_with_verification",
    description:
      "Execute code, capture errors, and provide repair suggestions. Supports iterative refinement up to N attempts.",
    inputSchema: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "The code to execute",
        },
        language: {
          type: "string",
          enum: ["typescript", "javascript", "python", "go", "rust", "bash"],
          description: "Programming language of the code",
        },
        testCommand: {
          type: "string",
          description: "Optional test command to verify the code works correctly",
        },
        maxIterations: {
          type: "number",
          description: "Maximum repair iterations (default: 3)",
          default: 3,
        },
        timeout: {
          type: "number",
          description: "Execution timeout in milliseconds (default: 30000)",
          default: 30000,
        },
        cwd: {
          type: "string",
          description: "Working directory for execution",
        },
      },
      required: ["code", "language"],
    },
  },
  {
    name: "self_debug",
    description:
      "Given failing code and an error, diagnose the issue and provide a detailed fix suggestion",
    inputSchema: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "The failing code",
        },
        error: {
          type: "string",
          description: "The error message or stack trace",
        },
        language: {
          type: "string",
          description: "Programming language",
        },
        contextFiles: {
          type: "array",
          items: { type: "string" },
          description: "Additional context files that may help diagnose",
        },
      },
      required: ["code", "error", "language"],
    },
  },
  {
    name: "iterative_refine",
    description: "Perform multiple improvement passes on code, verifying each change",
    inputSchema: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "The code to refine",
        },
        language: {
          type: "string",
          description: "Programming language",
        },
        goals: {
          type: "array",
          items: { type: "string" },
          description:
            "List of improvement goals (e.g., 'add error handling', 'improve performance')",
        },
        testCommand: {
          type: "string",
          description: "Test command to verify refinements don't break anything",
        },
        maxPasses: {
          type: "number",
          description: "Maximum refinement passes (default: 5)",
          default: 5,
        },
      },
      required: ["code", "language", "goals"],
    },
  },
  {
    name: "run_tests_with_repair",
    description:
      "Run tests and if they fail, provide repair suggestions based on the failures",
    inputSchema: {
      type: "object",
      properties: {
        testCommand: {
          type: "string",
          description: "The test command to run (e.g., 'npm test', 'pytest')",
        },
        cwd: {
          type: "string",
          description: "Working directory for tests",
        },
        targetFiles: {
          type: "array",
          items: { type: "string" },
          description: "Files that may need repair if tests fail",
        },
        maxRetries: {
          type: "number",
          description: "Maximum test retry attempts (default: 3)",
          default: 3,
        },
      },
      required: ["testCommand"],
    },
  },
  {
    name: "get_repair_history",
    description: "Get past repair attempts for similar errors to inform fixes",
    inputSchema: {
      type: "object",
      properties: {
        errorType: {
          type: "string",
          description: "Type of error to find repairs for",
        },
        limit: {
          type: "number",
          description: "Maximum number of repairs to return (default: 5)",
          default: 5,
        },
      },
      required: ["errorType"],
    },
  },
  {
    name: "list_repair_strategies",
    description: "List available repair strategies and when to use them",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

const dispatcher = createDispatcher();

dispatcher
  .registerLong("run_with_verification", async (args) => {
    const projectRoot = config().projectRoot;
    const code = a.string(args, "code");
    const language = a.string(args, "language");
    const testCommand = a.stringOptional(args, "testCommand");
    const maxIterations = a.number(args, "maxIterations", 3);
    const timeout = a.number(args, "timeout", 30000);
    const cwd = a.string(args, "cwd", projectRoot);

    const codeHash = hashCode(code);
    const iterations: Array<{
      iteration: number;
      result: ExecutionResult;
      repairSuggestion?: string;
    }> = [];

    let currentCode = code;
    let finalResult: ExecutionResult | null = null;

    for (let i = 0; i < maxIterations; i++) {
      const result = await executeCode(currentCode, language, { timeout, cwd });

      iterations.push({
        iteration: i + 1,
        result,
        repairSuggestion: undefined,
      });

      if (result.success) {
        if (testCommand) {
          const testResult = await runTests(testCommand, cwd, { timeout });
          if (!testResult.result.success || testResult.testsFailed > 0) {
            const errorInfo = parseError(testResult.result.stderr, language);
            const suggestion = generateRepairSuggestion(
              currentCode,
              "test_failure",
              `${testResult.testsFailed} tests failed`,
              errorInfo.file,
              errorInfo.line,
              language
            );

            iterations[i].repairSuggestion = suggestion;

            getStore().recordAttempt(
              codeHash,
              currentCode,
              "test_failure",
              testResult.result.stderr,
              "test_failure",
              suggestion,
              i + 1
            );

            // Cannot auto-apply text suggestion; return for caller to fix and re-invoke
            finalResult = result;
            break;
          }
        }

        finalResult = result;
        break;
      }

      const errorInfo = parseError(result.stderr, language);
      const { strategy } = selectStrategy(
        errorInfo.errorType,
        errorInfo.message,
        language
      );

      const suggestion = generateRepairSuggestion(
        currentCode,
        errorInfo.errorType,
        errorInfo.message,
        errorInfo.file,
        errorInfo.line,
        language
      );

      iterations[i].repairSuggestion = suggestion;

      getStore().recordAttempt(
        codeHash,
        currentCode,
        errorInfo.errorType,
        errorInfo.message,
        strategy,
        suggestion,
        i + 1
      );

      const pastRepairs = getStore().findSimilarRepairs(errorInfo.errorType, 3);
      if (pastRepairs.length > 0) {
        iterations[i].repairSuggestion +=
          "\n\n## Similar Past Repairs\n" +
          pastRepairs
            .map(
              (r, idx) =>
                `${idx + 1}. Strategy: ${r.strategy}\n   Suggestion: ${r.suggestion}\n`
            )
            .join("\n");
      }

      // Cannot auto-apply text suggestion; return for caller to fix and re-invoke
      finalResult = result;
      break;
    }

    return successResponse({
      success: finalResult?.success || false,
      totalIterations: iterations.length,
      iterations: iterations.map((it) => ({
        iteration: it.iteration,
        success: it.result.success,
        stdout: it.result.stdout.slice(0, 1000),
        stderr: it.result.stderr.slice(0, 1000),
        exitCode: it.result.exitCode,
        duration: it.result.duration,
        repairSuggestion: it.repairSuggestion,
      })),
      finalOutput: finalResult?.stdout.slice(0, 2000),
      requiresManualRepair: !finalResult?.success,
    });
  })
  .register("self_debug", async (args) => {
    const code = a.string(args, "code");
    const error = a.string(args, "error");
    const language = a.string(args, "language");

    const errorInfo = parseError(error, language);
    const { strategy } = selectStrategy(
      errorInfo.errorType,
      errorInfo.message,
      language
    );

    const suggestion = generateRepairSuggestion(
      code,
      errorInfo.errorType,
      errorInfo.message,
      errorInfo.file,
      errorInfo.line,
      language
    );

    const pastRepairs = getStore().findSimilarRepairs(errorInfo.errorType, 5);

    return successResponse({
      diagnosis: {
        errorType: errorInfo.errorType,
        message: errorInfo.message,
        location: errorInfo.file
          ? {
              file: errorInfo.file,
              line: errorInfo.line,
              column: errorInfo.column,
            }
          : null,
      },
      strategy: {
        name: REPAIR_STRATEGIES[strategy]?.name || strategy,
        description: REPAIR_STRATEGIES[strategy]?.description || "",
      },
      repairSuggestion: suggestion,
      pastSuccessfulRepairs: pastRepairs.map((r) => ({
        errorMessage: r.errorMessage.slice(0, 200),
        strategy: r.strategy,
        fixApproach: r.suggestion.slice(0, 500),
      })),
    });
  })
  .register("iterative_refine", async (args) => {
    const projectRoot = config().projectRoot;
    const code = a.string(args, "code");
    const language = a.string(args, "language");
    const goals = a.array<string>(args, "goals");
    const testCommand = a.stringOptional(args, "testCommand");
    const maxPasses = a.number(args, "maxPasses", 5);

    const refinements: Array<{
      pass: number;
      goal: string;
      suggestion: string;
      verified: boolean;
    }> = [];

    let currentCode = code;

    for (let pass = 0; pass < Math.min(maxPasses, goals.length); pass++) {
      const goal = goals[pass];

      const suggestion = `## Refinement Pass ${pass + 1}: ${goal}

### Goal
${goal}

### Current Code
\`\`\`${language}
${currentCode}
\`\`\`

### Suggested Approach
Based on the goal "${goal}", consider:
1. Identify the specific parts of the code that relate to this goal
2. Make minimal, focused changes to achieve the goal
3. Ensure changes don't break existing functionality
${pass > 0 ? "\n### Note\nThis suggestion assumes all prior refinement suggestions have been applied.\n" : ""}
### Verification
${testCommand ? `Run \`${testCommand}\` to verify the refinement works` : "Manually verify the refinement achieves the goal"}
`;

      let verified = false;
      if (testCommand && pass === 0) {
        // Only verify on first pass; subsequent passes can't verify without applied changes
        const testResult = await runTests(testCommand, projectRoot);
        verified = testResult.result.success && testResult.testsFailed === 0;
      }

      refinements.push({
        pass: pass + 1,
        goal,
        suggestion,
        verified,
      });
    }

    return successResponse({
      totalPasses: refinements.length,
      refinements,
      remainingGoals: goals.slice(refinements.length),
      summary: `Generated ${refinements.length} refinement suggestions for the provided goals. Apply each refinement sequentially and verify before proceeding to the next.`,
    });
  })
  .registerLong("run_tests_with_repair", async (args) => {
    const projectRoot = config().projectRoot;
    const testCommand = a.string(args, "testCommand");
    const cwdRaw = a.string(args, "cwd", projectRoot);
    const cwd = path.isAbsolute(cwdRaw) ? cwdRaw : path.join(projectRoot, cwdRaw);
    const targetFiles = a.array<string>(args, "targetFiles");
    const maxRetries = a.number(args, "maxRetries", 3);

    const attempts: Array<{
      attempt: number;
      passed: number;
      failed: number;
      skipped: number;
      repairSuggestions: string[];
    }> = [];

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const testResult = await runTests(testCommand, cwd);

      const repairSuggestions: string[] = [];

      if (!testResult.result.success || testResult.testsFailed > 0) {
        const suggestion = `## Test Failure Repair Suggestion

### Failed Tests
${testResult.testsFailed} test(s) failed

### Error Output
\`\`\`
${testResult.result.stderr.slice(0, 2000)}
\`\`\`

### Repair Approach
1. Analyze the failing test assertions
2. Identify what the test expects vs what the code produces
3. Fix the implementation, not the test (unless the test is clearly wrong)
4. Consider edge cases that might be causing failures

${targetFiles.length > 0 ? `### Files to Check\n${targetFiles.map((f) => `- ${f}`).join("\n")}` : ""}
`;

        repairSuggestions.push(suggestion);
      }

      attempts.push({
        attempt: attempt + 1,
        passed: testResult.testsPassed,
        failed: testResult.testsFailed,
        skipped: testResult.testsSkipped,
        repairSuggestions,
      });

      if (testResult.result.success && testResult.testsFailed === 0) {
        break;
      }

      // Cannot auto-fix; return suggestion for caller to apply and re-invoke
      break;
    }

    const lastAttempt = attempts[attempts.length - 1];

    return successResponse({
      success: lastAttempt.failed === 0,
      totalAttempts: attempts.length,
      finalResults: {
        passed: lastAttempt.passed,
        failed: lastAttempt.failed,
        skipped: lastAttempt.skipped,
      },
      attempts,
      requiresManualFix: lastAttempt.failed > 0,
    });
  })
  .registerQuick("get_repair_history", async (args) => {
    const errorType = a.string(args, "errorType");
    const limit = a.number(args, "limit", 5);

    const repairs = getStore().findSimilarRepairs(errorType, limit);

    return successResponse({
      errorType,
      count: repairs.length,
      repairs: repairs.map((r) => ({
        errorMessage: r.errorMessage.slice(0, 300),
        strategy: r.strategy,
        suggestion: r.suggestion.slice(0, 500),
        hasFixedCode: !!r.fixedCode,
      })),
    });
  })
  .registerQuick("list_repair_strategies", async () => {
    return successResponse({
      strategies: Object.entries(REPAIR_STRATEGIES).map(([key, value]) => ({
        id: key,
        name: value.name,
        description: value.description,
        useCases: value.prompt.split("\n").slice(1, 5).join(" "),
      })),
    });
  });

export const repairModule = createModule(tools, dispatcher);
