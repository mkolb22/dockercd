/**
 * Content Loader Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { ContentLoader } from "./content-loader.js";

describe("ContentLoader", () => {
  let tmpDir: string;
  let loader: ContentLoader;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "framework-test-"));
    // Create directory structure
    fs.mkdirSync(path.join(tmpDir, "concepts"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "commands"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "agents"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "skills"), { recursive: true });

    // Create sample concept
    fs.writeFileSync(
      path.join(tmpDir, "concepts", "architecture.md"),
      `---
name: architecture
type: concept
model: opus
cost_tier: high
purpose: "Design system architecture"
---

# Architecture Concept

This concept handles architectural decisions.
`,
    );

    // Create sample command
    fs.writeFileSync(
      path.join(tmpDir, "commands", "feature.md"),
      `Create a new feature using the Story concept, then architecture concept.

1. Invoke Story Concept
2. Invoke Architecture Concept
3. Invoke Implementation Concept
`,
    );

    // Create sample agent
    fs.writeFileSync(
      path.join(tmpDir, "agents", "story-concept.md"),
      `---
name: story-concept
type: workflow
model: sonnet
description: Story Concept - Captures requirements
skills:
  - schema-validation
  - story-decomposition
  - acceptance-criteria-generation
---

# Story Concept Agent

You are the story concept agent.
`,
    );

    // Create sample skills
    fs.writeFileSync(
      path.join(tmpDir, "skills", "schema-validation.md"),
      `---
name: Schema Validation
description: Validate YAML schema structure
applies_to:
  - story-concept
  - quality-concept
trigger_keywords:
  - schema
  - validate
  - structure
priority: P0
---

# Schema Validation Skill

Validates schema structures.
`,
    );

    fs.writeFileSync(
      path.join(tmpDir, "skills", "acceptance-criteria-generation.md"),
      `---
name: Acceptance Criteria Generation
description: Generate acceptance criteria from user stories
applies_to:
  - story-concept
trigger_keywords:
  - acceptance criteria
  - requirements
  - done definition
priority: P3
---

# Acceptance Criteria Generation

Generates acceptance criteria.
`,
    );

    loader = new ContentLoader(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("get()", () => {
    it("should return a concept by name", () => {
      const result = loader.get("concept", "architecture");
      expect(result).not.toBeNull();
      expect(result!.name).toBe("architecture");
      expect(result!.frontmatter.model).toBe("opus");
      expect(result!.frontmatter.purpose).toBe("Design system architecture");
      expect(result!.body).toContain("# Architecture Concept");
    });

    it("should return null for non-existent item", () => {
      const result = loader.get("concept", "nonexistent");
      expect(result).toBeNull();
    });

    it("should be case-insensitive", () => {
      const result = loader.get("concept", "Architecture");
      expect(result).not.toBeNull();
      expect(result!.name).toBe("architecture");
    });
  });

  describe("getAll()", () => {
    it("should return all items in a category", () => {
      const concepts = loader.getAll("concept");
      expect(concepts).toHaveLength(1);
      expect(concepts[0].name).toBe("architecture");
    });

    it("should return all skills", () => {
      const skills = loader.getAll("skill");
      expect(skills).toHaveLength(2);
    });

    it("should return empty array for empty category", () => {
      // commands has one file
      const commands = loader.getAll("command");
      expect(commands).toHaveLength(1);
    });
  });

  describe("search()", () => {
    it("should find items by name", () => {
      const results = loader.search("architecture");
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.name === "architecture")).toBe(true);
    });

    it("should find items by description/purpose", () => {
      const results = loader.search("system architecture");
      expect(results.some((r) => r.name === "architecture")).toBe(true);
    });

    it("should filter by category", () => {
      const results = loader.search("architecture", "concept");
      expect(results).toHaveLength(1);
      expect(results[0].category).toBe("concept");
    });

    it("should return empty for no match", () => {
      const results = loader.search("zzzznonexistent");
      expect(results).toHaveLength(0);
    });
  });

  describe("getSkillsForAgent()", () => {
    it("should find skills by agent skill list", () => {
      const skills = loader.getSkillsForAgent("story-concept");
      expect(skills.length).toBeGreaterThan(0);
      const names = skills.map((s) => s.name);
      expect(names).toContain("schema-validation");
    });

    it("should find skills by applies_to", () => {
      const skills = loader.getSkillsForAgent("story-concept");
      const names = skills.map((s) => s.name);
      expect(names).toContain("acceptance-criteria-generation");
    });

    it("should return empty for unknown agent", () => {
      const skills = loader.getSkillsForAgent("nonexistent-agent");
      expect(skills).toHaveLength(0);
    });
  });

  describe("getStatus()", () => {
    it("should return counts for all categories", () => {
      const status = loader.getStatus();
      expect(status.loaded).toBe(true);
      expect(status.loadedAt).not.toBeNull();
      expect(status.counts.concept).toBe(1);
      expect(status.counts.command).toBe(1);
      expect(status.counts.agent).toBe(1);
      expect(status.counts.skill).toBe(2);
      expect(status.items.concept).toContain("architecture");
    });
  });

  describe("reload()", () => {
    it("should pick up new files after reload", () => {
      // Initial load
      expect(loader.getAll("concept")).toHaveLength(1);

      // Add a new file
      fs.writeFileSync(
        path.join(tmpDir, "concepts", "implementation.md"),
        `---
name: implementation
model: sonnet
---

# Implementation Concept
`,
      );

      loader.reload();
      expect(loader.getAll("concept")).toHaveLength(2);
    });
  });

  describe(".md.template extension", () => {
    it("should load .md.template files", () => {
      fs.writeFileSync(
        path.join(tmpDir, "commands", "health.md.template"),
        `Check and display context health status.\n\n1. Read health data\n2. Display zone\n`,
      );
      loader.reload();
      const cmd = loader.get("command", "health");
      expect(cmd).not.toBeNull();
      expect(cmd!.name).toBe("health");
      expect(cmd!.body).toContain("Check and display context health status");
    });

    it("should strip .md.template extension from name", () => {
      fs.writeFileSync(
        path.join(tmpDir, "concepts", "quality.md.template"),
        `---\nname: quality\nmodel: sonnet\n---\n\n# Quality Concept\n`,
      );
      loader.reload();
      const item = loader.get("concept", "quality");
      expect(item).not.toBeNull();
      expect(item!.name).toBe("quality");
    });

    it("should handle mixed .md and .md.template files", () => {
      fs.writeFileSync(
        path.join(tmpDir, "skills", "new-skill.md.template"),
        `---\nname: new-skill\n---\n\nA template skill.\n`,
      );
      loader.reload();
      const skills = loader.getAll("skill");
      // 2 original .md + 1 new .md.template
      expect(skills).toHaveLength(3);
      expect(skills.some((s) => s.name === "new-skill")).toBe(true);
    });
  });

  describe("frontmatter parsing", () => {
    it("should handle files without frontmatter", () => {
      const cmd = loader.get("command", "feature");
      expect(cmd).not.toBeNull();
      expect(cmd!.frontmatter).toEqual({});
      expect(cmd!.body).toContain("Create a new feature");
    });

    it("should parse boolean values", () => {
      fs.writeFileSync(
        path.join(tmpDir, "concepts", "test-bool.md"),
        `---
name: test-bool
enabled: true
disabled: false
---

Body.
`,
      );
      loader.reload();
      const item = loader.get("concept", "test-bool");
      expect(item!.frontmatter.enabled).toBe(true);
      expect(item!.frontmatter.disabled).toBe(false);
    });

    it("should parse numeric values", () => {
      fs.writeFileSync(
        path.join(tmpDir, "concepts", "test-num.md"),
        `---
name: test-num
cost_per_action: 0.015
---

Body.
`,
      );
      loader.reload();
      const item = loader.get("concept", "test-num");
      expect(item!.frontmatter.cost_per_action).toBe(0.015);
    });

    it("should parse array values", () => {
      const agent = loader.get("agent", "story-concept");
      expect(agent!.frontmatter.skills).toEqual([
        "schema-validation",
        "story-decomposition",
        "acceptance-criteria-generation",
      ]);
    });
  });
});
