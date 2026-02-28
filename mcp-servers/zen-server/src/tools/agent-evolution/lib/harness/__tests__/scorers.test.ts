import { describe, it, expect, vi } from 'vitest';
import { AutomatedScorer, LLMJudgeScorer } from '../scorers.js';
import type { BenchmarkTask } from '../../benchmark/schema.js';
import { STANDARD_RUBRICS } from '../../benchmark/schema.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeTask(expectedElements: string[]): BenchmarkTask {
  return {
    id: 'test-task',
    name: 'Test Task',
    description: 'A test task',
    targetAgent: 'story-concept',
    category: 'feature',
    difficulty: 'simple',
    prompt: 'Do the thing.',
    context: { projectDescription: 'Test', files: [], constraints: [] },
    criteria: [
      {
        id: 'c-correctness',
        dimension: 'correctness',
        description: 'Is it correct?',
        weight: 0.5,
        rubric: STANDARD_RUBRICS.correctness,
      },
      {
        id: 'c-completeness',
        dimension: 'completeness',
        description: 'Is it complete?',
        weight: 0.5,
        rubric: STANDARD_RUBRICS.completeness,
      },
    ],
    expectedElements,
    tags: [],
  };
}

// ---------------------------------------------------------------------------
// AutomatedScorer
// ---------------------------------------------------------------------------

