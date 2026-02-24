/**
 * Configuration Management
 * Centralized, type-safe configuration with environment variable support
 */

import * as fs from "fs";

/**
 * Environment variable helpers
 */
function envOr(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

function envInt(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

function envFloat(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

function envBool(key: string, defaultValue: boolean): boolean {
  const value = process.env[key]?.toLowerCase();
  if (!value) return defaultValue;
  return value === "true" || value === "1" || value === "yes";
}

function envArray(key: string, defaultValue: string[]): string[] {
  const value = process.env[key];
  if (!value) return defaultValue;
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Server configuration
 */
export interface ZenConfig {
  // Server
  serverName: string;
  serverVersion: string;

  // Paths
  projectRoot: string;
  indexPath: string;

  // AST Indexing
  astMaxFileSize: number;
  astExcludePatterns: string[];
  astIncrementalDefault: boolean;

  // Semantic Search
  embeddingModel: string;
  embeddingDimensions: number;
  semanticChunkSize: number;
  semanticChunkOverlap: number;
  semanticMaxResults: number;
  semanticMinSimilarity: number;

  // Memory System
  memoryEnabled: boolean;
  memoryDbPath: string;
  memoryDecayGraceDays: number;
  memoryDecayBaseRate: number;
  memoryDecayThreshold: number;
  memoryAutoLinkThreshold: number;

  // Framework
  frameworkEnabled: boolean;
  frameworkContentRoot: string;

  // State Store
  stateEnabled: boolean;
  stateDbPath: string;

  // Evolution
  evolveEnabled: boolean;

  // Spec
  specEnabled: boolean;

  // Feature Flags
  debugMode: boolean;
  verboseLogging: boolean;
}

/**
 * Default configuration with environment overrides
 */
export function getConfig(): ZenConfig {
  const projectRoot = envOr("PROJECT_ROOT", process.cwd());

  return {
    // Server
    serverName: envOr("ZEN_SERVER_NAME", "zen-server"),
    serverVersion: envOr("ZEN_SERVER_VERSION", "1.0.0"),

    // Paths
    projectRoot,
    indexPath: envOr("ZEN_INDEX_PATH", `${projectRoot}/koan/index`),

    // AST Indexing
    astMaxFileSize: envInt("ZEN_AST_MAX_FILE_SIZE", 1024 * 1024), // 1MB
    astExcludePatterns: envArray("ZEN_AST_EXCLUDE", [
      "node_modules",
      ".git",
      "dist",
      "build",
      "__pycache__",
      ".pytest_cache",
      "coverage",
    ]),
    astIncrementalDefault: envBool("ZEN_AST_INCREMENTAL", true),

    // Semantic Search
    embeddingModel: envOr("ZEN_EMBEDDING_MODEL", "all-MiniLM-L6-v2"),
    embeddingDimensions: envInt("ZEN_EMBEDDING_DIMS", 384),
    semanticChunkSize: envInt("ZEN_CHUNK_SIZE", 512),
    semanticChunkOverlap: envInt("ZEN_CHUNK_OVERLAP", 50),
    semanticMaxResults: envInt("ZEN_MAX_RESULTS", 10),
    semanticMinSimilarity: envFloat("ZEN_MIN_SIMILARITY", 0.3),

    // Memory System
    memoryEnabled: envBool("ZEN_MEMORY_ENABLED", true),
    memoryDbPath: envOr("ZEN_MEMORY_DB_PATH", `${projectRoot}/koan/memory/memory.db`),
    memoryDecayGraceDays: envInt("ZEN_MEMORY_DECAY_GRACE_DAYS", 7),
    memoryDecayBaseRate: envFloat("ZEN_MEMORY_DECAY_BASE_RATE", 0.05),
    memoryDecayThreshold: envFloat("ZEN_MEMORY_DECAY_THRESHOLD", 0.1),
    memoryAutoLinkThreshold: envFloat("ZEN_MEMORY_AUTO_LINK_THRESHOLD", 0.3),

    // Framework
    frameworkEnabled: envBool("ZEN_FRAMEWORK_ENABLED", true),
    frameworkContentRoot: envOr(
      "ZEN_FRAMEWORK_CONTENT_ROOT",
      fs.existsSync(`${projectRoot}/.zen/templates`) ? `${projectRoot}/.zen/templates` : `${projectRoot}/.claude`,
    ),

    // State Store
    stateEnabled: envBool("ZEN_STATE_ENABLED", true),
    stateDbPath: envOr("ZEN_STATE_DB_PATH", `${projectRoot}/koan/state/state.db`),

    // Evolution
    evolveEnabled: envBool("ZEN_EVOLVE_ENABLED", true),

    // Spec
    specEnabled: envBool("ZEN_SPEC_ENABLED", true),

    // Feature Flags
    debugMode: envBool("ZEN_DEBUG", false),
    verboseLogging: envBool("ZEN_VERBOSE", false),
  };
}

import { createResettableLazyLoader } from "../utils/lazy.js";

const configLoader = createResettableLazyLoader(() => getConfig());

/**
 * Get or create config instance
 */
export const config = configLoader.get;

/**
 * Reset config (for testing)
 */
export const resetConfig = configLoader.reset;

/**
 * Log config summary (for debugging)
 */
export function logConfig(cfg: ZenConfig = config()): void {
  console.error(`[zen-server] Configuration:`);
  console.error(`  Server: ${cfg.serverName} v${cfg.serverVersion}`);
  console.error(`  Project: ${cfg.projectRoot}`);
  console.error(`  Index: ${cfg.indexPath}`);
  console.error(`  State: ${cfg.stateDbPath}`);
  console.error(`  Memory: ${cfg.memoryDbPath}`);
  console.error(`  Features:`);
  console.error(`    - Debug: ${cfg.debugMode}`);
}
