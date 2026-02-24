/**
 * Tool Annotations
 * Safety metadata for intelligent tool routing and execution
 */

/**
 * Tool execution safety levels
 */
export enum ToolSafety {
  /** Read-only data access (idempotent, no side effects) */
  ReadOnly = "read_only",

  /** Read-only but accesses external systems (network, filesystem) */
  ReadOnlyExternal = "read_only_external",

  /** Creates or modifies data (non-idempotent) */
  Mutating = "mutating",

  /** Modifies data but safe to retry (idempotent mutation) */
  IdempotentMutation = "idempotent_mutation",

  /** Deletes or archives data (requires careful handling) */
  Destructive = "destructive",
}

/**
 * Tool annotation metadata
 */
export interface ToolAnnotation {
  /** Safety level for execution decisions */
  safety: ToolSafety;

  /** Human-readable title for UI/logging */
  title: string;

  /** Estimated cost tier (for routing decisions) */
  costTier?: "low" | "medium" | "high";

  /** Whether tool requires confirmation in cautious mode */
  requiresConfirmation?: boolean;

  /** Tags for categorization */
  tags?: string[];
}

/**
 * Create a tool annotation
 */
export function annotate(
  safety: ToolSafety,
  title: string,
  options?: Partial<Omit<ToolAnnotation, "safety" | "title">>
): ToolAnnotation {
  return {
    safety,
    title,
    ...options,
  };
}

/**
 * Pre-built annotation helpers
 */
export const Annotations = {
  /** Read-only tool that queries data */
  readOnly: (title: string, tags?: string[]) =>
    annotate(ToolSafety.ReadOnly, title, { costTier: "low", tags }),

  /** Read-only but accesses external resources */
  readOnlyExternal: (title: string, tags?: string[]) =>
    annotate(ToolSafety.ReadOnlyExternal, title, { costTier: "medium", tags }),

  /** Tool that creates or modifies data */
  mutating: (title: string, tags?: string[]) =>
    annotate(ToolSafety.Mutating, title, { costTier: "medium", requiresConfirmation: true, tags }),

  /** Safe-to-retry mutation */
  idempotent: (title: string, tags?: string[]) =>
    annotate(ToolSafety.IdempotentMutation, title, { costTier: "medium", tags }),

  /** Destructive operation requiring confirmation */
  destructive: (title: string, tags?: string[]) =>
    annotate(ToolSafety.Destructive, title, { costTier: "high", requiresConfirmation: true, tags }),
};

/**
 * Tool definition with annotation
 */
export interface AnnotatedTool {
  name: string;
  description: string;
  inputSchema: object;
  annotation: ToolAnnotation;
}

/**
 * Check if a tool is safe to execute without confirmation
 */
export function isSafeToExecute(annotation: ToolAnnotation): boolean {
  return (
    annotation.safety === ToolSafety.ReadOnly ||
    annotation.safety === ToolSafety.ReadOnlyExternal ||
    annotation.safety === ToolSafety.IdempotentMutation
  );
}

/**
 * Get tools filtered by safety level
 */
export function filterBySafety(
  tools: AnnotatedTool[],
  safety: ToolSafety | ToolSafety[]
): AnnotatedTool[] {
  const safetyLevels = Array.isArray(safety) ? safety : [safety];
  return tools.filter((t) => safetyLevels.includes(t.annotation.safety));
}
