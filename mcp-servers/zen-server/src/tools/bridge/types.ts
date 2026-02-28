/**
 * Bridge Module Types
 * Cross-project memory transfer via global YAML store.
 */

export type MemoryConfidence = "high" | "medium" | "low";
export type MatchType = "content" | "tag";

export interface BridgeMemory {
  id: string;
  content: string;
  confidence: MemoryConfidence;
  source: string;
  tags: string[];
  created_at: string;
  related_files?: string[];
  project?: string;
}

export interface MemoryFile {
  type: string;
  category: string;
  created_at: string;
  last_updated: string;
  memories: BridgeMemory[];
}

export interface ExportResult {
  exported: number;
  skipped: number;
  categories: string[];
}

export interface ImportResult {
  imported: number;
  skipped: number;
  categories: string[];
}

export interface SearchResult {
  memory: BridgeMemory;
  category: string;
  matchType: MatchType;
}

export interface CategorySummary {
  category: string;
  count: number;
  preview: string[];
}
