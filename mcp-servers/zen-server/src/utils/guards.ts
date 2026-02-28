/**
 * Config Guard Middleware
 * Replaces repeated config-check boilerplate at the start of tool handlers
 */

import type { HandlerFn } from "../core/dispatcher.js";
import { errorResponse } from "./responses.js";
import { config } from "../core/config.js";

/**
 * Wrap a handler with a config guard. If the guard check fails,
 * returns an error response without calling the handler.
 */
export function withConfigGuard(
  check: (cfg: ReturnType<typeof config>) => boolean,
  message: string,
  handler: HandlerFn,
): HandlerFn {
  return async (args) => {
    const cfg = config();
    if (!check(cfg)) {
      return errorResponse(message);
    }
    return handler(args);
  };
}

/** Guard that requires memory to be enabled */
export const requireMemory = (handler: HandlerFn) =>
  withConfigGuard(
    (cfg) => cfg.memoryEnabled,
    "Memory system is disabled. Set ZEN_MEMORY_ENABLED=true to enable.",
    handler,
  );

/** Guard that requires framework module to be enabled */
export const requireFramework = (handler: HandlerFn) =>
  withConfigGuard(
    (cfg) => cfg.frameworkEnabled,
    "Framework module is disabled. Set ZEN_FRAMEWORK_ENABLED=true to enable.",
    handler,
  );

/** Guard that requires state store to be enabled */
export const requireState = (handler: HandlerFn) =>
  withConfigGuard(
    (cfg) => cfg.stateEnabled,
    "State store is disabled. Set ZEN_STATE_ENABLED=true to enable.",
    handler,
  );

/** Guard that requires evolution to be enabled */
export const requireEvolve = (handler: HandlerFn) =>
  withConfigGuard(
    (cfg) => cfg.evolveEnabled,
    "Evolution is disabled. Set ZEN_EVOLVE_ENABLED=true to enable.",
    handler,
  );

/** Guard that requires spec module to be enabled */
export const requireSpec = (handler: HandlerFn) =>
  withConfigGuard(
    (cfg) => cfg.specEnabled,
    "Spec module is disabled. Set ZEN_SPEC_ENABLED=true to enable.",
    handler,
  );

/** Guard that requires compete module to be enabled */
export const requireCompete = (handler: HandlerFn) =>
  withConfigGuard(
    (cfg) => cfg.competeEnabled,
    "Compete module is disabled. Set ZEN_COMPETE_ENABLED=true to enable.",
    handler,
  );

/** Guard that requires repair module to be enabled */
export const requireRepair = (handler: HandlerFn) =>
  withConfigGuard(
    (cfg) => cfg.repairEnabled,
    "Repair is disabled. Set ZEN_REPAIR_ENABLED=true to enable.",
    handler,
  );

/** Guard that requires knowledge graph to be enabled */
export const requireKnowledgeGraph = (handler: HandlerFn) =>
  withConfigGuard(
    (cfg) => cfg.kgEnabled,
    "Knowledge graph is disabled. Set ZEN_KG_ENABLED=true to enable.",
    handler,
  );

/** Guard that requires agent evolution to be enabled */
export const requireAgentEvolution = (handler: HandlerFn) =>
  withConfigGuard(
    (cfg) => cfg.agentEvolutionEnabled,
    "Agent evolution is disabled. Set ZEN_AGENT_EVOLUTION_ENABLED=true to enable.",
    handler,
  );

/** Guard that requires analytics module to be enabled */
export const requireAnalytics = (handler: HandlerFn) =>
  withConfigGuard(
    (cfg) => cfg.analyticsEnabled,
    "Analytics is disabled. Set ZEN_ANALYTICS_ENABLED=true to enable.",
    handler,
  );

/** Guard that requires fitness module to be enabled */
export const requireFitness = (handler: HandlerFn) =>
  withConfigGuard(
    (cfg) => cfg.fitnessEnabled,
    "Fitness is disabled. Set ZEN_FITNESS_ENABLED=true to enable.",
    handler,
  );

/** Guard that requires pipeline module to be enabled */
export const requirePipeline = (handler: HandlerFn) =>
  withConfigGuard(
    (cfg) => cfg.pipelineEnabled,
    "Pipeline is disabled. Set ZEN_PIPELINE_ENABLED=true to enable.",
    handler,
  );

/** Guard that requires bridge module to be enabled */
export const requireBridge = (handler: HandlerFn) =>
  withConfigGuard(
    (cfg) => cfg.bridgeEnabled,
    "Bridge is disabled. Set ZEN_BRIDGE_ENABLED=true to enable.",
    handler,
  );
