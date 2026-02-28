/**
 * Coverage Analyzer - Analyze code coverage and identify gaps
 */

import * as fs from "fs";
import * as path from "path";
import fg from "fast-glob";

export interface CoverageGap {
  file: string;
  type: "function" | "class" | "branch" | "line";
  name?: string;
  line?: number;
  description: string;
  priority: "high" | "medium" | "low";
  suggestedTest: string;
}

export interface CoverageReport {
  totalCoverage: number;
  lineCoverage: number;
  branchCoverage: number;
  functionCoverage: number;
  gaps: CoverageGap[];
  suggestions: string[];
}

/**
 * Analyze coverage report and identify gaps
 */
export async function analyzeCoverage(
  projectRoot: string,
  coverageDir?: string
): Promise<CoverageReport> {
  const report: CoverageReport = {
    totalCoverage: 0,
    lineCoverage: 0,
    branchCoverage: 0,
    functionCoverage: 0,
    gaps: [],
    suggestions: [],
  };

  const coveragePath = coverageDir || path.join(projectRoot, "coverage");
  const coverageJsonPath = path.join(coveragePath, "coverage-summary.json");
  const lcovPath = path.join(coveragePath, "lcov.info");

  if (fs.existsSync(coverageJsonPath)) {
    parseCoverageJson(coverageJsonPath, report);
  } else if (fs.existsSync(lcovPath)) {
    parseLcov(lcovPath, report);
  }

  // Generate suggestions based on gaps
  generateSuggestions(report);

  return report;
}

function parseCoverageJson(coverageJsonPath: string, report: CoverageReport): void {
  try {
    const coverage = JSON.parse(fs.readFileSync(coverageJsonPath, "utf-8"));
    const total = coverage.total;

    report.lineCoverage = total.lines?.pct || 0;
    report.branchCoverage = total.branches?.pct || 0;
    report.functionCoverage = total.functions?.pct || 0;
    report.totalCoverage =
      (report.lineCoverage + report.branchCoverage + report.functionCoverage) / 3;

    // Find files with low coverage
    for (const [filePath, data] of Object.entries(coverage)) {
      if (filePath === "total") continue;
      const fileData = data as {
        lines?: { pct: number };
        functions?: { pct: number };
        branches?: { pct: number };
      };

      if (fileData.lines && fileData.lines.pct < 80) {
        report.gaps.push({
          file: filePath,
          type: "line",
          description: `Only ${fileData.lines.pct}% line coverage`,
          priority: fileData.lines.pct < 50 ? "high" : "medium",
          suggestedTest: `Add tests covering more lines in ${path.basename(filePath)}`,
        });
      }

      if (fileData.functions && fileData.functions.pct < 80) {
        report.gaps.push({
          file: filePath,
          type: "function",
          description: `Only ${fileData.functions.pct}% function coverage`,
          priority: fileData.functions.pct < 50 ? "high" : "medium",
          suggestedTest: `Add tests for untested functions in ${path.basename(filePath)}`,
        });
      }

      if (fileData.branches && fileData.branches.pct < 80) {
        report.gaps.push({
          file: filePath,
          type: "branch",
          description: `Only ${fileData.branches.pct}% branch coverage`,
          priority: "medium",
          suggestedTest: `Add tests for edge cases and conditional branches in ${path.basename(filePath)}`,
        });
      }
    }
  } catch {
    // Ignore parse errors
  }
}

function parseLcov(lcovPath: string, report: CoverageReport): void {
  try {
    const lcov = fs.readFileSync(lcovPath, "utf-8");
    const files = lcov.split("end_of_record");

    let totalLines = 0;
    let coveredLines = 0;
    let totalFunctions = 0;
    let coveredFunctions = 0;
    let totalBranches = 0;
    let coveredBranches = 0;

    for (const fileBlock of files) {
      const sfMatch = fileBlock.match(/SF:(.+)/);
      const lhMatch = fileBlock.match(/LH:(\d+)/);
      const lfMatch = fileBlock.match(/LF:(\d+)/);
      const fnhMatch = fileBlock.match(/FNH:(\d+)/);
      const fnfMatch = fileBlock.match(/FNF:(\d+)/);
      const brhMatch = fileBlock.match(/BRH:(\d+)/);
      const brfMatch = fileBlock.match(/BRF:(\d+)/);

      if (lfMatch && lhMatch) {
        totalLines += parseInt(lfMatch[1], 10);
        coveredLines += parseInt(lhMatch[1], 10);
      }

      if (fnfMatch && fnhMatch) {
        totalFunctions += parseInt(fnfMatch[1], 10);
        coveredFunctions += parseInt(fnhMatch[1], 10);
      }

      if (brfMatch && brhMatch) {
        totalBranches += parseInt(brfMatch[1], 10);
        coveredBranches += parseInt(brhMatch[1], 10);
      }

      // Check for low coverage files
      if (sfMatch && lfMatch && lhMatch) {
        const fileCoverage =
          (parseInt(lhMatch[1], 10) / parseInt(lfMatch[1], 10)) * 100;
        if (fileCoverage < 80) {
          report.gaps.push({
            file: sfMatch[1],
            type: "line",
            description: `Only ${fileCoverage.toFixed(1)}% line coverage`,
            priority: fileCoverage < 50 ? "high" : "medium",
            suggestedTest: `Add tests for ${path.basename(sfMatch[1])}`,
          });
        }
      }
    }

    report.lineCoverage = totalLines > 0 ? (coveredLines / totalLines) * 100 : 0;
    report.functionCoverage =
      totalFunctions > 0 ? (coveredFunctions / totalFunctions) * 100 : 0;
    report.branchCoverage =
      totalBranches > 0 ? (coveredBranches / totalBranches) * 100 : 0;
    report.totalCoverage =
      (report.lineCoverage + report.functionCoverage + report.branchCoverage) / 3;
  } catch {
    // Ignore parse errors
  }
}

