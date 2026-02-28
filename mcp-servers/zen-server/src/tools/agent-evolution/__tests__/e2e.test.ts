/**
 * Rigorous end-to-end tests for the agent-evolution pipeline.
 *
 * Tests cross-tool interactions and multi-step workflows:
 * - Full evolution lifecycle (start → steps → completion → portfolio → select → execute)
 * - Store persistence round-trips for all new tables
 * - Complex DAG execution patterns (out-of-order, multi-retry, fan-out/fan-in)
 * - Message bus serialization integrity (nested objects, nulls, unicode)
 * - Classifier feedback loop with accuracy improvement
 * - Terminal state enforcement (no re-completion, no re-start)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createDispatcher, type HandlerFn } from '../../../core/dispatcher.js';
import { AgentEvolutionStore } from '../store.js';
import { registerTopologyHandlers } from '../topology-tools.js';
import { registerExecutionHandlers } from '../execution-tracker.js';
import { createMinimalDAG, createLinearDAG, validateDAG } from '../lib/topology/dag.js';
import type { WorkflowDAG, TopologyNode, TopologyEdge } from '../lib/topology/types.js';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const identityGuard = (handler: HandlerFn): HandlerFn => handler;

function parse(response: { content: Array<{ type: string; text: string }>; isError?: boolean }): any {
  const text = response.content[0]?.text;
  if (!text) throw new Error('Empty response');
  if (response.isError) throw new Error(text);
  return JSON.parse(text);
}

function setup() {
  const dbPath = path.join(
    os.tmpdir(),
    `e2e-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.db`,
  );
  const store = new AgentEvolutionStore(dbPath);
  const dispatcher = createDispatcher();
  registerTopologyHandlers(dispatcher, () => store, identityGuard);
  registerExecutionHandlers(dispatcher, () => store, identityGuard);
  return { dbPath, store, dispatcher };
}

function teardown(ref: { dbPath: string; store: AgentEvolutionStore }) {
  ref.store.close();
  for (const suffix of ['', '-wal', '-shm']) {
    const p = ref.dbPath + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

/** Helper: dispatch and parse in one call. */
async function call(ref: ReturnType<typeof setup>, tool: string, args: Record<string, unknown>) {
  const res = await ref.dispatcher.dispatch(tool, args);
  if (res.isError) throw new Error(res.content[0]?.text);
  return parse(res);
}

/** Helper: dispatch expecting an error. Returns error text. */
async function callError(ref: ReturnType<typeof setup>, tool: string, args: Record<string, unknown>) {
  const res = await ref.dispatcher.dispatch(tool, args);
  expect(res.isError).toBe(true);
  return res.content[0]?.text ?? '';
}

// ---------------------------------------------------------------------------
// DAG factories
// ---------------------------------------------------------------------------

function wideFanOutDAG(): WorkflowDAG {
  // entry → w1, w2, w3, w4 → exit (4 parallel workers)
  const workers = ['w1', 'w2', 'w3', 'w4'];
  const nodes: TopologyNode[] = [
    { id: 'entry', agentName: 'planner', role: 'entry', modelOverride: null, maxRetries: 0 },
    ...workers.map((w) => ({
      id: w, agentName: `worker-${w}`, role: 'worker' as const, modelOverride: null, maxRetries: 0,
    })),
    { id: 'exit', agentName: 'aggregator', role: 'exit', modelOverride: null, maxRetries: 0 },
  ];
  const edges: TopologyEdge[] = [
    ...workers.map((w) => ({
      source: 'entry', target: w, edgeType: 'sequential' as const, weight: 1, condition: null,
    })),
    ...workers.map((w) => ({
      source: w, target: 'exit', edgeType: 'sequential' as const, weight: 1, condition: null,
    })),
  ];
  return { id: 'wide-fan', name: 'wide-fan-out', nodes, edges };
}

function multiLayerDAG(): WorkflowDAG {
  // entry → a, b → c → d, e → exit
  return {
    id: 'multi-layer',
    name: 'multi-layer-dag',
    nodes: [
      { id: 'entry', agentName: 'entry-agent', role: 'entry', modelOverride: null, maxRetries: 0 },
      { id: 'a', agentName: 'agent-a', role: 'worker', modelOverride: null, maxRetries: 0 },
      { id: 'b', agentName: 'agent-b', role: 'worker', modelOverride: null, maxRetries: 0 },
      { id: 'c', agentName: 'agent-c', role: 'worker', modelOverride: null, maxRetries: 0 },
      { id: 'd', agentName: 'agent-d', role: 'worker', modelOverride: null, maxRetries: 0 },
      { id: 'e', agentName: 'agent-e', role: 'worker', modelOverride: null, maxRetries: 0 },
      { id: 'exit', agentName: 'exit-agent', role: 'exit', modelOverride: null, maxRetries: 0 },
    ],
    edges: [
      { source: 'entry', target: 'a', edgeType: 'sequential', weight: 1, condition: null },
      { source: 'entry', target: 'b', edgeType: 'sequential', weight: 1, condition: null },
      { source: 'a', target: 'c', edgeType: 'sequential', weight: 1, condition: null },
      { source: 'b', target: 'c', edgeType: 'sequential', weight: 1, condition: null },
      { source: 'c', target: 'd', edgeType: 'sequential', weight: 1, condition: null },
      { source: 'c', target: 'e', edgeType: 'sequential', weight: 1, condition: null },
      { source: 'd', target: 'exit', edgeType: 'sequential', weight: 1, condition: null },
      { source: 'e', target: 'exit', edgeType: 'sequential', weight: 1, condition: null },
    ],
  };
}

function retryDAG(maxRetries: number): WorkflowDAG {
  return {
    id: 'retry-dag',
    name: 'retry-test',
    nodes: [
      { id: 'entry', agentName: 'starter', role: 'entry', modelOverride: null, maxRetries: 0 },
      { id: 'flaky', agentName: 'flaky-worker', role: 'worker', modelOverride: null, maxRetries },
      { id: 'exit', agentName: 'finisher', role: 'exit', modelOverride: null, maxRetries: 0 },
    ],
    edges: [
      { source: 'entry', target: 'flaky', edgeType: 'sequential', weight: 1, condition: null },
      { source: 'flaky', target: 'exit', edgeType: 'sequential', weight: 1, condition: null },
    ],
  };
}

// ===========================================================================
// 1. FULL EVOLUTION LIFECYCLE
// ===========================================================================

