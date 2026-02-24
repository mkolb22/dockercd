/**
 * Workflow Intelligence
 * Bridge between memory/KG and workflow planning.
 * All functions are time-bounded and return empty/null on failure (graceful degradation).
 */

import { createLazyLoader } from "../../utils/lazy.js";
import { getSharedEmbedder } from "../../utils/embedder.js";
import { MemoryStore } from "../memory/store.js";
import { config } from "../../core/config.js";

// Lazy-loaded memory store for workflow intelligence
const getMemoryStore = createLazyLoader(() => new MemoryStore(config().memoryDbPath));

/**
 * Types
 */
export interface WorkflowInsight {
  similarTasks: Array<{
    task: string;
    taskType: string;
    complexity: "small" | "medium" | "large";
    outcome: string;
    totalDurationMs: number;
    similarity: number;
  }>;
  suggestedComplexity: "small" | "medium" | "large" | null;
  reasoning: string;
}

export interface FailureHint {
  pastFailures: Array<{
    task: string;
    failedStep: string;
    notes: string;
    resolution: string;
  }>;
  suggestion: string;
}

interface WorkflowOutcomeData {
  task: string;
  taskType: string;
  complexity: "small" | "medium" | "large";
  outcome: string;
  steps: Array<{ concept: string; outcome: string | null; durationMs: number | null }>;
  totalDurationMs: number;
}

/**
 * Race a promise against a timeout, returning fallback if timeout wins.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer!));
}

/**
 * Record a completed workflow outcome to memory (fire-and-forget).
 * Callers should not await this — use `.catch(() => {})`.
 */
export async function recordWorkflowOutcome(
  task: string,
  taskType: string,
  complexity: "small" | "medium" | "large",
  outcome: string,
  steps: Array<{ concept: string; outcome: string | null; durationMs: number | null }>,
  totalDurationMs: number,
): Promise<string | null> {
  const cfg = config();
  if (!cfg.memoryEnabled) return null;

  const store = getMemoryStore();
  const data: WorkflowOutcomeData = { task, taskType, complexity, outcome, steps, totalDurationMs };

  const memoryId = store.insertMemory({
    type: "episodic",
    content: JSON.stringify(data),
    summary: `Workflow: ${taskType}/${complexity} — ${outcome} — "${task.slice(0, 80)}"`,
    confidence: 1.0,
    source: "workflow-intelligence",
    category: "workflow-outcome",
    tags: ["workflow", taskType, outcome],
    archived: false,
  });

  // Embed the task description for similarity search
  try {
    const embedder = getSharedEmbedder();
    const embedding = await embedder.embed(task);
    store.insertEmbedding(memoryId, embedding);
  } catch {
    // Embedding failure is non-fatal — memory still stored
  }

  return memoryId;
}

/**
 * Recall similar past workflows to inform planning.
 */
export async function recallSimilarWorkflows(
  task: string,
  timeoutMs = 400,
): Promise<WorkflowInsight> {
  const empty: WorkflowInsight = { similarTasks: [], suggestedComplexity: null, reasoning: "" };

  return withTimeout(recallSimilarWorkflowsImpl(task), timeoutMs, empty);
}

async function recallSimilarWorkflowsImpl(task: string): Promise<WorkflowInsight> {
  const cfg = config();
  if (!cfg.memoryEnabled) {
    return { similarTasks: [], suggestedComplexity: null, reasoning: "" };
  }

  const store = getMemoryStore();
  const embedder = getSharedEmbedder();
  const embedding = await embedder.embed(task);

  const results = store.searchByEmbedding(embedding, {
    type: "episodic",
    category: "workflow-outcome",
    limit: 5,
    threshold: 0.3,
  });

  const similarTasks: WorkflowInsight["similarTasks"] = [];
  for (const r of results) {
    try {
      const data: WorkflowOutcomeData = JSON.parse(r.memory.content);
      similarTasks.push({
        task: data.task,
        taskType: data.taskType,
        complexity: data.complexity,
        outcome: data.outcome,
        totalDurationMs: data.totalDurationMs,
        similarity: r.similarity,
      });
    } catch {
      // Skip unparseable memories
    }
  }

  // Analyze: if >=2 similar tasks agree on complexity, suggest that
  let suggestedComplexity: WorkflowInsight["suggestedComplexity"] = null;
  let reasoning = "";

  if (similarTasks.length >= 2) {
    const complexityCounts: Record<string, number> = {};
    for (const t of similarTasks) {
      complexityCounts[t.complexity] = (complexityCounts[t.complexity] || 0) + 1;
    }

    const sorted = Object.entries(complexityCounts).sort((a, b) => b[1] - a[1]);
    if (sorted[0][1] >= 2) {
      suggestedComplexity = sorted[0][0] as "small" | "medium" | "large";
      reasoning = `${sorted[0][1]} of ${similarTasks.length} similar past workflows were ${suggestedComplexity} complexity.`;
    }
  }

  return { similarTasks, suggestedComplexity, reasoning };
}

