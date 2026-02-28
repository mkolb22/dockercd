/**
 * Shared Command Execution Utilities
 * Provides common patterns for spawning processes and parsing output
 */

import { spawn, SpawnOptions } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { ExecutionResult } from "../core/types.js";

export interface ExecutionOptions {
  timeout?: number;
  cwd?: string;
  env?: Record<string, string>;
}

/**
 * Execute a command and capture results
 */
export async function executeCommand(
  command: string,
  args: string[],
  options: ExecutionOptions = {}
): Promise<ExecutionResult> {
  const startTime = Date.now();
  const timeout = options.timeout || 30000;

  return new Promise((resolve) => {
    const spawnOptions: SpawnOptions = {
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...options.env },
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    };

    const proc = spawn(command, args, spawnOptions);

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      resolve({
        success: false,
        stdout,
        stderr,
        exitCode: null,
        duration: Date.now() - startTime,
        error: `Execution timed out after ${timeout}ms`,
      });
    }, timeout);

    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        success: code === 0,
        stdout,
        stderr,
        exitCode: code,
        duration: Date.now() - startTime,
      });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        success: false,
        stdout,
        stderr,
        exitCode: null,
        duration: Date.now() - startTime,
        error: err.message,
      });
    });
  });
}

/**
 * Execute a shell command string
 */
export async function executeShell(
  command: string,
  options: ExecutionOptions = {}
): Promise<ExecutionResult> {
  // Pass command directly — shell: true in executeCommand already wraps in /bin/sh -c
  return executeCommand(command, [], options);
}

/**
 * Execute code in a temporary file
 */