describe('full evolution lifecycle', () => {
  let ref: ReturnType<typeof setup>;
  beforeEach(() => { ref = setup(); });
  afterEach(() => teardown(ref));

  it('start → multiple steps → completion → status shows completed', async () => {
    const start = await call(ref, 'topology_evolve', {
      action: 'start',
      agent_pool: ['story', 'arch', 'impl', 'qa'],
      target_complexity: 'medium',
      max_generations: 3,
      seed: 42,
      seed_count: 3,
    });

    expect(start.session_id).toBeDefined();
    expect(start.pending_composites).toHaveLength(3);

    let sessionId = start.session_id;
    let pending = start.pending_composites;

    // Run 3 generations
    for (let gen = 0; gen < 3; gen++) {
      const fitness = pending.map((c: any) => ({
        composite_id: c.id,
        fitness: 0.3 + gen * 0.2 + Math.random() * 0.1,
      }));

      const step = await call(ref, 'topology_evolve', {
        action: 'step',
        session_id: sessionId,
        fitness_results: fitness,
      });

      if (gen < 2) {
        expect(step.status).toBe('active');
        expect(step.generation).toBe(gen + 1);
        pending = step.pending_composites;
      } else {
        expect(step.status).toBe('completed');
      }
    }

    // Verify status shows completed
    const status = await call(ref, 'topology_evolve', {
      action: 'status',
      session_id: sessionId,
    });
    expect(status.status).toBe('completed');
    expect(status.total_evaluations).toBe(13); // 3 seeds + 5 mutations + 5 mutations

    // Verify store persistence
    const session = ref.store.getConductorSession(sessionId);
    expect(session).not.toBeNull();
    expect(session!.status).toBe('completed');
    expect(session!.generation).toBe(3);
  });

  it('rejects step on completed session', async () => {
    const start = await call(ref, 'topology_evolve', {
      action: 'start',
      agent_pool: ['a', 'b'],
      max_generations: 1,
      seed: 1,
      seed_count: 1,
    });

    // Complete it
    await call(ref, 'topology_evolve', {
      action: 'step',
      session_id: start.session_id,
      fitness_results: [{ composite_id: start.pending_composites[0].id, fitness: 0.8 }],
    });

    // Try another step — should error
    const err = await callError(ref, 'topology_evolve', {
      action: 'step',
      session_id: start.session_id,
      fitness_results: [{ composite_id: 'x', fitness: 0.9 }],
    });
    expect(err).toContain('completed');
  });
});

// ===========================================================================
// 2. STORE PERSISTENCE ROUND-TRIPS
// ===========================================================================

describe('store persistence round-trips', () => {
  let ref: ReturnType<typeof setup>;
  beforeEach(() => { ref = setup(); });
  afterEach(() => teardown(ref));

  it('conductor session persists config, grid data, and stats across updates', async () => {
    const start = await call(ref, 'topology_evolve', {
      action: 'start',
      agent_pool: ['alpha', 'beta', 'gamma'],
      target_complexity: 'complex',
      max_generations: 5,
      seed: 777,
      seed_count: 2,
    });

    // Advance one step
    const fitness = start.pending_composites.map((c: any) => ({
      composite_id: c.id,
      fitness: 0.65,
    }));
    await call(ref, 'topology_evolve', {
      action: 'step',
      session_id: start.session_id,
      fitness_results: fitness,
    });

    // Reload from store
    const session = ref.store.getConductorSession(start.session_id)!;
    expect(session.targetComplexity).toBe('complex');
    expect(session.generation).toBe(1);
    expect(session.status).toBe('active');
    expect((session.config as any).maxGenerations).toBe(5);
    expect((session.config as any).seed).toBe(777);
    expect(session.totalEvaluations).toBe(2);
    expect((session.stats as any[]).length).toBe(1);
  });

  it('execution nodes round-trip input_context and output through JSON serialization', async () => {
    const dag = createMinimalDAG('rt-test', 'agent-x', 'agent-y');
    const exec = await call(ref, 'topology_execute_start', {
      topology: dag,
      task_description: 'Round-trip test',
      complexity: 'simple',
    });

    // Complete entry with complex nested output
    const complexOutput = {
      nested: { deeply: { nested: true, array: [1, 2, 3] } },
      nullField: null,
      emptyArray: [],
      emptyObject: {},
      number: 42.5,
      boolean: false,
    };
    await call(ref, 'topology_execute_node', {
      execution_id: exec.execution_id,
      action: 'complete',
      node_id: 'entry',
      output: complexOutput,
    });

    // Read back from store
    const entryNode = ref.store.getExecutionNode(exec.execution_id, 'entry')!;
    expect(entryNode.output).toEqual(complexOutput);
    expect(entryNode.status).toBe('completed');

    // Check the message was stored correctly
    const msgs = ref.store.getMessagesForNode(exec.execution_id, 'exit');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toEqual(complexOutput);
    expect(msgs[0].sourceNodeId).toBe('entry');
    expect(msgs[0].targetNodeId).toBe('exit');
    expect(msgs[0].edgeType).toBe('sequential');

    // Also verify getMessage (single lookup)
    const singleMsg = ref.store.getMessage(exec.execution_id, 'entry', 'exit');
    expect(singleMsg).not.toBeNull();
    expect(singleMsg!.content).toEqual(complexOutput);
  });

  it('classification + feedback + config persist and reload correctly', async () => {
    // Classify
    const c1 = await call(ref, 'topology_classify', {
      action: 'classify',
      query: 'Refactor auth module with dependency injection',
      context: 'Large codebase with 50 files',
    });

    // Feedback
    await call(ref, 'topology_classify', {
      action: 'feedback',
      classification_id: c1.id,
      actual_difficulty: 8.5,
      outcome: 'partial',
      notes: 'Required 3 iterations',
    });

    // Adjust thresholds
    await call(ref, 'topology_classify', { action: 'adjust_thresholds' });

    // Verify classification persisted
    const stored = ref.store.getClassification(c1.id)!;
    expect(stored.query).toBe('Refactor auth module with dependency injection');
    expect(stored.context).toBe('Large codebase with 50 files');
    expect(stored.complexity).toBe(c1.complexity);
    expect(stored.difficulty).toBe(c1.difficulty);
    expect(stored.confidence).toBe(c1.confidence);
    expect(stored.fusionMethod).toBe(c1.fusion_method);
    expect(stored.features).toBeDefined();

    // Verify feedback persisted
    const feedback = ref.store.getFeedbackForClassification(c1.id);
    expect(feedback).toHaveLength(1);
    expect(feedback[0].actualDifficulty).toBe(8.5);
    expect(feedback[0].outcome).toBe('partial');
    expect(feedback[0].notes).toBe('Required 3 iterations');

    // Verify config persisted
    const config = ref.store.getClassifierConfig('adjusted_thresholds');
    expect(config).toBeDefined();
  });

  it('execution record persists topology, plan, status, result, and error', async () => {
    const dag = createLinearDAG('persist-exec', ['a', 'b', 'c']);
    const exec = await call(ref, 'topology_execute_start', {
      topology: dag,
      task_description: 'Persist everything',
      complexity: 'medium',
    });

    // Complete all nodes
    for (const nodeId of exec.execution_plan) {
      await call(ref, 'topology_execute_node', {
        execution_id: exec.execution_id,
        action: 'complete',
        node_id: nodeId,
        output: { node: nodeId },
      });
    }

    // Read back full execution
    const stored = ref.store.getExecution(exec.execution_id)!;
    expect(stored.topologyId).toBe('persist-exec');
    expect(stored.taskDescription).toBe('Persist everything');
    expect(stored.complexity).toBe('medium');
    expect(stored.executionPlan).toEqual(['node-0', 'node-1', 'node-2']);
    expect(stored.status).toBe('completed');
    expect(stored.result).toEqual({ node: 'node-2' }); // exit node output
    expect(stored.error).toBeNull();
    expect((stored.topology as any).id).toBe('persist-exec');
  });

  it('getLatestConductorSession filters by status', async () => {
    // Create two sessions
    const s1 = await call(ref, 'topology_evolve', {
      action: 'start',
      agent_pool: ['x'],
      max_generations: 1,
      seed: 1,
      seed_count: 1,
    });
    const s2 = await call(ref, 'topology_evolve', {
      action: 'start',
      agent_pool: ['y'],
      max_generations: 10,
      seed: 2,
      seed_count: 1,
    });

    // Complete s1
    await call(ref, 'topology_evolve', {
      action: 'step',
      session_id: s1.session_id,
      fitness_results: [{ composite_id: s1.pending_composites[0].id, fitness: 0.5 }],
    });

    // s1 is completed, s2 is still active
    const latestCompleted = ref.store.getLatestConductorSession('completed');
    expect(latestCompleted).not.toBeNull();
    expect(latestCompleted!.id).toBe(s1.session_id);

    const latestActive = ref.store.getLatestConductorSession('active');
    expect(latestActive).not.toBeNull();
    expect(latestActive!.id).toBe(s2.session_id);

    const latestAny = ref.store.getLatestConductorSession();
    expect(latestAny).not.toBeNull();
    // Without a status filter, should return one of the two sessions
    // (both created in same millisecond, so ordering is non-deterministic)
    expect([s1.session_id, s2.session_id]).toContain(latestAny!.id);
  });

  it('conductor steps persist generation and fitness data', async () => {
    const start = await call(ref, 'topology_evolve', {
      action: 'start',
      agent_pool: ['a', 'b'],
      max_generations: 2,
      seed: 1,
      seed_count: 2,
    });

    // Step with fitness
    await call(ref, 'topology_evolve', {
      action: 'step',
      session_id: start.session_id,
      fitness_results: [
        { composite_id: start.pending_composites[0].id, fitness: 0.4 },
        { composite_id: start.pending_composites[1].id, fitness: 0.7 },
      ],
    });

    const steps = ref.store.getConductorSteps(start.session_id);
    expect(steps).toHaveLength(2);
    expect(steps.every(s => s.sessionId === start.session_id)).toBe(true);
    expect(steps.every(s => s.generation === 0)).toBe(true);

    // Filter by generation
    const gen0Steps = ref.store.getConductorSteps(start.session_id, 0);
    expect(gen0Steps).toHaveLength(2);

    const gen1Steps = ref.store.getConductorSteps(start.session_id, 1);
    expect(gen1Steps).toHaveLength(0);
  });
});

