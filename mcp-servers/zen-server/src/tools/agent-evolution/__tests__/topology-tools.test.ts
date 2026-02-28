/**
 * Integration tests for topology MCP tools.
 *
 * Tests the full handler pipeline: dispatcher → guard → handler → store → response.
 * Exercises all 5 topology tools (topology_classify, topology_evolve, topology_select,
 * topology_ablation, topology_skills) and both execution tracker tools
 * (topology_execute_start, topology_execute_node).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createDispatcher, type Dispatcher, type HandlerFn } from '../../../core/dispatcher.js';
import { AgentEvolutionStore } from '../store.js';
import { registerTopologyHandlers, topologyTools } from '../topology-tools.js';
import { registerExecutionHandlers, executionTools } from '../execution-tracker.js';
import { createMinimalDAG, createLinearDAG } from '../lib/topology/dag.js';
import type { WorkflowDAG } from '../lib/topology/types.js';

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

/** Parse the JSON payload from a tool response. */
function parseResponse(response: { content: Array<{ type: string; text: string }>; isError?: boolean }): unknown {
  const text = response.content[0]?.text;
  if (!text) throw new Error('Empty response');
  if (response.isError) throw new Error(text);
  return JSON.parse(text);
}

/** Identity guard — passes through all handlers (bypasses config check). */
const identityGuard = (handler: HandlerFn): HandlerFn => handler;

function setup() {
  const dbPath = path.join(
    os.tmpdir(),
    `topology-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.db`,
  );
  const store = new AgentEvolutionStore(dbPath);
  const dispatcher = createDispatcher();
  const getStore = () => store;

  registerTopologyHandlers(dispatcher, getStore, identityGuard);
  registerExecutionHandlers(dispatcher, getStore, identityGuard);

  return { dbPath, store, dispatcher };
}

