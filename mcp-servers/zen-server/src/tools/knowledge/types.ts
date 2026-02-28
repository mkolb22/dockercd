/**
 * Knowledge Graph Types
 * Entities, relations, and communities
 */

/**
 * Entity type classification
 */
export type EntityType = "function" | "type" | "package" | "file" | "concept" | "pattern" | "tool" | "module" | "store" | "table" | "config" | "method" | "variable" | "interface";

/**
 * Relation type classification
 */
export type RelationType = "calls" | "imports" | "implements" | "contains" | "depends_on" | "related_to" | "defined_in" | "tested_by" | "guards" | "stores_in" | "configures";

/**
 * Entity in the knowledge graph
 */
export interface Entity {
  id: string;
  name: string;
  entityType: EntityType;
  description?: string;
  properties?: Record<string, unknown>;  // flexible properties (defaults to {})
  sourceMemoryId?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Relation between entities
 */
export interface Relation {
  id: string;
  sourceId: string;
  targetId: string;
  relationType: RelationType;
  weight: number;
  properties?: Record<string, unknown>;  // flexible properties (defaults to {})
  createdAt: string;
}

/**
 * Community of related entities
 */
export interface Community {
  id: string;
  name: string;
  summary: string;
  entityIds: string[];
  level: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Query result with scores
 */
export interface QueryResult {
  entity: Entity;
  finalScore: number;
  semanticScore: number;
  keywordScore: number;
  graphScore: number;
  communityScore: number;
}

/**
 * Traversal result node
 */
export interface TraversalNode {
  entity: Entity;
  depth: number;
  relations: Relation[];
}

/**
 * Query options
 */
export interface QueryOptions {
  limit?: number;
  entityType?: EntityType;
  mode?: "semantic" | "keyword" | "hybrid";
  weights?: {
    semantic: number;
    keyword: number;
    graph: number;
    community: number;
  };
}

/**
 * Extracted entity from text
 */
export interface ExtractedEntity {
  name: string;
  entityType: EntityType;
  context?: string;
}

/**
 * Extracted relation from text
 */
export interface ExtractedRelation {
  sourceName: string;
  targetName: string;
  relationType: RelationType;
}

/**
 * Extraction result
 */
export interface ExtractionResult {
  entities: ExtractedEntity[];
  relations: ExtractedRelation[];
}

/**
 * Knowledge graph statistics
 */
export interface KGStats {
  totalEntities: number;
  totalRelations: number;
  totalCommunities: number;
  byEntityType: Record<EntityType, number>;
  byRelationType: Record<RelationType, number>;
  avgRelationsPerEntity: number;
}

/**
 * Ingest input
 */
export interface IngestInput {
  text: string;
  source?: string;
}

/**
 * Entity input
 */
export interface EntityInput {
  name: string;
  entity_type: EntityType;
  description?: string;
  properties?: Record<string, string>;
}

/**
 * Relate input
 */
export interface RelateInput {
  source: string;
  target: string;
  relation_type: RelationType;
  weight?: number;
}

/**
 * Query input
 */
export interface KGQueryInput {
  query: string;
  limit?: number;
  entity_type?: EntityType;
  mode?: "semantic" | "keyword" | "hybrid";
}

/**
 * Traverse input
 */
export interface TraverseInput {
  entity_id?: string;
  name?: string;
  depth?: number;
  limit?: number;
  relation_types?: RelationType[];
}

/**
 * Community input
 */
export interface CommunityInput {
  action: "detect" | "list" | "get";
  community_id?: string;
}