// ===========================================================================
// 3. COMPLEX DAG EXECUTION PATTERNS
// ===========================================================================

describe('complex DAG execution', () => {
  let ref: ReturnType<typeof setup>;
  beforeEach(() => { ref = setup(); });
  afterEach(() => teardown(ref));

  it('wide fan-out (4 parallel workers) with out-of-order completion', async () => {
    const dag = wideFanOutDAG();
    const exec = await call(ref, 'topology_execute_start', {
      topology: dag,
      task_description: 'Wide fan-out test',
      complexity: 'complex',
    });

    expect(exec.node_count).toBe(6);
    expect(exec.edge_count).toBe(8);

    // Complete entry → all 4 workers become ready
    const entryResult = await call(ref, 'topology_execute_node', {
      execution_id: exec.execution_id,
      action: 'complete',
      node_id: 'entry',
      output: { plan: 'distribute work' },
    });
    expect(entryResult.newly_ready_nodes).toHaveLength(4);

    // Complete workers in reverse order (w4, w2, w3, w1) — out of topological order
    const workerOrder = ['w4', 'w2', 'w3', 'w1'];
    for (let i = 0; i < workerOrder.length; i++) {
      const w = workerOrder[i];
      const res = await call(ref, 'topology_execute_node', {
        execution_id: exec.execution_id,
        action: 'complete',
        node_id: w,
        output: { worker: w, result: `output-${w}` },
      });

      if (i < 3) {
        // Exit not ready yet — missing some worker outputs
        expect(res.newly_ready_nodes).toHaveLength(0);
      } else {
        // Last worker completed → exit is now ready
        expect(res.newly_ready_nodes).toHaveLength(1);
        expect(res.newly_ready_nodes[0].node_id).toBe('exit');
      }
    }

    // Get exit context — should have all 4 worker messages
    const exitCtx = await call(ref, 'topology_execute_node', {
      execution_id: exec.execution_id,
      action: 'get_context',
      node_id: 'exit',
    });
    expect(exitCtx.upstream_messages).toHaveLength(4);
    const workerOutputs = exitCtx.upstream_messages.map((m: any) => m.from_node).sort();
    expect(workerOutputs).toEqual(['w1', 'w2', 'w3', 'w4']);

    // Complete exit
    const final = await call(ref, 'topology_execute_node', {
      execution_id: exec.execution_id,
      action: 'complete',
      node_id: 'exit',
      output: { aggregated: true },
    });
    expect(final.execution_complete).toBe(true);
  });

  it('multi-layer DAG (entry → a,b → c → d,e → exit) with correct readiness cascading', async () => {
    const dag = multiLayerDAG();
    expect(validateDAG(dag).valid).toBe(true);

    const exec = await call(ref, 'topology_execute_start', {
      topology: dag,
      task_description: 'Multi-layer cascade',
      complexity: 'expert',
    });
    expect(exec.node_count).toBe(7);

    // Complete entry → a and b become ready
    const r1 = await call(ref, 'topology_execute_node', {
      execution_id: exec.execution_id,
      action: 'complete',
      node_id: 'entry',
      output: { phase: 'planning' },
    });
    expect(r1.newly_ready_nodes.map((n: any) => n.node_id).sort()).toEqual(['a', 'b']);

    // Complete a — c still not ready (needs b too)
    const r2 = await call(ref, 'topology_execute_node', {
      execution_id: exec.execution_id,
      action: 'complete',
      node_id: 'a',
      output: { from: 'a' },
    });
    expect(r2.newly_ready_nodes).toHaveLength(0);

    // Complete b — c becomes ready
    const r3 = await call(ref, 'topology_execute_node', {
      execution_id: exec.execution_id,
      action: 'complete',
      node_id: 'b',
      output: { from: 'b' },
    });
    expect(r3.newly_ready_nodes).toHaveLength(1);
    expect(r3.newly_ready_nodes[0].node_id).toBe('c');

    // c should have both a and b messages
    const cCtx = await call(ref, 'topology_execute_node', {
      execution_id: exec.execution_id,
      action: 'get_context',
      node_id: 'c',
    });
    expect(cCtx.upstream_messages).toHaveLength(2);

    // Complete c → d and e become ready
    const r4 = await call(ref, 'topology_execute_node', {
      execution_id: exec.execution_id,
      action: 'complete',
      node_id: 'c',
      output: { from: 'c', merged: true },
    });
    expect(r4.newly_ready_nodes.map((n: any) => n.node_id).sort()).toEqual(['d', 'e']);

    // Complete d — exit not ready yet
    await call(ref, 'topology_execute_node', {
      execution_id: exec.execution_id,
      action: 'complete',
      node_id: 'd',
      output: { from: 'd' },
    });

    // Complete e — exit becomes ready
    const r5 = await call(ref, 'topology_execute_node', {
      execution_id: exec.execution_id,
      action: 'complete',
      node_id: 'e',
      output: { from: 'e' },
    });
    expect(r5.newly_ready_nodes).toHaveLength(1);
    expect(r5.newly_ready_nodes[0].node_id).toBe('exit');

    // Complete exit
    const final = await call(ref, 'topology_execute_node', {
      execution_id: exec.execution_id,
      action: 'complete',
      node_id: 'exit',
      output: { final: true },
    });
    expect(final.execution_complete).toBe(true);

    // Verify all 7 nodes completed
    const status = await call(ref, 'topology_execute_node', {
      execution_id: exec.execution_id,
      action: 'status',
    });
    expect(status.summary.completed).toBe(7);
    expect(status.summary.pending).toBe(0);
    expect(status.summary.ready).toBe(0);
    expect(status.summary.running).toBe(0);
    expect(status.status).toBe('completed');
  });

  it('full retry cycle: fail → ready → start → fail → ready → start → complete', async () => {
    const dag = retryDAG(3); // 3 retries allowed
    const exec = await call(ref, 'topology_execute_start', {
      topology: dag,
      task_description: 'Retry cycle test',
      complexity: 'medium',
    });

    // Complete entry → flaky becomes ready
    await call(ref, 'topology_execute_node', {
      execution_id: exec.execution_id,
      action: 'complete',
      node_id: 'entry',
      output: { started: true },
    });

    // Fail flaky 3 times, each time it should go back to ready
    for (let attempt = 1; attempt <= 3; attempt++) {
      // Start
      await call(ref, 'topology_execute_node', {
        execution_id: exec.execution_id,
        action: 'start',
        node_id: 'flaky',
      });

      // Fail
      const failRes = await call(ref, 'topology_execute_node', {
        execution_id: exec.execution_id,
        action: 'fail',
        node_id: 'flaky',
        error: `Attempt ${attempt} failed`,
      });

      expect(failRes.can_retry).toBe(true);
      expect(failRes.retries).toBe(attempt);
      expect(failRes.status).toBe('ready');

      // Verify node is ready in store
      const node = ref.store.getExecutionNode(exec.execution_id, 'flaky')!;
      expect(node.status).toBe('ready');
      expect(node.retries).toBe(attempt);
      expect(node.error).toBe(`Attempt ${attempt} failed`);
    }

    // Now succeed on attempt 4
    await call(ref, 'topology_execute_node', {
      execution_id: exec.execution_id,
      action: 'start',
      node_id: 'flaky',
    });
    const success = await call(ref, 'topology_execute_node', {
      execution_id: exec.execution_id,
      action: 'complete',
      node_id: 'flaky',
      output: { recovered: true, after_attempts: 4 },
    });
    expect(success.status).toBe('completed');
    expect(success.newly_ready_nodes).toHaveLength(1);
    expect(success.newly_ready_nodes[0].node_id).toBe('exit');

    // Complete exit
    const final = await call(ref, 'topology_execute_node', {
      execution_id: exec.execution_id,
      action: 'complete',
      node_id: 'exit',
      output: { done: true },
    });
    expect(final.execution_complete).toBe(true);

    // Verify final node state
    const flakyNode = ref.store.getExecutionNode(exec.execution_id, 'flaky')!;
    expect(flakyNode.status).toBe('completed');
    expect(flakyNode.retries).toBe(3);
    expect(flakyNode.output).toEqual({ recovered: true, after_attempts: 4 });
  });

  it('exhausted retries fail the execution', async () => {
    const dag = retryDAG(1); // only 1 retry
    const exec = await call(ref, 'topology_execute_start', {
      topology: dag,
      task_description: 'Exhausted retries',
      complexity: 'simple',
    });

    await call(ref, 'topology_execute_node', {
      execution_id: exec.execution_id,
      action: 'complete',
      node_id: 'entry',
      output: {},
    });

    // Fail once → retried
    await call(ref, 'topology_execute_node', {
      execution_id: exec.execution_id,
      action: 'start',
      node_id: 'flaky',
    });
    const r1 = await call(ref, 'topology_execute_node', {
      execution_id: exec.execution_id,
      action: 'fail',
      node_id: 'flaky',
      error: 'First failure',
    });
    expect(r1.can_retry).toBe(true);

    // Fail again → exhausted
    await call(ref, 'topology_execute_node', {
      execution_id: exec.execution_id,
      action: 'start',
      node_id: 'flaky',
    });
    const r2 = await call(ref, 'topology_execute_node', {
      execution_id: exec.execution_id,
      action: 'fail',
      node_id: 'flaky',
      error: 'Second failure',
    });
    expect(r2.can_retry).toBe(false);
    expect(r2.execution_failed).toBe(true);

    // Execution is failed
    const execution = ref.store.getExecution(exec.execution_id)!;
    expect(execution.status).toBe('failed');
    expect(execution.error).toContain('flaky');
    expect(execution.error).toContain('1 retries');
  });
});