function teardown(ref: { dbPath: string; store: AgentEvolutionStore }) {
  ref.store.close();
  for (const suffix of ['', '-wal', '-shm']) {
    const p = ref.dbPath + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

// ---------------------------------------------------------------------------
// topology_classify
// ---------------------------------------------------------------------------

describe('topology_classify', () => {
  let ref: ReturnType<typeof setup>;
  beforeEach(() => { ref = setup(); });
  afterEach(() => teardown(ref));

  it('classifies a simple task as trivial/simple', async () => {
    const res = await ref.dispatcher.dispatch('topology_classify', {
      action: 'classify',
      query: 'Fix typo in README',
    });
    const data = parseResponse(res) as any;
    expect(data.complexity).toMatch(/^(trivial|simple)$/);
    expect(data.difficulty).toBeLessThan(4);
    expect(data.confidence).toBeGreaterThan(0);
    expect(data.id).toMatch(/^tc-/);
    expect(data.fusion_method).toBe('heuristic-only');
  });

  it('classifies a complex task as complex/expert', async () => {
    const res = await ref.dispatcher.dispatch('topology_classify', {
      action: 'classify',
      query:
        'Architect distributed microservice infrastructure with encrypted auth, ' +
        'security vulnerability scanning across src/auth.ts, src/gateway.ts, src/cache.ts. ' +
        'Must ensure backward compatibility. First design schema, then implement, then test.',
    });
    const data = parseResponse(res) as any;
    expect(['complex', 'expert']).toContain(data.complexity);
    expect(data.difficulty).toBeGreaterThan(5);
  });

  it('persists classification to store', async () => {
    const res = await ref.dispatcher.dispatch('topology_classify', {
      action: 'classify',
      query: 'Add logging utility',
    });
    const data = parseResponse(res) as any;

    const stored = ref.store.getClassification(data.id);
    expect(stored).not.toBeNull();
    expect(stored!.query).toBe('Add logging utility');
    expect(stored!.complexity).toBe(data.complexity);
  });

  it('includes context in classification', async () => {
    const res = await ref.dispatcher.dispatch('topology_classify', {
      action: 'classify',
      query: 'Fix the issue',
      context: 'Critical security vulnerability allows SQL injection in the authentication module',
    });
    const data = parseResponse(res) as any;
    expect(data.features.hasSecurityKeywords).toBe(true);
  });

  it('records feedback and returns count', async () => {
    // First classify
    const classRes = await ref.dispatcher.dispatch('topology_classify', {
      action: 'classify',
      query: 'Some task',
    });
    const classData = parseResponse(classRes) as any;

    // Then feedback
    const fbRes = await ref.dispatcher.dispatch('topology_classify', {
      action: 'feedback',
      classification_id: classData.id,
      actual_difficulty: 7.0,
      outcome: 'success',
      notes: 'Was harder than expected',
    });
    const fbData = parseResponse(fbRes) as any;
    expect(fbData.recorded).toBe(true);
    expect(fbData.feedback_count).toBe(1);

    // Verify persisted
    const feedback = ref.store.getFeedbackForClassification(classData.id);
    expect(feedback).toHaveLength(1);
    expect(feedback[0].actualDifficulty).toBe(7.0);
    expect(feedback[0].outcome).toBe('success');
  });

  it('returns stats', async () => {
    // Classify a couple tasks
    await ref.dispatcher.dispatch('topology_classify', { action: 'classify', query: 'Fix typo' });
    await ref.dispatcher.dispatch('topology_classify', { action: 'classify', query: 'Build system' });

    const res = await ref.dispatcher.dispatch('topology_classify', { action: 'stats' });
    const data = parseResponse(res) as any;
    // Classifier is a module-level singleton — count includes all tests in this file
    expect(data.classification_count).toBeGreaterThanOrEqual(2);
    expect(data.distribution).toBeDefined();
    expect(data.effective_thresholds).toBeDefined();
  });

  it('adjusts thresholds and persists config', async () => {
    const res = await ref.dispatcher.dispatch('topology_classify', { action: 'adjust_thresholds' });
    const data = parseResponse(res) as any;
    expect(data.thresholds).toBeDefined();
    expect(data.adjustments).toBeDefined();

    // Verify persisted to classifier_config table
    const stored = ref.store.getClassifierConfig('adjusted_thresholds');
    expect(stored).toEqual(data.thresholds);
  });

  it('rejects missing query for classify', async () => {
    const res = await ref.dispatcher.dispatch('topology_classify', { action: 'classify' });
    expect(res.isError).toBe(true);
  });

  it('rejects missing fields for feedback', async () => {
    const res = await ref.dispatcher.dispatch('topology_classify', {
      action: 'feedback',
      // missing classification_id, actual_difficulty, outcome
    });
    expect(res.isError).toBe(true);
  });

  it('rejects unknown action', async () => {
    const res = await ref.dispatcher.dispatch('topology_classify', { action: 'bogus' });
    expect(res.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// topology_evolve
// ---------------------------------------------------------------------------

describe('topology_evolve', () => {
  let ref: ReturnType<typeof setup>;
  beforeEach(() => { ref = setup(); });
  afterEach(() => teardown(ref));

  it('starts an evolution session with seeds', async () => {
    const res = await ref.dispatcher.dispatch('topology_evolve', {
      action: 'start',
      agent_pool: ['story', 'architect', 'implementer', 'quality'],
      target_complexity: 'medium',
      max_generations: 3,
      seed: 42,
      seed_count: 3,
    });
    const data = parseResponse(res) as any;

    expect(data.session_id).toBeDefined();
    expect(data.target_complexity).toBe('medium');
    expect(data.pending_composites).toHaveLength(3);
    expect(data.instructions).toHaveLength(3);

    // Each seed has required fields
    for (const composite of data.pending_composites) {
      expect(composite.id).toBeDefined();
      expect(composite.topology).toBeDefined();
      expect(composite.density).toBeGreaterThanOrEqual(0);
      expect(composite.node_count).toBeGreaterThan(0);
      expect(composite.agents).toBeInstanceOf(Array);
    }

    // Session persisted
    const session = ref.store.getConductorSession(data.session_id);
    expect(session).not.toBeNull();
    expect(session!.status).toBe('active');
    expect(session!.targetComplexity).toBe('medium');
  });

  it('advances with step and returns next composites', async () => {
    const startRes = await ref.dispatcher.dispatch('topology_evolve', {
      action: 'start',
      agent_pool: ['alpha', 'beta', 'gamma'],
      target_complexity: 'simple',
      max_generations: 3,
      seed: 99,
      seed_count: 2,
    });
    const startData = parseResponse(startRes) as any;

    // Submit fitness for seeds
    const fitnessResults = startData.pending_composites.map((c: any) => ({
      composite_id: c.id,
      fitness: 0.5 + Math.random() * 0.3,
    }));

    const stepRes = await ref.dispatcher.dispatch('topology_evolve', {
      action: 'step',
      session_id: startData.session_id,
      fitness_results: fitnessResults,
    });
    const stepData = parseResponse(stepRes) as any;

    expect(stepData.status).toBe('active');
    expect(stepData.generation).toBe(1);
    expect(stepData.step_results).toHaveLength(fitnessResults.length);
    expect(stepData.stats).toBeDefined();
  });

  it('completes after max_generations', async () => {
    const startRes = await ref.dispatcher.dispatch('topology_evolve', {
      action: 'start',
      agent_pool: ['a', 'b'],
      max_generations: 1, // completes after 1 step
      seed: 7,
      seed_count: 1,
    });
    const startData = parseResponse(startRes) as any;

    const stepRes = await ref.dispatcher.dispatch('topology_evolve', {
      action: 'step',
      session_id: startData.session_id,
      fitness_results: [{ composite_id: startData.pending_composites[0].id, fitness: 0.8 }],
    });
    const stepData = parseResponse(stepRes) as any;

    expect(stepData.status).toBe('completed');
    expect(stepData.pending_composites).toHaveLength(0);

    // Session updated in store
    const session = ref.store.getConductorSession(startData.session_id);
    expect(session!.status).toBe('completed');
  });

  it('returns status for active session', async () => {
    const startRes = await ref.dispatcher.dispatch('topology_evolve', {
      action: 'start',
      agent_pool: ['x', 'y'],
      max_generations: 10,
      seed: 1,
    });
    const startData = parseResponse(startRes) as any;

    const statusRes = await ref.dispatcher.dispatch('topology_evolve', {
      action: 'status',
      session_id: startData.session_id,
    });
    const statusData = parseResponse(statusRes) as any;

    expect(statusData.session_id).toBe(startData.session_id);
    expect(statusData.status).toBe('active');
    expect(statusData.generation).toBe(0);
  });

  it('rejects step with missing session_id', async () => {
    const res = await ref.dispatcher.dispatch('topology_evolve', {
      action: 'step',
      fitness_results: [{ composite_id: 'x', fitness: 0.5 }],
    });
    expect(res.isError).toBe(true);
  });

  it('rejects step for non-existent session', async () => {
    const res = await ref.dispatcher.dispatch('topology_evolve', {
      action: 'step',
      session_id: 'nonexistent',
      fitness_results: [{ composite_id: 'x', fitness: 0.5 }],
    });
    expect(res.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// topology_select
// ---------------------------------------------------------------------------

describe('topology_select', () => {
  let ref: ReturnType<typeof setup>;
  beforeEach(() => { ref = setup(); });
  afterEach(() => teardown(ref));

  it('errors when no completed session exists', async () => {
    const res = await ref.dispatcher.dispatch('topology_select', { complexity: 'medium' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('No completed conductor session');
  });

  it('errors when missing complexity', async () => {
    const res = await ref.dispatcher.dispatch('topology_select', {});
    expect(res.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// topology_ablation
// ---------------------------------------------------------------------------

describe('topology_ablation', () => {
  let ref: ReturnType<typeof setup>;
  beforeEach(() => { ref = setup(); });
  afterEach(() => teardown(ref));

  const AGENT_MARKDOWN = `---
name: test-agent
model: sonnet
skills:
  - code-review  # Review code
---

# Test Agent

## Identity

You are a test agent.

## Instructions

Follow these steps carefully.

## Output Format

Return JSON output.
`;

  it('plans ablation variants for all sections', async () => {
    const res = await ref.dispatcher.dispatch('topology_ablation', {
      action: 'plan',
      markdown: AGENT_MARKDOWN,
    });
    const data = parseResponse(res) as any;

    expect(data.agent_name).toBe('test-agent');
    expect(data.baseline_markdown).toBe(AGENT_MARKDOWN);
    expect(data.total_sections).toBeGreaterThanOrEqual(3);
    expect(data.sections_to_ablate).toBeGreaterThanOrEqual(1);
    expect(data.variants).toBeInstanceOf(Array);
    expect(data.instructions).toHaveLength(3);

    // Each applied variant has ablated markdown
    for (const v of data.variants) {
      expect(v.section_id).toBeDefined();
      expect(v.section_heading).toBeDefined();
      if (v.applied) {
        expect(v.ablated_markdown).toBeTruthy();
        expect(v.ablated_markdown).not.toBe(AGENT_MARKDOWN);
      }
    }
  });

  it('submits results and computes impacts', async () => {
    const res = await ref.dispatcher.dispatch('topology_ablation', {
      action: 'submit',
      baseline_fitness: 0.80,
      section_results: [
        { section_id: 'identity', fitness: 0.60 },      // hurts when removed (−0.20)
        { section_id: 'instructions', fitness: 0.50 },   // hurts more (−0.30)
        { section_id: 'output-format', fitness: 0.85 },  // improves when removed (+0.05)
      ],
    });
    const data = parseResponse(res) as any;

    expect(data.baseline_fitness).toBe(0.80);
    expect(data.sections_analyzed).toBe(3);
    expect(data.impacts).toHaveLength(3);

    // Sorted by impact magnitude (highest first)
    expect(data.impacts[0].section_id).toBe('instructions');
    expect(data.impacts[0].impact_magnitude).toBeCloseTo(0.30);
    expect(data.impacts[0].direction).toBe('hurts_when_removed');

    // output-format improves when removed
    const outputImpact = data.impacts.find((i: any) => i.section_id === 'output-format');
    expect(outputImpact.direction).toBe('improves_when_removed');

    // Mutation weights sum to 1
    const weights = Object.values(data.mutation_weights) as number[];
    expect(weights.reduce((s, w) => s + w, 0)).toBeCloseTo(1.0);
    expect(data.significant_sections).toBeGreaterThan(0);
    expect(data.highest_impact).toBeDefined();
  });

  it('handles zero-impact sections', async () => {
    const res = await ref.dispatcher.dispatch('topology_ablation', {
      action: 'submit',
      baseline_fitness: 0.50,
      section_results: [
        { section_id: 'a', fitness: 0.50 },
        { section_id: 'b', fitness: 0.50 },
      ],
    });
    const data = parseResponse(res) as any;
    expect(data.impacts[0].direction).toBe('no_effect');
    expect(data.significant_sections).toBe(0);
  });

  it('rejects submit without baseline_fitness', async () => {
    const res = await ref.dispatcher.dispatch('topology_ablation', {
      action: 'submit',
      section_results: [{ section_id: 'a', fitness: 0.5 }],
    });
    expect(res.isError).toBe(true);
  });

  it('rejects submit with empty section_results', async () => {
    const res = await ref.dispatcher.dispatch('topology_ablation', {
      action: 'submit',
      baseline_fitness: 0.5,
      section_results: [],
    });
    expect(res.isError).toBe(true);
  });

  it('rejects plan without markdown', async () => {
    const res = await ref.dispatcher.dispatch('topology_ablation', { action: 'plan' });
    expect(res.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// topology_skills
// ---------------------------------------------------------------------------

describe('topology_skills', () => {
  let ref: ReturnType<typeof setup>;
  beforeEach(() => { ref = setup(); });
  afterEach(() => teardown(ref));

  const AGENT_MD = `---
name: skill-agent
model: sonnet
skills:
  - code-review  # Review code quality
  - testing  # Write tests
  - debugging  # Debug issues
---

# Skill Agent

## Instructions

Do your work.
`;

  it('plans removal and addition variants', async () => {
    const res = await ref.dispatcher.dispatch('topology_skills', {
      action: 'plan',
      markdown: AGENT_MD,
      candidates: [
        { name: 'refactoring', comment: 'Refactor code' },
        { name: 'documentation', comment: 'Write docs' },
      ],
    });
    const data = parseResponse(res) as any;

    expect(data.agent_name).toBe('skill-agent');
    expect(data.current_skills).toHaveLength(3);
    expect(data.removal_variants.length).toBeGreaterThanOrEqual(1);
    expect(data.addition_variants.length).toBeGreaterThanOrEqual(1);
    expect(data.total_variants).toBe(
      data.removal_variants.length + data.addition_variants.length,
    );
    expect(data.instructions).toHaveLength(3);

    // Each removal variant removes exactly one skill
    for (const v of data.removal_variants) {
      expect(v.direction).toBe('remove');
      expect(v.variant_markdown).toBeTruthy();
      expect(v.variant_markdown).not.toContain(`- ${v.skill_name}`);
    }

    // Each addition variant adds a candidate skill
    for (const v of data.addition_variants) {
      expect(v.direction).toBe('add');
      expect(v.variant_markdown).toBeTruthy();
    }
  });

  it('submits results and recommends skill set', async () => {
    const res = await ref.dispatcher.dispatch('topology_skills', {
      action: 'submit',
      baseline_fitness: 0.70,
      removal_results: [
        { skill_name: 'code-review', fitness: 0.55 },  // hurts → keep
        { skill_name: 'testing', fitness: 0.68 },       // neutral
        { skill_name: 'debugging', fitness: 0.75 },     // improves → remove
      ],
      addition_results: [
        { skill_name: 'refactoring', fitness: 0.82 },   // improves → add
        { skill_name: 'documentation', fitness: 0.71 },  // marginal → skip
      ],
    });
    const data = parseResponse(res) as any;

    expect(data.baseline_fitness).toBe(0.70);
    expect(data.total_analyzed).toBe(5);

    // Removal impacts
    expect(data.removal_impacts).toHaveLength(3);
    const codeReview = data.removal_impacts.find((i: any) => i.skill_name === 'code-review');
    expect(codeReview.recommendation).toBe('keep');

    const debugging = data.removal_impacts.find((i: any) => i.skill_name === 'debugging');
    expect(debugging.recommendation).toBe('remove');

    // Addition impacts
    expect(data.addition_impacts).toHaveLength(2);
    const refactoring = data.addition_impacts.find((i: any) => i.skill_name === 'refactoring');
    expect(refactoring.recommendation).toBe('add');

    const documentation = data.addition_impacts.find((i: any) => i.skill_name === 'documentation');
    expect(documentation.recommendation).toBe('skip');

    // Recommended skill set
    expect(data.recommended_skills.keep).toContain('code-review');
    expect(data.recommended_skills.add).toContain('refactoring');
    expect(data.recommended_skills.remove).toContain('debugging');
  });

  it('accepts only removal results', async () => {
    const res = await ref.dispatcher.dispatch('topology_skills', {
      action: 'submit',
      baseline_fitness: 0.60,
      removal_results: [{ skill_name: 'x', fitness: 0.50 }],
    });
    const data = parseResponse(res) as any;
    expect(data.total_analyzed).toBe(1);
    expect(data.removal_impacts).toHaveLength(1);
    expect(data.addition_impacts).toHaveLength(0);
  });

  it('accepts only addition results', async () => {
    const res = await ref.dispatcher.dispatch('topology_skills', {
      action: 'submit',
      baseline_fitness: 0.60,
      addition_results: [{ skill_name: 'y', fitness: 0.80 }],
    });
    const data = parseResponse(res) as any;
    expect(data.total_analyzed).toBe(1);
    expect(data.addition_impacts).toHaveLength(1);
  });

  it('rejects submit with no results', async () => {
    const res = await ref.dispatcher.dispatch('topology_skills', {
      action: 'submit',
      baseline_fitness: 0.60,
    });
    expect(res.isError).toBe(true);
  });

  it('rejects plan without markdown', async () => {
    const res = await ref.dispatcher.dispatch('topology_skills', { action: 'plan' });
    expect(res.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// topology_execute_start + topology_execute_node
// ---------------------------------------------------------------------------

describe('execution tracker', () => {
  let ref: ReturnType<typeof setup>;
  beforeEach(() => { ref = setup(); });
  afterEach(() => teardown(ref));

  /** A→B→C linear DAG. */
  function linearDAG(): WorkflowDAG {
    return createLinearDAG('test-linear', ['story-agent', 'impl-agent', 'quality-agent']);
  }

  /** A→B, A→C, B→D, C→D diamond DAG (fan-out + fan-in). */
  function diamondDAG(): WorkflowDAG {
    return {
      id: 'test-diamond',
      name: 'diamond',
      nodes: [
        { id: 'entry', agentName: 'planner', role: 'entry', modelOverride: null, maxRetries: 0 },
        { id: 'left', agentName: 'coder', role: 'worker', modelOverride: null, maxRetries: 0 },
        { id: 'right', agentName: 'tester', role: 'worker', modelOverride: null, maxRetries: 0 },
        { id: 'exit', agentName: 'reviewer', role: 'exit', modelOverride: null, maxRetries: 0 },
      ],
      edges: [
        { source: 'entry', target: 'left', edgeType: 'sequential', weight: 1, condition: null },
        { source: 'entry', target: 'right', edgeType: 'sequential', weight: 1, condition: null },
        { source: 'left', target: 'exit', edgeType: 'sequential', weight: 1, condition: null },
        { source: 'right', target: 'exit', edgeType: 'sequential', weight: 1, condition: null },
      ],
    };
  }

  // ── topology_execute_start ────────────────────────────────────

  describe('topology_execute_start', () => {
    it('creates execution with entry node ready', async () => {
      const dag = linearDAG();
      const res = await ref.dispatcher.dispatch('topology_execute_start', {
        topology: dag,
        task_description: 'Build a login page',
        complexity: 'medium',
      });
      const data = parseResponse(res) as any;

      expect(data.execution_id).toBeDefined();
      expect(data.topology_id).toBe('test-linear');
      expect(data.node_count).toBe(3);
      expect(data.edge_count).toBe(2);
      expect(data.entry_node).toBe('node-0');
      expect(data.exit_node).toBe('node-2');
      expect(data.execution_plan).toEqual(['node-0', 'node-1', 'node-2']);

      // Only entry node is ready
      expect(data.ready_nodes).toHaveLength(1);
      expect(data.ready_nodes[0].node_id).toBe('node-0');
      expect(data.ready_nodes[0].agent_name).toBe('story-agent');
      expect(data.ready_nodes[0].role).toBe('entry');
      expect(data.ready_nodes[0].input_context).toEqual({
        task_description: 'Build a login page',
        complexity: 'medium',
      });
    });

    it('uses provided execution_id', async () => {
      const dag = linearDAG();
      const res = await ref.dispatcher.dispatch('topology_execute_start', {
        topology: dag,
        task_description: 'Test',
        complexity: 'trivial',
        execution_id: 'my-exec-001',
      });
      const data = parseResponse(res) as any;
      expect(data.execution_id).toBe('my-exec-001');
    });

    it('rejects invalid DAG', async () => {
      const bad: WorkflowDAG = {
        id: 'bad',
        name: 'bad',
        nodes: [],
        edges: [],
      };
      const res = await ref.dispatcher.dispatch('topology_execute_start', {
        topology: bad,
        task_description: 'Test',
        complexity: 'trivial',
      });
      expect(res.isError).toBe(true);
    });

    it('rejects missing topology', async () => {
      const res = await ref.dispatcher.dispatch('topology_execute_start', {
        task_description: 'Test',
        complexity: 'trivial',
      });
      expect(res.isError).toBe(true);
    });

    it('persists execution and nodes to store', async () => {
      const dag = linearDAG();
      const res = await ref.dispatcher.dispatch('topology_execute_start', {
        topology: dag,
        task_description: 'Persist test',
        complexity: 'simple',
      });
      const data = parseResponse(res) as any;

      const execution = ref.store.getExecution(data.execution_id);
      expect(execution).not.toBeNull();
      expect(execution!.status).toBe('running');
      expect(execution!.taskDescription).toBe('Persist test');

      const nodes = ref.store.getExecutionNodes(data.execution_id);
      expect(nodes).toHaveLength(3);

      const entry = nodes.find(n => n.nodeId === 'node-0');
      expect(entry!.status).toBe('ready');

      const mid = nodes.find(n => n.nodeId === 'node-1');
      expect(mid!.status).toBe('pending');
    });
  });

  // ── topology_execute_node: get_context ────────────────────────

  describe('get_context', () => {
    it('returns entry node context', async () => {
      const dag = linearDAG();
      const startRes = await ref.dispatcher.dispatch('topology_execute_start', {
        topology: dag,
        task_description: 'Context test',
        complexity: 'simple',
      });
      const { execution_id } = parseResponse(startRes) as any;

      const res = await ref.dispatcher.dispatch('topology_execute_node', {
        execution_id,
        action: 'get_context',
        node_id: 'node-0',
      });
      const data = parseResponse(res) as any;

      expect(data.node_id).toBe('node-0');
      expect(data.agent_name).toBe('story-agent');
      expect(data.role).toBe('entry');
      expect(data.status).toBe('ready');
      expect(data.input_context).toEqual({
        task_description: 'Context test',
        complexity: 'simple',
      });
      expect(data.upstream_messages).toHaveLength(0);
    });

    it('returns upstream messages for mid node', async () => {
      const dag = linearDAG();
      const { execution_id } = parseResponse(
        await ref.dispatcher.dispatch('topology_execute_start', {
          topology: dag,
          task_description: 'Msg test',
          complexity: 'simple',
        }),
      ) as any;

      // Start and complete entry node
      await ref.dispatcher.dispatch('topology_execute_node', {
        execution_id,
        action: 'start',
        node_id: 'node-0',
      });
      await ref.dispatcher.dispatch('topology_execute_node', {
        execution_id,
        action: 'complete',
        node_id: 'node-0',
        output: { story: 'User wants login page' },
      });

      // Get context for node-1 (should have message from node-0)
      const res = await ref.dispatcher.dispatch('topology_execute_node', {
        execution_id,
        action: 'get_context',
        node_id: 'node-1',
      });
      const data = parseResponse(res) as any;

      expect(data.upstream_messages).toHaveLength(1);
      expect(data.upstream_messages[0].from_node).toBe('node-0');
      expect(data.upstream_messages[0].content).toEqual({ story: 'User wants login page' });
      expect(data.message_count).toBe(1);
    });

    it('errors for non-existent node', async () => {
      const dag = linearDAG();
      const { execution_id } = parseResponse(
        await ref.dispatcher.dispatch('topology_execute_start', {
          topology: dag,
          task_description: 'X',
          complexity: 'trivial',
        }),
      ) as any;

      const res = await ref.dispatcher.dispatch('topology_execute_node', {
        execution_id,
        action: 'get_context',
        node_id: 'nonexistent',
      });
      expect(res.isError).toBe(true);
    });
  });

  // ── topology_execute_node: start ──────────────────────────────

  describe('start', () => {
    it('transitions ready node to running', async () => {
      const dag = linearDAG();
      const { execution_id } = parseResponse(
        await ref.dispatcher.dispatch('topology_execute_start', {
          topology: dag,
          task_description: 'Start test',
          complexity: 'simple',
        }),
      ) as any;

      const res = await ref.dispatcher.dispatch('topology_execute_node', {
        execution_id,
        action: 'start',
        node_id: 'node-0',
      });
      const data = parseResponse(res) as any;

      expect(data.status).toBe('running');
      expect(data.node_id).toBe('node-0');
      expect(data.agent_name).toBe('story-agent');

      // Verify in store
      const node = ref.store.getExecutionNode(execution_id, 'node-0');
      expect(node!.status).toBe('running');
      expect(node!.startedAt).not.toBeNull();
    });

    it('rejects start on pending node', async () => {
      const dag = linearDAG();
      const { execution_id } = parseResponse(
        await ref.dispatcher.dispatch('topology_execute_start', {
          topology: dag,
          task_description: 'X',
          complexity: 'trivial',
        }),
      ) as any;

      const res = await ref.dispatcher.dispatch('topology_execute_node', {
        execution_id,
        action: 'start',
        node_id: 'node-1', // still pending
      });
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain('pending');
    });
  });

  // ── topology_execute_node: complete ───────────────────────────

  describe('complete', () => {
    it('completes node and marks downstream as ready (linear)', async () => {
      const dag = linearDAG();
      const { execution_id } = parseResponse(
        await ref.dispatcher.dispatch('topology_execute_start', {
          topology: dag,
          task_description: 'Complete test',
          complexity: 'simple',
        }),
      ) as any;

      // Start entry
      await ref.dispatcher.dispatch('topology_execute_node', {
        execution_id,
        action: 'start',
        node_id: 'node-0',
      });

      // Complete entry
      const res = await ref.dispatcher.dispatch('topology_execute_node', {
        execution_id,
        action: 'complete',
        node_id: 'node-0',
        output: { requirements: ['login', 'signup'] },
      });
      const data = parseResponse(res) as any;

      expect(data.status).toBe('completed');
      expect(data.execution_complete).toBe(false);
      expect(data.newly_ready_nodes).toHaveLength(1);
      expect(data.newly_ready_nodes[0].node_id).toBe('node-1');
      expect(data.newly_ready_nodes[0].agent_name).toBe('impl-agent');

      // Verify downstream node is ready in store
      const node1 = ref.store.getExecutionNode(execution_id, 'node-1');
      expect(node1!.status).toBe('ready');
    });

    it('completing exit node marks execution complete', async () => {
      const dag = createMinimalDAG('mini', 'agent-a', 'agent-b');
      const { execution_id } = parseResponse(
        await ref.dispatcher.dispatch('topology_execute_start', {
          topology: dag,
          task_description: 'End-to-end',
          complexity: 'trivial',
        }),
      ) as any;

      // Complete entry (which makes exit ready in a minimal DAG)
      await ref.dispatcher.dispatch('topology_execute_node', {
        execution_id,
        action: 'complete',
        node_id: 'entry',
        output: { step: 1 },
      });

      // Complete exit
      const res = await ref.dispatcher.dispatch('topology_execute_node', {
        execution_id,
        action: 'complete',
        node_id: 'exit',
        output: { result: 'done' },
      });
      const data = parseResponse(res) as any;

      expect(data.execution_complete).toBe(true);
      expect(data.final_result).toEqual({ result: 'done' });

      // Execution is completed in store
      const exec = ref.store.getExecution(execution_id);
      expect(exec!.status).toBe('completed');
      expect(exec!.result).toEqual({ result: 'done' });
    });

    it('rejects complete on pending node', async () => {
      const dag = linearDAG();
      const { execution_id } = parseResponse(
        await ref.dispatcher.dispatch('topology_execute_start', {
          topology: dag,
          task_description: 'X',
          complexity: 'trivial',
        }),
      ) as any;

      const res = await ref.dispatcher.dispatch('topology_execute_node', {
        execution_id,
        action: 'complete',
        node_id: 'node-1', // pending
      });
      expect(res.isError).toBe(true);
    });

    it('allows complete directly from ready (skipping start)', async () => {
      const dag = linearDAG();
      const { execution_id } = parseResponse(
        await ref.dispatcher.dispatch('topology_execute_start', {
          topology: dag,
          task_description: 'X',
          complexity: 'trivial',
        }),
      ) as any;

      // Complete entry without calling start first
      const res = await ref.dispatcher.dispatch('topology_execute_node', {
        execution_id,
        action: 'complete',
        node_id: 'node-0',
        output: { fast: true },
      });
      const data = parseResponse(res) as any;
      expect(data.status).toBe('completed');
    });
  });

  // ── topology_execute_node: fail ───────────────────────────────

  describe('fail', () => {
    it('retries when retries < maxRetries', async () => {
      const dag: WorkflowDAG = {
        id: 'retry-dag',
        name: 'retry',
        nodes: [
          { id: 'entry', agentName: 'a', role: 'entry', modelOverride: null, maxRetries: 2 },
          { id: 'exit', agentName: 'b', role: 'exit', modelOverride: null, maxRetries: 0 },
        ],
        edges: [
          { source: 'entry', target: 'exit', edgeType: 'sequential', weight: 1, condition: null },
        ],
      };

      const { execution_id } = parseResponse(
        await ref.dispatcher.dispatch('topology_execute_start', {
          topology: dag,
          task_description: 'Retry test',
          complexity: 'simple',
        }),
      ) as any;

      // Start then fail
      await ref.dispatcher.dispatch('topology_execute_node', {
        execution_id,
        action: 'start',
        node_id: 'entry',
      });

      const res = await ref.dispatcher.dispatch('topology_execute_node', {
        execution_id,
        action: 'fail',
        node_id: 'entry',
        error: 'Temporary error',
      });
      const data = parseResponse(res) as any;

      expect(data.can_retry).toBe(true);
      expect(data.status).toBe('ready'); // back to ready for retry
      expect(data.retries).toBe(1);
      expect(data.max_retries).toBe(2);

      // Node is ready again in store
      const node = ref.store.getExecutionNode(execution_id, 'entry');
      expect(node!.status).toBe('ready');
      expect(node!.retries).toBe(1);
    });

    it('fails execution when retries exhausted', async () => {
      const dag: WorkflowDAG = {
        id: 'fail-dag',
        name: 'fail',
        nodes: [
          { id: 'entry', agentName: 'a', role: 'entry', modelOverride: null, maxRetries: 0 },
          { id: 'exit', agentName: 'b', role: 'exit', modelOverride: null, maxRetries: 0 },
        ],
        edges: [
          { source: 'entry', target: 'exit', edgeType: 'sequential', weight: 1, condition: null },
        ],
      };

      const { execution_id } = parseResponse(
        await ref.dispatcher.dispatch('topology_execute_start', {
          topology: dag,
          task_description: 'Fail test',
          complexity: 'trivial',
        }),
      ) as any;

      await ref.dispatcher.dispatch('topology_execute_node', {
        execution_id,
        action: 'start',
        node_id: 'entry',
      });

      const res = await ref.dispatcher.dispatch('topology_execute_node', {
        execution_id,
        action: 'fail',
        node_id: 'entry',
        error: 'Fatal error',
      });
      const data = parseResponse(res) as any;

      expect(data.can_retry).toBe(false);
      expect(data.status).toBe('failed');
      expect(data.execution_failed).toBe(true);

      // Execution is failed in store
      const exec = ref.store.getExecution(execution_id);
      expect(exec!.status).toBe('failed');
      expect(exec!.error).toContain('Fatal error');
    });
  });

  // ── topology_execute_node: status ─────────────────────────────

  describe('status', () => {
    it('returns all node statuses with summary', async () => {
      const dag = linearDAG();
      const { execution_id } = parseResponse(
        await ref.dispatcher.dispatch('topology_execute_start', {
          topology: dag,
          task_description: 'Status test',
          complexity: 'medium',
        }),
      ) as any;

      // Complete first node
      await ref.dispatcher.dispatch('topology_execute_node', {
        execution_id,
        action: 'start',
        node_id: 'node-0',
      });
      await ref.dispatcher.dispatch('topology_execute_node', {
        execution_id,
        action: 'complete',
        node_id: 'node-0',
        output: { done: true },
      });

      const res = await ref.dispatcher.dispatch('topology_execute_node', {
        execution_id,
        action: 'status',
      });
      const data = parseResponse(res) as any;

      expect(data.execution_id).toBe(execution_id);
      expect(data.status).toBe('running');
      expect(data.task_description).toBe('Status test');
      expect(data.complexity).toBe('medium');
      expect(data.nodes).toHaveLength(3);

      expect(data.summary.total).toBe(3);
      expect(data.summary.completed).toBe(1);
      expect(data.summary.ready).toBe(1);    // node-1 became ready
      expect(data.summary.pending).toBe(1);   // node-2 still pending
      expect(data.summary.running).toBe(0);
      expect(data.summary.failed).toBe(0);
    });

    it('errors for non-existent execution', async () => {
      const res = await ref.dispatcher.dispatch('topology_execute_node', {
        execution_id: 'nonexistent',
        action: 'status',
      });
      expect(res.isError).toBe(true);
    });
  });

  // ── Diamond DAG (fan-out / fan-in) ────────────────────────────

  describe('diamond DAG (parallel fan-out)', () => {
    it('readies both workers after entry completes', async () => {
      const dag = diamondDAG();
      const { execution_id } = parseResponse(
        await ref.dispatcher.dispatch('topology_execute_start', {
          topology: dag,
          task_description: 'Diamond test',
          complexity: 'complex',
        }),
      ) as any;

      // Complete entry
      const res = await ref.dispatcher.dispatch('topology_execute_node', {
        execution_id,
        action: 'complete',
        node_id: 'entry',
        output: { plan: 'parallel work' },
      });
      const data = parseResponse(res) as any;

      // Both left and right should be newly ready
      expect(data.newly_ready_nodes).toHaveLength(2);
      const readyIds = data.newly_ready_nodes.map((n: any) => n.node_id).sort();
      expect(readyIds).toEqual(['left', 'right']);
    });

    it('exit only readies when both workers complete (fan-in)', async () => {
      const dag = diamondDAG();
      const { execution_id } = parseResponse(
        await ref.dispatcher.dispatch('topology_execute_start', {
          topology: dag,
          task_description: 'Fan-in test',
          complexity: 'complex',
        }),
      ) as any;

      // Complete entry
      await ref.dispatcher.dispatch('topology_execute_node', {
        execution_id,
        action: 'complete',
        node_id: 'entry',
        output: { plan: 'go' },
      });

      // Complete left only — exit should NOT be ready yet
      const leftRes = await ref.dispatcher.dispatch('topology_execute_node', {
        execution_id,
        action: 'complete',
        node_id: 'left',
        output: { code: 'impl' },
      });
      const leftData = parseResponse(leftRes) as any;
      expect(leftData.newly_ready_nodes).toHaveLength(0); // exit still waiting for right

      // Verify exit is still pending
      const exitNode = ref.store.getExecutionNode(execution_id, 'exit');
      expect(exitNode!.status).toBe('pending');

      // Complete right — NOW exit should be ready
      const rightRes = await ref.dispatcher.dispatch('topology_execute_node', {
        execution_id,
        action: 'complete',
        node_id: 'right',
        output: { tests: 'pass' },
      });
      const rightData = parseResponse(rightRes) as any;
      expect(rightData.newly_ready_nodes).toHaveLength(1);
      expect(rightData.newly_ready_nodes[0].node_id).toBe('exit');

      // Exit now has both upstream messages
      const contextRes = await ref.dispatcher.dispatch('topology_execute_node', {
        execution_id,
        action: 'get_context',
        node_id: 'exit',
      });
      const ctxData = parseResponse(contextRes) as any;
      expect(ctxData.upstream_messages).toHaveLength(2);
      const sources = ctxData.upstream_messages.map((m: any) => m.from_node).sort();
      expect(sources).toEqual(['left', 'right']);
    });

    it('full diamond execution end-to-end', async () => {
      const dag = diamondDAG();
      const { execution_id } = parseResponse(
        await ref.dispatcher.dispatch('topology_execute_start', {
          topology: dag,
          task_description: 'Full diamond',
          complexity: 'complex',
        }),
      ) as any;

      // entry → complete
      await ref.dispatcher.dispatch('topology_execute_node', {
        execution_id, action: 'complete', node_id: 'entry',
        output: { plan: 'go' },
      });

      // left → complete, right → complete
      await ref.dispatcher.dispatch('topology_execute_node', {
        execution_id, action: 'complete', node_id: 'left',
        output: { code: 'done' },
      });
      await ref.dispatcher.dispatch('topology_execute_node', {
        execution_id, action: 'complete', node_id: 'right',
        output: { tests: 'pass' },
      });

      // exit → complete (should mark execution_complete)
      const res = await ref.dispatcher.dispatch('topology_execute_node', {
        execution_id, action: 'complete', node_id: 'exit',
        output: { review: 'approved' },
      });
      const data = parseResponse(res) as any;

      expect(data.execution_complete).toBe(true);
      expect(data.final_result).toEqual({ review: 'approved' });

      // Full status check
      const statusRes = await ref.dispatcher.dispatch('topology_execute_node', {
        execution_id, action: 'status',
      });
      const status = parseResponse(statusRes) as any;
      expect(status.status).toBe('completed');
      expect(status.summary.completed).toBe(4);
      expect(status.summary.pending).toBe(0);
      expect(status.summary.ready).toBe(0);
      expect(status.summary.running).toBe(0);
    });
  });

  // ── Edge cases ────────────────────────────────────────────────

  describe('edge cases', () => {
    it('rejects unknown action', async () => {
      const dag = linearDAG();
      const { execution_id } = parseResponse(
        await ref.dispatcher.dispatch('topology_execute_start', {
          topology: dag,
          task_description: 'X',
          complexity: 'trivial',
        }),
      ) as any;

      const res = await ref.dispatcher.dispatch('topology_execute_node', {
        execution_id,
        action: 'bogus',
      });
      expect(res.isError).toBe(true);
    });

    it('rejects missing execution_id', async () => {
      const res = await ref.dispatcher.dispatch('topology_execute_node', {
        action: 'status',
      });
      expect(res.isError).toBe(true);
    });

    it('rejects missing node_id for start', async () => {
      const dag = linearDAG();
      const { execution_id } = parseResponse(
        await ref.dispatcher.dispatch('topology_execute_start', {
          topology: dag,
          task_description: 'X',
          complexity: 'trivial',
        }),
      ) as any;

      const res = await ref.dispatcher.dispatch('topology_execute_node', {
        execution_id,
        action: 'start',
      });
      expect(res.isError).toBe(true);
    });

    it('handles empty output on complete', async () => {
      const dag = createMinimalDAG('empty-out', 'a', 'b');
      const { execution_id } = parseResponse(
        await ref.dispatcher.dispatch('topology_execute_start', {
          topology: dag,
          task_description: 'X',
          complexity: 'trivial',
        }),
      ) as any;

      const res = await ref.dispatcher.dispatch('topology_execute_node', {
        execution_id,
        action: 'complete',
        node_id: 'entry',
        // no output provided — defaults to {}
      });
      const data = parseResponse(res) as any;
      expect(data.status).toBe('completed');
    });
  });
});

// ---------------------------------------------------------------------------
// End-to-end pipeline: classify → evolve → execute
// ---------------------------------------------------------------------------

describe('end-to-end: classify → start execution', () => {
  let ref: ReturnType<typeof setup>;
  beforeEach(() => { ref = setup(); });
  afterEach(() => teardown(ref));

  it('classifies task then executes a DAG built from the classification', async () => {
    // Step 1: Classify
    const classRes = await ref.dispatcher.dispatch('topology_classify', {
      action: 'classify',
      query: 'Add a new REST endpoint for user profiles',
    });
    const classData = parseResponse(classRes) as any;
    expect(classData.complexity).toBeDefined();

    // Step 2: Build a topology based on complexity (simulated — normally from topology_select)
    const dag = classData.complexity === 'trivial' || classData.complexity === 'simple'
      ? createMinimalDAG('auto', 'implementer', 'implementer')
      : createLinearDAG('auto', ['story', 'implementer', 'quality']);

    // Step 3: Execute
    const execRes = await ref.dispatcher.dispatch('topology_execute_start', {
      topology: dag,
      task_description: classData.query || 'Add REST endpoint',
      complexity: classData.complexity,
    });
    const execData = parseResponse(execRes) as any;
    expect(execData.execution_id).toBeDefined();
    expect(execData.ready_nodes.length).toBeGreaterThan(0);

    // Step 4: Complete all nodes in order
    const plan = execData.execution_plan as string[];
    for (const nodeId of plan) {
      // Wait for ready status if needed
      const node = ref.store.getExecutionNode(execData.execution_id, nodeId);
      if (node!.status === 'pending') {
        // Should not happen if we follow topological order after completing prior nodes
        break;
      }

      await ref.dispatcher.dispatch('topology_execute_node', {
        execution_id: execData.execution_id,
        action: 'complete',
        node_id: nodeId,
        output: { node: nodeId, result: 'done' },
      });
    }

    // Step 5: Verify execution completed
    const statusRes = await ref.dispatcher.dispatch('topology_execute_node', {
      execution_id: execData.execution_id,
      action: 'status',
    });
    const status = parseResponse(statusRes) as any;
    expect(status.status).toBe('completed');
    expect(status.summary.failed).toBe(0);

    // Step 6: Provide feedback on classification
    const fbRes = await ref.dispatcher.dispatch('topology_classify', {
      action: 'feedback',
      classification_id: classData.id,
      actual_difficulty: classData.difficulty + 1, // slightly underestimated
      outcome: 'success',
    });
    const fbData = parseResponse(fbRes) as any;
    expect(fbData.recorded).toBe(true);
  });
});
