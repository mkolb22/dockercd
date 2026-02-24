/**
 * Concept Composition Language — parse, validate, and render workflow pipelines.
 * DSL syntax: "story | architecture | implementation"
 * Supports parallel(): "story | parallel(architecture, security) | implementation"
 *
 * Extended syntax (v2):
 * - Model hints: "architecture:opus | implementation:sonnet"
 * - Pass counts: "verification[2]" (run verification 2 times)
 * - Actions: "quality.review | quality.test"
 * - Annotations: "@slo:standard @errors:graceful" (at end of pipeline)
 */

import chalk from 'chalk';

// --- Types ---

export type StepType = 'sequential' | 'parallel';

/** Extended concept reference with optional action, model, and passes */
export interface ConceptRef {
  concept: string;
  action?: string;       // e.g., "review" in "quality.review"
  model?: string;        // e.g., "opus" in "architecture:opus"
  passes?: number;       // e.g., 2 in "verification[2]"
}

export interface PipelineStep {
  type: StepType;
  concepts: string[];      // Legacy: simple concept names
  conceptRefs: ConceptRef[]; // Extended: full concept references
}

export interface PipelineAnnotations {
  slo?: string;         // e.g., "standard" from "@slo:standard"
  errors?: string;      // e.g., "graceful" from "@errors:graceful"
}

export interface Pipeline {
  raw: string;
  steps: PipelineStep[];
  annotations: PipelineAnnotations;
}

export interface ValidationError {
  step: number;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: string[];
}

// --- Known concepts ---

export const KNOWN_CONCEPTS = [
  'story', 'architecture', 'implementation', 'quality', 'version',
  'context', 'retrospective', 'security', 'documentation',
  'code-analysis', 'verification',
] as const;

// Shorthand aliases
const ALIASES: Record<string, string> = {
  arch: 'architecture',
  impl: 'implementation',
  verify: 'verification',
  docs: 'documentation',
  sec: 'security',
  retro: 'retrospective',
  qa: 'quality',
  ship: 'version',
};

function resolveConcept(name: string): string {
  const trimmed = name.trim().toLowerCase();
  return ALIASES[trimmed] || trimmed;
}

/**
 * Parse an extended concept reference.
 * Formats:
 *   - "architecture" -> { concept: "architecture" }
 *   - "architecture:opus" -> { concept: "architecture", model: "opus" }
 *   - "quality.review" -> { concept: "quality", action: "review" }
 *   - "quality.review:sonnet" -> { concept: "quality", action: "review", model: "sonnet" }
 *   - "verification[2]" -> { concept: "verification", passes: 2 }
 *   - "verification[2]:sonnet" -> { concept: "verification", passes: 2, model: "sonnet" }
 */
export function parseConceptRef(input: string): ConceptRef {
  let remaining = input.trim();

  // Extract model hint (after :) - extract any value, validation catches invalid
  let model: string | undefined;
  const colonIdx = remaining.lastIndexOf(':');
  if (colonIdx > 0) {
    const potentialModel = remaining.slice(colonIdx + 1).toLowerCase().trim();
    // Only treat as model hint if it's a simple word (no special chars)
    if (potentialModel && /^[a-z]+$/.test(potentialModel)) {
      model = potentialModel;
      remaining = remaining.slice(0, colonIdx);
    }
  }

  // Extract pass count (in [N])
  let passes: number | undefined;
  const bracketMatch = remaining.match(/^(.+?)\[(\d+)\]$/);
  if (bracketMatch) {
    remaining = bracketMatch[1];
    passes = parseInt(bracketMatch[2], 10);
  }

  // Extract action (after .)
  let action: string | undefined;
  const dotIdx = remaining.indexOf('.');
  if (dotIdx > 0) {
    action = remaining.slice(dotIdx + 1).toLowerCase();
    remaining = remaining.slice(0, dotIdx);
  }

  // Resolve the concept name
  const concept = resolveConcept(remaining);

  return { concept, action, model, passes };
}

/**
 * Extract annotations from the end of a pipeline string.
 * Format: "@slo:standard @errors:graceful"
 */
function extractAnnotations(input: string): { pipeline: string; annotations: PipelineAnnotations } {
  const annotations: PipelineAnnotations = {};

  // Find and extract @slo:name
  const sloMatch = input.match(/@slo:(\w+)/i);
  if (sloMatch) {
    annotations.slo = sloMatch[1].toLowerCase();
    input = input.replace(sloMatch[0], '');
  }

  // Find and extract @errors:name
  const errorsMatch = input.match(/@errors:(\w+)/i);
  if (errorsMatch) {
    annotations.errors = errorsMatch[1].toLowerCase();
    input = input.replace(errorsMatch[0], '');
  }

  return { pipeline: input.trim(), annotations };
}

// --- Parser ---

