/**
 * Memory System Types
 * Episodic, semantic, and procedural memory with evolution
 */

/**
 * Memory type classification
 */
export type MemoryType = "episodic" | "semantic" | "procedural";

/**
 * Relationship types for memory evolution
 */
export type RelationshipType = "supports" | "contradicts" | "extends" | "supersedes" | "related";

/**
 * Core memory structure
 */
export interface Memory {
  id: string;
  type: MemoryType;
  content: string;
  summary?: string;
  confidence: number;      // 0-1 trust metric
  source?: string;         // provenance
  category?: string;       // grouping
  tags?: string[];         // flexible labels (defaults to [])
  steps?: string[];        // for procedural memory
  createdAt: string;
  updatedAt: string;
  lastAccessed: string;
  accessCount: number;
  archived: boolean;
  archiveReason?: string;
}

/**
 * Memory link/relationship
 */
export interface Link {
  id: string;
  sourceId: string;
  targetId: string;
  relationship: RelationshipType;
  strength: number;        // 0-1 weighting
  autoCreated: boolean;    // system vs manual
  createdAt: string;
}

/**
 * Evolution event for audit trail
 */
export interface EvolutionEvent {
  id: string;
  memoryId: string;
  action: "created" | "evolved" | "decayed" | "archived";
  relationship?: RelationshipType;
  oldConfidence: number;
  newConfidence: number;
  oldContent?: string;
  newContent?: string;
  evidence?: string;
  createdAt: string;
}

/**
 * Graph node for traversal results
 */
export interface GraphNode {
  memory: Memory;
  depth: number;
  links: Link[];
}

/**
 * Recall result with similarity
 */
export interface RecallResult {
  memory: Memory;
  similarity: number;
  graphContext?: GraphNode[];
}

/**
 * Recall options
 */
export interface RecallOptions {
  limit?: number;
  threshold?: number;
  type?: MemoryType;
  category?: string;
  tags?: string[];
  traverseDepth?: number;
}

/**
 * Evolution options
 */
export interface EvolveOptions {
  memoryId: string;
  newEvidence: string;
  relationship: RelationshipType;
}

/**
 * Decay result
 */
export interface DecayResult {
  processed: number;
  decayed: number;
  archived: number;
}

/**
 * Memory statistics
 */
export interface MemoryStats {
  totalMemories: number;
  activeMemories: number;
  archivedMemories: number;
  byType: Record<MemoryType, number>;
  byCategory: Record<string, number>;
  avgConfidence: number;
  totalLinks: number;
  decayCandidates: number;
  lastDecayRun?: string;
}

/**
 * Store input for memory_store tool
 */
export interface StoreInput {
  content: string;
  type: MemoryType;
  category?: string;
  source?: string;
  tags?: string[];
  steps?: string[];
}

/**
 * Recall input for memory_recall tool
 */
export interface RecallInput {
  query: string;
  limit?: number;
  threshold?: number;
  type?: MemoryType;
  category?: string;
  traverseDepth?: number;
}

/**
 * Evolve input for memory_evolve tool
 */
export interface EvolveInput {
  memoryId: string;
  newEvidence: string;
  relationship: RelationshipType;
}

/**
 * Link input for memory_link tool
 */
export interface LinkInput {
  sourceId: string;
  targetId: string;
  relationship: RelationshipType;
}

/**
 * Forget input for memory_forget tool
 */
export interface ForgetInput {
  memoryId: string;
  reason: string;
}

/**
 * Graph input for memory_graph tool
 */
export interface GraphInput {
  memoryId?: string;
  query?: string;
  depth?: number;
  limit?: number;
}
