import { describe, it, expect } from "vitest";
import {
  buildMutationPrompt,
  buildCrossoverPrompt,
  mutate,
  crossover,
  validateMutatedContent,
} from "./population.js";
import type { PromptVariant, MutationConfig, CrossoverConfig } from "./types.js";

function makeVariant(overrides: Partial<PromptVariant> = {}): PromptVariant {
  return {
    variant_id: "var-001",
    created_at: "2026-02-15T10:00:00Z",
    fitness_at_creation: null,
    status: "active",
    checksum: "abc123",
    content: "# Agent Prompt\n\n## Instructions\n\nYou are a helpful assistant. Follow these rules carefully and produce high-quality output.",
    ...overrides,
  };
}

describe("buildMutationPrompt", () => {
  it("includes variant content and focus", () => {
    const variant = makeVariant();
    const config: MutationConfig = { focus: "error handling", recentFailures: [] };
    const prompt = buildMutationPrompt(variant, config);
    expect(prompt).toContain(variant.content);
    expect(prompt).toContain("error handling");
    expect(prompt).toContain("No specific failures noted");
  });

  it("includes numbered recent failures", () => {
    const config: MutationConfig = {
      focus: "reliability",
      recentFailures: ["timeout on large inputs", "missed edge case"],
    };
    const prompt = buildMutationPrompt(makeVariant(), config);
    expect(prompt).toContain("1. timeout on large inputs");
    expect(prompt).toContain("2. missed edge case");
    expect(prompt).not.toContain("No specific failures noted");
  });
});

describe("buildCrossoverPrompt", () => {
  it("includes both variant contents with fitness scores", () => {
    const config: CrossoverConfig = {
      variantA: makeVariant({ variant_id: "a", content: "# Variant A\n\n## Core\n\nAlpha content with sufficient length for validation to pass the minimum." }),
      variantB: makeVariant({ variant_id: "b", content: "# Variant B\n\n## Core\n\nBeta content with sufficient length for validation to pass the minimum." }),
      fitnessA: 0.85,
      fitnessB: 0.72,
    };
    const prompt = buildCrossoverPrompt(config);
    expect(prompt).toContain("Alpha content");
    expect(prompt).toContain("Beta content");
    expect(prompt).toContain("0.850");
    expect(prompt).toContain("0.720");
  });
});

describe("mutate", () => {
  it("creates a new variant with parent lineage", () => {
    const source = makeVariant({ variant_id: "parent-1" });
    const config: MutationConfig = { focus: "conciseness", recentFailures: [] };
    const newContent = "# Improved Prompt\n\n## Instructions\n\nBe concise and clear in all outputs. Follow these rules for best results.";
    const result = mutate(source, newContent, config);
    expect(result.parent).toBe("parent-1");
    expect(result.mutation_type).toBe("targeted");
    expect(result.mutation_focus).toBe("conciseness");
    expect(result.content).toBe(newContent);
    expect(result.status).toBe("active");
    expect(result.variant_id).toBe("");
    expect(result.checksum).toHaveLength(64);
  });

  it("generates unique checksums for different content", () => {
    const source = makeVariant();
    const config: MutationConfig = { focus: "test", recentFailures: [] };
    const a = mutate(source, "# Content A\n\n## Details\n\nUnique content here for variant A with enough length to pass validation.", config);
    const b = mutate(source, "# Content B\n\n## Details\n\nDifferent content here for variant B with enough length to pass validation.", config);
    expect(a.checksum).not.toBe(b.checksum);
  });
});

describe("crossover", () => {
  it("creates a crossover variant", () => {
    const config: CrossoverConfig = {
      variantA: makeVariant({ variant_id: "a" }),
      variantB: makeVariant({ variant_id: "b" }),
      fitnessA: 0.9,
      fitnessB: 0.7,
    };
    const content = "# Combined Prompt\n\n## Instructions\n\nMerged instructions from both parents with best elements preserved.";
    const result = crossover(content, config);
    expect(result.mutation_type).toBe("crossover");
    expect(result.content).toBe(content);
    expect(result.status).toBe("active");
    expect(result.checksum).toHaveLength(64);
  });
});

describe("validateMutatedContent", () => {
  it("accepts valid markdown content", () => {
    const content = "# Agent Prompt\n\n## Instructions\n\nYou are a helpful assistant. Follow these rules carefully and produce high-quality output for the user.";
    const result = validateMutatedContent(content);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects content shorter than 100 characters", () => {
    const result = validateMutatedContent("# Short\n\nToo brief.");
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Content too short (< 100 characters)");
  });

  it("rejects content with placeholder text", () => {
    const result = validateMutatedContent("# Agent Prompt\n\n## Instructions\n\n[placeholder for actual instructions] This content has a placeholder that should be filled in by the user before deployment.");
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Content contains placeholder text");
  });

  it("rejects content without markdown headers", () => {
    const result = validateMutatedContent("This is a long prompt without any markdown headers. It contains enough text to pass the length check but lacks structure that would make it a proper agent prompt.");
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Content lacks markdown structure (no headers found)");
  });

  it("collects multiple errors", () => {
    const result = validateMutatedContent("[placeholder] short");
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});
