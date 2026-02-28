/**
 * Classifier calibration test suite.
 *
 * Validates heuristic classifier behavior against a curated corpus
 * of task descriptions with expected complexity labels. Run after
 * any classifier tuning change to catch regressions.
 *
 * Current heuristic-only accuracy: ~56%.
 * Known limitations (documented as actionable issues):
 *   1. Score saturation: complex and expert both hit the 10.0 cap
 *      when multiple pattern categories trigger — no headroom to
 *      distinguish them.
 *   2. Vocabulary gaps: medium-complexity terms (caching, validation,
 *      pagination, middleware) aren't in any pattern dictionary.
 *   3. Short query bias: simple tasks without keywords are
 *      indistinguishable from trivial.
 *
 * These are heuristic-only issues. The full fusion pipeline (with
 * historical + semantic signals) is expected to perform better.
 */

import { describe, it, expect } from 'vitest';
import {
  TaskComplexityClassifier,
  DEFAULT_CLASSIFIER_CONFIG,
} from '../classifier.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Complexity = 'trivial' | 'simple' | 'medium' | 'complex' | 'expert';

interface CorpusEntry {
  readonly query: string;
  readonly expected: Complexity;
  readonly notes?: string;
}

interface CaseResult {
  readonly query: string;
  readonly expected: Complexity;
  readonly predicted: Complexity;
  readonly difficulty: number;
  readonly correct: boolean;
}

// ---------------------------------------------------------------------------
// Corpus — 16 entries across 5 complexity levels
//
// Entries use realistic task descriptions. Some intentionally lack
// pattern keywords to test classifier boundaries.
// ---------------------------------------------------------------------------

