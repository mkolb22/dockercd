/**
 * Generate execution plans from pipelines.
 */

import type { Pipeline } from '@zen/koan-compose/dist/compose.js';
import type {
  ExecutionPlan,
  ExecutionStep,
  PlanOptions,
  PreconditionResult,
  SyncRuleSet,
  ValidationResult,
  StepStatus,
} from './types.js';
import { findRulesForTransition, getSloForConcept } from './sync-loader.js';

/**
 * Generate execution plan from a validated pipeline.
 */
export async function generatePlan(
  pipeline: Pipeline,
  validation: ValidationResult,
  preconditionResults: PreconditionResult[],
  syncRules: SyncRuleSet,
  options: PlanOptions
): Promise<ExecutionPlan> {
  const planId = `plan-${Date.now()}`;
  const steps: ExecutionStep[] = [];

  let stepNumber = 1;
  let preconditionIndex = 0;

  // Track parallel groups for blocked_by and parallel_with
  const stepsByNumber = new Map<number, ExecutionStep>();

  for (let i = 0; i < pipeline.steps.length; i++) {
    const pipelineStep = pipeline.steps[i];
    const isParallel = pipelineStep.type === 'parallel';
    const parallelStepNumbers: number[] = [];

    for (const concept of pipelineStep.concepts) {
      const preconditionResult = preconditionResults[preconditionIndex++];
      const preconditions = preconditionResult?.checks ?? [];

      // Determine status
      let status: StepStatus = 'pending';
      if (!validation.valid) {
        status = 'blocked';
      } else if (options.fromStep && stepNumber < options.fromStep) {
        status = 'skipped';
      } else if (preconditions.every((c) => c.passed)) {
        status = 'ready';
      } else if (preconditions.some((c) => !c.passed)) {
        status = 'blocked';
      }

      // Find applicable sync rules
      const fromConcept = i > 0 ? pipeline.steps[i - 1].concepts[0] : 'start';
      const applicableRules = findRulesForTransition(
        syncRules.rules,
        fromConcept,
        concept
      );
      const syncRuleIds = applicableRules.map((r) => r.id);

      // Get SLO expectations
      const sloExpectations = getSloForConcept(concept, syncRules.sloTemplates);

      // Determine action (simplified mapping)
      const action = getActionForConcept(concept);

      // Determine blocked_by (previous step)
      const blockedBy: number[] = [];
      if (stepNumber > 1 && !isParallel) {
        blockedBy.push(stepNumber - 1);
      } else if (stepNumber > 1 && isParallel && i > 0) {
        // Blocked by all steps from previous pipeline step
        const prevPipelineStep = pipeline.steps[i - 1];
        const prevStepCount = prevPipelineStep.concepts.length;
        for (
          let j = stepNumber - prevStepCount;
          j < stepNumber;
          j++
        ) {
          blockedBy.push(j);
        }
      }

      // Generate instruction
      const instruction = generateInstruction(
        concept,
        action,
        options.storyId
      );

      const step: ExecutionStep = {
        step_number: stepNumber,
        concept,
        action,
        status,
        preconditions,
        sync_rules: syncRuleIds,
        slo_expectations: sloExpectations,
        blocked_by: blockedBy.length > 0 ? blockedBy : undefined,
        instructions: instruction,
      };

      steps.push(step);
      stepsByNumber.set(stepNumber, step);

      if (isParallel) {
        parallelStepNumbers.push(stepNumber);
      }

      stepNumber++;
    }

    // Set parallel_with for parallel steps
    if (isParallel && parallelStepNumbers.length > 1) {
      for (const num of parallelStepNumbers) {
        const step = stepsByNumber.get(num);
        if (step) {
          step.parallel_with = parallelStepNumbers.filter((n) => n !== num);
        }
      }
    }
  }

  // Calculate cost and duration
  let estimatedCost = 0;
  let estimatedDuration = 0;

  for (const step of steps) {
    if (step.slo_expectations) {
      estimatedCost += step.slo_expectations.expected_cost_usd;
      // For parallel steps, take max duration, not sum
      if (step.parallel_with && step.parallel_with.length > 0) {
        const parallelDurations = [step, ...step.parallel_with.map(n => stepsByNumber.get(n)!)]
          .map(s => s.slo_expectations?.expected_duration_ms ?? 0);
        const maxDuration = Math.max(...parallelDurations);
        if (step.step_number === Math.min(...(step.parallel_with ?? []), step.step_number)) {
          estimatedDuration += maxDuration;
        }
      } else {
        estimatedDuration += step.slo_expectations.expected_duration_ms;
      }
    }
  }

  // Determine overall status
  let planStatus: ExecutionPlan['status'] = 'valid';
  if (!validation.valid) {
    planStatus = 'invalid';
  } else if (steps.every((s) => s.status === 'ready')) {
    planStatus = 'ready';
  }

  return {
    plan_id: planId,
    pipeline_dsl: pipeline.raw,
    story_id: options.storyId,
    created_at: new Date().toISOString(),
    status: planStatus,
    steps,
    validation,
    precondition_results: preconditionResults,
    estimated_cost_usd: estimatedCost,
    estimated_duration_ms: estimatedDuration,
    start_from_step: options.fromStep,
  };
}

/**
 * Map concept to default action.
 */
function getActionForConcept(concept: string): string {
  const mapping: Record<string, string> = {
    story: 'create',
    architecture: 'design',
    implementation: 'generate',
    quality: 'review',
    version: 'commit',
    security: 'threat_model',
    'code-analysis': 'context',
    verification: 'verify',
    documentation: 'generate',
    context: 'compress',
    retrospective: 'analyze',
  };

  return mapping[concept] ?? 'execute';
}

/**
 * Generate human-readable instruction for a step.
 */
function generateInstruction(
  concept: string,
  action: string,
  storyId?: string
): string {
  const id = storyId ? `-${storyId}` : '-XXX';

  const instructions: Record<string, string> = {
    story: `Create story state file at koan/stories/story${id}.yaml`,
    architecture: `Design architecture and save to koan/architecture/arch${id}.yaml`,
    implementation: `Generate implementation and save to koan/implementations/impl${id}.yaml`,
    quality: `Review code and run tests, save to koan/reviews/review${id}.yaml`,
    version: `Commit changes with proper message`,
    security: `Perform threat modeling and save to koan/security/threat${id}.yaml`,
    'code-analysis': `Gather codebase context using MCP tools`,
    verification: `Run independent verification pass`,
    documentation: `Generate documentation`,
    context: `Compress context window`,
    retrospective: `Analyze workflow and identify improvements`,
  };

  return (
    instructions[concept] ?? `Execute ${action} for ${concept}`
  );
}