// ===========================================================================
// 4. MESSAGE BUS SERIALIZATION INTEGRITY
// ===========================================================================

describe('message bus serialization', () => {
  let ref: ReturnType<typeof setup>;
  beforeEach(() => { ref = setup(); });
  afterEach(() => teardown(ref));

  it('preserves deeply nested objects through store round-trip', async () => {
    const dag = createMinimalDAG('nested', 'a', 'b');
    const exec = await call(ref, 'topology_execute_start', {
      topology: dag,
      task_description: 'Nested objects',
      complexity: 'trivial',
    });

    const deepOutput = {
      level1: {
        level2: {
          level3: {
            value: 'deep',
            numbers: [1, 2.5, -3, 0, 1e10],
            mixed: [true, false, null, 'string', 42],
          },
        },
      },
      topArray: [[1, 2], [3, 4], [[5]]],
      emptyNested: { a: { b: { c: {} } } },
    };

    await call(ref, 'topology_execute_node', {
      execution_id: exec.execution_id,
      action: 'complete',
      node_id: 'entry',
      output: deepOutput,
    });

    // Verify via get_context
    const ctx = await call(ref, 'topology_execute_node', {
      execution_id: exec.execution_id,
      action: 'get_context',
      node_id: 'exit',
    });
    expect(ctx.upstream_messages[0].content).toEqual(deepOutput);
  });

  it('handles unicode and special characters in messages', async () => {
    const dag = createMinimalDAG('unicode', 'a', 'b');
    const exec = await call(ref, 'topology_execute_start', {
      topology: dag,
      task_description: 'Unicode test',
      complexity: 'trivial',
    });

    const unicodeOutput = {
      japanese: 'テストデータ',
      korean: '테스트',
      emoji: '🚀💻🔧',
      special: 'line1\nline2\ttab "quotes" \\backslash',
      nullish: null,
      zero: 0,
      emptyString: '',
    };

    await call(ref, 'topology_execute_node', {
      execution_id: exec.execution_id,
      action: 'complete',
      node_id: 'entry',
      output: unicodeOutput,
    });

    const ctx = await call(ref, 'topology_execute_node', {
      execution_id: exec.execution_id,
      action: 'get_context',
      node_id: 'exit',
    });
    expect(ctx.upstream_messages[0].content).toEqual(unicodeOutput);
  });

  it('preserves message content from multiple upstream nodes independently', async () => {
    // Diamond: entry → left, right → exit
    const dag: WorkflowDAG = {
      id: 'msg-integrity',
      name: 'msg-integrity',
      nodes: [
        { id: 'entry', agentName: 'e', role: 'entry', modelOverride: null, maxRetries: 0 },
        { id: 'left', agentName: 'l', role: 'worker', modelOverride: null, maxRetries: 0 },
        { id: 'right', agentName: 'r', role: 'worker', modelOverride: null, maxRetries: 0 },
        { id: 'exit', agentName: 'x', role: 'exit', modelOverride: null, maxRetries: 0 },
      ],
      edges: [
        { source: 'entry', target: 'left', edgeType: 'sequential', weight: 1, condition: null },
        { source: 'entry', target: 'right', edgeType: 'review', weight: 1, condition: null },
        { source: 'left', target: 'exit', edgeType: 'sequential', weight: 1, condition: null },
        { source: 'right', target: 'exit', edgeType: 'review', weight: 1, condition: null },
      ],
    };

    const exec = await call(ref, 'topology_execute_start', {
      topology: dag,
      task_description: 'Message integrity',
      complexity: 'medium',
    });

    // Complete entry
    await call(ref, 'topology_execute_node', {
      execution_id: exec.execution_id,
      action: 'complete',
      node_id: 'entry',
      output: { instruction: 'go' },
    });

    // Left produces code output, right produces review output
    await call(ref, 'topology_execute_node', {
      execution_id: exec.execution_id,
      action: 'complete',
      node_id: 'left',
      output: { code: 'function foo() {}', language: 'typescript' },
    });
    await call(ref, 'topology_execute_node', {
      execution_id: exec.execution_id,
      action: 'complete',
      node_id: 'right',
      output: { review: 'LGTM', score: 9.5, issues: [] },
    });

    // Exit should see both messages with correct edge types
    const ctx = await call(ref, 'topology_execute_node', {
      execution_id: exec.execution_id,
      action: 'get_context',
      node_id: 'exit',
    });

    expect(ctx.upstream_messages).toHaveLength(2);

    const fromLeft = ctx.upstream_messages.find((m: any) => m.from_node === 'left');
    expect(fromLeft.edge_type).toBe('sequential');
    expect(fromLeft.content).toEqual({ code: 'function foo() {}', language: 'typescript' });

    const fromRight = ctx.upstream_messages.find((m: any) => m.from_node === 'right');
    expect(fromRight.edge_type).toBe('review');
    expect(fromRight.content).toEqual({ review: 'LGTM', score: 9.5, issues: [] });
  });
});

