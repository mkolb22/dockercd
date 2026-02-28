/**
 * Types for DAG-based workflow topology representation.
 *
 * Multi-agent workflows are represented as Directed Acyclic Graphs (DAGs)
 * where nodes are agent roles and edges are communication channels.
 * Topological density quantifies orchestration complexity and maps
 * to task difficulty via the AgentConductor density-difficulty principle:
 *   simple tasks → sparse topologies (low overhead)
 *   complex tasks → dense topologies (thorough review)
 *
 * Design references:
 * - Wang et al. (2026): AgentConductor — adaptive topology +14.6% accuracy, -68% tokens
 * - Stanley & Miikkulainen (2002): NEAT — evolve topology + weights simultaneously
 * - AGENT-EVOLUTION-RESEARCH.md Phase 2, Steps 1-2
 *
 * Constraints:
 * - Zero external dependencies
 * - All types are serializable (JSON round-trip safe)
 * - DAGs are immutable value objects — mutations return new instances
 */

import type { AgentGenome } from '../genome/schema.js';

// ---------------------------------------------------------------------------
// Node types
// ---------------------------------------------------------------------------

/**
 * Role a node plays in the workflow DAG.
 * - 'entry': receives initial task input (exactly one per DAG)
 * - 'exit': produces final output (exactly one per DAG)
 * - 'worker': intermediate processing node
 * - 'reviewer': validates/refines output from another node
 * - 'aggregator': merges outputs from multiple upstream nodes
 */
export type NodeRole = 'entry' | 'exit' | 'worker' | 'reviewer' | 'aggregator';

/**
 * A node in the workflow DAG, representing one agent's participation.
 *
 * Nodes are identified by string IDs (unique within a DAG).
 * Each node references an agent genome by name (resolved at execution time).
 */
export interface TopologyNode {
  /** Unique identifier within the DAG. */
  readonly id: string;

  /** Name of the agent genome assigned to this node. */
  readonly agentName: string;

  /** Role this node plays in the workflow. */
  readonly role: NodeRole;

  /** Model tier override (null = use genome default). */
  readonly modelOverride: string | null;

  /** Maximum retries before escalation (0 = no retry). */
  readonly maxRetries: number;
}

// ---------------------------------------------------------------------------
// Edge types
// ---------------------------------------------------------------------------

/**
 * Type of data flow along an edge.
 * - 'sequential': output of source feeds input of target (pipeline)
 * - 'review': source output sent to target for validation/feedback
 * - 'parallel': source triggers target concurrently (fan-out)
 * - 'conditional': edge is traversed only if a condition is met
 */
export type EdgeType = 'sequential' | 'review' | 'parallel' | 'conditional';

/**
 * A directed edge in the workflow DAG.
 *
 * Edges define communication patterns. The source node's output
 * is routed to the target node as input, optionally filtered
 * or transformed based on edge type.
 */
export interface TopologyEdge {
  /** Source node ID. */
  readonly source: string;

  /** Target node ID. */
  readonly target: string;

  /** Communication pattern for this edge. */
  readonly edgeType: EdgeType;

  /** Weight for priority ordering when multiple edges exist (0-1). */
  readonly weight: number;

  /** Condition expression for conditional edges (null for unconditional). */
  readonly condition: string | null;
}

// ---------------------------------------------------------------------------
// DAG structure
// ---------------------------------------------------------------------------

/**
 * A complete workflow topology as a Directed Acyclic Graph.
 *
 * Invariants (enforced by validation):
 * - Exactly one entry node
 * - Exactly one exit node
 * - All nodes reachable from entry
 * - Exit reachable from all nodes
 * - No cycles
 * - No duplicate edges
 * - All edge references point to existing nodes
 */
export interface WorkflowDAG {
  /** Unique identifier for this topology. */
  readonly id: string;

  /** Human-readable name. */
  readonly name: string;

  /** Ordered list of nodes. */
  readonly nodes: readonly TopologyNode[];

  /** Directed edges between nodes. */
  readonly edges: readonly TopologyEdge[];

  /** Optional: genome assignments for each node (keyed by node ID). */
  readonly genomeAssignments?: Readonly<Record<string, AgentGenome>>;
}

// ---------------------------------------------------------------------------
// Density metrics
// ---------------------------------------------------------------------------

/**
 * Quantitative metrics describing topological complexity.
 *
 * These metrics serve as behavioral dimensions in the MAP-Elites grid
 * and as features for the density-difficulty mapping function.
 */
export interface DensityMetrics {
  /** Number of nodes in the DAG. */
  readonly nodeCount: number;