describe('AutomatedScorer', () => {
  const scorer = new AutomatedScorer();

  it('returns scores for all criteria', async () => {
    const task = makeTask(['element one', 'element two']);
    const scores = await scorer.score(task, 'This mentions element one and element two.');

    expect(scores).toHaveLength(2);
    expect(scores[0].criterionId).toBe('c-correctness');
    expect(scores[1].criterionId).toBe('c-completeness');
  });

  it('empty output → score 0 for all criteria', async () => {
    const task = makeTask(['element']);
    const scores = await scorer.score(task, '');

    for (const s of scores) {
      expect(s.score).toBe(0);
      expect(s.rationale).toContain('Empty');
    }
  });

  it('whitespace-only output → score 0', async () => {
    const task = makeTask(['element']);
    const scores = await scorer.score(task, '   \n  \t  ');

    for (const s of scores) {
      expect(s.score).toBe(0);
    }
  });

  it('all elements found → high score', async () => {
    const task = makeTask([
      'dark mode toggle',
      'localStorage persistence',
      'system preference detection',
    ]);

    const output = `
      The dark mode toggle will be in settings.
      We use localStorage for persistence of the theme.
      On first visit, detect the system preference for color scheme.
    `;
    const scores = await scorer.score(task, output);

    for (const s of scores) {
      expect(s.score).toBeGreaterThanOrEqual(3);
    }
  });

  it('no elements found → score 0', async () => {
    const task = makeTask([
      'dark mode toggle',
      'localStorage persistence',
    ]);

    const output = 'This output talks about completely unrelated things.';
    const scores = await scorer.score(task, output);

    for (const s of scores) {
      expect(s.score).toBe(0);
    }
  });

  it('partial element coverage → middle scores', async () => {
    const task = makeTask([
      'dark mode toggle',
      'localStorage persistence',
      'system preference',
      'accessibility contrast',
      'theme provider',
    ]);

    // Only 2 out of 5 elements → 40% → score 2 (Adequate)
    const output = 'Implement a dark mode toggle using the theme provider context.';
    const scores = await scorer.score(task, output);

    for (const s of scores) {
      expect(s.score).toBe(2);
    }
  });

  it('case-insensitive matching', async () => {
    const task = makeTask(['DARK MODE', 'localStorage']);
    const output = 'Add dark mode support with localstorage persistence.';
    const scores = await scorer.score(task, output);

    for (const s of scores) {
      expect(s.score).toBeGreaterThanOrEqual(3);
    }
  });

  it('keyword-based fuzzy matching', async () => {
    const task = makeTask(['API key generation mechanism']);
    // "API" is only 3 chars but "key" and "generation" and "mechanism" are 3+
    const output = 'The key generation mechanism for the API produces unique tokens.';
    const scores = await scorer.score(task, output);

    for (const s of scores) {
      expect(s.score).toBeGreaterThanOrEqual(3);
    }
  });

  it('includes coverage ratio in rationale', async () => {
    const task = makeTask(['element one', 'element two']);
    const scores = await scorer.score(task, 'Found element one here.');

    expect(scores[0].rationale).toContain('1/2');
    expect(scores[0].rationale).toContain('50%');
  });

  it('handles task with no expected elements', async () => {
    const task = makeTask([]);
    const scores = await scorer.score(task, 'Some output.');

    // Coverage is 0/0, baseScore maps to 0
    for (const s of scores) {
      expect(s.score).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// LLMJudgeScorer
// ---------------------------------------------------------------------------

describe('LLMJudgeScorer', () => {
  it('calls LLM with structured prompt', async () => {
    const mockLLM = vi.fn().mockResolvedValue(JSON.stringify([
      { criterionId: 'c-correctness', score: 3, rationale: 'Mostly correct' },
      { criterionId: 'c-completeness', score: 4, rationale: 'Very complete' },
    ]));

    const scorer = new LLMJudgeScorer(mockLLM);
    const task = makeTask(['element']);
    await scorer.score(task, 'Agent output');

    expect(mockLLM).toHaveBeenCalledOnce();
    const prompt = mockLLM.mock.calls[0][0];
    expect(prompt).toContain('Test Task');
    expect(prompt).toContain('Agent output');
    expect(prompt).toContain('c-correctness');
    expect(prompt).toContain('c-completeness');
    expect(prompt).toContain('Rubric:');
  });

  it('parses JSON response correctly', async () => {
    const mockLLM = vi.fn().mockResolvedValue(JSON.stringify([
      { criterionId: 'c-correctness', score: 3, rationale: 'Good' },
      { criterionId: 'c-completeness', score: 4, rationale: 'Excellent' },
    ]));

    const scorer = new LLMJudgeScorer(mockLLM);
    const task = makeTask(['element']);
    const scores = await scorer.score(task, 'output');

    expect(scores).toHaveLength(2);
    expect(scores[0].criterionId).toBe('c-correctness');
    expect(scores[0].score).toBe(3);
    expect(scores[0].rationale).toBe('Good');
    expect(scores[1].score).toBe(4);
  });

  it('handles JSON wrapped in markdown fences', async () => {
    const mockLLM = vi.fn().mockResolvedValue(`Here's the evaluation:
\`\`\`json
[
  {"criterionId": "c-correctness", "score": 2, "rationale": "Adequate"},
  {"criterionId": "c-completeness", "score": 3, "rationale": "Good"}
]
\`\`\`
`);

    const scorer = new LLMJudgeScorer(mockLLM);
    const task = makeTask(['element']);
    const scores = await scorer.score(task, 'output');

    expect(scores[0].score).toBe(2);
    expect(scores[1].score).toBe(3);
  });

  it('falls back to neutral scores on malformed response', async () => {
    const mockLLM = vi.fn().mockResolvedValue('This is not JSON at all.');
    const scorer = new LLMJudgeScorer(mockLLM);
    const task = makeTask(['element']);
    const scores = await scorer.score(task, 'output');

    for (const s of scores) {
      expect(s.score).toBe(2); // Adequate fallback
      expect(s.rationale).toContain('could not be parsed');
    }
  });

  it('fills missing criteria with neutral scores', async () => {
    const mockLLM = vi.fn().mockResolvedValue(JSON.stringify([
      { criterionId: 'c-correctness', score: 4, rationale: 'Excellent' },
      // c-completeness missing
    ]));

    const scorer = new LLMJudgeScorer(mockLLM);
    const task = makeTask(['element']);
    const scores = await scorer.score(task, 'output');

    expect(scores[0].score).toBe(4);
    expect(scores[1].score).toBe(2); // Default for missing
    expect(scores[1].rationale).toContain('did not score');
  });

  it('clamps out-of-range scores', async () => {
    const mockLLM = vi.fn().mockResolvedValue(JSON.stringify([
      { criterionId: 'c-correctness', score: 7, rationale: 'Way too high' },
      { criterionId: 'c-completeness', score: -2, rationale: 'Negative' },
    ]));

    const scorer = new LLMJudgeScorer(mockLLM);
    const task = makeTask(['element']);
    const scores = await scorer.score(task, 'output');

    expect(scores[0].score).toBe(4); // Clamped to max
    expect(scores[1].score).toBe(0); // Clamped to min
  });

  it('handles LLM returning extra text around JSON', async () => {
    const mockLLM = vi.fn().mockResolvedValue(`
      Based on my analysis, here are the scores:
      [{"criterionId": "c-correctness", "score": 3, "rationale": "Good work"}]
      That concludes my evaluation.
    `);

    const scorer = new LLMJudgeScorer(mockLLM);
    const task = makeTask(['element']);
    const scores = await scorer.score(task, 'output');

    expect(scores[0].score).toBe(3);
  });
});
