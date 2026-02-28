/**
 * Agent Evolution Store
 * SQLite-backed persistence for MAP-Elites evolution sessions.
 *
 * Session data includes:
 * - Seed genome markdown
 * - Grid state (serialized JSON)
 * - Pending variant batches
 * - Per-generation stats history
 */

import { BaseStore, type FieldMapping, jsonSerialize, jsonOrNull } from "../../core/store.js";
import { generateId } from "../../utils/ids.js";

// ---------------------------------------------------------------------------
// Row types (match DB schema)
// ---------------------------------------------------------------------------

interface SessionRow {
  id: string;
  seed_markdown: string;
  config: string;
  grid_data: string;
  generation: number;
  status: string;
  best_fitness: number;
  best_markdown: string | null;
  stats: string;
  created_at: string;
  updated_at: string;
}

interface VariantRow {
  id: string;
  session_id: string;
  generation: number;
  markdown: string;
  mutation_kind: string;
  mutation_desc: string;
  fitness: number | null;
  cost: number | null;
  status: string;
  created_at: string;
}

interface ConductorSessionRow {
  id: string;
  config: string;
  grid_data: string;
  generation: number;
  status: string;
  target_complexity: string;
  total_evaluations: number;
  stats: string;
  created_at: string;
  updated_at: string;
}

interface ConductorStepRow {
  id: string;
  session_id: string;
  generation: number;
  parent_id: string | null;
  child_id: string;
  mutation_type: string;
  mutation_desc: string;
  fitness: number;
  density: number;
  coord_x: number;
  coord_y: number;
  outcome: string;
  created_at: string;
}

interface ClassificationRow {
  id: string;
  query: string;
  context: string | null;
  difficulty: number;
  complexity: string;
  confidence: number;
  features: string;
  fusion_method: string;
  created_at: string;
}

interface FeedbackRow {
  id: string;
  classification_id: string;
  actual_difficulty: number;
  outcome: string;
  notes: string | null;
  created_at: string;
}

