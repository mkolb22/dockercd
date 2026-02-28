/**
 * Topology module — DAG-based multi-agent workflow representation
 * with NEAT-inspired evolution and density-difficulty mapping.
 *
 * Modules:
 * - types: Core type definitions (WorkflowDAG, TopologyNode, TopologyEdge, etc.)
 * - dag: DAG construction, validation, density computation, traversal
 * - mapping: Density-difficulty mapping, scoring, topology selection
 * - mutations: NEAT-inspired structural mutations (add/remove nodes/edges)
 * - conductor: Co-evolution engine (MAP-Elites over composite genomes)
 * - comparison: Statistical comparison (Welch's t-test, Cohen's d)
 * - classifier: Task complexity classifier for MAS orchestration routing
 */

// Types
export type {
  NodeRole,
  EdgeType,
  TopologyNode,
  TopologyEdge,
  WorkflowDAG,
  DensityMetrics,
  TaskComplexity,
  DensityMappingConfig,
  TopologyMutationKind,
  TopologyMutationResult,
  DAGValidationResult,
  CompositeGenome,
} from './types.js';

export {
  DEFAULT_DENSITY_TARGETS,
  DEFAULT_DENSITY_MAPPING_CONFIG,
} from './types.js';

// DAG operations
export {
  createMinimalDAG,
  createLinearDAG,
  validateDAG,
  topologicalSort,
  computeDensity,
  getPredecessors,
  getSuccessors,
  getEntryNode,
  getExitNode,
  getNode,
  getOutgoingEdges,
  getIncomingEdges,
} from './dag.js';

// Density-difficulty mapping
export {
  targetDensityRange,
  isDensityMatch,
  inferComplexity,
  densityMatchScore,
  scoreDagForComplexity,
  selectTopology,
  classifyTaskComplexity,
} from './mapping.js';

// Mutations
export {
  addNode,
  removeNode,
  addEdge,
  removeEdge,
  changeRole,
  changeEdgeType,
  reassignAgent,
  randomMutation,
} from './mutations.js';

// Conductor (co-evolution)
export type {
  ConductorConfig,
  ConductorAxisConfig,
  CompositeElite,
  GridCoord,
  ConductorPlacement,
  ConductorStep,
  ConductorStats,
  ConductorResult,
  CompositeEvaluator,
  GenomeMutator,
} from './conductor.js';

export {
  DEFAULT_CONDUCTOR_CONFIG,
  ConductorGrid,
  createComposite,
  mutateTopology,
  seedPopulation,
  evolve,
  selectForComplexity,
  selectPortfolio,
  identityGenomeMutator,
} from './conductor.js';

// Comparison (statistical testing)
export type {
  ConditionLabel,
  TrialResult,
  MetricComparison,
  ExperimentConfig,
  ExperimentResult,
  ExperimentVerdict,
} from './comparison.js';

export {
  DEFAULT_EXPERIMENT_CONFIG,
  compareMetric,
  analyzeExperiment,
  createControlTrials,
  createTreatmentTrials,
  formatReport,
} from './comparison.js';

// Classifier (task complexity detection for MAS orchestration)
export type {
  TaskFeatures,
  ClassificationResult,
  TaskFeedback,
  SemanticSignalProvider,
  ClassifierConfig,
} from './classifier.js';

export {
  DEFAULT_CLASSIFIER_CONFIG,
  extractFeatures,
  scoreDifficulty,
  mapToComplexity,
  calculateConfidence,
  jaccardSimilarity,
  TaskComplexityClassifier,
} from './classifier.js';
