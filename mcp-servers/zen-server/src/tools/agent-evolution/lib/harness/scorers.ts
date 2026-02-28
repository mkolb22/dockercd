/**
 * Scorer implementations for benchmark task evaluation.
 *
 * AutomatedScorer: fast, deterministic baseline using expected-element
 * pattern matching. Suitable for rapid iteration and test harness.
 *
 * LLMJudgeScorer: accurate, LLM-as-judge evaluation using structured
 * rubric prompts. Suitable for final fitness determination.
 */

import type {
  BenchmarkTask,
  CriterionScore,
  EvaluationCriterion,
  RubricScore,
} from '../benchmark/schema.js';
import type { LLMCompleteFn } from '../mutation/types.js';
import type { Scorer } from './types.js';

// ---------------------------------------------------------------------------
// Automated scorer
// ---------------------------------------------------------------------------

/** Coverage thresholds for mapping element match ratio to rubric scores. */
const COVERAGE_THRESHOLDS: readonly { min: number; score: RubricScore }[] = [
  { min: 0.90, score: 4 },
  { min: 0.70, score: 3 },
  { min: 0.40, score: 2 },
  { min: 0.10, score: 1 },
  { min: 0.00, score: 0 },
];

/** Maps a coverage ratio (0-1) to a rubric score (0-4). */
function coverageToScore(coverage: number): RubricScore {
  for (const { min, score } of COVERAGE_THRESHOLDS) {
    if (coverage >= min) return score;
  }
  return 0;
}

/**
 * Counts how many expected elements appear in the output.
 *
 * Uses case-insensitive substring matching. Each element is checked
 * independently — partial matches count if the core keyword is found.
 */
function countMatchedElements(
  output: string,
  expectedElements: readonly string[],
): number {
  if (expectedElements.length === 0) return 0;

  const lowerOutput = output.toLowerCase();
  let matched = 0;

  for (const element of expectedElements) {
    // Split element into keywords (3+ chars) for fuzzy matching
    const keywords = element
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length >= 3);

    // Element matches if majority of its keywords appear
    if (keywords.length === 0) continue;
    const threshold = Math.ceil(keywords.length * 0.6);
    const found = keywords.filter(kw => lowerOutput.includes(kw)).length;
    if (found >= threshold) matched++;
  }

  return matched;
}

/**
 * Fast, deterministic scorer using expected-element pattern matching.
 *
 * Scoring strategy:
 * - Computes element coverage ratio (matched / total expected elements)
 * - Maps ratio to rubric score via fixed thresholds
 * - All criteria receive the same base score (element coverage)
 * - Empty output → score 0 for all criteria
 *
 * This is a baseline scorer for rapid iteration. For accurate
 * fitness evaluation, use LLMJudgeScorer.
 */
export class AutomatedScorer implements Scorer {
  async score(
    task: BenchmarkTask,
    output: string,
  ): Promise<readonly CriterionScore[]> {
    if (!output.trim()) {
      return task.criteria.map(c => ({
        criterionId: c.id,
        score: 0 as RubricScore,
        rationale: 'Empty output',
      }));
    }

    const matched = countMatchedElements(output, task.expectedElements);
    const total = task.expectedElements.length;
    const coverage = total > 0 ? matched / total : 0;
    const baseScore = coverageToScore(coverage);

    return task.criteria.map(c => ({
      criterionId: c.id,
      score: baseScore,
      rationale: `Element coverage: ${matched}/${total} (${(coverage * 100).toFixed(0)}%)`,
    }));
  }
}

// ---------------------------------------------------------------------------
// LLM judge scorer
// ---------------------------------------------------------------------------

/**
 * Builds the evaluation prompt for LLM-as-judge scoring.
 *
 * Includes full rubric descriptors for each criterion so the LLM
 * can make calibrated judgments.
 */
function buildJudgePrompt(task: BenchmarkTask, output: string): string {
  const criteriaBlock = task.criteria.map((c, i) => {
    const rubricLines = c.rubric.map(r =>
      `  - ${r.score} (${r.label}): ${r.description}`,
    ).join('\n');
    return [
      `### ${i + 1}. ${c.id} (${c.dimension})`,
      c.description,
      'Rubric:',
      rubricLines,
    ].join('\n');
  }).join('\n\n');

  return [
    'You are an expert evaluator scoring an AI agent\'s output against specific criteria.',
    '',
    '## Task',
    `Name: ${task.name}`,
    `Description: ${task.description}`,
    `Prompt given to agent: ${task.prompt}`,
    '',
    '## Agent Output',
    '---',
    output,
    '---',
    '',
    '## Evaluation Criteria',
    criteriaBlock,
    '',
    '## Instructions',
    'Score the agent output on EACH criterion above.',
    'For each, provide the criterion ID, a score (0-4) matching the rubric, and a brief rationale.',
    '',
    'Return your evaluation as a JSON array:',
    '```json',
    '[',
    '  {"criterionId": "...", "score": 0, "rationale": "..."},',
    '  ...',
    ']',
    '```',
    'Return ONLY the JSON array, no other text.',
  ].join('\n');
}

/** Parsed score entry from LLM response. */
interface LLMScoreEntry {
  criterionId: string;
  score: number;
  rationale: string;
}

/**
 * Parses JSON score array from LLM response.
 *
 * Handles common formatting issues: markdown fences, extra text
 * before/after the JSON array, and missing fields.
 */
function parseLLMScores(response: string): LLMScoreEntry[] | null {
  // Strip markdown code fences
  let cleaned = response.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  // Find JSON array boundaries
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return null;

  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    if (!Array.isArray(parsed)) return null;

    return parsed.map(entry => ({
      criterionId: String(entry.criterionId ?? ''),
      score: Number(entry.score ?? 0),
      rationale: String(entry.rationale ?? ''),
    }));
  } catch {
    return null;
  }
}

/**
 * Clamps and validates a score to the rubric range.
 */
function clampScore(score: number): RubricScore {
  const clamped = Math.round(Math.max(0, Math.min(4, score)));
  return clamped as RubricScore;
}

/**
 * Accurate scorer using LLM-as-judge with structured rubric prompts.
 *
 * Sends the full task context, output, and rubric to the LLM in a
 * single call. Parses structured JSON scores from the response.
 * Falls back to neutral scores (2 = Adequate) on parse failure.
 */
export class LLMJudgeScorer implements Scorer {
  constructor(private readonly llm: LLMCompleteFn) {}

  async score(
    task: BenchmarkTask,
    output: string,
  ): Promise<readonly CriterionScore[]> {
    const prompt = buildJudgePrompt(task, output);
    const response = await this.llm(prompt);
    const parsed = parseLLMScores(response);

    if (!parsed) {
      // Fallback: neutral scores on parse failure
      return task.criteria.map(c => ({
        criterionId: c.id,
        score: 2 as RubricScore,
        rationale: 'LLM response could not be parsed; defaulting to Adequate',
      }));
    }

    // Build lookup from LLM response
    const scoreMap = new Map<string, LLMScoreEntry>();
    for (const entry of parsed) {
      scoreMap.set(entry.criterionId, entry);
    }

    // Map LLM scores to criteria, defaulting missing ones
    return task.criteria.map(c => {
      const entry = scoreMap.get(c.id);
      if (entry) {
        return {
          criterionId: c.id,
          score: clampScore(entry.score),
          rationale: entry.rationale,
        };
      }
      return {
        criterionId: c.id,
        score: 2 as RubricScore,
        rationale: 'LLM did not score this criterion; defaulting to Adequate',
      };
    });
  }
}
