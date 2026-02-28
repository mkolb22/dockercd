/**
 * Shared types for Zen MCP Server
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";

/**
 * Standard tool response format
 */
export interface ToolResponse {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

/**
 * Tool handler function type
 */
export type ToolHandler = (
  name: string,
  args: Record<string, unknown>
) => Promise<ToolResponse>;

/**
 * Tool module interface - each tool group exports this
 */
export interface ToolModule {
  tools: Tool[];
  handleToolCall: ToolHandler;
}

/**
 * Supported programming languages
 */
export type SupportedLanguage =
  | "typescript"
  | "javascript"
  | "python"
  | "go"
  | "rust"
  | "java"
  | "c"
  | "bash"
  | "swift";

/**
 * Language configuration for AST parsing and analysis
 */
export interface LanguageConfig {
  extensions: string[];
  wasmName?: string;
  testFrameworks?: string[];
  commentPatterns?: {
    line: string;
    blockStart?: string;
    blockEnd?: string;
  };
}

/**
 * Symbol information from AST analysis
 */
export interface Symbol {
  id: string;
  name: string;
  kind: string;
  file: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  parent?: string;
  signature?: string;
  docstring?: string;
}

/**
 * Types of symbols that can be indexed
 */
export type SymbolKind =
  | "function"
  | "class"
  | "method"
  | "variable"
  | "interface"
  | "type"
  | "constant";

/**
 * Reference to a symbol
 */
export interface Reference {
  symbolName: string;
  file: string;
  line: number;
  column: number;
  context: string;
}

/**
 * Call relationship between functions
 */
export interface CallRelation {
  caller: string;
  callerFile: string;
  callee: string;
  line: number;
  column: number;
}

/**
 * Code chunk for semantic analysis
 */
export interface CodeChunk {
  id: string;
  content: string;
  hash: string;
  metadata: {
    file: string;
    language: string;
    kind: "function" | "class" | "method" | "module" | "config" | "other";
    name: string;
    startLine: number;
    endLine: number;
    imports?: string[];
    parentClass?: string;
  };
}

/**
 * Search result with similarity score
 */
export interface SearchResult {
  id: string;
  content: string;
  similarity: number;
  metadata: {
    file: string;
    language: string;
    kind: string;
    name: string;
    startLine: number;
    endLine: number;
  };
}

/**
 * Result from executing a command or code snippet
 */
export interface ExecutionResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  duration: number;
  error?: string;
}