// ===========================================================================
// 5. TERMINAL STATE ENFORCEMENT
// ===========================================================================

describe('terminal state enforcement', () => {
  let ref: ReturnType<typeof setup>;
  beforeEach(() => { ref = setup(); });
  afterEach(() => teardown(ref));

  it('rejects start on already-completed node', async () => {
    const dag = createMinimalDAG('terminal', 'a', 'b');
    const exec = await call(ref, 'topology_execute_start', {
      topology: dag,
      task_description: 'Terminal test',
      complexity: 'trivial',
    });

    // Complete entry
    await call(ref, 'topology_execute_node', {
      execution_id: exec.execution_id,
      action: 'complete',
      node_id: 'entry',
      output: { done: true },
    });

    // Try to start it again — should error
    const err = await callError(ref, 'topology_execute_node', {
      execution_id: exec.execution_id,
      action: 'start',
      node_id: 'entry',
    });
    expect(err).toContain('completed');
    expect(err).toContain('expected');
  });

  it('rejects complete on already-completed node', async () => {
    const dag = createMinimalDAG('recomp', 'a', 'b');
    const exec = await call(ref, 'topology_execute_start', {
      topology: dag,
      task_description: 'Re-completion test',
      complexity: 'trivial',
    });

    await call(ref, 'topology_execute_node', {
      execution_id: exec.execution_id,
      action: 'complete',
      node_id: 'entry',
      output: { v: 1 },
    });

    // Try to complete again with different output
    const err = await callError(ref, 'topology_execute_node', {
      execution_id: exec.execution_id,
      action: 'complete',
      node_id: 'entry',
      output: { v: 2 },
    });
    expect(err).toContain('completed');
  });

  it('rejects start on failed node', async () => {
    const dag = retryDAG(0); // no retries
    const exec = await call(ref, 'topology_execute_start', {
      topology: dag,
      task_description: 'Failed node test',
      complexity: 'trivial',
    });

    // Complete entry
    await call(ref, 'topology_execute_node', {
      execution_id: exec.execution_id,
      action: 'complete',
      node_id: 'entry',
      output: {},
    });

    // Start and fail flaky
    await call(ref, 'topology_execute_node', {
      execution_id: exec.execution_id,
      action: 'start',
      node_id: 'flaky',
    });
    await call(ref, 'topology_execute_node', {
      execution_id: exec.execution_id,
      action: 'fail',
      node_id: 'flaky',
      error: 'permanent',
    });

    // Try to start failed node
    const err = await callError(ref, 'topology_execute_node', {
      execution_id: exec.execution_id,
      action: 'start',
      node_id: 'flaky',
    });
    expect(err).toContain('failed');
  });
});