const CORPUS: readonly CorpusEntry[] = [
  // ── Trivial (3) ──────────────────────────────────────────────────────
  {
    query: 'Fix typo in README.md',
    expected: 'trivial',
  },
  {
    query: 'Rename variable from x to count',
    expected: 'trivial',
  },
  {
    query: 'Update copyright year in LICENSE file',
    expected: 'trivial',
  },

  // ── Simple (3) ───────────────────────────────────────────────────────
  {
    query: 'Add a --verbose flag to the CLI tool that enables debug log output to stderr when set',
    expected: 'simple',
  },
  {
    query: 'Write unit tests for the parseDate function in src/utils.ts covering edge cases like invalid input and timezone offsets',
    expected: 'simple',
  },
  {
    query: 'Change the default port from 3000 to 8080 in src/config.ts and update the corresponding tests in tests/config.test.ts',
    expected: 'simple',
  },

  // ── Medium (4) ───────────────────────────────────────────────────────
  {
    query: 'Refactor the logger module in src/logger.ts to support multiple output formats including JSON structured logging, plain text, and CSV export with configurable destinations',
    expected: 'medium',
  },
  {
    query: 'Add pagination to the /api/users REST endpoint with limit and offset query parameters, update the service layer in src/services/user.ts, and add integration tests',
    expected: 'medium',
  },
  {
    query: 'Implement a caching layer for database queries with TTL-based expiration, cache invalidation on writes, and support for both Redis and in-memory backends',
    expected: 'medium',
  },
  {
    query: 'Add input validation middleware to all REST API endpoints using JSON Schema, with structured error responses and request body size limits',
    expected: 'medium',
  },

  // ── Complex (3) ──────────────────────────────────────────────────────
  {
    query: 'Design and implement a role-based access control system with hierarchical permissions, audit logging for all authorization decisions, and integration with the existing authentication module in src/auth/. Must support permission inheritance, deny rules, and multi-tenant isolation.',
    expected: 'complex',
  },
  {
    query: 'Migrate the monolithic Express application to a microservice architecture with separate services for authentication, user management, and billing. First design the service boundaries, then implement inter-service communication via message queue, and finally add distributed tracing.',
    expected: 'complex',
  },
  {
    query: 'Optimize the search pipeline by adding full-text indexing, implementing a query parser with boolean operators and field-scoped filters, designing a relevance scoring algorithm with configurable weights, and integrating the pipeline with the existing src/api/search.ts endpoint.',
    expected: 'complex',
  },

  // ── Expert (3) ───────────────────────────────────────────────────────
  {
    query: 'Design and implement a distributed consensus protocol with leader election, log replication across cluster nodes, automatic failover with partition tolerance, and quorum-based commit. The system must handle network partitions, ensure linearizable reads, and support dynamic cluster membership changes. Implement in src/consensus/ with comprehensive property-based tests.',
    expected: 'expert',
  },
  {
    query: 'Build a custom query optimizer for the distributed graph database that performs cost-based plan selection with join reordering, predicate pushdown, parallel execution scheduling across shards, and transaction isolation. Must support concurrent read-write workloads with idempotent retry semantics and handle shard rebalancing during optimization.',
    expected: 'expert',
  },
  {
    query: 'Architect a multi-tenant platform with tenant isolation at the database, network, and compute layers. Implement encryption at rest with automated key rotation, a compliance audit trail system, and security vulnerability scanning in the CI pipeline. The architecture must support horizontal scaling with automatic failover and zero-downtime deployments.',
    expected: 'expert',
  },
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

function runCalibration(): {
  cases: CaseResult[];
  perLevel: Map<Complexity, { total: number; correct: number }>;
  overall: { total: number; correct: number; rate: number };
} {
  const classifier = new TaskComplexityClassifier();
  const cases: CaseResult[] = [];
  const perLevel = new Map<Complexity, { total: number; correct: number }>();

  for (const level of ['trivial', 'simple', 'medium', 'complex', 'expert'] as Complexity[]) {
    perLevel.set(level, { total: 0, correct: 0 });
  }

  for (const entry of CORPUS) {
    const result = classifier.classifySync(entry.query);
    const correct = result.complexity === entry.expected;
    cases.push({
      query: entry.query,
      expected: entry.expected,
      predicted: result.complexity,
      difficulty: result.difficulty,
      correct,
    });

    const group = perLevel.get(entry.expected)!;
    group.total++;
    if (correct) group.correct++;
  }

  const totalCorrect = cases.filter((c) => c.correct).length;

  return {
    cases,
    perLevel,
    overall: {
      total: cases.length,
      correct: totalCorrect,
      rate: cases.length > 0 ? totalCorrect / cases.length : 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('classifier calibration', () => {
  const { cases, perLevel, overall } = runCalibration();
  const misses = cases.filter((c) => !c.correct);

  it('runs the full corpus without errors', () => {
    expect(cases).toHaveLength(CORPUS.length);
    expect(cases.length).toBeGreaterThanOrEqual(16);
  });

  it('logs calibration summary', () => {
    const lines: string[] = [
      `Calibration: ${overall.correct}/${overall.total} (${(overall.rate * 100).toFixed(0)}%)`,
    ];
    for (const [level, stats] of perLevel) {
      const pct = stats.total > 0 ? ((stats.correct / stats.total) * 100).toFixed(0) : '-';
      lines.push(`  ${level.padEnd(8)} ${stats.correct}/${stats.total} (${pct}%)`);
    }
    if (misses.length > 0) {
      lines.push('Misclassifications:');
      for (const m of misses) {
        lines.push(`  [${m.expected}->${m.predicted}] d=${m.difficulty.toFixed(1)} "${m.query.slice(0, 60)}..."`);
      }
    }
    console.log(lines.join('\n'));
    // Always passes — this test is for visibility
    expect(true).toBe(true);
  });

  // ── Regression guard: accuracy must not drop below baseline ──────────
  it('accuracy does not regress below 50%', () => {
    expect(overall.rate).toBeGreaterThanOrEqual(0.50);
  });

  it('covers all 5 complexity levels in corpus', () => {
    for (const [level, stats] of perLevel) {
      expect(stats.total, `no ${level} entries`).toBeGreaterThanOrEqual(1);
    }
  });

  // ── Safety invariants: extreme misclassifications must never happen ──
  it('trivial tasks are never classified as complex or expert', () => {
    for (const c of cases.filter((c) => c.expected === 'trivial')) {
      expect(
        ['trivial', 'simple'].includes(c.predicted),
        `trivial "${c.query.slice(0, 40)}..." classified as ${c.predicted}`,
      ).toBe(true);
    }
  });

  it('expert tasks are never classified as trivial or simple', () => {
    for (const c of cases.filter((c) => c.expected === 'expert')) {
      expect(
        ['medium', 'complex', 'expert'].includes(c.predicted),
        `expert "${c.query.slice(0, 40)}..." classified as ${c.predicted}`,
      ).toBe(true);
    }
  });

  it('complex tasks score above simple threshold (3.5)', () => {
    for (const c of cases.filter((c) => c.expected === 'complex')) {
      expect(
        c.difficulty,
        `complex "${c.query.slice(0, 40)}..." scored ${c.difficulty}`,
      ).toBeGreaterThan(DEFAULT_CLASSIFIER_CONFIG.thresholds.simple);
    }
  });

  // ── Ordering: median difficulty should increase across levels ────────
  // Checks trivial < simple < medium. Complex/expert are excluded because
  // score saturation at 10.0 makes them indistinguishable (known issue).
  it('median difficulty is non-decreasing for trivial → simple → medium', () => {
    const levels: Complexity[] = ['trivial', 'simple', 'medium'];
    const medians: number[] = [];

    for (const level of levels) {
      const diffs = cases
        .filter((c) => c.expected === level)
        .map((c) => c.difficulty)
        .sort((a, b) => a - b);
      const mid = Math.floor(diffs.length / 2);
      medians.push(diffs.length % 2 === 0 ? (diffs[mid - 1] + diffs[mid]) / 2 : diffs[mid]);
    }

    for (let i = 1; i < medians.length; i++) {
      expect(
        medians[i],
        `${levels[i]} median (${medians[i].toFixed(1)}) < ${levels[i - 1]} median (${medians[i - 1].toFixed(1)})`,
      ).toBeGreaterThanOrEqual(medians[i - 1]);
    }
  });

  // ── Diagnostic: identify known issues for future fixes ───────────────
  it('documents known classifier issues', () => {
    // Issue 1: Score saturation — complex/expert indistinguishable
    const complexCases = cases.filter((c) => c.expected === 'complex');
    const expertCases = cases.filter((c) => c.expected === 'expert');
    const complexAtCap = complexCases.filter((c) => c.difficulty >= 10).length;
    const expertAtCap = expertCases.filter((c) => c.difficulty >= 10).length;

    // Issue 2: Vocabulary gaps — medium tasks without keywords
    const mediumCases = cases.filter((c) => c.expected === 'medium');
    const mediumAsTrivial = mediumCases.filter((c) => c.predicted === 'trivial').length;

    console.log([
      'Known issues:',
      `  Score saturation: ${complexAtCap}/${complexCases.length} complex at cap, ${expertAtCap}/${expertCases.length} expert at cap`,
      `  Vocabulary gaps: ${mediumAsTrivial}/${mediumCases.length} medium tasks scored as trivial`,
      `  Overall accuracy: ${(overall.rate * 100).toFixed(0)}% (target: 75%+)`,
    ].join('\n'));

    expect(true).toBe(true);
  });
});