export async function executeCode(
  code: string,
  language: string,
  options: ExecutionOptions = {}
): Promise<ExecutionResult> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zen-exec-"));

  try {
    const execution = getLanguageExecution(language, code, tempDir);
    if (!execution) {
      return {
        success: false,
        stdout: "",
        stderr: "",
        exitCode: null,
        duration: 0,
        error: `Unsupported language: ${language}`,
      };
    }

    fs.writeFileSync(path.join(tempDir, execution.filename), code);

    // Handle languages that need compilation first
    if (execution.compile) {
      const compileResult = await executeCommand(
        execution.compile.command,
        execution.compile.args,
        options
      );
      if (!compileResult.success) {
        return compileResult;
      }
    }

    return await executeCommand(execution.run.command, execution.run.args, {
      ...options,
      cwd: options.cwd || tempDir,
    });
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

interface LanguageExecution {
  filename: string;
  compile?: { command: string; args: string[] };
  run: { command: string; args: string[] };
}

function getLanguageExecution(
  language: string,
  _code: string,
  tempDir: string
): LanguageExecution | null {
  const filePath = (name: string) => path.join(tempDir, name);

  switch (language.toLowerCase()) {
    case "typescript":
    case "ts":
      return {
        filename: "code.ts",
        run: { command: "npx", args: ["tsx", filePath("code.ts")] },
      };

    case "javascript":
    case "js":
      return {
        filename: "code.js",
        run: { command: "node", args: [filePath("code.js")] },
      };

    case "python":
    case "py":
      return {
        filename: "code.py",
        run: { command: "python3", args: [filePath("code.py")] },
      };

    case "go":
      return {
        filename: "main.go",
        run: { command: "go", args: ["run", filePath("main.go")] },
      };

    case "rust":
      return {
        filename: "main.rs",
        compile: {
          command: "rustc",
          args: [filePath("main.rs"), "-o", filePath("main")],
        },
        run: { command: filePath("main"), args: [] },
      };

    case "bash":
    case "sh":
      return {
        filename: "script.sh",
        run: { command: "bash", args: [filePath("script.sh")] },
      };

    default:
      return null;
  }
}

/**
 * Test result from running tests
 */
export interface TestRunResult {
  result: ExecutionResult;
  passed: number;
  failed: number;
  skipped: number;
  coverage?: number;
  failures: TestFailure[];
  // Aliases for backward compatibility
  testsPassed: number;
  testsFailed: number;
  testsSkipped: number;
}

export interface TestFailure {
  testName: string;
  file?: string;
  line?: number;
  message: string;
  expected?: string;
  actual?: string;
  stack?: string;
}

/**
 * Run tests and parse results
 */
export async function runTests(
  command: string,
  cwd: string,
  options: ExecutionOptions = {}
): Promise<TestRunResult> {
  const result = await executeShell(command, {
    ...options,
    cwd,
    timeout: options.timeout || 120000,
    env: { CI: "true", NO_COLOR: "1" },
  });

  const output = result.stdout + result.stderr;
  const parsed = parseTestOutput(output, command);

  return {
    result,
    passed: parsed.passed,
    failed: parsed.failed,
    skipped: parsed.skipped,
    coverage: parsed.coverage,
    failures: parsed.failures,
    // Aliases for backward compatibility
    testsPassed: parsed.passed,
    testsFailed: parsed.failed,
    testsSkipped: parsed.skipped,
  };
}

/**
 * Parse test output to extract structured results
 */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

function parseTestOutput(
  output: string,
  command: string
): {
  passed: number;
  failed: number;
  skipped: number;
  coverage?: number;
  failures: TestFailure[];
} {
  const result = {
    passed: 0,
    failed: 0,
    skipped: 0,
    coverage: undefined as number | undefined,
    failures: [] as TestFailure[],
  };

  // Strip ANSI escape codes before parsing (some tools ignore NO_COLOR)
  const clean = stripAnsi(output);

  // Detect framework from command and output
  if (isJestVitest(command, clean)) {
    parseJestVitest(clean, result);
  } else if (isPytest(command, clean)) {
    parsePytest(clean, result);
  } else if (isGoTest(command, clean)) {
    parseGo(clean, result);
  } else if (isMocha(command, clean)) {
    parseMocha(clean, result);
  }

  return result;
}

function isJestVitest(command: string, output: string): boolean {
  return (
    command.includes("jest") ||
    command.includes("vitest") ||
    output.includes("PASS") ||
    output.includes("vitest")
  );
}

function isPytest(command: string, output: string): boolean {
  return command.includes("pytest") || output.includes("pytest");
}

function isGoTest(command: string, _output: string): boolean {
  return command.includes("go test");
}

function isMocha(command: string, _output: string): boolean {
  return command.includes("mocha");
}

interface ParseResult {
  passed: number;
  failed: number;
  skipped: number;
  coverage?: number;
  failures: TestFailure[];
}

function parseJestVitest(output: string, result: ParseResult): void {
  // Jest format: "Tests: 5 passed, 2 failed, 1 skipped"
  const jestSummaryMatch = output.match(
    /Tests:\s+(\d+)\s+passed(?:,\s+(\d+)\s+failed)?(?:,\s+(\d+)\s+skipped)?/i
  );
  if (jestSummaryMatch) {
    result.passed = parseInt(jestSummaryMatch[1], 10) || 0;
    result.failed = parseInt(jestSummaryMatch[2], 10) || 0;
    result.skipped = parseInt(jestSummaryMatch[3], 10) || 0;
  }

  // Vitest format: "Tests  3 failed | 2 skipped | 417 passed (422)"
  // Match the "Tests" line specifically (not "Test Files") using line-start anchor
  const vitestTestsMatch = output.match(
    /^\s*Tests\s+(.+)/m
  );
  if (vitestTestsMatch) {
    const line = vitestTestsMatch[1];
    const passedMatch = line.match(/(\d+)\s+passed/);
    const failedMatch = line.match(/(\d+)\s+failed/);
    const skippedMatch = line.match(/(\d+)\s+skipped/);
    if (passedMatch) result.passed = parseInt(passedMatch[1], 10);
    if (failedMatch) result.failed = parseInt(failedMatch[1], 10);
    if (skippedMatch) result.skipped = parseInt(skippedMatch[1], 10);
  }

  // Fallback: generic "N passed" / "N failed" (only if nothing matched above)
  if (result.passed === 0 && result.failed === 0) {
    const altMatch = output.match(/(\d+) passed/);
    const altFailMatch = output.match(/(\d+) failed/);
    if (altMatch) result.passed = parseInt(altMatch[1], 10);
    if (altFailMatch) result.failed = parseInt(altFailMatch[1], 10);
  }

  // Coverage: "All files     |  85.5 %"
  const coverageMatch = output.match(/All files[^\d]*(\d+(?:\.\d+)?)\s*%/);
  if (coverageMatch) {
    result.coverage = parseFloat(coverageMatch[1]);
  }

  // Parse failures — jest format
  const jestFailureRegex =
    /FAIL\s+([^\n]+)\n[\s\S]*?●\s+([^\n]+)\n([\s\S]*?)(?=\n\s*●|\n\s*PASS|\n\s*FAIL|$)/g;
  let match;
  while ((match = jestFailureRegex.exec(output)) !== null) {
    const file = match[1].trim();
    const testName = match[2].trim();
    const details = match[3];

    const expectedMatch = details.match(/Expected[:\s]+([^\n]+)/);
    const actualMatch = details.match(/Received[:\s]+([^\n]+)/);

    result.failures.push({
      testName,
      file,
      message: details.split("\n")[0].trim(),
      expected: expectedMatch?.[1],
      actual: actualMatch?.[1],
      stack: details,
    });
  }

  // Parse failures — vitest format: "FAIL  src/file.ts > describe > test name"
  const vitestFailureRegex =
    /^\s*[×✗]\s+(.+?)(?:\s+\d+ms)?$/gm;
  while ((match = vitestFailureRegex.exec(output)) !== null) {
    const testName = match[1].trim();
    // Only add if not already captured by jest parser
    if (!result.failures.some(f => f.testName === testName)) {
      result.failures.push({
        testName,
        message: testName,
      });
    }
  }
}

function parsePytest(output: string, result: ParseResult): void {
  const summaryMatch = output.match(
    /(\d+)\s+passed(?:,\s+(\d+)\s+failed)?(?:,\s+(\d+)\s+skipped)?/i
  );
  if (summaryMatch) {
    result.passed = parseInt(summaryMatch[1], 10) || 0;
    result.failed = parseInt(summaryMatch[2], 10) || 0;
    result.skipped = parseInt(summaryMatch[3], 10) || 0;
  }

  // Coverage: "TOTAL      100     10    90%"
  const coverageMatch = output.match(/TOTAL\s+\d+\s+\d+\s+(\d+)%/);
  if (coverageMatch) {
    result.coverage = parseFloat(coverageMatch[1]);
  }

  // Parse failures
  const failureRegex = /FAILED\s+([^:]+)::([^\s]+)\s+-\s+([^\n]+)/g;
  let match;
  while ((match = failureRegex.exec(output)) !== null) {
    result.failures.push({
      testName: match[2],
      file: match[1],
      message: match[3],
    });
  }
}

function parseGo(output: string, result: ParseResult): void {
  const passMatch = output.match(/ok\s+/g);
  const failMatch = output.match(/FAIL\s+/g);

  result.passed = passMatch?.length || 0;
  result.failed = failMatch?.length || 0;

  // Coverage
  const coverageMatch = output.match(/coverage:\s+(\d+(?:\.\d+)?)/);
  if (coverageMatch) {
    result.coverage = parseFloat(coverageMatch[1]);
  }

  // Parse failures
  const failureRegex =
    /---\s+FAIL:\s+(\w+)\s+\(([^)]+)\)\n([\s\S]*?)(?=---\s+FAIL|FAIL\s+|ok\s+|$)/g;
  let match;
  while ((match = failureRegex.exec(output)) !== null) {
    result.failures.push({
      testName: match[1],
      message: match[3].trim(),
    });
  }
}

