/**
 * Framework Module
 * Dynamic content serving from .claude/ directory
 *
 * Provides 11 tools for on-demand access to concepts, commands, agents, skills,
 * workflow planning, and dynamic orchestration — replacing static context loading
 * with MCP-served content and active workflow coordination.
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { successResponse, errorResponse, args as a } from "../../utils/responses.js";
import { createDispatcher, createModule } from "../../core/dispatcher.js";
import { requireFramework } from "../../utils/guards.js";
import { config } from "../../core/config.js";
import { getContentLoader, resetContentLoader } from "./content-loader.js";
import { planWorkflow } from "./workflow-planner.js";
import { getSessionManager, setSessionStore } from "./session.js";
import { getSyncEvaluator, resetSyncEvaluator } from "./sync-evaluator.js";
import { StateStore } from "../state/store.js";
import type {
  ConceptResult,
  WorkflowResult,
  AgentPromptResult,
  SkillsResult,
  AdvanceResult,
  FrameworkStatus,
} from "./types.js";

const dispatcher = createDispatcher();

/** Enrich an agent prompt with task context and skill summaries. */
function enrichAgentPrompt(
  agentName: string,
  taskContext?: string,
): { enrichedPrompt: string | null; skills: Array<{ name: string; description?: string }> } {
  const loader = getContentLoader();
  const agent = loader.get("agent", agentName);
  if (!agent) return { enrichedPrompt: null, skills: [] };

  let body = agent.body;
  if (taskContext) {
    body = `## Task Context\n\n${taskContext}\n\n---\n\n${body}`;
  }

  const agentSkills = loader.getSkillsForAgent(agentName);
  const skills = agentSkills.map((s) => ({
    name: s.name,
    description: s.frontmatter.description as string | undefined,
  }));

  if (skills.length > 0) {
    const skillSection = skills
      .map((s) => `- **${s.name}**: ${s.description || "No description"}`)
      .join("\n");
    body = `${body}\n\n## Available Skills\n\n${skillSection}`;
  }

  return { enrichedPrompt: body, skills };
}

/**
 * Map workflow concept names to sync rule action names.
 * Workflow planner uses simple names (story, architecture, etc.)
 * while sync rules use compound names (story.create, architecture.design, etc.)
 */
const CONCEPT_DEFAULT_ACTIONS: Record<string, string> = {
  story: "create",
  "code-analysis": "context",
  architecture: "design",
  verification: "verify",
  implementation: "generate",
  quality: "review",
  version: "commit",
  documentation: "generate",
  security: "threat_model",
};

/**
 * Evaluate sync rules for a completed workflow step.
 * Maps workflow outcome to sync status and returns matched rules.
 */
function evaluateSyncForStep(
  concept: string,
  outcome: "success" | "partial" | "failed",
): AdvanceResult["syncRules"] {
  const action = CONCEPT_DEFAULT_ACTIONS[concept] || concept;
  const status = outcome === "failed" ? "failed" : "completed";

  const evaluator = getSyncEvaluator();
  const result = evaluator.evaluate(concept, action, status);

  if (result.noMatch) return undefined;

  // Auto-advance when rules match and have no where conditions
  const autoAdvance = result.matchedRules.some((r) => r.where === null);

  return {
    matched: true,
    event: { concept, action, status },
    rules: result.matchedRules.map((r) => ({
      id: r.rule.id,
      description: r.rule.description,
      actions: r.actions,
      where: r.where,
    })),
    autoAdvance,
  };
}

// Wire StateStore into SessionManager for persistence (if enabled)
const cfg = config();
if (cfg.stateEnabled) {
  setSessionStore(new StateStore(cfg.stateDbPath));
}

