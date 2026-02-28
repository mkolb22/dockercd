/**
 * Concept Composition Language — parse, validate, and render pipelines.
 * Pure functions — no I/O, no chalk.
 *
 * DSL syntax: "story | architecture | implementation"
 * Parallel:   "story | parallel(architecture, security) | implementation"
 * Extended:   "architecture:opus | impl:sonnet | verification[2]"
 * Annotations: "@slo:standard @errors:graceful" (appended)
 */

import type {
  ConceptRef,
  Pipeline,
  PipelineStep,
  PipelineAnnotations,
  ValidationResult,
  ValidationError,
} from "./types.js";

// ─── Constants ───────────────────────────────────────────────

export const KNOWN_CONCEPTS = [
  "story", "architecture", "implementation", "quality", "version",
  "context", "retrospective", "security", "documentation",
  "code-analysis", "verification",
] as const;

const ALIASES: Record<string, string> = {
  arch: "architecture",
  impl: "implementation",
  verify: "verification",
  docs: "documentation",
  sec: "security",
  retro: "retrospective",
  qa: "quality",
  ship: "version",
};

const VALID_MODELS = ["opus", "sonnet", "haiku"] as const;

const VALID_SLO_PROFILES = [
  "architecture", "verification", "implementation", "quality", "quick",
  "context", "mcp", "zero", "test_generation", "execution_loop",
  "coverage", "security", "documentation", "standard", "fast", "thorough",
] as const;

const VALID_ERROR_POLICIES = ["graceful", "strict", "lenient", "best_effort"] as const;

// ─── Helpers ─────────────────────────────────────────────────

function resolveConcept(name: string): string {
  const trimmed = name.trim().toLowerCase();
  return ALIASES[trimmed] || trimmed;
}

// ─── Parser ──────────────────────────────────────────────────

/**
 * Parse an extended concept reference.
 * Formats: "arch:opus", "quality.review", "verification[2]:sonnet"
 */
export function parseConceptRef(input: string): ConceptRef {
  let remaining = input.trim();

  let model: string | undefined;
  const colonIdx = remaining.lastIndexOf(":");
  if (colonIdx > 0) {
    const potentialModel = remaining.slice(colonIdx + 1).toLowerCase().trim();
    if (potentialModel && /^[a-z]+$/.test(potentialModel)) {
      model = potentialModel;
      remaining = remaining.slice(0, colonIdx);
    }
  }

  let passes: number | undefined;
  const bracketMatch = remaining.match(/^(.+?)\[(\d+)\]$/);
  if (bracketMatch) {
    remaining = bracketMatch[1];
    passes = parseInt(bracketMatch[2], 10);
  }

  let action: string | undefined;
  const dotIdx = remaining.indexOf(".");
  if (dotIdx > 0) {
    action = remaining.slice(dotIdx + 1).toLowerCase();
    remaining = remaining.slice(0, dotIdx);
  }

  return { concept: resolveConcept(remaining), action, model, passes };
}

function extractAnnotations(input: string): { pipeline: string; annotations: PipelineAnnotations } {
  const annotations: PipelineAnnotations = {};

  const sloMatch = input.match(/@slo:(\w+)/i);
  if (sloMatch) {
    annotations.slo = sloMatch[1].toLowerCase();
    input = input.replace(sloMatch[0], "");
  }

  const errorsMatch = input.match(/@errors:(\w+)/i);
  if (errorsMatch) {
    annotations.errors = errorsMatch[1].toLowerCase();
    input = input.replace(errorsMatch[0], "");
  }

  return { pipeline: input.trim(), annotations };
}

/**
 * Parse a pipeline DSL string into a Pipeline object.
 */
export function parsePipeline(input: string): Pipeline {
  const raw = input.trim();
  if (!raw) return { raw, steps: [], annotations: {} };

  const { pipeline: pipelineStr, annotations } = extractAnnotations(raw);
  const segments = pipelineStr.split("|").map((s) => s.trim()).filter(Boolean);
  const steps: PipelineStep[] = [];

  for (const segment of segments) {
    const parallelMatch = segment.match(/^parallel\s*\((.+)\)$/i);
    if (parallelMatch) {
      const refs = parallelMatch[1].split(",").map((c) => parseConceptRef(c)).filter((r) => r.concept);
      steps.push({ type: "parallel", concepts: refs.map((r) => r.concept), conceptRefs: refs });
    } else {
      const ref = parseConceptRef(segment);
      if (ref.concept) {
        steps.push({ type: "sequential", concepts: [ref.concept], conceptRefs: [ref] });
      }
    }
  }

  return { raw, steps, annotations };
}

// ─── Validator ───────────────────────────────────────────────

/**
 * Validate a parsed pipeline against known concepts, models, and policies.
 */
