/**
 * Workflow Planner
 * Task classification, complexity estimation, and workflow step recommendations
 */

import type { WorkflowPlan, WorkflowStep } from "./types.js";
import { getContentLoader } from "./content-loader.js";
import { config } from "../../core/config.js";
import { recallSimilarWorkflows } from "./workflow-intelligence.js";

/**
 * Task types with classification keywords
 */
type TaskType = "bugfix" | "feature" | "refactor" | "docs";

const TASK_KEYWORDS: Record<TaskType, string[]> = {
  bugfix: ["fix", "bug", "broken", "error", "crash", "issue", "wrong", "fail", "not working"],
  docs: ["document", "docs", "readme", "documentation", "jsdoc", "comments", "describe"],
  refactor: ["refactor", "clean up", "restructure", "reorganize", "simplify", "extract", "rename"],
  feature: [], // default fallback
};

/**
 * Complexity indicators
 */
const LARGE_INDICATORS = [
  "system",
  "architecture",
  "redesign",
  "migration",
  "overhaul",
  "framework",
  "infrastructure",
  "multi-service",
  "cross-cutting",
];

const SMALL_INDICATORS = [
  "typo",
  "rename",
  "simple",
  "small",
  "quick",
  "minor",
  "single",
  "one",
  "just",
];

/**
 * Concept pipeline definitions
 * Maps concept name to agent, model, and base cost
 */
interface ConceptDef {
  agent: string;
  model: string;
  baseCost: number;
}

const CONCEPTS: Record<string, ConceptDef> = {
  story: { agent: "story-concept", model: "sonnet", baseCost: 0.003 },
  architecture: { agent: "architecture-concept", model: "opus", baseCost: 0.015 },
  implementation: { agent: "implementation-concept", model: "sonnet", baseCost: 0.008 },
  quality: { agent: "quality-concept", model: "sonnet", baseCost: 0.005 },
  documentation: { agent: "documentation-concept", model: "sonnet", baseCost: 0.003 },
  version: { agent: "version-concept", model: "sonnet", baseCost: 0.002 },
  security: { agent: "security-concept", model: "sonnet", baseCost: 0.004 },
  spec: { agent: "spec-concept", model: "sonnet", baseCost: 0.005 },
};

/**
 * Classify a task description into a task type
 */
function classifyTask(task: string): TaskType {
  const lower = task.toLowerCase();
  for (const [type, keywords] of Object.entries(TASK_KEYWORDS) as Array<[TaskType, string[]]>) {
    if (keywords.some((kw) => lower.includes(kw))) {
      return type;
    }
  }
  return "feature";
}

/**
 * Estimate task complexity from description and optional context
 */
function estimateComplexity(task: string, context?: string): "small" | "medium" | "large" {
  const text = `${task} ${context || ""}`.toLowerCase();

  if (LARGE_INDICATORS.some((ind) => text.includes(ind))) return "large";
  if (SMALL_INDICATORS.some((ind) => text.includes(ind))) return "small";

  // Heuristic: longer descriptions suggest more complexity
  const wordCount = task.split(/\s+/).length;
  if (wordCount > 30) return "large";
  if (wordCount < 8) return "small";

  return "medium";
}

/**
 * Build a workflow step from a concept definition
 */
function buildStep(order: number, conceptName: string, reason: string): WorkflowStep {
  const def = CONCEPTS[conceptName];
  if (!def) {
    return {
      order,
      concept: conceptName,
      agent: `${conceptName}-concept`,
      model: "sonnet",
      skills: [],
      estimatedCost: 0.005,
      reason,
    };
  }

  // Look up skills from content loader
  const loader = getContentLoader();
  const agentSkills = loader.getSkillsForAgent(def.agent);

  return {
    order,
    concept: conceptName,
    agent: def.agent,
    model: def.model,
    skills: agentSkills.map((s) => s.name),
    estimatedCost: def.baseCost,
    reason,
  };
}

/**
 * Plan a workflow for a given task
 */