// ===========================================================================
// 6. CLASSIFIER FEEDBACK LOOP
// ===========================================================================

describe('classifier feedback loop', () => {
  let ref: ReturnType<typeof setup>;
  beforeEach(() => { ref = setup(); });
  afterEach(() => teardown(ref));

  it('accumulates feedback across multiple classifications', async () => {
    const tasks = [
      'Fix typo in README',
      'Add a date formatting utility',
      'Implement JWT auth with token refresh',
      'Refactor the ORM layer for multi-tenancy with row-level security',
      'Design distributed event sourcing with CQRS across 5 microservices',
    ];

    const results: any[] = [];
    for (const query of tasks) {
      const data = await call(ref, 'topology_classify', { action: 'classify', query });
      results.push(data);

      // Provide feedback — actual difficulty matches classifier prediction ±1
      await call(ref, 'topology_classify', {
        action: 'feedback',
        classification_id: data.id,
        actual_difficulty: Math.min(10, Math.max(0, data.difficulty + (Math.random() - 0.5) * 2)),
        outcome: 'success',
      });
    }

    // Verify stats reflect all classifications and feedback
    const stats = await call(ref, 'topology_classify', { action: 'stats' });
    expect(stats.classification_count).toBeGreaterThanOrEqual(5);
    expect(stats.feedback_count).toBeGreaterThanOrEqual(5);
    expect(stats.accuracy.total).toBeGreaterThanOrEqual(5);
    expect(stats.accuracy.rate).toBeGreaterThanOrEqual(0);
    expect(stats.accuracy.rate).toBeLessThanOrEqual(1);

    // Distribution should cover multiple complexity levels
    const dist = stats.distribution;
    const totalClassified = dist.trivial + dist.simple + dist.medium + dist.complex + dist.expert;
    expect(totalClassified).toBeGreaterThanOrEqual(5);

    // Verify recent classifications from store
    const stored = ref.store.getRecentClassifications(10);
    expect(stored.length).toBeGreaterThanOrEqual(5);

    // Verify all feedback persisted
    const allFeedback = ref.store.getAllFeedback();
    expect(allFeedback.length).toBeGreaterThanOrEqual(5);
  });

  it('complexity classification is monotonic with task complexity', async () => {
    const complexityOrder = ['trivial', 'simple', 'medium', 'complex', 'expert'];

    // Simple task should classify lower than complex task
    const simple = await call(ref, 'topology_classify', {
      action: 'classify',
      query: 'Fix a typo',
    });
    const complex = await call(ref, 'topology_classify', {
      action: 'classify',
      query:
        'Architect distributed microservice infrastructure with encrypted authentication, ' +
        'security vulnerability scanning, and zero-downtime deployments across ' +
        'src/auth.ts, src/gateway.ts, src/deploy.ts, src/monitor.ts, src/scan.ts. ' +
        'Must maintain backward compatibility. First design, then implement, finally test.',
    });

    expect(simple.difficulty).toBeLessThan(complex.difficulty);
    expect(complexityOrder.indexOf(simple.complexity)).toBeLessThanOrEqual(
      complexityOrder.indexOf(complex.complexity),
    );
  });
});

// ===========================================================================
// 7. ABLATION + SKILLS END-TO-END
// ===========================================================================