export function validatePipeline(pipeline: Pipeline): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: string[] = [];
  const knownSet = new Set<string>(KNOWN_CONCEPTS);

  if (pipeline.steps.length === 0) {
    errors.push({ step: 0, message: "Pipeline is empty" });
    return { valid: false, errors, warnings };
  }

  const allConcepts: string[] = [];

  for (let i = 0; i < pipeline.steps.length; i++) {
    const step = pipeline.steps[i];

    for (const ref of step.conceptRefs) {
      if (!knownSet.has(ref.concept)) {
        errors.push({ step: i + 1, message: `Unknown concept: ${ref.concept}` });
      }

      if (ref.model && !VALID_MODELS.includes(ref.model as typeof VALID_MODELS[number])) {
        errors.push({ step: i + 1, message: `Unknown model: ${ref.model} (valid: opus, sonnet, haiku)` });
      }

      if (ref.passes !== undefined && (ref.passes < 1 || ref.passes > 5)) {
        warnings.push(`Pass count ${ref.passes} for ${ref.concept} is unusual (typical: 1-3)`);
      }

      const conceptKey = ref.action ? `${ref.concept}.${ref.action}` : ref.concept;
      if (allConcepts.includes(conceptKey)) {
        warnings.push(`Concept "${conceptKey}" appears more than once in the pipeline`);
      }
      allConcepts.push(conceptKey);
    }

    if (step.type === "parallel" && step.conceptRefs.length < 2) {
      errors.push({ step: i + 1, message: "parallel() requires at least 2 concepts" });
    }
  }

  if (pipeline.annotations.slo) {
    if (!VALID_SLO_PROFILES.includes(pipeline.annotations.slo as typeof VALID_SLO_PROFILES[number])) {
      warnings.push(`Unknown SLO profile: ${pipeline.annotations.slo}`);
    }
  }

  if (pipeline.annotations.errors) {
    if (!VALID_ERROR_POLICIES.includes(pipeline.annotations.errors as typeof VALID_ERROR_POLICIES[number])) {
      warnings.push(`Unknown error policy: ${pipeline.annotations.errors}`);
    }
  }

  const firstConcepts = pipeline.steps[0].concepts;
  if (!firstConcepts.includes("story") && allConcepts.some((c) => c === "story" || c.startsWith("story."))) {
    warnings.push("Story is not the first step — workflows typically start with story");
  }

  const archIdx = allConcepts.findIndex((c) => c === "architecture" || c.startsWith("architecture."));
  const implIdx = allConcepts.findIndex((c) => c === "implementation" || c.startsWith("implementation."));
  if (archIdx >= 0 && implIdx >= 0 && implIdx < archIdx) {
    warnings.push("Implementation precedes architecture — design before you build");
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ─── Renderer ────────────────────────────────────────────────

function formatConceptRef(ref: ConceptRef): string {
  let str = ref.concept;
  if (ref.action) str += `.${ref.action}`;
  if (ref.passes) str += `[${ref.passes}]`;
  if (ref.model) str += `:${ref.model}`;
  return str;
}

/**
 * Render a pipeline as a plain-text ASCII flow diagram.
 */
export function renderPipeline(pipeline: Pipeline, validation?: ValidationResult): string {
  const lines: string[] = [];

  lines.push(`Pipeline: ${pipeline.raw}`);
  lines.push("");

  if (pipeline.annotations.slo || pipeline.annotations.errors) {
    const anns: string[] = [];
    if (pipeline.annotations.slo) anns.push(`@slo:${pipeline.annotations.slo}`);
    if (pipeline.annotations.errors) anns.push(`@errors:${pipeline.annotations.errors}`);
    lines.push(`  ${anns.join(" ")}`);
    lines.push("");
  }

  for (let i = 0; i < pipeline.steps.length; i++) {
    const step = pipeline.steps[i];
    if (step.type === "parallel") {
      const labels = step.conceptRefs.map(formatConceptRef);
      lines.push(`  parallel(`);
      for (const label of labels) {
        lines.push(`    ${label}`);
      }
      lines.push(`  )`);
    } else {
      lines.push(`  [${formatConceptRef(step.conceptRefs[0])}]`);
    }

    if (i < pipeline.steps.length - 1) {
      lines.push("    |");
      lines.push("    v");
    }
  }

  lines.push("");

  if (validation) {
    if (validation.valid) {
      lines.push("  Valid");
    } else {
      lines.push("  Errors:");
      for (const err of validation.errors) {
        lines.push(`    Step ${err.step}: ${err.message}`);
      }
    }
    for (const warn of validation.warnings) {
      lines.push(`  Warning: ${warn}`);
    }
  }

  return lines.join("\n");
}