function parseMocha(output: string, result: ParseResult): void {
  const passMatch = output.match(/(\d+)\s+passing/);
  const failMatch = output.match(/(\d+)\s+failing/);
  const skipMatch = output.match(/(\d+)\s+pending/);

  result.passed = passMatch ? parseInt(passMatch[1], 10) : 0;
  result.failed = failMatch ? parseInt(failMatch[1], 10) : 0;
  result.skipped = skipMatch ? parseInt(skipMatch[1], 10) : 0;
}

/**
 * Get test command for common frameworks
 */
export function getTestCommand(
  framework: string,
  options?: {
    coverage?: boolean;
    watch?: boolean;
    filter?: string;
  }
): string {
  const { coverage = false, watch = false, filter } = options || {};

  const commands: Record<string, () => string[]> = {
    jest: () => [
      "npx jest",
      coverage ? "--coverage" : "",
      watch ? "--watch" : "",
      filter ? `--testNamePattern="${filter}"` : "",
    ],
    vitest: () => [
      "npx vitest run",
      coverage ? "--coverage" : "",
      watch ? "--watch" : "",
      filter ? `--filter "${filter}"` : "",
    ],
    pytest: () => ["pytest", coverage ? "--cov" : "", filter ? `-k "${filter}"` : "", "-v"],
    "go-test": () => [
      "go test",
      coverage ? "-cover" : "",
      filter ? `-run "${filter}"` : "",
      "./...",
    ],
    mocha: () => ["npx mocha", filter ? `--grep "${filter}"` : ""],
  };

  const buildCommand = commands[framework.toLowerCase()];
  if (buildCommand) {
    return buildCommand().filter(Boolean).join(" ");
  }
  return "npm test";
}