// Tool definitions
export const tools: Tool[] = [
  {
    name: "zen_get_concept",
    description:
      "Get a concept definition with its related commands and agents. Concepts define workflow phases (story, architecture, implementation, quality, etc.).",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Concept name (e.g., 'architecture', 'implementation', 'quality')",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "zen_get_workflow",
    description:
      "Get a command workflow definition with full instructions. Commands define user-facing workflows (feature, health, checkpoint, etc.).",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Command name (e.g., 'feature', 'health', 'checkpoint')",
        },
        args: {
          type: "string",
          description: "Optional arguments to include in context",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "zen_get_agent_prompt",
    description:
      "Get an agent's full prompt enriched with skill summaries. Agents are specialized Task tool subagents for specific workflow phases.",
    inputSchema: {
      type: "object",
      properties: {
        agent: {
          type: "string",
          description: "Agent name (e.g., 'story-concept', 'architecture-concept')",
        },
        taskContext: {
          type: "string",
          description: "Optional task context to prepend to the agent prompt",
        },
      },
      required: ["agent"],
    },
  },
  {
    name: "zen_get_skills",
    description:
      "Find skills by name, agent, or task description. Skills provide specialized capabilities for agents.",
    inputSchema: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "Task description to match against trigger_keywords",
        },
        skillNames: {
          type: "array",
          items: { type: "string" },
          description: "Exact skill names to retrieve",
        },
        agent: {
          type: "string",
          description: "Agent name to get associated skills for",
        },
      },
    },
  },
  {
    name: "zen_plan_workflow",
    description:
      "Analyze a task and recommend an optimal workflow with ordered steps, model assignments, and cost estimates. Classifies task type (feature/bugfix/refactor/docs) and complexity.",
    inputSchema: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "Task description to plan a workflow for",
        },
        context: {
          type: "string",
          description: "Optional additional context (codebase info, constraints)",
        },
      },
      required: ["task"],
    },
  },
  {
    name: "zen_start_workflow",
    description:
      "Start a tracked workflow session. Plans the workflow, creates an in-memory session, and returns the enriched first step with agent prompt and skills.",
    inputSchema: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "Task description to plan and start a workflow for",
        },
        context: {
          type: "string",
          description: "Optional additional context (codebase info, constraints)",
        },
      },
      required: ["task"],
    },
  },
  {
    name: "zen_advance_workflow",
    description:
      "Record step completion and advance to the next workflow step. Returns the enriched next step or workflow completion summary. On failure, does not auto-advance.",
    inputSchema: {
      type: "object",
      properties: {
        workflow_id: {
          type: "string",
          description: "Workflow session ID from zen_start_workflow",
        },
        completed_step: {
          type: "string",
          description: "Concept name of the step being completed (e.g., 'story', 'architecture')",
        },
        outcome: {
          type: "string",
          enum: ["success", "partial", "failed"],
          description: "Outcome of the completed step",
        },
        notes: {
          type: "string",
          description: "Optional notes about the step outcome",
        },
      },
      required: ["workflow_id", "completed_step", "outcome"],
    },
  },
  {
    name: "zen_evaluate_sync",
    description:
      "Evaluate synchronization rules for an event. Returns matching rules with actions and unevaluated where conditions. Does NOT evaluate conditions — returns them for Claude to check.",
    inputSchema: {
      type: "object",
      properties: {
        concept: {
          type: "string",
          description: "Concept that triggered the event (e.g., 'story', 'architecture')",
        },
        action: {
          type: "string",
          description: "Action that occurred (e.g., 'create', 'design', 'generate')",
        },
        status: {
          type: "string",
          description: "Status of the event (e.g., 'completed', 'failed', 'starting')",
        },
      },
      required: ["concept", "action", "status"],
    },
  },
  {
    name: "zen_get_workflow_state",
    description:
      "Get the current state of a workflow session including step statuses, timing, and summary. Defaults to the current active session if no ID provided.",
    inputSchema: {
      type: "object",
      properties: {
        workflow_id: {
          type: "string",
          description: "Workflow session ID. Defaults to current/most recent active session.",
        },
      },
    },
  },
  {
    name: "zen_framework_status",
    description:
      "Get framework module status: content counts by category, available items, and load timestamp.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "zen_reload_framework",
    description:
      "Reload framework content (concepts, commands, agents, skills) and sync rules from disk. Use after deploying new templates via install.sh.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

// Register handlers
dispatcher
  .registerQuick(
    "zen_get_concept",
    requireFramework(async (args) => {
      const name = a.string(args, "name");
      if (!name) return errorResponse("name is required");

      const loader = getContentLoader();
      const concept = loader.get("concept", name);
      if (!concept) {
        const available = loader.getAll("concept").map((c) => c.name);
        return errorResponse(
          `Concept "${name}" not found. Available: ${available.join(", ")}`,
        );
      }

      // Find related commands and agents by name matching
      const allCommands = loader.getAll("command");
      const allAgents = loader.getAll("agent");
      const conceptName = concept.name.toLowerCase();

      const relatedCommands = allCommands
        .filter(
          (cmd) =>
            cmd.body.toLowerCase().includes(conceptName) ||
            cmd.name.toLowerCase().includes(conceptName),
        )
        .map((cmd) => cmd.name);

      const relatedAgents = allAgents
        .filter(
          (agent) =>
            agent.name.toLowerCase().includes(conceptName) ||
            agent.frontmatter.name?.toLowerCase().includes(conceptName),
        )
        .map((agent) => agent.name);

      const result: ConceptResult = {
        name: concept.name,
        model: concept.frontmatter.model as string | undefined,
        purpose: (concept.frontmatter.purpose as string | undefined) ||
          (concept.frontmatter.description as string | undefined),
        cost_tier: concept.frontmatter.cost_tier as string | undefined,
        body: concept.body,
        relatedCommands,
        relatedAgents,
      };

      return successResponse(result);
    }),
  )
  .registerQuick(
    "zen_get_workflow",
    requireFramework(async (args) => {
      const command = a.string(args, "command");
      if (!command) return errorResponse("command is required");

      const loader = getContentLoader();
      const cmd = loader.get("command", command);

      if (!cmd) {
        const available = loader.getAll("command").map((c) => c.name);
        return errorResponse(
          `Command "${command}" not found. Available: ${available.join(", ")}`,
        );
      }

      const argsValue = a.stringOptional(args, "args");
      let body = cmd.body;
      if (argsValue) {
        body = `**Arguments**: ${argsValue}\n\n${body}`;
      }

      const result: WorkflowResult = {
        command: cmd.name,
        body,
        found: true,
      };

      return successResponse(result);
    }),
  )
  .registerQuick(
    "zen_get_agent_prompt",
    requireFramework(async (args) => {
      const agentName = a.string(args, "agent");
      if (!agentName) return errorResponse("agent is required");

      const loader = getContentLoader();
      const agent = loader.get("agent", agentName);

      if (!agent) {
        const available = loader.getAll("agent").map((a) => a.name);
        return errorResponse(
          `Agent "${agentName}" not found. Available: ${available.join(", ")}`,
        );
      }

      // Enrich prompt with task context and skills
      const taskContext = a.stringOptional(args, "taskContext");
      const { enrichedPrompt: body, skills: skillSummaries } = enrichAgentPrompt(agentName, taskContext);

      const result: AgentPromptResult = {
        agent: agent.name,
        model: agent.frontmatter.model as string | undefined,
        description: agent.frontmatter.description as string | undefined,
        body: body || agent.body,
        skills: skillSummaries,
      };

      return successResponse(result);
    }),
  )
  .registerQuick(
    "zen_get_skills",
    requireFramework(async (args) => {
      const task = a.stringOptional(args, "task");
      const skillNames = a.arrayOptional<string>(args, "skillNames");
      const agentName = a.stringOptional(args, "agent");

      if (!task && !skillNames && !agentName) {
        return errorResponse(
          "At least one of task, skillNames, or agent is required",
        );
      }

      interface SkillEntry {
        name: string;
        description?: string;
        applies_to?: string[];
        trigger_keywords?: string[];
        priority?: string;
        body: string;
      }

      const loader = getContentLoader();
      const matchedSkills = new Map<string, SkillEntry>();

      // By exact name
      if (skillNames && skillNames.length > 0) {
        for (const name of skillNames) {
          const skill = loader.get("skill", name);
          if (skill) {
            matchedSkills.set(skill.name, {
              name: skill.name,
              description: skill.frontmatter.description as string | undefined,
              applies_to: skill.frontmatter.applies_to,
              trigger_keywords: skill.frontmatter.trigger_keywords,
              priority: skill.frontmatter.priority as string | undefined,
              body: skill.body,
            });
          }
        }
      }

      // By agent
      if (agentName) {
        const agentSkills = loader.getSkillsForAgent(agentName);
        for (const skill of agentSkills) {
          if (!matchedSkills.has(skill.name)) {
            matchedSkills.set(skill.name, {
              name: skill.name,
              description: skill.frontmatter.description as string | undefined,
              applies_to: skill.frontmatter.applies_to,
              trigger_keywords: skill.frontmatter.trigger_keywords,
              priority: skill.frontmatter.priority as string | undefined,
              body: skill.body,
            });
          }
        }
      }

      // By task (keyword matching against trigger_keywords)
      if (task) {
        const taskLower = task.toLowerCase();
        const allSkills = loader.getAll("skill");
        for (const skill of allSkills) {
          if (matchedSkills.has(skill.name)) continue;
          const keywords = skill.frontmatter.trigger_keywords;
          if (
            Array.isArray(keywords) &&
            keywords.some((kw) => taskLower.includes(kw.toLowerCase()))
          ) {
            matchedSkills.set(skill.name, {
              name: skill.name,
              description: skill.frontmatter.description as string | undefined,
              applies_to: skill.frontmatter.applies_to,
              trigger_keywords: skill.frontmatter.trigger_keywords,
              priority: skill.frontmatter.priority as string | undefined,
              body: skill.body,
            });
          }
        }
      }

      const results = Array.from(matchedSkills.values());
      const result: SkillsResult = {
        count: results.length,
        skills: results,
      };

      return successResponse(result);
    }),
  )
  .register(
    "zen_plan_workflow",
    requireFramework(async (args) => {
      const task = a.string(args, "task");
      if (!task) return errorResponse("task is required");

      const context = a.stringOptional(args, "context");
      const plan = await planWorkflow(task, context);
      return successResponse(plan);
    }),
  )
  .register(
    "zen_start_workflow",
    requireFramework(async (args) => {
      const task = a.string(args, "task");
      if (!task) return errorResponse("task is required");

      const context = a.stringOptional(args, "context");
      const plan = await planWorkflow(task, context);
      const manager = getSessionManager();
      const session = manager.startWorkflow(task, plan, context);

      // Enrich the first step with agent prompt + skills
      const currentStep = manager.getCurrentStep(session);
      let enrichedPrompt: string | null = null;
      let skills: Array<{ name: string; description?: string }> = [];

      if (currentStep) {
        const taskContext = `${task}${context ? `\n\n${context}` : ""}`;
        ({ enrichedPrompt, skills } = enrichAgentPrompt(currentStep.agent, taskContext));
      }

      return successResponse({
        workflowId: session.id,
        task: session.task,
        plan: {
          taskType: plan.taskType,
          complexity: plan.complexity,
          totalSteps: plan.steps.length,
          reasoning: plan.reasoning,
        },
        firstStep: currentStep
          ? {
              concept: currentStep.concept,
              agent: currentStep.agent,
              model: currentStep.model,
              enrichedPrompt,
              skills,
            }
          : null,
        stepOverview: session.steps.map((s) => ({
          concept: s.concept,
          agent: s.agent,
          model: s.model,
          status: s.status,
        })),
      });
    }),
  )
  .register(
    "zen_advance_workflow",
    requireFramework(async (args) => {
      const workflowId = a.string(args, "workflow_id");
      if (!workflowId) return errorResponse("workflow_id is required");
      const completedStep = a.string(args, "completed_step");
      if (!completedStep) return errorResponse("completed_step is required");
      const outcome = a.string(args, "outcome") as "success" | "partial" | "failed";
      if (!["success", "partial", "failed"].includes(outcome)) {
        return errorResponse("outcome must be 'success', 'partial', or 'failed'");
      }
      const notes = a.stringOptional(args, "notes");

      const manager = getSessionManager();
      const session = manager.getSession(workflowId);
      if (!session) return errorResponse(`Workflow "${workflowId}" not found`);

      // Record the completed step
      const completedStepState = session.steps.find(
        (s) => s.concept === completedStep && s.status === "in_progress",
      );

      const { nextIndex, failureHints } = await manager.advanceStepWithIntelligence(workflowId, completedStep, outcome, notes);
      const updatedSession = manager.getSession(workflowId)!;
      const summary = manager.getSummary(updatedSession);

      // If there's a next step, enrich it
      let nextStep: AdvanceResult["nextStep"] = null;
      if (nextIndex >= 0) {
        const step = updatedSession.steps[nextIndex];
        const taskContext = `${updatedSession.task}${updatedSession.context ? `\n\n${updatedSession.context}` : ""}`;
        const { enrichedPrompt, skills } = enrichAgentPrompt(step.agent, taskContext);

        nextStep = {
          concept: step.concept,
          agent: step.agent,
          model: step.model,
          enrichedPrompt,
          skills,
        };
      }

      // Evaluate sync rules for the completed step
      const syncRules = evaluateSyncForStep(completedStep, outcome);

      // Build checkpoint prompt for successful steps
      let checkpointPrompt: AdvanceResult["checkpoint_prompt"] = undefined;
      if (outcome === "success" || updatedSession.status !== "active") {
        const trigger = updatedSession.status !== "active" ? "workflow_complete" : "step_complete";
        const message = trigger === "workflow_complete"
          ? "Workflow complete. Save a checkpoint with lessons, dead_ends, and warm_up_files. Update memory/relationship.md if you learned anything new about working with the user."
          : `Step "${completedStep}" complete. Note any lessons or dead ends for the next checkpoint.`;
        checkpointPrompt = { trigger, message };
      }

      const result: AdvanceResult = {
        workflowId,
        completedStep: completedStepState || null,
        nextStep,
        workflowComplete: updatedSession.status !== "active",
        summary,
        ...(failureHints ? { failureHints } : {}),
        ...(syncRules ? { syncRules } : {}),
        ...(checkpointPrompt ? { checkpoint_prompt: checkpointPrompt } : {}),
      };

      return successResponse(result);
    }),
  )
  .registerQuick(
    "zen_evaluate_sync",
    requireFramework(async (args) => {
      const concept = a.string(args, "concept");
      if (!concept) return errorResponse("concept is required");
      const action = a.string(args, "action");
      if (!action) return errorResponse("action is required");
      const status = a.string(args, "status");
      if (!status) return errorResponse("status is required");

      const evaluator = getSyncEvaluator();
      const result = evaluator.evaluate(concept, action, status);
      return successResponse(result);
    }),
  )
  .registerQuick(
    "zen_get_workflow_state",
    requireFramework(async (args) => {
      const workflowId = a.stringOptional(args, "workflow_id");
      const manager = getSessionManager();

      const session = workflowId
        ? manager.getSession(workflowId)
        : manager.getCurrentSession();

      if (!session) {
        return errorResponse(
          workflowId
            ? `Workflow "${workflowId}" not found`
            : "No active workflow session",
        );
      }

      return successResponse(manager.getStateSnapshot(session));
    }),
  )
  .registerQuick(
    "zen_framework_status",
    requireFramework(async () => {
      const loader = getContentLoader();
      const baseStatus = loader.getStatus();

      // Add orchestration stats
      const manager = getSessionManager();
      const evaluator = getSyncEvaluator();
      const stats = manager.getStats();

      const status: FrameworkStatus = {
        ...baseStatus,
        orchestration: {
          activeSessions: stats.activeSessions,
          totalSessions: stats.totalSessions,
          syncRulesLoaded: evaluator.getRuleCount(),
        },
      };

      return successResponse(status);
    }),
  )
  .registerQuick(
    "zen_reload_framework",
    requireFramework(async () => {
      // Reset all cached singletons so they re-read from disk
      resetContentLoader();
      resetSyncEvaluator();

      // Expire stale workflow sessions (>1 hour old)
      const manager = getSessionManager();
      const expiredCount = manager.expireStale(3600000);

      // Force re-initialization by accessing them
      const loader = getContentLoader();
      const evaluator = getSyncEvaluator();
      const loaderStatus = loader.getStatus();

      return successResponse({
        reloaded: true,
        contentRoot: loaderStatus.contentRoot,
        counts: loaderStatus.counts,
        syncRulesLoaded: evaluator.getRuleCount(),
        loadedAt: loaderStatus.loadedAt,
        staleSessionsExpired: expiredCount,
      });
    }),
  );

export const frameworkModule = createModule(tools, dispatcher);

// Export types and utilities
export * from "./types.js";
export { ContentLoader, getContentLoader, resetContentLoader } from "./content-loader.js";
export { planWorkflow } from "./workflow-planner.js";
export { SessionManager, getSessionManager, setSessionStore } from "./session.js";
export { SyncEvaluator, getSyncEvaluator } from "./sync-evaluator.js";
export { evaluateSyncForStep, CONCEPT_DEFAULT_ACTIONS };
