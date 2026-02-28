import { describe, it, expect } from "vitest";
import { generatePlan } from "./planner.js";
import { parsePipeline, validatePipeline } from "./composer.js";

function makePlan(dsl: string, storyId?: string) {
  const pipeline = parsePipeline(dsl);
  const validation = validatePipeline(pipeline);
  return generatePlan(pipeline, validation, { storyId });
}

describe("generatePlan", () => {
  it("generates steps for a simple pipeline", () => {
    const plan = makePlan("story | architecture | implementation");
    expect(plan.steps).toHaveLength(3);
    expect(plan.steps[0].concept).toBe("story");
    expect(plan.steps[0].action).toBe("create");
    expect(plan.steps[1].concept).toBe("architecture");
    expect(plan.steps[1].action).toBe("design");
    expect(plan.steps[2].concept).toBe("implementation");
    expect(plan.steps[2].action).toBe("generate");
  });

  it("assigns sequential step numbers", () => {
    const plan = makePlan("story | architecture | implementation");
    expect(plan.steps.map((s) => s.step_number)).toEqual([1, 2, 3]);
  });

  it("sets blocked_by for sequential steps", () => {
    const plan = makePlan("story | architecture | implementation");
    expect(plan.steps[0].blocked_by).toBeUndefined();
    expect(plan.steps[1].blocked_by).toEqual([1]);
    expect(plan.steps[2].blocked_by).toEqual([2]);
  });

  it("handles parallel steps", () => {
    const plan = makePlan("story | parallel(architecture, security) | implementation");
    expect(plan.steps).toHaveLength(4);
    expect(plan.steps[1].parallel_with).toEqual([3]);
    expect(plan.steps[2].parallel_with).toEqual([2]);
    // Implementation blocked by previous (architecture's step)
    expect(plan.steps[3].blocked_by).toEqual([3]);
  });

  it("includes preconditions when story_id provided", () => {
    const plan = makePlan("story | architecture", "test-001");
    // architecture has preconditions when storyId is provided
    expect(plan.steps[1].preconditions.length).toBeGreaterThan(0);
    expect(plan.steps[1].preconditions[0].description).toContain("test-001");
  });

  it("applies model from concept ref", () => {
    const plan = makePlan("architecture:opus | implementation:sonnet");
    expect(plan.steps[0].model).toBe("opus");
    expect(plan.steps[1].model).toBe("sonnet");
  });

  it("applies pass count from concept ref", () => {
    const plan = makePlan("verification[2]");
    expect(plan.steps[0].passes).toBe(2);
  });

  it("estimates cost and duration", () => {
    const plan = makePlan("story | architecture | implementation");
    expect(plan.estimated_cost_usd).toBeGreaterThan(0);
    expect(plan.estimated_duration_ms).toBeGreaterThan(0);
  });

  it("model multiplier affects cost", () => {
    const haiku = makePlan("architecture:haiku");
    const opus = makePlan("architecture:opus");
    expect(opus.estimated_cost_usd).toBeGreaterThan(haiku.estimated_cost_usd);
  });

  it("marks invalid pipeline plan as invalid", () => {
    const pipeline = parsePipeline("story | foobar");
    const validation = validatePipeline(pipeline);
    const plan = generatePlan(pipeline, validation, {});
    expect(plan.status).toBe("invalid");
  });

  it("includes validation in plan", () => {
    const plan = makePlan("story | architecture");
    expect(plan.validation.valid).toBe(true);
  });

  it("includes plan_id and created_at", () => {
    const plan = makePlan("story");
    expect(plan.plan_id).toMatch(/^plan-/);
    expect(plan.created_at).toBeTruthy();
  });

  it("includes instructions for each step", () => {
    const plan = makePlan("story | architecture", "test-001");
    expect(plan.steps[0].instructions).toContain("story");
    expect(plan.steps[1].instructions).toContain("architecture");
  });

  it("respects fromStep", () => {
    const pipeline = parsePipeline("story | architecture | implementation");
    const validation = validatePipeline(pipeline);
    const plan = generatePlan(pipeline, validation, { fromStep: 2 });
    expect(plan.start_from_step).toBe(2);
  });

  it("handles parallel duration correctly (max, not sum)", () => {
    const seqPlan = makePlan("architecture | security");
    const parPlan = makePlan("parallel(architecture, security)");
    // Parallel duration should be less than sequential
    expect(parPlan.estimated_duration_ms).toBeLessThan(seqPlan.estimated_duration_ms);
  });
});
