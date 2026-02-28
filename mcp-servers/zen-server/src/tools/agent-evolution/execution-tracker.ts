/**
 * Execution Tracker (MCP Message Bus)
 * 2 tools for workflow execution coordination.
 *
 * The MCP server acts as a passive state tracker and message broker.
 * It cannot spawn agents — Claude Code does that. The server:
 * 1. Holds the DAG execution state
 * 2. Stores per-node outputs as "messages" for downstream nodes
 * 3. Tracks which nodes are ready (all upstream edges satisfied)
 * 4. Provides upstream context to each node when requested
 *
 * - topology_execute_start  (quick)  Create execution from topology DAG
 * - topology_execute_node   (30s)    Manage node lifecycle (get_context/start/complete/fail/status)
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { Dispatcher, HandlerFn } from "../../core/dispatcher.js";
import {
  successResponse,
  errorResponse,
  args as a,
} from "../../utils/responses.js";

import {
  validateDAG,
  topologicalSort,
  getEntryNode,
  getExitNode,
  getIncomingEdges,
  getOutgoingEdges,
} from "./lib/topology/dag.js";
import type { WorkflowDAG } from "./lib/topology/types.js";
import type { AgentEvolutionStore } from "./store.js";

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const executionTools: Tool[] = [
  {
    name: "topology_execute_start",
    description:
      "Start executing a workflow topology. Creates an execution record, initializes all " +
      "nodes, and returns the execution plan with the first ready nodes. The entry node " +
      "is immediately marked as 'ready'. Call topology_execute_node for each node.",
    inputSchema: {
      type: "object" as const,
      properties: {
        topology: {
          type: "object",
          description: "WorkflowDAG to execute (from topology_select)",
        },
        task_description: {
          type: "string",
          description: "The task being executed (passed as context to entry node)",
        },
        complexity: {
          type: "string",
          enum: ["trivial", "simple", "medium", "complex", "expert"],
          description: "Classified task complexity level",
        },
        execution_id: {
          type: "string",
          description: "Optional execution ID (auto-generated if not provided)",
        },
      },
      required: ["topology", "task_description", "complexity"],
    },
  },
  {
    name: "topology_execute_node",
    description:
      "Manage node execution within a running topology. Actions: " +
      "'get_context' retrieves upstream messages; " +
      "'start' marks node as running; " +
      "'complete' reports output, creates messages for downstream nodes, checks readiness; " +
      "'fail' reports failure with optional retry; " +
      "'status' returns all node statuses.",
    inputSchema: {
      type: "object" as const,
      properties: {
        execution_id: {
          type: "string",
          description: "Execution ID from topology_execute_start",
        },
        action: {
          type: "string",
          enum: ["get_context", "start", "complete", "fail", "status"],
          description: "Node lifecycle action",
        },
        node_id: {
          type: "string",
          description: "Node ID within the DAG (for get_context/start/complete/fail)",
        },
        output: {
          type: "object",
          description: "Node output data (for complete)",
        },
        error: {
          type: "string",
          description: "Error message (for fail)",
        },
      },
      required: ["execution_id", "action"],
    },
  },
];

// ---------------------------------------------------------------------------
// Node readiness check
// ---------------------------------------------------------------------------

/**
 * A node is ready when ALL incoming edges have corresponding messages.
 */
