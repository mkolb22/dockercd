/**
 * Execution plan generator.
 * Pure functions — creates execution plans from validated pipelines.
 */

import type {
  Pipeline,
  ExecutionPlan,
  ExecutionStep,
  PlanOptions,
  ValidationResult,
  PreconditionSpec,
  PlanStatus,
} from "./types.js";
import { getPreconditions } from "./preconditions.js";
import { generateId } from "../../utils/ids.js";

// ─── Cost/Duration Estimates ─────────────────────────────────

const COST_ESTIMATES: Record<string, number> = {
  story: 0.005, architecture: 0.02, implementation: 0.01, quality: 0.008,
  version: 0.002, security: 0.01, "code-analysis": 0.003, verification: 0.008,
  documentation: 0.005, context: 0.001, retrospective: 0.003,
};

const DURATION_ESTIMATES_MS: Record<string, number> = {
  story: 30000, architecture: 60000, implementation: 45000, quality: 40000,
  version: 15000, security: 35000, "code-analysis": 20000, verification: 30000,
  documentation: 25000, context: 10000, retrospective: 20000,
};

const MODEL_COST_MULTIPLIERS: Record<string, number> = {
  haiku: 0.2, sonnet: 1.0, opus: 5.0,
};

// ─── Concept → Default Action ────────────────────────────────

const ACTION_MAPPING: Record<string, string> = {
  story: "create", architecture: "design", implementation: "generate",
  quality: "review", version: "commit", security: "threat_model",
  "code-analysis": "context", verification: "verify", documentation: "generate",
  context: "compress", retrospective: "analyze",
};

function getAction(concept: string, refAction?: string): string {
  return refAction || ACTION_MAPPING[concept] || "execute";
}

// ─── Instruction Templates ───────────────────────────────────

function getInstruction(concept: string, action: string, storyId?: string): string {
  const id = storyId || "XXX";
  const instructions: Record<string, string> = {
    story: `Create story state (story-${id})`,
    architecture: `Design architecture (arch-${id})`,
    implementation: `Generate implementation (impl-${id})`,
    quality: `Review code and run tests (review-${id})`,
    version: "Commit changes with proper message",
    security: `Perform threat modeling (threat-${id})`,
    "code-analysis": "Gather codebase context using MCP tools",
    verification: "Run independent verification pass",
    documentation: "Generate documentation",
    context: "Compress context window",
    retrospective: "Analyze workflow and identify improvements",
  };
  return instructions[concept] || `Execute ${action} for ${concept}`;
}

// ─── Plan Generator ──────────────────────────────────────────

/**
 * Generate an execution plan from a validated pipeline.
 */
export function generatePlan(
  pipeline: Pipeline,
  validation: ValidationResult,
  options: PlanOptions = {},
): ExecutionPlan {
  const preconditionData = getPreconditions(pipeline, options.storyId);
  const steps: ExecutionStep[] = [];
  const stepsByNumber = new Map<number, ExecutionStep>();

  let stepNumber = 1;

  for (let i = 0; i < pipeline.steps.length; i++) {
    const pipelineStep = pipeline.steps[i];
    const isParallel = pipelineStep.type === "parallel";
    const parallelStepNumbers: number[] = [];

    for (let j = 0; j < pipelineStep.conceptRefs.length; j++) {
      const ref = pipelineStep.conceptRefs[j];
      const action = getAction(ref.concept, ref.action);
      const preconditions: PreconditionSpec[] = preconditionData.find((p) => p.step === stepNumber)?.preconditions || [];

      // Blocked by previous pipeline step's last concept(s)
      const blockedBy: number[] = [];
      if (stepNumber > 1 && i > 0 && !isParallel) {
        blockedBy.push(stepNumber - 1);
      } else if (stepNumber > 1 && isParallel && i > 0) {
        const prevStep = pipeline.steps[i - 1];
        const prevCount = prevStep.concepts.length;
        for (let k = stepNumber - prevCount; k < stepNumber; k++) {
          if (k > 0) blockedBy.push(k);
        }
      }

      const step: ExecutionStep = {
        step_number: stepNumber,
        concept: ref.concept,
        action,
        model: ref.model,
        passes: ref.passes || 1,
        preconditions,
        blocked_by: blockedBy.length > 0 ? blockedBy : undefined,
        instructions: getInstruction(ref.concept, action, options.storyId),
      };

      steps.push(step);
      stepsByNumber.set(stepNumber, step);
      if (isParallel) parallelStepNumbers.push(stepNumber);
      stepNumber++;
    }

    // Link parallel steps
    if (isParallel && parallelStepNumbers.length > 1) {
      for (const num of parallelStepNumbers) {
        const step = stepsByNumber.get(num);
        if (step) step.parallel_with = parallelStepNumbers.filter((n) => n !== num);
      }
    }
  }

  // Estimate cost and duration
  let estimatedCost = 0;
  let estimatedDuration = 0;
  const parallelGroupSeen = new Set<string>();

  for (const step of steps) {
    const baseCost = COST_ESTIMATES[step.concept] || 0.005;
    const modelMult = step.model ? (MODEL_COST_MULTIPLIERS[step.model] || 1.0) : 1.0;
    estimatedCost += baseCost * modelMult * step.passes;

    const baseDuration = DURATION_ESTIMATES_MS[step.concept] || 30000;
    if (step.parallel_with && step.parallel_with.length > 0) {
      const groupKey = [step.step_number, ...step.parallel_with].sort().join(",");
      if (!parallelGroupSeen.has(groupKey)) {
        parallelGroupSeen.add(groupKey);
        const groupDurations = [step, ...step.parallel_with.map((n) => stepsByNumber.get(n)!)]
          .map((s) => (DURATION_ESTIMATES_MS[s.concept] || 30000) * s.passes);
        estimatedDuration += Math.max(...groupDurations);
      }
    } else {
      estimatedDuration += baseDuration * step.passes;
    }
  }

  // Determine plan status
  let status: PlanStatus = "valid";
  if (!validation.valid) {
    status = "invalid";
  } else if (steps.every((s) => s.preconditions.length === 0 || !options.storyId)) {
    status = "ready";
  }

  return {
    plan_id: generateId("plan"),
    pipeline_dsl: pipeline.raw,
    story_id: options.storyId,
    created_at: new Date().toISOString(),
    status,
    steps,
    validation,
    estimated_cost_usd: Math.round(estimatedCost * 10000) / 10000,
    estimated_duration_ms: estimatedDuration,
    start_from_step: options.fromStep,
  };
}