function generateSuggestions(report: CoverageReport): void {
  if (report.gaps.length > 0) {
    const highPriority = report.gaps.filter((g) => g.priority === "high");

    if (highPriority.length > 0) {
      report.suggestions.push(
        `Focus on ${highPriority.length} high-priority coverage gaps first`
      );
    }

    if (report.branchCoverage < report.lineCoverage - 20) {
      report.suggestions.push(
        "Branch coverage is significantly lower than line coverage - add edge case tests"
      );
    }

    if (report.functionCoverage < 80) {
      report.suggestions.push("Consider adding tests for untested functions");
    }
  }

  if (report.totalCoverage < 80) {
    report.suggestions.push(
      `Aim for 80% coverage - currently at ${report.totalCoverage.toFixed(1)}%`
    );
  }
}

/**
 * Find source files that don't have corresponding test files
 */
export async function findUntestedFiles(
  projectRoot: string,
  options?: {
    sourceGlob?: string;
    testGlob?: string;
    exclude?: string[];
  }
): Promise<Array<{ source: string; suggestedTestFile: string }>> {
  const {
    sourceGlob = "src/**/*.{ts,tsx,js,jsx}",
    testGlob = "**/*.{test,spec}.{ts,tsx,js,jsx}",
    exclude = ["**/node_modules/**", "**/dist/**", "**/coverage/**"],
  } = options || {};

  const sourceFiles = await fg(sourceGlob, {
    cwd: projectRoot,
    ignore: exclude,
  });

  const testFiles = await fg(testGlob, {
    cwd: projectRoot,
    ignore: exclude,
  });

  // Create a set of tested files (normalize names)
  const testedFiles = new Set<string>();
  for (const testFile of testFiles) {
    const baseName = path
      .basename(testFile)
      .replace(/\.(test|spec)\.(ts|tsx|js|jsx)$/, ".$2");
    testedFiles.add(baseName);

    const matchingSourcePattern = baseName.replace(/\.[^.]+$/, "");
    testedFiles.add(matchingSourcePattern);
  }

  const untestedFiles: Array<{ source: string; suggestedTestFile: string }> = [];

  for (const sourceFile of sourceFiles) {
    const baseName = path.basename(sourceFile);
    const baseNameNoExt = baseName.replace(/\.[^.]+$/, "");

    // Skip if it's a test file itself or index file
    if (
      baseName.includes(".test.") ||
      baseName.includes(".spec.") ||
      baseName === "index.ts" ||
      baseName === "index.js"
    ) {
      continue;
    }

    // Check if there's a corresponding test file
    const hasTest =
      testedFiles.has(baseName) ||
      testedFiles.has(baseNameNoExt) ||
      testFiles.some(
        (t) =>
          t.includes(baseNameNoExt + ".test.") ||
          t.includes(baseNameNoExt + ".spec.")
      );

    if (!hasTest) {
      const ext = path.extname(sourceFile);
      const suggestedTestFile = sourceFile.replace(ext, `.test${ext}`);

      untestedFiles.push({
        source: sourceFile,
        suggestedTestFile,
      });
    }
  }

  return untestedFiles;
}

/**
 * Suggest specific tests based on code patterns
 */
export function suggestTestsForCode(
  code: string,
  _language: string
): Array<{
  type: string;
  description: string;
  priority: "high" | "medium" | "low";
}> {
  const suggestions: Array<{
    type: string;
    description: string;
    priority: "high" | "medium" | "low";
  }> = [];

  // Check for error handling patterns
  if (code.includes("try") || code.includes("catch") || code.includes("throw")) {
    suggestions.push({
      type: "error_handling",
      description:
        "Test error handling paths - verify correct exceptions are thrown and caught",
      priority: "high",
    });
  }

  // Check for async code
  if (code.includes("async") || code.includes("await") || code.includes("Promise")) {
    suggestions.push({
      type: "async",
      description: "Test async behavior - verify promises resolve/reject correctly",
      priority: "high",
    });
  }

  // Check for conditional logic
  const conditionalCount = (code.match(/if\s*\(/g) || []).length;
  if (conditionalCount > 2) {
    suggestions.push({
      type: "conditionals",
      description: `${conditionalCount} conditionals found - test each branch`,
      priority: "medium",
    });
  }

  // Check for loops
  if (
    code.includes("for") ||
    code.includes("while") ||
    code.includes(".map") ||
    code.includes(".forEach")
  ) {
    suggestions.push({
      type: "loops",
      description: "Test loop behavior - empty arrays, single item, multiple items",
      priority: "medium",
    });
  }

  // Check for external calls
  if (code.includes("fetch") || code.includes("axios") || code.includes("http")) {
    suggestions.push({
      type: "external_calls",
      description: "Mock external HTTP calls - test success and failure scenarios",
      priority: "high",
    });
  }

  // Check for database operations
  if (
    code.includes("query") ||
    code.includes("insert") ||
    code.includes("update") ||
    code.includes("delete")
  ) {
    suggestions.push({
      type: "database",
      description: "Test database operations - use transactions or mocks",
      priority: "high",
    });
  }

  // Check for validation
  if (code.includes("validate") || code.includes("check") || code.includes("assert")) {
    suggestions.push({
      type: "validation",
      description: "Test validation logic - valid and invalid inputs",
      priority: "medium",
    });
  }

  // Check for boundary conditions
  if (code.includes("length") || code.includes("size") || code.includes("count")) {
    suggestions.push({
      type: "boundaries",
      description: "Test boundary conditions - zero, one, many, max values",
      priority: "medium",
    });
  }

  return suggestions;
}