function isNodeReady(
  store: AgentEvolutionStore,
  executionId: string,
  nodeId: string,
  dag: WorkflowDAG,
): boolean {
  const incomingEdges = getIncomingEdges(dag, nodeId);
  if (incomingEdges.length === 0) return false; // Entry node is set ready on creation

  for (const edge of incomingEdges) {
    const msg = store.getMessage(executionId, edge.source, nodeId);
    if (!msg) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Per-tool handler functions
// ---------------------------------------------------------------------------

function handleExecuteStart(getStore: () => AgentEvolutionStore): HandlerFn {
  return async (args) => {
    const topologyArg = a.object<WorkflowDAG>(args, "topology");
    if (!topologyArg) return errorResponse("topology is required");

    const taskDescription = a.string(args, "task_description");
    if (!taskDescription) return errorResponse("task_description is required");

    const complexity = a.string(args, "complexity");
    if (!complexity) return errorResponse("complexity is required");

    const executionId = a.stringOptional(args, "execution_id");

    const validation = validateDAG(topologyArg);
    if (!validation.valid) {
      return errorResponse(`Invalid topology: ${validation.errors.join("; ")}`);
    }

    const sortedNodes = topologicalSort(topologyArg);
    const executionPlan = sortedNodes.map((n) => n.id);
    const entryNode = getEntryNode(topologyArg);
    const exitNode = getExitNode(topologyArg);

    if (!entryNode || !exitNode) {
      return errorResponse("Topology must have exactly one entry and one exit node");
    }

    const store = getStore();

    const execution = store.createExecution({
      id: executionId,
      topologyId: topologyArg.id,
      topology: topologyArg,
      taskDescription,
      complexity,
      executionPlan,
    });

    const nodeParams = topologyArg.nodes.map((n) => ({
      nodeId: n.id,
      agentName: n.agentName,
      role: n.role,
      maxRetries: n.maxRetries ?? 0,
      initialStatus: n.id === entryNode.id ? "ready" : "pending",
      inputContext: n.id === entryNode.id
        ? { task_description: taskDescription, complexity }
        : undefined,
    }));

    const nodes = store.createExecutionNodes(execution.id, nodeParams);

    const readyNodes = nodes
      .filter((n) => n.status === "ready")
      .map((n) => ({
        node_id: n.nodeId,
        agent_name: n.agentName,
        role: n.role,
        input_context: n.inputContext,
      }));

    return successResponse({
      execution_id: execution.id,
      topology_id: topologyArg.id,
      execution_plan: executionPlan,
      node_count: topologyArg.nodes.length,
      edge_count: topologyArg.edges.length,
      entry_node: entryNode.id,
      exit_node: exitNode.id,
      ready_nodes: readyNodes,
      instructions: [
        `Spawn a subagent for each ready node.`,
        `Each subagent should: call topology_execute_node(action='get_context') → do work → call topology_execute_node(action='complete').`,
        `After each completion, check newly_ready_nodes to know which nodes to spawn next.`,
        `When execution_complete=true, the workflow is done.`,
      ],
    });
  };
}

// ---------------------------------------------------------------------------
// Per-action handlers for topology_execute_node
// ---------------------------------------------------------------------------

interface ExecutionContext {
  store: AgentEvolutionStore;
  executionId: string;
  dag: WorkflowDAG;
  args: Record<string, unknown>;
}

function handleGetContext(ctx: ExecutionContext) {
  const { store, executionId, args } = ctx;

  const nodeId = a.string(args, "node_id");
  if (!nodeId) return errorResponse("node_id is required for get_context");

  const node = store.getExecutionNode(executionId, nodeId);
  if (!node) return errorResponse(`Node '${nodeId}' not found in execution`);

  const execution = store.getExecution(executionId)!;
  const messages = store.getMessagesForNode(executionId, nodeId);

  return successResponse({
    node_id: nodeId,
    agent_name: node.agentName,
    role: node.role,
    status: node.status,
    task_description: (execution.topology as any)?.name ?? execution.taskDescription,
    input_context: node.inputContext,
    upstream_messages: messages.map((m) => ({
      from_node: m.sourceNodeId,
      edge_type: m.edgeType,
      content: m.content,
    })),
    message_count: messages.length,
  });
}

function handleNodeStart(ctx: ExecutionContext) {
  const { store, executionId, args } = ctx;

  const nodeId = a.string(args, "node_id");
  if (!nodeId) return errorResponse("node_id is required for start");

  const node = store.getExecutionNode(executionId, nodeId);
  if (!node) return errorResponse(`Node '${nodeId}' not found`);

  if (node.status !== "ready") {
    return errorResponse(`Node '${nodeId}' is '${node.status}', expected 'ready'`);
  }

  store.updateExecutionNode(executionId, nodeId, {
    status: "running",
    startedAt: new Date().toISOString(),
  });

  return successResponse({
    node_id: nodeId,
    status: "running",
    agent_name: node.agentName,
    role: node.role,
  });
}

function handleNodeComplete(ctx: ExecutionContext) {
  const { store, executionId, dag, args } = ctx;

  const nodeId = a.string(args, "node_id");
  if (!nodeId) return errorResponse("node_id is required for complete");

  const output = a.object(args, "output") ?? {};

  const node = store.getExecutionNode(executionId, nodeId);
  if (!node) return errorResponse(`Node '${nodeId}' not found`);

  if (node.status !== "running" && node.status !== "ready") {
    return errorResponse(`Node '${nodeId}' is '${node.status}', expected 'running' or 'ready'`);
  }

  const now = new Date().toISOString();

  store.updateExecutionNode(executionId, nodeId, {
    status: "completed",
    output,
    completedAt: now,
  });

  // Propagate messages to downstream nodes and check readiness
  const outgoingEdges = getOutgoingEdges(dag, nodeId);
  const newlyReadyNodes: Array<{
    node_id: string;
    agent_name: string;
    role: string;
  }> = [];

  for (const edge of outgoingEdges) {
    store.insertMessage({
      executionId,
      sourceNodeId: nodeId,
      targetNodeId: edge.target,
      edgeType: edge.edgeType,
      content: output,
    });

    if (isNodeReady(store, executionId, edge.target, dag)) {
      const downstream = store.getExecutionNode(executionId, edge.target);
      if (downstream && downstream.status === "pending") {
        const upstreamMessages = store.getMessagesForNode(executionId, edge.target);
        const aggregatedContext = upstreamMessages.map((m) => ({
          from_node: m.sourceNodeId,
          edge_type: m.edgeType,
          content: m.content,
        }));

        store.updateExecutionNode(executionId, edge.target, {
          status: "ready",
          inputContext: aggregatedContext,
        });

        newlyReadyNodes.push({
          node_id: edge.target,
          agent_name: downstream.agentName,
          role: downstream.role,
        });
      }
    }
  }

  const exitNode = getExitNode(dag);
  const executionComplete = exitNode !== null && nodeId === exitNode.id;

  if (executionComplete) {
    store.updateExecution(executionId, {
      status: "completed",
      result: output,
    });
  }

  return successResponse({
    node_id: nodeId,
    status: "completed",
    newly_ready_nodes: newlyReadyNodes,
    execution_complete: executionComplete,
    ...(executionComplete ? { final_result: output } : {}),
  });
}

function handleNodeFail(ctx: ExecutionContext) {
  const { store, executionId, args } = ctx;

  const nodeId = a.string(args, "node_id");
  if (!nodeId) return errorResponse("node_id is required for fail");

  const error = a.string(args, "error", "Unknown error");

  const node = store.getExecutionNode(executionId, nodeId);
  if (!node) return errorResponse(`Node '${nodeId}' not found`);

  const canRetry = node.retries < node.maxRetries;

  if (canRetry) {
    store.updateExecutionNode(executionId, nodeId, {
      status: "ready",
      retries: node.retries + 1,
      error,
    });

    return successResponse({
      node_id: nodeId,
      status: "ready",
      retries: node.retries + 1,
      max_retries: node.maxRetries,
      can_retry: true,
      retry_message: `Retrying (${node.retries + 1}/${node.maxRetries})`,
    });
  }

  store.updateExecutionNode(executionId, nodeId, {
    status: "failed",
    error,
    completedAt: new Date().toISOString(),
  });

  store.updateExecution(executionId, {
    status: "failed",
    error: `Node '${nodeId}' failed after ${node.maxRetries} retries: ${error}`,
  });

  return successResponse({
    node_id: nodeId,
    status: "failed",
    retries: node.retries,
    max_retries: node.maxRetries,
    can_retry: false,
    execution_failed: true,
    error,
  });
}

function handleNodeStatus(ctx: ExecutionContext) {
  const { store, executionId } = ctx;

  const execution = store.getExecution(executionId)!;
  const allNodes = store.getExecutionNodes(executionId);
  const readyNodes = allNodes.filter((n) => n.status === "ready");
  const runningNodes = allNodes.filter((n) => n.status === "running");
  const completedNodes = allNodes.filter((n) => n.status === "completed");
  const failedNodes = allNodes.filter((n) => n.status === "failed");

  return successResponse({
    execution_id: executionId,
    status: execution.status,
    task_description: execution.taskDescription,
    complexity: execution.complexity,
    nodes: allNodes.map((n) => ({
      node_id: n.nodeId,
      agent_name: n.agentName,
      role: n.role,
      status: n.status,
      retries: n.retries,
      started_at: n.startedAt,
      completed_at: n.completedAt,
      has_output: n.output !== null,
      error: n.error,
    })),
    summary: {
      total: allNodes.length,
      pending: allNodes.length - readyNodes.length - runningNodes.length - completedNodes.length - failedNodes.length,
      ready: readyNodes.length,
      running: runningNodes.length,
      completed: completedNodes.length,
      failed: failedNodes.length,
    },
    result: execution.result,
    error: execution.error,
  });
}

function handleExecuteNode(getStore: () => AgentEvolutionStore): HandlerFn {
  return async (args) => {
    const executionId = a.string(args, "execution_id");
    const action = a.string(args, "action");

    if (!executionId) return errorResponse("execution_id is required");
    if (!action) return errorResponse("action is required");

    const store = getStore();
    const execution = store.getExecution(executionId);
    if (!execution) return errorResponse(`Execution '${executionId}' not found`);

    const dag = execution.topology as WorkflowDAG;
    const ctx: ExecutionContext = { store, executionId, dag, args };

    switch (action) {
      case "get_context": return handleGetContext(ctx);
      case "start":       return handleNodeStart(ctx);
      case "complete":    return handleNodeComplete(ctx);
      case "fail":        return handleNodeFail(ctx);
      case "status":      return handleNodeStatus(ctx);
      default:
        return errorResponse(
          `Unknown action: ${action}. Supported: get_context, start, complete, fail, status`,
        );
    }
  };
}

// ---------------------------------------------------------------------------
// Handler registration
// ---------------------------------------------------------------------------

export function registerExecutionHandlers(
  dispatcher: Dispatcher,
  getStore: () => AgentEvolutionStore,
  requireGuard: (handler: HandlerFn) => HandlerFn,
): void {
  dispatcher.registerQuick("topology_execute_start", requireGuard(handleExecuteStart(getStore)));
  dispatcher.register("topology_execute_node", requireGuard(handleExecuteNode(getStore)));
}