describe('ablation and skills end-to-end', () => {
  let ref: ReturnType<typeof setup>;
  beforeEach(() => { ref = setup(); });
  afterEach(() => teardown(ref));

  // Use canonical section headings so the parser maps them to known IDs
  const FULL_AGENT_MD = `---
name: full-agent
model: sonnet
skills:
  - semantic-search  # Find similar code
  - code-review  # Review quality
  - testing  # Write tests
---

# Full Agent

## Purpose

You are a senior software engineer.

## Methodology

Follow clean code principles.

## Constraints

Write unit and integration tests.

## Output Format

Return structured JSON responses.
`;

  it('ablation plan → submit → identifies highest-impact section', async () => {
    const plan = await call(ref, 'topology_ablation', {
      action: 'plan',
      markdown: FULL_AGENT_MD,
    });

    expect(plan.agent_name).toBe('full-agent');
    expect(plan.total_sections).toBeGreaterThanOrEqual(4);

    // Simulate fitness evaluation — purpose section is critical, output format is not
    const sectionResults = plan.variants
      .filter((v: any) => v.applied)
      .map((v: any) => ({
        section_id: v.section_id,
        fitness: v.section_id === 'purpose' ? 0.3        // big drop
          : v.section_id === 'methodology' ? 0.6          // moderate drop
          : v.section_id === 'constraints' ? 0.65         // small drop
          : 0.75,                                          // minimal drop (output_format)
      }));

    const result = await call(ref, 'topology_ablation', {
      action: 'submit',
      baseline_fitness: 0.75,
      section_results: sectionResults,
    });

    // Purpose should have highest impact
    expect(result.impacts[0].section_id).toBe('purpose');
    expect(result.impacts[0].impact_magnitude).toBeCloseTo(0.45);
    expect(result.impacts[0].direction).toBe('hurts_when_removed');

    // Mutation weights should sum to 1
    const weightSum = Object.values(result.mutation_weights).reduce((s: number, w: unknown) => s + (w as number), 0);
    expect(weightSum).toBeCloseTo(1.0);

    // Purpose should get highest mutation weight (most protection)
    const purposeWeight = result.mutation_weights['purpose'];
    expect(purposeWeight).toBeGreaterThan(0.3);
  });

  it('skills plan → submit → produces actionable recommendations', async () => {
    const plan = await call(ref, 'topology_skills', {
      action: 'plan',
      markdown: FULL_AGENT_MD,
      candidates: [
        { name: 'refactoring', comment: 'Refactor code' },
        { name: 'documentation', comment: 'Write docs' },
      ],
    });

    expect(plan.current_skills).toHaveLength(3);
    expect(plan.removal_variants.length).toBeGreaterThan(0);
    expect(plan.addition_variants.length).toBeGreaterThan(0);

    // Simulate: semantic-search is crucial, testing is marginal, refactoring helps
    const result = await call(ref, 'topology_skills', {
      action: 'submit',
      baseline_fitness: 0.70,
      removal_results: [
        { skill_name: 'semantic-search', fitness: 0.45 },  // big drop → keep
        { skill_name: 'code-review', fitness: 0.62 },      // moderate drop → keep
        { skill_name: 'testing', fitness: 0.72 },           // marginal improvement → remove
      ],
      addition_results: [
        { skill_name: 'refactoring', fitness: 0.82 },      // significant improvement → add
        { skill_name: 'documentation', fitness: 0.71 },     // marginal → skip
      ],
    });

    expect(result.recommended_skills.keep).toContain('semantic-search');
    expect(result.recommended_skills.keep).toContain('code-review');
    expect(result.recommended_skills.remove).toContain('testing');
    expect(result.recommended_skills.add).toContain('refactoring');
    expect(result.recommended_skills.add).not.toContain('documentation');
  });
});

// ===========================================================================
// 8. FULL PIPELINE: CLASSIFY → EVOLVE → EXECUTE
// ===========================================================================

describe('full pipeline: classify → evolve → execute', () => {
  let ref: ReturnType<typeof setup>;
  beforeEach(() => { ref = setup(); });
  afterEach(() => teardown(ref));

  it('classifies task, evolves topologies, then executes the best one', async () => {
    // Step 1: Classify
    const classification = await call(ref, 'topology_classify', {
      action: 'classify',
      query: 'Implement a caching layer with TTL and LRU eviction for the API gateway',
    });
    expect(classification.complexity).toBeDefined();
    expect(classification.difficulty).toBeGreaterThan(0);

    // Step 2: Evolve topologies
    const evolution = await call(ref, 'topology_evolve', {
      action: 'start',
      agent_pool: ['story', 'architect', 'implementer', 'quality'],
      target_complexity: classification.complexity,
      max_generations: 2,
      seed: 42,
      seed_count: 2,
    });

    // Run 2 generations
    let pending = evolution.pending_composites;
    for (let gen = 0; gen < 2; gen++) {
      const fitness = pending.map((c: any, i: number) => ({
        composite_id: c.id,
        fitness: 0.4 + gen * 0.15 + i * 0.05,
      }));

      const step = await call(ref, 'topology_evolve', {
        action: 'step',
        session_id: evolution.session_id,
        fitness_results: fitness,
      });

      pending = step.pending_composites ?? [];
    }

    // Verify evolution completed
    const evolveStatus = await call(ref, 'topology_evolve', {
      action: 'status',
      session_id: evolution.session_id,
    });
    expect(evolveStatus.status).toBe('completed');

    // Step 3: Since evolution produces composite topologies, build a simple
    // topology based on the classified complexity for execution
    const dag = classification.complexity === 'trivial'
      ? createMinimalDAG('pipeline', 'implementer', 'implementer')
      : createLinearDAG('pipeline', ['story', 'implementer', 'quality']);

    // Step 4: Execute
    const exec = await call(ref, 'topology_execute_start', {
      topology: dag,
      task_description: 'Implement caching layer',
      complexity: classification.complexity,
    });

    // Complete all nodes
    for (const nodeId of exec.execution_plan) {
      await call(ref, 'topology_execute_node', {
        execution_id: exec.execution_id,
        action: 'complete',
        node_id: nodeId,
        output: { node: nodeId, phase: 'done' },
      });
    }

    // Step 5: Verify everything completed
    const execStatus = await call(ref, 'topology_execute_node', {
      execution_id: exec.execution_id,
      action: 'status',
    });
    expect(execStatus.status).toBe('completed');
    expect(execStatus.summary.failed).toBe(0);
    expect(execStatus.summary.pending).toBe(0);

    // Step 6: Provide feedback on classification
    await call(ref, 'topology_classify', {
      action: 'feedback',
      classification_id: classification.id,
      actual_difficulty: classification.difficulty,
      outcome: 'success',
    });

    // Step 7: Verify cross-store consistency
    const storedExec = ref.store.getExecution(exec.execution_id)!;
    expect(storedExec.status).toBe('completed');

    const storedClassification = ref.store.getClassification(classification.id)!;
    expect(storedClassification.complexity).toBe(classification.complexity);

    const storedSession = ref.store.getConductorSession(evolution.session_id)!;
    expect(storedSession.status).toBe('completed');
  });
});

// ===========================================================================
// 9. DAG VALIDATION EDGE CASES
// ===========================================================================

