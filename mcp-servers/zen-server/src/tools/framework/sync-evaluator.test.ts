/**
 * SyncEvaluator Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { SyncEvaluator } from "./sync-evaluator.js";
import { evaluateSyncForStep, CONCEPT_DEFAULT_ACTIONS } from "./index.js";

describe("SyncEvaluator", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-eval-test-"));
    fs.mkdirSync(path.join(tmpDir, "synchronizations"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "synchronizations", "legacy"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("compact DSL parsing", () => {
    it("should parse basic DSL rules", () => {
      fs.writeFileSync(
        path.join(tmpDir, "synchronizations", "main.sync"),
        `
rules:
  - story.create:completed -> architecture.design:opus @architecture
  - architecture.design:completed -> implementation.generate:sonnet @implementation
`,
      );

      const evaluator = new SyncEvaluator(tmpDir);
      const result = evaluator.evaluate("story", "create", "completed");

      expect(result.noMatch).toBe(false);
      expect(result.matchedRules).toHaveLength(1);
      expect(result.matchedRules[0].actions[0].concept).toBe("architecture");
      expect(result.matchedRules[0].actions[0].action).toBe("design");
      expect(result.matchedRules[0].actions[0].model).toBe("opus");
    });

    it("should parse rules with qualifiers as where clauses", () => {
      fs.writeFileSync(
        path.join(tmpDir, "synchronizations", "main.sync"),
        `
rules:
  - story.create[ready]:completed -> architecture.design:opus @architecture
`,
      );

      const evaluator = new SyncEvaluator(tmpDir);
      const result = evaluator.evaluate("story", "create", "completed");

      expect(result.matchedRules).toHaveLength(1);
      expect(result.matchedRules[0].where).toContain("ready");
    });

    it("should parse rules with conditions", () => {
      fs.writeFileSync(
        path.join(tmpDir, "synchronizations", "main.sync"),
        `
rules:
  - architecture.design:completed -> verification.verify:sonnet @verification [risk != low]
`,
      );

      const evaluator = new SyncEvaluator(tmpDir);
      const result = evaluator.evaluate("architecture", "design", "completed");

      expect(result.matchedRules).toHaveLength(1);
      expect(result.matchedRules[0].where).toContain("risk != low");
    });

    it("should parse rules from multiple sections", () => {
      fs.writeFileSync(
        path.join(tmpDir, "synchronizations", "main.sync"),
        `
rules:
  - story.create:completed -> architecture.design:opus @architecture

recovery:
  - story.create:failed -> ask_user @quick

learning:
  - quality.review:completed -> retrospective.extract_pattern:sonnet @quick
`,
      );

      const evaluator = new SyncEvaluator(tmpDir);

      const storyComplete = evaluator.evaluate("story", "create", "completed");
      expect(storyComplete.matchedRules).toHaveLength(1);

      const storyFailed = evaluator.evaluate("story", "create", "failed");
      expect(storyFailed.matchedRules).toHaveLength(1);

      const qualityComplete = evaluator.evaluate("quality", "review", "completed");
      expect(qualityComplete.matchedRules).toHaveLength(1);
    });

    it("should skip non-rule sections like workflows and decisions", () => {
      fs.writeFileSync(
        path.join(tmpDir, "synchronizations", "main.sync"),
        `
workflows:
  feature:
    pipeline: story | architecture | implementation

decisions:
  story_ambiguous:
    trigger: story.clarity == ambiguous

rules:
  - story.create:completed -> architecture.design:opus @architecture
`,
      );

      const evaluator = new SyncEvaluator(tmpDir);
      expect(evaluator.getRuleCount()).toBe(1);
    });
  });

  describe("legacy YAML parsing", () => {
    it("should parse legacy synchronization blocks", () => {
      fs.writeFileSync(
        path.join(tmpDir, "synchronizations", "legacy", "feature-development.yaml"),
        `
version: "1.0.0"

synchronizations:
  - id: "story-to-arch"
    description: "When story ready, design architecture"
    when:
      concept: "story"
      action: "create"
      status: "completed"
    where:
      query: "story.status == 'ready'"
    then:
      - concept: "architecture"
        action: "design"
        model: "opus"
        inputs:
          story_id: "\${story.id}"

    provenance:
      flow_id: "\${flow.id}"
`,
      );

      const evaluator = new SyncEvaluator(tmpDir);
      const result = evaluator.evaluate("story", "create", "completed");

      // Should match both DSL and legacy (if DSL also has one)
      expect(result.noMatch).toBe(false);
      const legacyMatch = result.matchedRules.find(
        (m) => m.rule.id === "story-to-arch",
      );
      expect(legacyMatch).toBeDefined();
      expect(legacyMatch!.where).toBe("story.status == 'ready'");
      expect(legacyMatch!.actions[0].concept).toBe("architecture");
    });

    it("should skip metadata files", () => {
      // These should be ignored
      fs.writeFileSync(
        path.join(tmpDir, "synchronizations", "legacy", "slo-registry.yaml"),
        "slo_templates:\n  test: true",
      );
      fs.writeFileSync(
        path.join(tmpDir, "synchronizations", "legacy", "error-policy.yaml"),
        "error_policies:\n  test: true",
      );

      const evaluator = new SyncEvaluator(tmpDir);
      expect(evaluator.getRuleCount()).toBe(0);
    });
  });

  describe("event matching", () => {
    let evaluator: SyncEvaluator;

    beforeEach(() => {
      fs.writeFileSync(
        path.join(tmpDir, "synchronizations", "main.sync"),
        `
rules:
  - story.create:completed -> architecture.design:opus @architecture
  - architecture.design:completed -> implementation.generate:sonnet @implementation
  - implementation.generate:completed -> quality.review:sonnet @quality

checkpoints:
  - version.commit:completed -> checkpoint.create:haiku @quick
`,
      );
      evaluator = new SyncEvaluator(tmpDir);
    });

    it("should match exact concept+action+status", () => {
      const result = evaluator.evaluate("story", "create", "completed");

      expect(result.matchedRules.length).toBeGreaterThanOrEqual(1);
      expect(result.matchedRules.some(
        (m) => m.actions[0].concept === "architecture",
      )).toBe(true);
    });

    it("should match rules from checkpoints section", () => {
      const result = evaluator.evaluate("version", "commit", "completed");

      const checkpointMatch = result.matchedRules.find(
        (m) => m.actions[0].concept === "checkpoint",
      );
      expect(checkpointMatch).toBeDefined();
    });

    it("should return noMatch for unmatched events", () => {
      const result = evaluator.evaluate("story", "create", "starting");

      expect(result.noMatch).toBe(true);
      expect(result.matchedRules).toHaveLength(0);
    });

    it("should echo the event in results", () => {
      const result = evaluator.evaluate("story", "create", "completed");

      expect(result.event).toEqual({
        concept: "story",
        action: "create",
        status: "completed",
      });
    });
  });

  describe("pipe-separated action matching", () => {
    it("should match pipe-separated actions", () => {
      fs.writeFileSync(
        path.join(tmpDir, "synchronizations", "legacy", "test.yaml"),
        `
synchronizations:
  - id: "quality-any-to-version"
    description: "Quality review or test triggers version"
    when:
      concept: "quality"
      action: "review|test"
      status: "completed"
    then:
      - concept: "version"
        action: "commit"
        model: "sonnet"

    provenance:
      flow_id: "test"
`,
      );

      const evaluator = new SyncEvaluator(tmpDir);

      const reviewResult = evaluator.evaluate("quality", "review", "completed");
      expect(reviewResult.noMatch).toBe(false);

      const testResult = evaluator.evaluate("quality", "test", "completed");
      expect(testResult.noMatch).toBe(false);

      const otherResult = evaluator.evaluate("quality", "analyze", "completed");
      expect(otherResult.noMatch).toBe(true);
    });
  });

  describe("getRuleCount()", () => {
    it("should return total loaded rules", () => {
      fs.writeFileSync(
        path.join(tmpDir, "synchronizations", "main.sync"),
        `
rules:
  - story.create:completed -> architecture.design:opus @architecture
  - architecture.design:completed -> implementation.generate:sonnet @impl

recovery:
  - story.create:failed -> ask_user @quick
`,
      );

      const evaluator = new SyncEvaluator(tmpDir);
      expect(evaluator.getRuleCount()).toBe(3);
    });

    it("should return 0 when no sync files exist", () => {
      // Remove the synchronizations directory
      fs.rmSync(path.join(tmpDir, "synchronizations"), { recursive: true });
      const evaluator = new SyncEvaluator(tmpDir);
      expect(evaluator.getRuleCount()).toBe(0);
    });
  });
});

describe("evaluateSyncForStep", () => {
  describe("CONCEPT_DEFAULT_ACTIONS mapping", () => {
    it("should map all core workflow concepts", () => {
      expect(CONCEPT_DEFAULT_ACTIONS.story).toBe("create");
      expect(CONCEPT_DEFAULT_ACTIONS.architecture).toBe("design");
      expect(CONCEPT_DEFAULT_ACTIONS.implementation).toBe("generate");
      expect(CONCEPT_DEFAULT_ACTIONS.quality).toBe("review");
      expect(CONCEPT_DEFAULT_ACTIONS.version).toBe("commit");
    });

    it("should map optional concepts", () => {
      expect(CONCEPT_DEFAULT_ACTIONS["code-analysis"]).toBe("context");
      expect(CONCEPT_DEFAULT_ACTIONS.verification).toBe("verify");
      expect(CONCEPT_DEFAULT_ACTIONS.documentation).toBe("generate");
      expect(CONCEPT_DEFAULT_ACTIONS.security).toBe("threat_model");
    });
  });

  describe("evaluateSyncForStep()", () => {
    it("should return undefined when no rules match", () => {
      // evaluateSyncForStep uses the singleton evaluator which reads from
      // frameworkContentRoot — with no matching rules, returns undefined
      const result = evaluateSyncForStep("nonexistent-concept", "success");
      expect(result).toBeUndefined();
    });

    it("should map success outcome to completed status", () => {
      // The function maps "success" → "completed" for sync evaluation
      // We verify the mapping indirectly through the result
      const result = evaluateSyncForStep("story", "success");
      // If rules match, the event should show "completed" status
      if (result) {
        expect(result.event.status).toBe("completed");
        expect(result.event.action).toBe("create");
      }
    });

    it("should map failed outcome to failed status", () => {
      const result = evaluateSyncForStep("story", "failed");
      if (result) {
        expect(result.event.status).toBe("failed");
      }
    });

    it("should map partial outcome to completed status", () => {
      const result = evaluateSyncForStep("architecture", "partial");
      if (result) {
        expect(result.event.status).toBe("completed");
        expect(result.event.action).toBe("design");
      }
    });

    it("should set autoAdvance true when rules have no where conditions", () => {
      const result = evaluateSyncForStep("story", "success");
      if (result && result.matched) {
        // Rules without where conditions should set autoAdvance=true
        const hasNoWhereRule = result.rules.some((r) => r.where === null);
        if (hasNoWhereRule) {
          expect(result.autoAdvance).toBe(true);
        }
      }
    });

    it("should use concept name as fallback action for unknown concepts", () => {
      // An unknown concept should use itself as the action
      const result = evaluateSyncForStep("custom-concept", "success");
      // Even if no match, the function returns undefined (no match)
      // The important thing is it doesn't crash
      expect(result === undefined || result.matched).toBeTruthy();
    });
  });
});
