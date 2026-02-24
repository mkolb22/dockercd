/**
 * Framework Module Types
 * Type definitions for dynamic content serving from .claude/ directory
 */

/**
 * Content categories matching .claude/ subdirectories
 */
export type ContentCategory = "concept" | "command" | "agent" | "skill";

/**
 * Parsed YAML frontmatter from content files
 */
export interface ContentFrontmatter {
  name?: string;
  type?: string;
  model?: string;
  description?: string;
  execution?: string;
  cost_tier?: string;
  cost_per_action?: number;
  purpose?: string;
  state_location?: string;
  version?: string;
  author?: string;
  priority?: string;
  impact?: string;
  color?: string;
  // Agent-specific
  tools?: string;
  skills?: string[];
  // Skill-specific
  applies_to?: string[];
  trigger_keywords?: string[];
  // Command-specific (no frontmatter typically, but just in case)
  [key: string]: unknown;
}

/**
 * A parsed content item from a .claude/ file
 */
export interface ContentItem {
  /** File name without extension */
  name: string;
  /** Which subdirectory it came from */
  category: ContentCategory;
  /** Parsed frontmatter, empty object if none */
  frontmatter: ContentFrontmatter;
  /** Content body after frontmatter */
  body: string;
  /** Full raw file content */
  raw: string;
  /** Absolute file path */
  filePath: string;
}

/**
 * Result for zen_get_concept
 */
export interface ConceptResult {
  name: string;
  model?: string;
  purpose?: string;
  cost_tier?: string;
  body: string;
  relatedCommands: string[];
  relatedAgents: string[];
}

/**
 * Result for zen_get_workflow
 */
export interface WorkflowResult {
  command: string;
  body: string;
  found: boolean;
}

/**
 * Result for zen_get_agent_prompt
 */
export interface AgentPromptResult {
  agent: string;
  model?: string;
  description?: string;
  body: string;
  skills: Array<{ name: string; description?: string }>;
}

/**
 * Result for zen_get_skills
 */
export interface SkillsResult {
  count: number;
  skills: Array<{
    name: string;
    description?: string;
    applies_to?: string[];
    trigger_keywords?: string[];
    priority?: string;
    body: string;
  }>;
}

/**
 * A single workflow step recommendation
 */
export interface WorkflowStep {
  order: number;
  concept: string;
  agent: string;
  model: string;
  skills: string[];
  estimatedCost: number;
  reason: string;
}

/**
 * Result for zen_plan_workflow
 */
export interface WorkflowPlan {
  task: string;
  taskType: string;
  complexity: "small" | "medium" | "large";
  steps: WorkflowStep[];
  skippedSteps: Array<{ concept: string; reason: string }>;
  totalEstimatedCost: number;
  reasoning: string;
}

/**
 * Result for zen_framework_status
 */
export interface FrameworkStatus {
  contentRoot: string;
  loaded: boolean;
  loadedAt: string | null;
  counts: Record<ContentCategory, number>;
  items: Record<ContentCategory, string[]>;
  orchestration?: {
    activeSessions: number;
    totalSessions: number;
    syncRulesLoaded: number;
  };
}

// ============================================================================
// Phase 2: Dynamic Orchestration Types
// ============================================================================

/**
 * Status of a workflow step
 */
export type StepStatus = "pending" | "in_progress" | "completed" | "skipped" | "failed";

/**
 * Status of a workflow session
 */
export type SessionStatus = "active" | "completed" | "failed" | "stale";

/**
 * Tracked state of a single workflow step
 */
export interface WorkflowStepState {
  concept: string;
  agent: string;
  model: string;
  status: StepStatus;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  outcome: string | null;
  notes: string | null;
}

/**
 * In-memory workflow session with step tracking
 */
export interface WorkflowSession {
  id: string;
  task: string;
  context: string | null;
  plan: WorkflowPlan;
  steps: WorkflowStepState[];
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * A single action to execute from a sync rule
 */
export interface SyncAction {
  concept: string;
  action: string;
  model: string | null;
  inputs: Record<string, unknown>;
}

/**
 * A parsed synchronization rule (from DSL or legacy YAML)
 */
export interface SyncRule {
  id: string;
  description: string;
  source: string;
  when: {
    concept: string;
    action: string;
    status: string;
  };
  where: string | null;
  then: SyncAction[];
}

/**
 * Result of evaluating sync rules against an event
 */
export interface SyncEvalResult {
  event: { concept: string; action: string; status: string };
  matchedRules: Array<{
    rule: SyncRule;
    actions: SyncAction[];
    where: string | null;
  }>;
  noMatch: boolean;
}

/**
 * Summary statistics for a workflow session
 */
export interface WorkflowSummary {
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  skippedSteps: number;
  totalDurationMs: number;
}

/**
 * Result of advancing a workflow step
 */
export interface AdvanceResult {
  workflowId: string;
  completedStep: WorkflowStepState | null;
  nextStep: {
    concept: string;
    agent: string;
    model: string;
    enrichedPrompt: string | null;
    skills: Array<{ name: string; description?: string }>;
  } | null;
  workflowComplete: boolean;
  summary: WorkflowSummary;
  failureHints?: {
    pastFailures: Array<{ task: string; failedStep: string; notes: string; resolution: string }>;
    suggestion: string;
  };
  syncRules?: {
    matched: boolean;
    event: { concept: string; action: string; status: string };
    rules: Array<{
      id: string;
      description: string;
      actions: SyncAction[];
      where: string | null;
    }>;
    autoAdvance: boolean;
  };
  checkpoint_prompt?: {
    trigger: "step_complete" | "workflow_complete";
    message: string;
  };
}

/**
 * Full state snapshot of a workflow session for reporting
 */
export interface WorkflowStateSnapshot {
  session: WorkflowSession;
  currentStep: WorkflowStepState | null;
  summary: WorkflowSummary;
}