  /** Number of edges in the DAG. */
  readonly edgeCount: number;

  /**
   * Edge density: |E| / max_possible_edges.
   * For a DAG with n nodes: max = n*(n-1)/2.
   * Range: [0, 1]. Higher = more interconnected.
   */
  readonly edgeDensity: number;

  /**
   * Average number of edges per node (in-degree + out-degree) / 2.
   * Measures typical communication burden per agent.
   */
  readonly avgDegree: number;

  /**
   * Maximum number of edges on any path from entry to exit.
   * Measures sequential depth (pipeline length).
   */
  readonly criticalPathLength: number;

  /**
   * Maximum fan-out: largest number of outgoing edges from any node.
   * Measures parallelism potential.
   */
  readonly maxFanOut: number;

  /**
   * Number of review edges / total edges.
   * Measures how much review/validation the topology employs.
   */
  readonly reviewRatio: number;

  /**
   * Composite density score: weighted combination of all metrics.
   * Range: [0, 1]. Used as behavioral dimension in MAP-Elites.
   */
  readonly compositeDensity: number;
}

// ---------------------------------------------------------------------------
// Density-difficulty mapping
// ---------------------------------------------------------------------------

/**
 * Task complexity classification for topology selection.
 *
 * Maps to expected topological density requirements:
 *   trivial → 1-2 nodes, linear
 *   simple  → 2-3 nodes, linear with optional review
 *   medium  → 3-5 nodes, includes review cycles
 *   complex → 4-7 nodes, parallel paths + reviews
 *   expert  → 5+ nodes, full debate topology
 */
export type TaskComplexity = 'trivial' | 'simple' | 'medium' | 'complex' | 'expert';

/**
 * Configuration for the density-difficulty mapping function.
 */
export interface DensityMappingConfig {
  /** Target composite density for each complexity level. */
  readonly targets: Readonly<Record<TaskComplexity, number>>;

  /** Tolerance band around each target (±). */
  readonly tolerance: number;
}

/**
 * Default density targets per complexity level.
 * Derived from AgentConductor empirical results.
 */
export const DEFAULT_DENSITY_TARGETS: Readonly<Record<TaskComplexity, number>> = {
  trivial: 0.1,
  simple: 0.25,
  medium: 0.45,
  complex: 0.65,
  expert: 0.85,
};

export const DEFAULT_DENSITY_MAPPING_CONFIG: DensityMappingConfig = {
  targets: DEFAULT_DENSITY_TARGETS,
  tolerance: 0.15,
};

// ---------------------------------------------------------------------------
// Topology mutation types
// ---------------------------------------------------------------------------

/**
 * NEAT-inspired structural mutation kinds for topology evolution.
 *
 * Start minimal (single entry→exit), grow complexity:
 * - add_node: split an edge by inserting a new agent node
 * - remove_node: merge a node's connections and remove it
 * - add_edge: create a new communication channel
 * - remove_edge: delete a communication channel
 * - change_role: alter a node's role (worker→reviewer, etc.)
 * - change_edge_type: alter edge type (sequential→review, etc.)
 * - reassign_agent: assign a different agent genome to a node
 */
export type TopologyMutationKind =
  | 'add_node'
  | 'remove_node'
  | 'add_edge'
  | 'remove_edge'
  | 'change_role'
  | 'change_edge_type'
  | 'reassign_agent';

/**
 * Result of applying a topology mutation.
 */
export interface TopologyMutationResult {
  /** The resulting DAG (original if mutation was a no-op). */
  readonly dag: WorkflowDAG;

  /** Whether a mutation was actually applied. */
  readonly applied: boolean;

  /** What kind of mutation was attempted. */
  readonly kind: TopologyMutationKind;

  /** Human-readable description of the change. */
  readonly description: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Result of DAG validation.
 */
export interface DAGValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

// ---------------------------------------------------------------------------
// Co-evolution
// ---------------------------------------------------------------------------

/**
 * Combined genome for co-evolution: topology + per-node agent sections.
 *
 * This is the "super-genome" that Phase 2 evolves:
 * the DAG structure determines WHICH agents participate and HOW they communicate,
 * while the per-node genomes determine WHAT each agent does.
 */
export interface CompositeGenome {
  /** The workflow topology. */
  readonly topology: WorkflowDAG;

  /** Agent genomes keyed by node ID. */
  readonly genomes: Readonly<Record<string, AgentGenome>>;

  /** Composite density metric for this topology. */
  readonly density: number;

  /** Task complexity this topology is optimized for. */
  readonly targetComplexity: TaskComplexity;
}
