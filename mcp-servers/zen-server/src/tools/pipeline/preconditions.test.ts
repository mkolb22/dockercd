import { describe, it, expect } from "vitest";
import { getPreconditions } from "./preconditions.js";
import { parsePipeline } from "./composer.js";

describe("getPreconditions", () => {
  it("returns empty preconditions for story", () => {
    const pipeline = parsePipeline("story");
    const results = getPreconditions(pipeline);
    expect(results).toHaveLength(1);
    expect(results[0].concept).toBe("story");
    expect(results[0].preconditions).toHaveLength(0);
  });

  it("requires story_id for architecture", () => {
    const pipeline = parsePipeline("architecture");
    const results = getPreconditions(pipeline);
    expect(results[0].preconditions).toHaveLength(1);
    expect(results[0].preconditions[0].description).toContain("Story ID required");
  });

  it("defines file and status checks for architecture with story_id", () => {
    const pipeline = parsePipeline("architecture");
    const results = getPreconditions(pipeline, "test-001");
    expect(results[0].preconditions).toHaveLength(2);
    expect(results[0].preconditions[0].type).toBe("file_exists");
    expect(results[0].preconditions[0].target).toContain("story-test-001");
    expect(results[0].preconditions[1].type).toBe("status_equals");
  });

  it("defines preconditions for implementation", () => {
    const pipeline = parsePipeline("implementation");
    const results = getPreconditions(pipeline, "test-001");
    expect(results[0].preconditions).toHaveLength(2);
    expect(results[0].preconditions[0].target).toContain("architecture");
  });

  it("defines preconditions for quality", () => {
    const pipeline = parsePipeline("quality");
    const results = getPreconditions(pipeline, "test-001");
    expect(results[0].preconditions).toHaveLength(2);
    expect(results[0].preconditions[0].target).toContain("implementation");
  });

  it("defines preconditions for version", () => {
    const pipeline = parsePipeline("version");
    const results = getPreconditions(pipeline, "test-001");
    expect(results[0].preconditions).toHaveLength(2);
    expect(results[0].preconditions[0].target).toContain("review");
  });

  it("returns empty for concepts with no preconditions", () => {
    for (const concept of ["code-analysis", "verification", "security", "context", "documentation", "retrospective"]) {
      const pipeline = parsePipeline(concept);
      const results = getPreconditions(pipeline);
      expect(results[0].preconditions, `${concept} should have no preconditions`).toHaveLength(0);
    }
  });

  it("handles multi-step pipeline", () => {
    const pipeline = parsePipeline("story | architecture | implementation");
    const results = getPreconditions(pipeline, "s1");
    expect(results).toHaveLength(3);
    expect(results[0].step).toBe(1);
    expect(results[1].step).toBe(2);
    expect(results[2].step).toBe(3);
  });

  it("handles parallel steps", () => {
    const pipeline = parsePipeline("parallel(architecture, security)");
    const results = getPreconditions(pipeline, "s1");
    expect(results).toHaveLength(2);
    expect(results[0].concept).toBe("architecture");
    expect(results[1].concept).toBe("security");
  });

  it("returns fallback for unknown concepts", () => {
    const pipeline = parsePipeline("foobar");
    // foobar won't parse as known but pipeline still has steps
    const results = getPreconditions(pipeline);
    expect(results).toHaveLength(1);
    expect(results[0].preconditions[0].description).toContain("Unknown concept");
  });
});