export function parsePipeline(input: string): Pipeline {
  const raw = input.trim();
  if (!raw) return { raw, steps: [], annotations: {} };

  // Extract annotations first
  const { pipeline: pipelineStr, annotations } = extractAnnotations(raw);

  const segments = pipelineStr.split('|').map(s => s.trim()).filter(Boolean);
  const steps: PipelineStep[] = [];

  for (const segment of segments) {
    const parallelMatch = segment.match(/^parallel\s*\((.+)\)$/i);
    if (parallelMatch) {
      const refs = parallelMatch[1]
        .split(',')
        .map(c => parseConceptRef(c))
        .filter(r => r.concept);
      const concepts = refs.map(r => r.concept);
      steps.push({ type: 'parallel', concepts, conceptRefs: refs });
    } else {
      const ref = parseConceptRef(segment);
      if (ref.concept) {
        steps.push({ type: 'sequential', concepts: [ref.concept], conceptRefs: [ref] });
      }
    }
  }

  return { raw, steps, annotations };
}

// Valid SLO profiles (from slo-registry.yaml)
const VALID_SLO_PROFILES = [
  'architecture', 'verification', 'implementation', 'quality', 'quick',
  'context', 'mcp', 'zero', 'test_generation', 'execution_loop',
  'coverage', 'security', 'documentation', 'standard', 'fast', 'thorough',
] as const;

// Valid error policies (from error-policy.yaml)
const VALID_ERROR_POLICIES = ['graceful', 'strict', 'lenient', 'best_effort'] as const;

// Valid models
const VALID_MODELS = ['opus', 'sonnet', 'haiku'] as const;

// --- Validator ---

export function validatePipeline(pipeline: Pipeline): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: string[] = [];
  const knownSet = new Set<string>(KNOWN_CONCEPTS);

  if (pipeline.steps.length === 0) {
    errors.push({ step: 0, message: 'Pipeline is empty' });
    return { valid: false, errors, warnings };
  }

  const allConcepts: string[] = [];

  for (let i = 0; i < pipeline.steps.length; i++) {
    const step = pipeline.steps[i];

    // Validate each concept reference
    for (const ref of step.conceptRefs) {
      if (!knownSet.has(ref.concept)) {
        errors.push({ step: i + 1, message: 'Unknown concept: ' + ref.concept });
      }

      // Validate model if specified
      if (ref.model && !VALID_MODELS.includes(ref.model as typeof VALID_MODELS[number])) {
        errors.push({ step: i + 1, message: 'Unknown model: ' + ref.model + ' (valid: opus, sonnet, haiku)' });
      }

      // Validate passes if specified
      if (ref.passes !== undefined && (ref.passes < 1 || ref.passes > 5)) {
        warnings.push('Pass count ' + ref.passes + ' for ' + ref.concept + ' is unusual (typical: 1-3)');
      }

      // Check for duplicate concepts (but allow same concept with different actions)
      const conceptKey = ref.action ? ref.concept + '.' + ref.action : ref.concept;
      if (allConcepts.includes(conceptKey)) {
        warnings.push('Concept "' + conceptKey + '" appears more than once in the pipeline');
      }
      allConcepts.push(conceptKey);
    }

    if (step.type === 'parallel' && step.conceptRefs.length < 2) {
      errors.push({ step: i + 1, message: 'parallel() requires at least 2 concepts' });
    }
  }

  // Validate annotations
  if (pipeline.annotations.slo) {
    if (!VALID_SLO_PROFILES.includes(pipeline.annotations.slo as typeof VALID_SLO_PROFILES[number])) {
      warnings.push('Unknown SLO profile: ' + pipeline.annotations.slo);
    }
  }

  if (pipeline.annotations.errors) {
    if (!VALID_ERROR_POLICIES.includes(pipeline.annotations.errors as typeof VALID_ERROR_POLICIES[number])) {
      warnings.push('Unknown error policy: ' + pipeline.annotations.errors);
    }
  }

  // Check that story comes first (if present)
  const firstConcepts = pipeline.steps[0].concepts;
  if (!firstConcepts.includes('story') && allConcepts.some(c => c === 'story' || c.startsWith('story.'))) {
    warnings.push('Story is not the first step — workflows typically start with story');
  }

  // Check implementation comes after architecture (if both present)
  const archIdx = allConcepts.findIndex(c => c === 'architecture' || c.startsWith('architecture.'));
  const implIdx = allConcepts.findIndex(c => c === 'implementation' || c.startsWith('implementation.'));
  if (archIdx >= 0 && implIdx >= 0 && implIdx < archIdx) {
    warnings.push('Implementation precedes architecture — design before you build');
  }

  return { valid: errors.length === 0, errors, warnings };
}

// --- Renderer ---

const RULE = '\u2501'.repeat(50);

/** Format a concept reference for display */
function formatConceptRef(ref: ConceptRef): string {
  let str = ref.concept;
  if (ref.action) str += '.' + ref.action;
  if (ref.passes) str += '[' + ref.passes + ']';
  if (ref.model) str += ':' + ref.model;
  return str;
}