/**
 * Parse error messages to extract useful debugging information
 */
export function parseError(
  stderr: string,
  language: string
): {
  errorType: string;
  message: string;
  file?: string;
  line?: number;
  column?: number;
} {
  const parsers: Record<string, (stderr: string) => Partial<ErrorInfo>> = {
    typescript: parseJsError,
    javascript: parseJsError,
    python: parsePythonError,
    go: parseGoError,
    rust: parseRustError,
  };

  const result: ErrorInfo = {
    errorType: "unknown",
    message: stderr.trim(),
  };

  const parser = parsers[language.toLowerCase()];
  if (parser) {
    Object.assign(result, parser(stderr));
  }

  return result;
}

interface ErrorInfo {
  errorType: string;
  message: string;
  file?: string;
  line?: number;
  column?: number;
}

function parseJsError(stderr: string): Partial<ErrorInfo> {
  const result: Partial<ErrorInfo> = {};

  // TypeScript/JavaScript error: file.ts(10,5): error TS2322: ...
  const tsMatch = stderr.match(/(.+?)\((\d+),(\d+)\):\s*(error|warning)\s+(\w+):\s*(.+)/);
  if (tsMatch) {
    result.file = tsMatch[1];
    result.line = parseInt(tsMatch[2], 10);
    result.column = parseInt(tsMatch[3], 10);
    result.errorType = tsMatch[5];
    result.message = tsMatch[6];
    return result;
  }

  // Node.js error: file.js:10:5
  const nodeMatch = stderr.match(/at\s+(.+?):(\d+):(\d+)/);
  if (nodeMatch) {
    result.file = nodeMatch[1];
    result.line = parseInt(nodeMatch[2], 10);
    result.column = parseInt(nodeMatch[3], 10);
  }

  return result;
}

function parsePythonError(stderr: string): Partial<ErrorInfo> {
  const result: Partial<ErrorInfo> = {};

  // Python error: File "file.py", line 10
  const pyMatch = stderr.match(/File "(.+?)", line (\d+)/);
  if (pyMatch) {
    result.file = pyMatch[1];
    result.line = parseInt(pyMatch[2], 10);
  }

  // Error type: TypeError: ...
  const pyErrorMatch = stderr.match(/(\w+Error):\s*(.+)/);
  if (pyErrorMatch) {
    result.errorType = pyErrorMatch[1];
    result.message = pyErrorMatch[2];
  }

  return result;
}

function parseGoError(stderr: string): Partial<ErrorInfo> {
  const result: Partial<ErrorInfo> = {};

  // Go error: ./file.go:10:5: ...
  const goMatch = stderr.match(/(.+?):(\d+):(\d+):\s*(.+)/);
  if (goMatch) {
    result.file = goMatch[1];
    result.line = parseInt(goMatch[2], 10);
    result.column = parseInt(goMatch[3], 10);
    result.message = goMatch[4];
  }

  return result;
}

function parseRustError(stderr: string): Partial<ErrorInfo> {
  const result: Partial<ErrorInfo> = {};

  // Rust error: error[E0308]: ...
  const rustMatch = stderr.match(/error\[(\w+)\]:\s*(.+)/);
  if (rustMatch) {
    result.errorType = rustMatch[1];
    result.message = rustMatch[2];
  }

  // Location: --> file.rs:10:5
  const rustLocMatch = stderr.match(/--> (.+?):(\d+):(\d+)/);
  if (rustLocMatch) {
    result.file = rustLocMatch[1];
    result.line = parseInt(rustLocMatch[2], 10);
    result.column = parseInt(rustLocMatch[3], 10);
  }

  return result;
}
