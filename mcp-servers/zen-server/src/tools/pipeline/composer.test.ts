import { describe, it, expect } from "vitest";
import { parsePipeline, validatePipeline, parseConceptRef, renderPipeline } from "./composer.js";

describe("parseConceptRef", () => {
  it("parses simple concept", () => {
    const ref = parseConceptRef("architecture");
    expect(ref.concept).toBe("architecture");
    expect(ref.action).toBeUndefined();
    expect(ref.model).toBeUndefined();
    expect(ref.passes).toBeUndefined();
  });

  it("resolves aliases", () => {
    expect(parseConceptRef("arch").concept).toBe("architecture");
    expect(parseConceptRef("impl").concept).toBe("implementation");
    expect(parseConceptRef("qa").concept).toBe("quality");
    expect(parseConceptRef("ship").concept).toBe("version");
  });

  it("parses model hint", () => {
    const ref = parseConceptRef("architecture:opus");
    expect(ref.concept).toBe("architecture");
    expect(ref.model).toBe("opus");
  });

  it("parses action", () => {
    const ref = parseConceptRef("quality.review");
    expect(ref.concept).toBe("quality");
    expect(ref.action).toBe("review");
  });

  it("parses pass count", () => {
    const ref = parseConceptRef("verification[2]");
    expect(ref.concept).toBe("verification");
    expect(ref.passes).toBe(2);
  });

  it("parses full extended syntax", () => {
    const ref = parseConceptRef("quality.review[2]:sonnet");
    expect(ref.concept).toBe("quality");
    expect(ref.action).toBe("review");
    expect(ref.passes).toBe(2);
    expect(ref.model).toBe("sonnet");
  });
});

describe("parsePipeline", () => {
  it("parses empty input", () => {
    const p = parsePipeline("");
    expect(p.steps).toHaveLength(0);
  });

  it("parses sequential pipeline", () => {
    const p = parsePipeline("story | architecture | implementation");
    expect(p.steps).toHaveLength(3);
    expect(p.steps[0].type).toBe("sequential");
    expect(p.steps[0].concepts[0]).toBe("story");
    expect(p.steps[1].concepts[0]).toBe("architecture");
    expect(p.steps[2].concepts[0]).toBe("implementation");
  });

  it("parses parallel step", () => {
    const p = parsePipeline("story | parallel(architecture, security) | implementation");
    expect(p.steps).toHaveLength(3);
    expect(p.steps[1].type).toBe("parallel");
    expect(p.steps[1].concepts).toEqual(["architecture", "security"]);
    expect(p.steps[1].conceptRefs).toHaveLength(2);
  });

  it("parses model hints", () => {
    const p = parsePipeline("architecture:opus | implementation:sonnet");
    expect(p.steps[0].conceptRefs[0].model).toBe("opus");
    expect(p.steps[1].conceptRefs[0].model).toBe("sonnet");
  });

  it("parses annotations", () => {
    const p = parsePipeline("story | architecture @slo:standard @errors:graceful");
    expect(p.annotations.slo).toBe("standard");
    expect(p.annotations.errors).toBe("graceful");
    expect(p.steps).toHaveLength(2);
  });

  it("parses aliases", () => {
    const p = parsePipeline("arch | impl | qa");
    expect(p.steps[0].concepts[0]).toBe("architecture");
    expect(p.steps[1].concepts[0]).toBe("implementation");
    expect(p.steps[2].concepts[0]).toBe("quality");
  });
});

describe("validatePipeline", () => {
  it("validates a correct pipeline", () => {
    const p = parsePipeline("story | architecture | implementation");
    const v = validatePipeline(p);
    expect(v.valid).toBe(true);
    expect(v.errors).toHaveLength(0);
  });

  it("rejects empty pipeline", () => {
    const p = parsePipeline("");
    const v = validatePipeline(p);
    expect(v.valid).toBe(false);
    expect(v.errors[0].message).toContain("empty");
  });

  it("rejects unknown concepts", () => {
    const p = parsePipeline("story | foobar");
    const v = validatePipeline(p);
    expect(v.valid).toBe(false);
    expect(v.errors[0].message).toContain("Unknown concept: foobar");
  });

  it("rejects unknown models", () => {
    // Model hint must be pure letters (digits aren't parsed as model hints)
    const p = parsePipeline("architecture:llama");
    const v = validatePipeline(p);
    expect(v.valid).toBe(false);
    expect(v.errors[0].message).toContain("Unknown model: llama");
  });

  it("rejects parallel with < 2 concepts", () => {
    const p: ReturnType<typeof parsePipeline> = {
      raw: "parallel(story)",
      steps: [{ type: "parallel", concepts: ["story"], conceptRefs: [{ concept: "story" }] }],
      annotations: {},
    };
    const v = validatePipeline(p);
    expect(v.valid).toBe(false);
    expect(v.errors[0].message).toContain("parallel() requires at least 2 concepts");
  });

  it("warns on unusual pass count", () => {
    const p = parsePipeline("verification[10]");
    const v = validatePipeline(p);
    expect(v.warnings.length).toBeGreaterThan(0);
    expect(v.warnings[0]).toContain("unusual");
  });

  it("warns when story is not first", () => {
    const p = parsePipeline("architecture | story");
    const v = validatePipeline(p);
    expect(v.warnings.some((w) => w.includes("not the first step"))).toBe(true);
  });

  it("warns when implementation precedes architecture", () => {
    const p = parsePipeline("story | implementation | architecture");
    const v = validatePipeline(p);
    expect(v.warnings.some((w) => w.includes("precedes architecture"))).toBe(true);
  });

  it("warns on duplicate concepts", () => {
    const p = parsePipeline("story | story");
    const v = validatePipeline(p);
    expect(v.warnings.some((w) => w.includes("more than once"))).toBe(true);
  });
});

describe("renderPipeline", () => {
  it("renders a sequential pipeline", () => {
    const p = parsePipeline("story | architecture");
    const text = renderPipeline(p);
    expect(text).toContain("story");
    expect(text).toContain("architecture");
  });

  it("renders parallel steps", () => {
    const p = parsePipeline("parallel(architecture, security)");
    const text = renderPipeline(p);
    expect(text).toContain("parallel(");
    expect(text).toContain("architecture");
    expect(text).toContain("security");
  });

  it("includes validation results", () => {
    const p = parsePipeline("story | unknown");
    const v = validatePipeline(p);
    const text = renderPipeline(p, v);
    expect(text).toContain("Errors:");
  });

  it("shows annotations", () => {
    const p = parsePipeline("story @slo:standard");
    const text = renderPipeline(p);
    expect(text).toContain("@slo:standard");
  });
});
