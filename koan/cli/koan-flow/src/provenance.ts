/**
 * Record execution plans in provenance trail.
 */

import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import * as yaml from 'js-yaml';
import type { ExecutionPlan } from './types.js';

/**
 * Record plan generation in provenance trail.
 */
export async function recordPlanGeneration(
  plan: ExecutionPlan,
  projectRoot: string
): Promise<string> {
  const timestamp = Date.now();
  const actionId = `action-${timestamp}-flow-plan`;

  const provenanceAction = {
    action_id: actionId,
    concept: 'flow',
    action: 'generate_plan',
    status: 'completed',
    timestamp: new Date().toISOString(),
    model: null,
    triggered_by: null,
    flow_id: plan.plan_id,
    sync_rule_id: null,
    inputs: {
      pipeline_dsl: plan.pipeline_dsl,
      story_id: plan.story_id,
      start_from_step: plan.start_from_step,
    },
    outputs: {
      artifact_id: plan.plan_id,
      artifact_type: 'execution_plan',
      artifact_path: `koan/flows/${plan.plan_id}.yaml`,
    },
    cost: {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      cost_usd: 0,
    },
    duration_ms: 0,
    error: null,
    metadata: {
      step_count: plan.steps.length,
      validation_status: plan.validation.valid ? 'valid' : 'invalid',
      estimated_cost_usd: plan.estimated_cost_usd,
      estimated_duration_ms: plan.estimated_duration_ms,
    },
  };

  const actionsDir = join(projectRoot, 'koan', 'provenance', 'actions');
  if (!existsSync(actionsDir)) {
    await mkdir(actionsDir, { recursive: true });
  }

  const provenancePath = join(actionsDir, `${actionId}.yaml`);
  await writeFile(provenancePath, yaml.dump(provenanceAction), 'utf-8');

  return actionId;
}

/**
 * Save execution plan to koan/flows/
 */
export async function savePlan(
  plan: ExecutionPlan,
  projectRoot: string
): Promise<string> {
  const flowsDir = join(projectRoot, 'koan', 'flows');
  if (!existsSync(flowsDir)) {
    await mkdir(flowsDir, { recursive: true });
  }

  const planPath = join(flowsDir, `${plan.plan_id}.yaml`);
  await writeFile(planPath, yaml.dump(plan), 'utf-8');

  return planPath;
}