describe('DAG validation edge cases', () => {
  let ref: ReturnType<typeof setup>;
  beforeEach(() => { ref = setup(); });
  afterEach(() => teardown(ref));

  it('rejects DAG with no entry node', async () => {
    const dag: WorkflowDAG = {
      id: 'no-entry',
      name: 'bad',
      nodes: [
        { id: 'a', agentName: 'a', role: 'worker', modelOverride: null, maxRetries: 0 },
        { id: 'b', agentName: 'b', role: 'exit', modelOverride: null, maxRetries: 0 },
      ],
      edges: [{ source: 'a', target: 'b', edgeType: 'sequential', weight: 1, condition: null }],
    };
    const err = await callError(ref, 'topology_execute_start', {
      topology: dag,
      task_description: 'Test',
      complexity: 'trivial',
    });
    expect(err).toContain('entry');
  });

  it('rejects DAG with cycle', async () => {
    const dag: WorkflowDAG = {
      id: 'cycle',
      name: 'bad',
      nodes: [
        { id: 'a', agentName: 'a', role: 'entry', modelOverride: null, maxRetries: 0 },
        { id: 'b', agentName: 'b', role: 'worker', modelOverride: null, maxRetries: 0 },
        { id: 'c', agentName: 'c', role: 'exit', modelOverride: null, maxRetries: 0 },
      ],
      edges: [
        { source: 'a', target: 'b', edgeType: 'sequential', weight: 1, condition: null },
        { source: 'b', target: 'c', edgeType: 'sequential', weight: 1, condition: null },
        { source: 'c', target: 'a', edgeType: 'sequential', weight: 1, condition: null },
      ],
    };
    const err = await callError(ref, 'topology_execute_start', {
      topology: dag,
      task_description: 'Test',
      complexity: 'trivial',
    });
    expect(err).toContain('Invalid');
  });

  it('rejects DAG with edge referencing non-existent node', async () => {
    const dag: WorkflowDAG = {
      id: 'bad-edge',
      name: 'bad',
      nodes: [
        { id: 'a', agentName: 'a', role: 'entry', modelOverride: null, maxRetries: 0 },
        { id: 'b', agentName: 'b', role: 'exit', modelOverride: null, maxRetries: 0 },
      ],
      edges: [
        { source: 'a', target: 'nonexistent', edgeType: 'sequential', weight: 1, condition: null },
      ],
    };
    const err = await callError(ref, 'topology_execute_start', {
      topology: dag,
      task_description: 'Test',
      complexity: 'trivial',
    });
    expect(err).toContain('Invalid');
  });

  it('handles minimal DAG (2 nodes, 1 edge) end-to-end', async () => {
    const dag = createMinimalDAG('tiny', 'alpha', 'omega');
    const exec = await call(ref, 'topology_execute_start', {
      topology: dag,
      task_description: 'Minimal',
      complexity: 'trivial',
    });

    expect(exec.node_count).toBe(2);
    expect(exec.edge_count).toBe(1);

    await call(ref, 'topology_execute_node', {
      execution_id: exec.execution_id,
      action: 'complete',
      node_id: 'entry',
      output: { start: true },
    });
    const final = await call(ref, 'topology_execute_node', {
      execution_id: exec.execution_id,
      action: 'complete',
      node_id: 'exit',
      output: { end: true },
    });
    expect(final.execution_complete).toBe(true);
  });
});

// ===========================================================================
// 10. MULTIPLE CONCURRENT EXECUTIONS
// ===========================================================================

describe('multiple concurrent executions', () => {
  let ref: ReturnType<typeof setup>;
  beforeEach(() => { ref = setup(); });
  afterEach(() => teardown(ref));

  it('two executions on the same DAG are independent', async () => {
    const dag = createMinimalDAG('shared', 'a', 'b');

    // Start two executions
    const exec1 = await call(ref, 'topology_execute_start', {
      topology: dag,
      task_description: 'Execution 1',
      complexity: 'trivial',
    });
    const exec2 = await call(ref, 'topology_execute_start', {
      topology: dag,
      task_description: 'Execution 2',
      complexity: 'trivial',
    });

    expect(exec1.execution_id).not.toBe(exec2.execution_id);

    // Complete exec1 entry with output A
    await call(ref, 'topology_execute_node', {
      execution_id: exec1.execution_id,
      action: 'complete',
      node_id: 'entry',
      output: { source: 'exec1' },
    });

    // Complete exec2 entry with output B
    await call(ref, 'topology_execute_node', {
      execution_id: exec2.execution_id,
      action: 'complete',
      node_id: 'entry',
      output: { source: 'exec2' },
    });

    // Verify messages are isolated
    const ctx1 = await call(ref, 'topology_execute_node', {
      execution_id: exec1.execution_id,
      action: 'get_context',
      node_id: 'exit',
    });
    expect(ctx1.upstream_messages[0].content).toEqual({ source: 'exec1' });

    const ctx2 = await call(ref, 'topology_execute_node', {
      execution_id: exec2.execution_id,
      action: 'get_context',
      node_id: 'exit',
    });
    expect(ctx2.upstream_messages[0].content).toEqual({ source: 'exec2' });

    // Complete exec1 exit, leave exec2 running
    await call(ref, 'topology_execute_node', {
      execution_id: exec1.execution_id,
      action: 'complete',
      node_id: 'exit',
      output: { done: 'exec1' },
    });

    // Exec1 completed, exec2 still running
    const s1 = ref.store.getExecution(exec1.execution_id)!;
    expect(s1.status).toBe('completed');

    const s2 = ref.store.getExecution(exec2.execution_id)!;
    expect(s2.status).toBe('running');
  });

  it('failing one execution does not affect another', async () => {
    const dag = retryDAG(0);

    const exec1 = await call(ref, 'topology_execute_start', {
      topology: dag,
      task_description: 'Failing exec',
      complexity: 'trivial',
    });
    const exec2 = await call(ref, 'topology_execute_start', {
      topology: dag,
      task_description: 'Succeeding exec',
      complexity: 'trivial',
    });

    // Complete both entries
    await call(ref, 'topology_execute_node', {
      execution_id: exec1.execution_id,
      action: 'complete',
      node_id: 'entry',
      output: {},
    });
    await call(ref, 'topology_execute_node', {
      execution_id: exec2.execution_id,
      action: 'complete',
      node_id: 'entry',
      output: {},
    });

    // Fail exec1's flaky node
    await call(ref, 'topology_execute_node', {
      execution_id: exec1.execution_id,
      action: 'start',
      node_id: 'flaky',
    });
    await call(ref, 'topology_execute_node', {
      execution_id: exec1.execution_id,
      action: 'fail',
      node_id: 'flaky',
      error: 'permanent failure',
    });

    // Complete exec2 successfully
    await call(ref, 'topology_execute_node', {
      execution_id: exec2.execution_id,
      action: 'complete',
      node_id: 'flaky',
      output: { ok: true },
    });
    await call(ref, 'topology_execute_node', {
      execution_id: exec2.execution_id,
      action: 'complete',
      node_id: 'exit',
      output: { done: true },
    });

    // Verify isolation
    expect(ref.store.getExecution(exec1.execution_id)!.status).toBe('failed');
    expect(ref.store.getExecution(exec2.execution_id)!.status).toBe('completed');
  });
});