/**
 * Get failure hints from past workflows to help recover from a failed step.
 */
export async function getFailureHints(
  task: string,
  failedConcept: string,
  timeoutMs = 300,
): Promise<FailureHint> {
  const empty: FailureHint = { pastFailures: [], suggestion: "" };
  return withTimeout(getFailureHintsImpl(task, failedConcept), timeoutMs, empty);
}

async function getFailureHintsImpl(task: string, failedConcept: string): Promise<FailureHint> {
  const cfg = config();
  if (!cfg.memoryEnabled) {
    return { pastFailures: [], suggestion: "" };
  }

  const store = getMemoryStore();
  const embedder = getSharedEmbedder();
  const embedding = await embedder.embed(task);

  const results = store.searchByEmbedding(embedding, {
    type: "episodic",
    category: "workflow-outcome",
    limit: 10,
    threshold: 0.4,
  });

  const pastFailures: FailureHint["pastFailures"] = [];

  for (const r of results) {
    try {
      const data: WorkflowOutcomeData = JSON.parse(r.memory.content);
      if (data.outcome !== "failed" && data.outcome !== "partial") continue;

      const failedStep = data.steps.find(
        (s) => s.concept === failedConcept && (s.outcome === "failed" || s.outcome === "partial"),
      );
      if (!failedStep) continue;

      pastFailures.push({
        task: data.task,
        failedStep: failedConcept,
        notes: `Workflow was ${data.complexity} ${data.taskType}. Step "${failedConcept}" ${failedStep.outcome}.`,
        resolution: data.outcome === "partial" ? "Workflow continued with partial success" : "Workflow failed",
      });
    } catch {
      // Skip unparseable
    }
  }

  const suggestion = pastFailures.length > 0
    ? `Found ${pastFailures.length} similar past failure(s) at the "${failedConcept}" step. Consider reviewing past approaches.`
    : "";

  return { pastFailures, suggestion };
}

/**
 * Compute a semantic difficulty signal from past workflow outcomes.
 * Used by the classifier to fill the _semantic slot in fuseSignals().
 */
export async function computeSemanticSignal(
  query: string,
  timeoutMs = 300,
): Promise<{ score: number; confidence: number } | null> {
  return withTimeout(computeSemanticSignalImpl(query), timeoutMs, null);
}

async function computeSemanticSignalImpl(
  query: string,
): Promise<{ score: number; confidence: number } | null> {
  const cfg = config();
  if (!cfg.memoryEnabled) return null;

  const store = getMemoryStore();
  const embedder = getSharedEmbedder();
  const embedding = await embedder.embed(query);

  const results = store.searchByEmbedding(embedding, {
    type: "episodic",
    category: "workflow-outcome",
    limit: 5,
    threshold: 0.3,
  });

  if (results.length === 0) return null;

  // Map complexity to difficulty score
  const complexityMap: Record<string, number> = { small: 2, medium: 5, large: 8 };

  let weightedScore = 0;
  let totalWeight = 0;
  let totalSimilarity = 0;

  for (const r of results) {
    try {
      const data: WorkflowOutcomeData = JSON.parse(r.memory.content);
      const difficulty = complexityMap[data.complexity] ?? 5;
      weightedScore += difficulty * r.similarity;
      totalWeight += r.similarity;
      totalSimilarity += r.similarity;
    } catch {
      // Skip unparseable
    }
  }

  if (totalWeight === 0) return null;

  return {
    score: weightedScore / totalWeight,
    confidence: totalSimilarity / results.length,
  };
}