interface ExecutionRow {
  id: string;
  topology_id: string;
  topology: string;
  task_description: string;
  complexity: string;
  execution_plan: string;
  status: string;
  result: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

interface ExecutionNodeRow {
  id: string;
  execution_id: string;
  node_id: string;
  agent_name: string;
  role: string;
  status: string;
  input_context: string | null;
  output: string | null;
  error: string | null;
  retries: number;
  max_retries: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

interface ExecutionMessageRow {
  id: string;
  execution_id: string;
  source_node_id: string;
  target_node_id: string;
  edge_type: string;
  content: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export interface EvolutionSessionConfig {
  batchSize: number;
  maxGenerations: number;
  seed: number;
  gridBinsX: number;
  gridBinsY: number;
  costMin: number;
  costMax: number;
}

export type SessionStatus = "active" | "completed" | "failed";

export interface EvolutionSession {
  id: string;
  seedMarkdown: string;
  config: EvolutionSessionConfig;
  gridData: GridCell[];
  generation: number;
  status: SessionStatus;
  bestFitness: number;
  bestMarkdown: string | null;
  stats: GenerationStats[];
  createdAt: string;
  updatedAt: string;
}

export interface GridCell {
  x: number;
  y: number;
  fitness: number;
  cost: number;
  markdown: string;
  generation: number;
}

export interface GenerationStats {
  generation: number;
  filledCells: number;
  bestFitness: number;
  meanFitness: number;
  variantsEvaluated: number;
}

export interface PendingVariant {
  id: string;
  sessionId: string;
  generation: number;
  markdown: string;
  mutationKind: string;
  mutationDesc: string;
  fitness: number | null;
  cost: number | null;
  status: "pending" | "evaluated";
  createdAt: string;
}

export type ConductorSessionStatus = "active" | "completed" | "stagnated";

export interface ConductorSessionRecord {
  id: string;
  config: unknown;
  gridData: unknown[];
  generation: number;
  status: ConductorSessionStatus;
  targetComplexity: string;
  totalEvaluations: number;
  stats: unknown[];
  createdAt: string;
  updatedAt: string;
}

export interface ConductorStepRecord {
  id: string;
  sessionId: string;
  generation: number;
  parentId: string | null;
  childId: string;
  mutationType: string;
  mutationDesc: string;
  fitness: number;
  density: number;
  coordX: number;
  coordY: number;
  outcome: string;
  createdAt: string;
}

export interface ClassificationRecord {
  id: string;
  query: string;
  context: string | null;
  difficulty: number;
  complexity: string;
  confidence: number;
  features: unknown;
  fusionMethod: string;
  createdAt: string;
}

export interface FeedbackRecord {
  id: string;
  classificationId: string;
  actualDifficulty: number;
  outcome: string;
  notes: string | null;
  createdAt: string;
}

export interface ExecutionRecord {
  id: string;
  topologyId: string;
  topology: unknown;
  taskDescription: string;
  complexity: string;
  executionPlan: string[];
  status: "running" | "completed" | "failed" | "cancelled";
  result: unknown | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExecutionNodeRecord {
  id: string;
  executionId: string;
  nodeId: string;
  agentName: string;
  role: string;
  status: "pending" | "ready" | "running" | "completed" | "failed" | "skipped";
  inputContext: unknown | null;
  output: unknown | null;
  error: string | null;
  retries: number;
  maxRetries: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface ExecutionMessageRecord {
  id: string;
  executionId: string;
  sourceNodeId: string;
  targetNodeId: string;
  edgeType: string;
  content: unknown;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export class AgentEvolutionStore extends BaseStore {
  constructor(dbPath: string) {
    super(dbPath);
    this.initTables();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ae_sessions (
        id TEXT PRIMARY KEY,
        seed_markdown TEXT NOT NULL,
        config TEXT NOT NULL,
        grid_data TEXT NOT NULL DEFAULT '[]',
        generation INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active',
        best_fitness REAL DEFAULT 0,
        best_markdown TEXT,
        stats TEXT DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ae_variants (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        generation INTEGER NOT NULL,
        markdown TEXT NOT NULL,
        mutation_kind TEXT NOT NULL,
        mutation_desc TEXT NOT NULL,
        fitness REAL,
        cost REAL,
        status TEXT DEFAULT 'pending',
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_ae_variants_session
        ON ae_variants (session_id);
      CREATE INDEX IF NOT EXISTS idx_ae_variants_pending
        ON ae_variants (session_id, status);

      CREATE TABLE IF NOT EXISTS ae_conductor_sessions (
        id TEXT PRIMARY KEY,
        config TEXT NOT NULL,
        grid_data TEXT NOT NULL DEFAULT '[]',
        generation INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active',
        target_complexity TEXT NOT NULL,
        total_evaluations INTEGER DEFAULT 0,
        stats TEXT DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ae_conductor_steps (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        generation INTEGER NOT NULL,
        parent_id TEXT,
        child_id TEXT NOT NULL,
        mutation_type TEXT NOT NULL,
        mutation_desc TEXT NOT NULL,
        fitness REAL NOT NULL,
        density REAL NOT NULL,
        coord_x INTEGER NOT NULL,
        coord_y INTEGER NOT NULL,
        outcome TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES ae_conductor_sessions(id)
      );
      CREATE INDEX IF NOT EXISTS idx_ae_conductor_steps_session
        ON ae_conductor_steps (session_id, generation);

      CREATE TABLE IF NOT EXISTS ae_classifications (
        id TEXT PRIMARY KEY,
        query TEXT NOT NULL,
        context TEXT,
        difficulty REAL NOT NULL,
        complexity TEXT NOT NULL,
        confidence REAL NOT NULL,
        features TEXT NOT NULL,
        fusion_method TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ae_classifications_complexity
        ON ae_classifications (complexity);
      CREATE INDEX IF NOT EXISTS idx_ae_classifications_created
        ON ae_classifications (created_at);

      CREATE TABLE IF NOT EXISTS ae_classification_feedback (
        id TEXT PRIMARY KEY,
        classification_id TEXT NOT NULL,
        actual_difficulty REAL NOT NULL,
        outcome TEXT NOT NULL,
        notes TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (classification_id) REFERENCES ae_classifications(id)
      );
      CREATE INDEX IF NOT EXISTS idx_ae_feedback_classification
        ON ae_classification_feedback (classification_id);

      CREATE TABLE IF NOT EXISTS ae_classifier_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ae_executions (
        id TEXT PRIMARY KEY,
        topology_id TEXT NOT NULL,
        topology TEXT NOT NULL,
        task_description TEXT NOT NULL,
        complexity TEXT NOT NULL,
        execution_plan TEXT NOT NULL,
        status TEXT DEFAULT 'running',
        result TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ae_executions_status
        ON ae_executions (status);

      CREATE TABLE IF NOT EXISTS ae_execution_nodes (
        id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        role TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        input_context TEXT,
        output TEXT,
        error TEXT,
        retries INTEGER DEFAULT 0,
        max_retries INTEGER DEFAULT 0,
        started_at TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (execution_id) REFERENCES ae_executions(id)
      );
      CREATE INDEX IF NOT EXISTS idx_ae_exec_nodes_execution
        ON ae_execution_nodes (execution_id, node_id);
      CREATE INDEX IF NOT EXISTS idx_ae_exec_nodes_status
        ON ae_execution_nodes (execution_id, status);

      CREATE TABLE IF NOT EXISTS ae_execution_messages (
        id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL,
        source_node_id TEXT NOT NULL,
        target_node_id TEXT NOT NULL,
        edge_type TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (execution_id) REFERENCES ae_executions(id)
      );
      CREATE INDEX IF NOT EXISTS idx_ae_exec_messages_target
        ON ae_execution_messages (execution_id, target_node_id);
    `);
  }

  // ─── Sessions ──────────────────────────────────────────

  createSession(
    seedMarkdown: string,
    config: EvolutionSessionConfig,
  ): EvolutionSession {
    const id = generateId("aevo");
    const now = new Date().toISOString();

    this.execute(
      `INSERT INTO ae_sessions
        (id, seed_markdown, config, grid_data, generation, status, best_fitness, best_markdown, stats, created_at, updated_at)
       VALUES (?, ?, ?, '[]', 0, 'active', 0, NULL, '[]', ?, ?)`,
      [id, seedMarkdown, JSON.stringify(config), now, now],
    );

    return {
      id,
      seedMarkdown,
      config,
      gridData: [],
      generation: 0,
      status: "active",
      bestFitness: 0,
      bestMarkdown: null,
      stats: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  getSession(id: string): EvolutionSession | null {
    const row = this.queryOne<SessionRow>(
      "SELECT * FROM ae_sessions WHERE id = ?",
      [id],
    );
    return row ? this.rowToSession(row) : null;
  }

  private static readonly sessionFields: FieldMapping[] = [
    { key: "gridData", column: "grid_data", serialize: jsonSerialize },
    { key: "generation", column: "generation" },
    { key: "status", column: "status" },
    { key: "bestFitness", column: "best_fitness" },
    { key: "bestMarkdown", column: "best_markdown" },
    { key: "stats", column: "stats", serialize: jsonSerialize },
  ];

  updateSession(
    id: string,
    updates: {
      gridData?: GridCell[];
      generation?: number;
      status?: SessionStatus;
      bestFitness?: number;
      bestMarkdown?: string | null;
      stats?: GenerationStats[];
    },
  ): void {
    this.partialUpdate("ae_sessions", "id = ?", [id], updates, AgentEvolutionStore.sessionFields);
  }

  // ─── Variants ──────────────────────────────────────────

  insertVariants(
    sessionId: string,
    generation: number,
    variants: Array<{
      markdown: string;
      mutationKind: string;
      mutationDesc: string;
    }>,
  ): PendingVariant[] {
    const now = new Date().toISOString();
    const results: PendingVariant[] = [];

    this.transaction(() => {
      for (const v of variants) {
        const id = generateId("avar");
        this.execute(
          `INSERT INTO ae_variants
            (id, session_id, generation, markdown, mutation_kind, mutation_desc, fitness, cost, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 'pending', ?)`,
          [id, sessionId, generation, v.markdown, v.mutationKind, v.mutationDesc, now],
        );
        results.push({
          id,
          sessionId,
          generation,
          markdown: v.markdown,
          mutationKind: v.mutationKind,
          mutationDesc: v.mutationDesc,
          fitness: null,
          cost: null,
          status: "pending",
          createdAt: now,
        });
      }
    });

    return results;
  }

  submitResult(variantId: string, fitness: number, cost: number): void {
    this.execute(
      `UPDATE ae_variants SET fitness = ?, cost = ?, status = 'evaluated' WHERE id = ?`,
      [fitness, cost, variantId],
    );
  }

  getPendingVariants(sessionId: string): PendingVariant[] {
    return this.query<VariantRow>(
      "SELECT * FROM ae_variants WHERE session_id = ? AND status = 'pending' ORDER BY created_at",
      [sessionId],
    ).map(this.rowToVariant);
  }

  getEvaluatedVariants(sessionId: string, generation?: number): PendingVariant[] {
    if (generation !== undefined) {
      return this.query<VariantRow>(
        "SELECT * FROM ae_variants WHERE session_id = ? AND generation = ? AND status = 'evaluated' ORDER BY fitness DESC",
        [sessionId, generation],
      ).map(this.rowToVariant);
    }
    return this.query<VariantRow>(
      "SELECT * FROM ae_variants WHERE session_id = ? AND status = 'evaluated' ORDER BY fitness DESC",
      [sessionId],
    ).map(this.rowToVariant);
  }

  // ─── Conductor sessions ────────────────────────────────

  createConductorSession(config: unknown, targetComplexity: string): ConductorSessionRecord {
    const id = generateId("tcnd");
    const now = new Date().toISOString();

    this.execute(
      `INSERT INTO ae_conductor_sessions
        (id, config, grid_data, generation, status, target_complexity, total_evaluations, stats, created_at, updated_at)
       VALUES (?, ?, '[]', 0, 'active', ?, 0, '[]', ?, ?)`,
      [id, JSON.stringify(config), targetComplexity, now, now],
    );

    return {
      id,
      config,
      gridData: [],
      generation: 0,
      status: "active",
      targetComplexity,
      totalEvaluations: 0,
      stats: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  getConductorSession(id: string): ConductorSessionRecord | null {
    const row = this.queryOne<ConductorSessionRow>(
      "SELECT * FROM ae_conductor_sessions WHERE id = ?",
      [id],
    );
    return row ? this.rowToConductorSession(row) : null;
  }

  getLatestConductorSession(status?: string): ConductorSessionRecord | null {
    const row = status
      ? this.queryOne<ConductorSessionRow>(
          "SELECT * FROM ae_conductor_sessions WHERE status = ? ORDER BY created_at DESC LIMIT 1",
          [status],
        )
      : this.queryOne<ConductorSessionRow>(
          "SELECT * FROM ae_conductor_sessions ORDER BY created_at DESC LIMIT 1",
        );
    return row ? this.rowToConductorSession(row) : null;
  }

  private static readonly conductorSessionFields: FieldMapping[] = [
    { key: "gridData", column: "grid_data", serialize: jsonSerialize },
    { key: "generation", column: "generation" },
    { key: "status", column: "status" },
    { key: "totalEvaluations", column: "total_evaluations" },
    { key: "stats", column: "stats", serialize: jsonSerialize },
  ];

  updateConductorSession(
    id: string,
    updates: Partial<
      Pick<ConductorSessionRecord, "gridData" | "generation" | "status" | "totalEvaluations" | "stats">
    >,
  ): void {
    this.partialUpdate("ae_conductor_sessions", "id = ?", [id], updates, AgentEvolutionStore.conductorSessionFields);
  }

  insertConductorStep(
    step: Omit<ConductorStepRecord, "id" | "createdAt">,
  ): ConductorStepRecord {
    const id = generateId("tcnd");
    const now = new Date().toISOString();

    this.execute(
      `INSERT INTO ae_conductor_steps
        (id, session_id, generation, parent_id, child_id, mutation_type, mutation_desc,
         fitness, density, coord_x, coord_y, outcome, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        step.sessionId,
        step.generation,
        step.parentId,
        step.childId,
        step.mutationType,
        step.mutationDesc,
        step.fitness,
        step.density,
        step.coordX,
        step.coordY,
        step.outcome,
        now,
      ],
    );

    return { ...step, id, createdAt: now };
  }

  getConductorSteps(sessionId: string, generation?: number): ConductorStepRecord[] {
    if (generation !== undefined) {
      return this.query<ConductorStepRow>(
        "SELECT * FROM ae_conductor_steps WHERE session_id = ? AND generation = ? ORDER BY created_at",
        [sessionId, generation],
      ).map(this.rowToConductorStep);
    }
    return this.query<ConductorStepRow>(
      "SELECT * FROM ae_conductor_steps WHERE session_id = ? ORDER BY generation, created_at",
      [sessionId],
    ).map(this.rowToConductorStep);
  }

  // ─── Classification ────────────────────────────────────

  saveClassification(record: Omit<ClassificationRecord, "createdAt">): void {
    const now = new Date().toISOString();

    this.execute(
      `INSERT INTO ae_classifications
        (id, query, context, difficulty, complexity, confidence, features, fusion_method, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.query,
        record.context,
        record.difficulty,
        record.complexity,
        record.confidence,
        JSON.stringify(record.features),
        record.fusionMethod,
        now,
      ],
    );
  }

  getClassification(id: string): ClassificationRecord | null {
    const row = this.queryOne<ClassificationRow>(
      "SELECT * FROM ae_classifications WHERE id = ?",
      [id],
    );
    return row ? this.rowToClassification(row) : null;
  }

  getRecentClassifications(limit: number): ClassificationRecord[] {
    return this.query<ClassificationRow>(
      "SELECT * FROM ae_classifications ORDER BY created_at DESC LIMIT ?",
      [limit],
    ).map(this.rowToClassification);
  }

  saveFeedback(record: Omit<FeedbackRecord, "id" | "createdAt">): FeedbackRecord {
    const id = generateId("tfbk");
    const now = new Date().toISOString();

    this.execute(
      `INSERT INTO ae_classification_feedback
        (id, classification_id, actual_difficulty, outcome, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, record.classificationId, record.actualDifficulty, record.outcome, record.notes, now],
    );

    return { ...record, id, createdAt: now };
  }

  getFeedbackForClassification(classificationId: string): FeedbackRecord[] {
    return this.query<FeedbackRow>(
      "SELECT * FROM ae_classification_feedback WHERE classification_id = ? ORDER BY created_at",
      [classificationId],
    ).map(this.rowToFeedback);
  }

  getAllFeedback(): FeedbackRecord[] {
    return this.query<FeedbackRow>(
      "SELECT * FROM ae_classification_feedback ORDER BY created_at",
    ).map(this.rowToFeedback);
  }

  saveClassifierConfig(key: string, value: unknown): void {
    const now = new Date().toISOString();
    this.execute(
      `INSERT INTO ae_classifier_config (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, JSON.stringify(value), now],
    );
  }

  getClassifierConfig(key: string): unknown | null {
    const row = this.queryOne<{ value: string }>(
      "SELECT value FROM ae_classifier_config WHERE key = ?",
      [key],
    );
    return row ? JSON.parse(row.value) : null;
  }

  // ─── Executions ────────────────────────────────────────

  createExecution(params: {
    topologyId: string;
    topology: unknown;
    taskDescription: string;
    complexity: string;
    executionPlan: string[];
    id?: string;
  }): ExecutionRecord {
    const id = params.id ?? generateId("texc");
    const now = new Date().toISOString();

    this.execute(
      `INSERT INTO ae_executions
        (id, topology_id, topology, task_description, complexity, execution_plan,
         status, result, error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'running', NULL, NULL, ?, ?)`,
      [
        id,
        params.topologyId,
        JSON.stringify(params.topology),
        params.taskDescription,
        params.complexity,
        JSON.stringify(params.executionPlan),
        now,
        now,
      ],
    );

    return {
      id,
      topologyId: params.topologyId,
      topology: params.topology,
      taskDescription: params.taskDescription,
      complexity: params.complexity,
      executionPlan: params.executionPlan,
      status: "running",
      result: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  getExecution(id: string): ExecutionRecord | null {
    const row = this.queryOne<ExecutionRow>(
      "SELECT * FROM ae_executions WHERE id = ?",
      [id],
    );
    return row ? this.rowToExecution(row) : null;
  }

  private static readonly executionFields: FieldMapping[] = [
    { key: "status", column: "status" },
    { key: "result", column: "result", serialize: jsonOrNull },
    { key: "error", column: "error" },
  ];

  updateExecution(
    id: string,
    updates: Partial<Pick<ExecutionRecord, "status" | "result" | "error">>,
  ): void {
    this.partialUpdate("ae_executions", "id = ?", [id], updates, AgentEvolutionStore.executionFields);
  }

  createExecutionNodes(
    executionId: string,
    nodes: Array<{
      nodeId: string;
      agentName: string;
      role: string;
      maxRetries: number;
      initialStatus?: string;
      inputContext?: unknown;
    }>,
  ): ExecutionNodeRecord[] {
    const now = new Date().toISOString();
    const results: ExecutionNodeRecord[] = [];

    this.transaction(() => {
      for (const n of nodes) {
        const id = generateId("tnd");
        const status = n.initialStatus ?? "pending";
        const inputContext = n.inputContext !== undefined ? JSON.stringify(n.inputContext) : null;

        this.execute(
          `INSERT INTO ae_execution_nodes
            (id, execution_id, node_id, agent_name, role, status,
             input_context, output, error, retries, max_retries,
             started_at, completed_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, ?, NULL, NULL, ?)`,
          [id, executionId, n.nodeId, n.agentName, n.role, status, inputContext, n.maxRetries, now],
        );

        results.push({
          id,
          executionId,
          nodeId: n.nodeId,
          agentName: n.agentName,
          role: n.role,
          status: status as ExecutionNodeRecord["status"],
          inputContext: n.inputContext ?? null,
          output: null,
          error: null,
          retries: 0,
          maxRetries: n.maxRetries,
          startedAt: null,
          completedAt: null,
          createdAt: now,
        });
      }
    });

    return results;
  }

  getExecutionNode(executionId: string, nodeId: string): ExecutionNodeRecord | null {
    const row = this.queryOne<ExecutionNodeRow>(
      "SELECT * FROM ae_execution_nodes WHERE execution_id = ? AND node_id = ?",
      [executionId, nodeId],
    );
    return row ? this.rowToExecutionNode(row) : null;
  }

  getExecutionNodes(executionId: string): ExecutionNodeRecord[] {
    return this.query<ExecutionNodeRow>(
      "SELECT * FROM ae_execution_nodes WHERE execution_id = ? ORDER BY created_at",
      [executionId],
    ).map(this.rowToExecutionNode);
  }

  getReadyNodes(executionId: string): ExecutionNodeRecord[] {
    return this.query<ExecutionNodeRow>(
      "SELECT * FROM ae_execution_nodes WHERE execution_id = ? AND status = 'ready' ORDER BY created_at",
      [executionId],
    ).map(this.rowToExecutionNode);
  }

  private static readonly executionNodeFields: FieldMapping[] = [
    { key: "status", column: "status" },
    { key: "inputContext", column: "input_context", serialize: jsonOrNull },
    { key: "output", column: "output", serialize: jsonOrNull },
    { key: "error", column: "error" },
    { key: "retries", column: "retries" },
    { key: "startedAt", column: "started_at" },
    { key: "completedAt", column: "completed_at" },
  ];

  updateExecutionNode(
    executionId: string,
    nodeId: string,
    updates: Partial<
      Pick<
        ExecutionNodeRecord,
        "status" | "inputContext" | "output" | "error" | "retries" | "startedAt" | "completedAt"
      >
    >,
  ): void {
    this.partialUpdate(
      "ae_execution_nodes",
      "execution_id = ? AND node_id = ?",
      [executionId, nodeId],
      updates,
      AgentEvolutionStore.executionNodeFields,
      true, // no updated_at column on this table
    );
  }

  insertMessage(params: {
    executionId: string;
    sourceNodeId: string;
    targetNodeId: string;
    edgeType: string;
    content: unknown;
  }): ExecutionMessageRecord {
    const id = generateId("tmsg");
    const now = new Date().toISOString();

    this.execute(
      `INSERT INTO ae_execution_messages
        (id, execution_id, source_node_id, target_node_id, edge_type, content, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        params.executionId,
        params.sourceNodeId,
        params.targetNodeId,
        params.edgeType,
        JSON.stringify(params.content),
        now,
      ],
    );

    return {
      id,
      executionId: params.executionId,
      sourceNodeId: params.sourceNodeId,
      targetNodeId: params.targetNodeId,
      edgeType: params.edgeType,
      content: params.content,
      createdAt: now,
    };
  }

  getMessagesForNode(executionId: string, targetNodeId: string): ExecutionMessageRecord[] {
    return this.query<ExecutionMessageRow>(
      "SELECT * FROM ae_execution_messages WHERE execution_id = ? AND target_node_id = ? ORDER BY created_at",
      [executionId, targetNodeId],
    ).map(this.rowToMessage);
  }

  getMessage(
    executionId: string,
    sourceNodeId: string,
    targetNodeId: string,
  ): ExecutionMessageRecord | null {
    const row = this.queryOne<ExecutionMessageRow>(
      "SELECT * FROM ae_execution_messages WHERE execution_id = ? AND source_node_id = ? AND target_node_id = ? LIMIT 1",
      [executionId, sourceNodeId, targetNodeId],
    );
    return row ? this.rowToMessage(row) : null;
  }

  // ─── Row converters ────────────────────────────────────

  private rowToSession(row: SessionRow): EvolutionSession {
    return {
      id: row.id,
      seedMarkdown: row.seed_markdown,
      config: JSON.parse(row.config),
      gridData: JSON.parse(row.grid_data),
      generation: row.generation,
      status: row.status as SessionStatus,
      bestFitness: row.best_fitness,
      bestMarkdown: row.best_markdown,
      stats: JSON.parse(row.stats),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private rowToVariant(row: VariantRow): PendingVariant {
    return {
      id: row.id,
      sessionId: row.session_id,
      generation: row.generation,
      markdown: row.markdown,
      mutationKind: row.mutation_kind,
      mutationDesc: row.mutation_desc,
      fitness: row.fitness,
      cost: row.cost,
      status: row.status as "pending" | "evaluated",
      createdAt: row.created_at,
    };
  }

  private rowToConductorSession(row: ConductorSessionRow): ConductorSessionRecord {
    return {
      id: row.id,
      config: JSON.parse(row.config),
      gridData: JSON.parse(row.grid_data),
      generation: row.generation,
      status: row.status as ConductorSessionStatus,
      targetComplexity: row.target_complexity,
      totalEvaluations: row.total_evaluations,
      stats: JSON.parse(row.stats),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private rowToConductorStep(row: ConductorStepRow): ConductorStepRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      generation: row.generation,
      parentId: row.parent_id,
      childId: row.child_id,
      mutationType: row.mutation_type,
      mutationDesc: row.mutation_desc,
      fitness: row.fitness,
      density: row.density,
      coordX: row.coord_x,
      coordY: row.coord_y,
      outcome: row.outcome,
      createdAt: row.created_at,
    };
  }

  private rowToClassification(row: ClassificationRow): ClassificationRecord {
    return {
      id: row.id,
      query: row.query,
      context: row.context,
      difficulty: row.difficulty,
      complexity: row.complexity,
      confidence: row.confidence,
      features: JSON.parse(row.features),
      fusionMethod: row.fusion_method,
      createdAt: row.created_at,
    };
  }

  private rowToFeedback(row: FeedbackRow): FeedbackRecord {
    return {
      id: row.id,
      classificationId: row.classification_id,
      actualDifficulty: row.actual_difficulty,
      outcome: row.outcome,
      notes: row.notes,
      createdAt: row.created_at,
    };
  }

  private rowToExecution(row: ExecutionRow): ExecutionRecord {
    return {
      id: row.id,
      topologyId: row.topology_id,
      topology: JSON.parse(row.topology),
      taskDescription: row.task_description,
      complexity: row.complexity,
      executionPlan: JSON.parse(row.execution_plan),
      status: row.status as ExecutionRecord["status"],
      result: row.result !== null ? JSON.parse(row.result) : null,
      error: row.error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private rowToExecutionNode(row: ExecutionNodeRow): ExecutionNodeRecord {
    return {
      id: row.id,
      executionId: row.execution_id,
      nodeId: row.node_id,
      agentName: row.agent_name,
      role: row.role,
      status: row.status as ExecutionNodeRecord["status"],
      inputContext: row.input_context !== null ? JSON.parse(row.input_context) : null,
      output: row.output !== null ? JSON.parse(row.output) : null,
      error: row.error,
      retries: row.retries,
      maxRetries: row.max_retries,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      createdAt: row.created_at,
    };
  }

  private rowToMessage(row: ExecutionMessageRow): ExecutionMessageRecord {
    return {
      id: row.id,
      executionId: row.execution_id,
      sourceNodeId: row.source_node_id,
      targetNodeId: row.target_node_id,
      edgeType: row.edge_type,
      content: JSON.parse(row.content),
      createdAt: row.created_at,
    };
  }
}