export function renderPipeline(pipeline: Pipeline, validation?: ValidationResult): string {
  const lines: string[] = [];

  lines.push(chalk.cyan(RULE));
  lines.push(chalk.bold.cyan('  Pipeline: ' + pipeline.raw));
  lines.push(chalk.cyan(RULE));
  lines.push('');

  // Show annotations if present
  if (pipeline.annotations.slo || pipeline.annotations.errors) {
    const anns: string[] = [];
    if (pipeline.annotations.slo) anns.push(chalk.blue('@slo:' + pipeline.annotations.slo));
    if (pipeline.annotations.errors) anns.push(chalk.magenta('@errors:' + pipeline.annotations.errors));
    lines.push('  ' + anns.join(' '));
    lines.push('');
  }

  // ASCII flow
  for (let i = 0; i < pipeline.steps.length; i++) {
    const step = pipeline.steps[i];

    if (step.type === 'parallel') {
      const labels = step.conceptRefs.map(formatConceptRef);
      const maxLen = Math.max(...labels.map(l => l.length));
      const boxWidth = maxLen + 4;

      lines.push('  ' + chalk.gray('\u250C' + '\u2500'.repeat(boxWidth) + '\u2510'));
      for (let j = 0; j < labels.length; j++) {
        const label = labels[j];
        const ref = step.conceptRefs[j];
        const padded = label.padEnd(maxLen);
        const colorFn = ref.model === 'opus' ? chalk.magenta : chalk.yellow;
        lines.push('  ' + chalk.gray('\u2502') + ' ' + colorFn(padded) + '   ' + chalk.gray('\u2502'));
        if (j < labels.length - 1) {
          lines.push('  ' + chalk.gray('\u2502') + ' ' + chalk.gray('\u2500'.repeat(maxLen + 2)) + ' ' + chalk.gray('\u2502'));
        }
      }
      lines.push('  ' + chalk.gray('\u2514' + '\u2500'.repeat(boxWidth) + '\u2518'));
    } else {
      const ref = step.conceptRefs[0];
      const label = formatConceptRef(ref);
      const colorFn = ref.model === 'opus' ? chalk.magenta : chalk.green;
      lines.push('  ' + chalk.gray('[') + colorFn(label) + chalk.gray(']'));
    }

    if (i < pipeline.steps.length - 1) {
      lines.push('  ' + chalk.gray('    \u2502'));
      lines.push('  ' + chalk.gray('    \u25BC'));
    }
  }

  lines.push('');

  // Validation results
  if (validation) {
    if (validation.valid) {
      lines.push(chalk.green('  \u2713 Pipeline is valid'));
    } else {
      lines.push(chalk.red('  \u2717 Pipeline has errors:'));
      for (const err of validation.errors) {
        lines.push(chalk.red('    Step ' + err.step + ': ' + err.message));
      }
    }

    if (validation.warnings.length > 0) {
      for (const warn of validation.warnings) {
        lines.push(chalk.yellow('  \u26A0 ' + warn));
      }
    }
  }

  lines.push('');
  return lines.join('\n');
}

export function renderConceptList(): string {
  const lines: string[] = [];

  lines.push(chalk.cyan(RULE));
  lines.push(chalk.bold.cyan('  Available Concepts'));
  lines.push(chalk.cyan(RULE));
  lines.push('');

  for (const concept of KNOWN_CONCEPTS) {
    lines.push('  ' + chalk.cyan(concept));
  }

  lines.push('');
  lines.push(chalk.gray('  Aliases:'));
  for (const [alias, target] of Object.entries(ALIASES)) {
    lines.push('    ' + chalk.yellow(alias.padEnd(8)) + chalk.gray('\u2192 ') + target);
  }

  lines.push('');
  lines.push(chalk.bold('  Syntax:'));
  lines.push(chalk.gray('    Basic:      concept | concept | parallel(a, b) | concept'));
  lines.push(chalk.gray('    Model:      architecture:opus | implementation:sonnet'));
  lines.push(chalk.gray('    Action:     quality.review | quality.test'));
  lines.push(chalk.gray('    Passes:     verification[2]'));
  lines.push(chalk.gray('    Annotation: @slo:standard @errors:graceful'));
  lines.push('');
  lines.push(chalk.bold('  SLO Profiles: ') + chalk.gray(VALID_SLO_PROFILES.join(', ')));
  lines.push(chalk.bold('  Error Policies: ') + chalk.gray(VALID_ERROR_POLICIES.join(', ')));
  lines.push('');

  return lines.join('\n');
}

export function renderPipelineJson(pipeline: Pipeline, validation: ValidationResult): string {
  return JSON.stringify({ pipeline, validation }, null, 2);
}

/** Get extended concept information for a step */
export function getConceptRefs(step: PipelineStep): ConceptRef[] {
  return step.conceptRefs;
}

/** Check if a pipeline has annotations */
export function hasAnnotations(pipeline: Pipeline): boolean {
  return !!(pipeline.annotations.slo || pipeline.annotations.errors);
}