export async function planWorkflow(task: string, context?: string): Promise<WorkflowPlan> {
  const taskType = classifyTask(task);
  let complexity = estimateComplexity(task, context);

  // Consult memory for similar past workflows
  let memoryReasoning = "";
  const cfg = config();
  if (cfg.memoryEnabled) {
    try {
      const insight = await recallSimilarWorkflows(task);
      if (insight.suggestedComplexity && insight.similarTasks.length >= 2) {
        complexity = insight.suggestedComplexity;
        memoryReasoning = ` Memory: ${insight.reasoning}`;
      }
    } catch { /* graceful degradation */ }
  }

  const steps: WorkflowStep[] = [];
  const skippedSteps: Array<{ concept: string; reason: string }> = [];
  let stepOrder = 1;

  // Build pipeline based on task type and complexity
  switch (taskType) {
    case "bugfix":
      if (complexity === "large") {
        steps.push(buildStep(stepOrder++, "story", "Capture bug report details and reproduction steps"));
        steps.push(buildStep(stepOrder++, "architecture", "Analyze root cause in system context"));
      } else {
        skippedSteps.push({ concept: "story", reason: "Simple bugfix - requirements are clear" });
        skippedSteps.push({ concept: "architecture", reason: "No architectural changes needed for bugfix" });
      }
      steps.push(buildStep(stepOrder++, "implementation", "Implement the fix"));
      steps.push(buildStep(stepOrder++, "quality", "Verify fix with tests and review"));
      if (complexity !== "small") {
        steps.push(buildStep(stepOrder++, "version", "Commit and tag the fix"));
      } else {
        skippedSteps.push({ concept: "version", reason: "Small fix - manual commit sufficient" });
      }
      break;

    case "docs":
      steps.push(buildStep(stepOrder++, "documentation", "Generate or update documentation"));
      skippedSteps.push({ concept: "story", reason: "Documentation task - no story needed" });
      skippedSteps.push({ concept: "architecture", reason: "Documentation task - no design needed" });
      skippedSteps.push({ concept: "implementation", reason: "Documentation task - no code changes" });
      skippedSteps.push({ concept: "quality", reason: "Documentation task - review inline" });
      break;

    case "refactor":
      if (complexity === "large") {
        steps.push(buildStep(stepOrder++, "story", "Capture refactoring goals and constraints"));
        steps.push(buildStep(stepOrder++, "architecture", "Design target structure"));
      } else {
        skippedSteps.push({ concept: "story", reason: "Refactoring scope is clear" });
        if (complexity === "small") {
          skippedSteps.push({ concept: "architecture", reason: "Small refactor - no redesign needed" });
        } else {
          steps.push(buildStep(stepOrder++, "architecture", "Plan refactoring approach"));
        }
      }
      steps.push(buildStep(stepOrder++, "implementation", "Execute refactoring"));
      steps.push(buildStep(stepOrder++, "quality", "Verify behavior preserved"));
      steps.push(buildStep(stepOrder++, "version", "Commit refactored code"));
      break;

    case "feature":
    default:
      steps.push(buildStep(stepOrder++, "story", "Capture requirements and acceptance criteria"));
      if (complexity !== "small") {
        steps.push(buildStep(stepOrder++, "architecture", "Design technical approach"));
      } else {
        skippedSteps.push({ concept: "architecture", reason: "Small feature - straightforward implementation" });
      }
      steps.push(buildStep(stepOrder++, "implementation", "Build the feature"));
      steps.push(buildStep(stepOrder++, "quality", "Review and test"));
      if (complexity === "large") {
        steps.push(buildStep(stepOrder++, "security", "Security review for large feature"));
      }
      steps.push(buildStep(stepOrder++, "version", "Commit and version"));
      break;
  }

  const totalEstimatedCost = steps.reduce((sum, s) => sum + s.estimatedCost, 0);

  const reasoning = [
    `Classified as "${taskType}" task with ${complexity} complexity.`,
    steps.length > 0
      ? `Recommending ${steps.length}-step workflow.`
      : "No steps recommended.",
    skippedSteps.length > 0
      ? `Skipping ${skippedSteps.length} step(s) for efficiency.`
      : "",
    memoryReasoning,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    task,
    taskType,
    complexity,
    steps,
    skippedSteps,
    totalEstimatedCost: Math.round(totalEstimatedCost * 1000) / 1000,
    reasoning,
  };
}
