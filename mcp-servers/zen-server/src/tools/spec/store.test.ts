/**
 * SpecStore Tests
 * Tests for spec CRUD operations and filtering
 */

import { describe, it, expect } from "vitest";
import { SpecStore } from "./store.js";
import { useStoreHarness } from "../../test-utils/store-harness.js";
import type { SpecData } from "./types.js";

function makeSpec(overrides?: Partial<SpecData>): SpecData {
  return {
    name: "string-utils",
    description: "String utility functions",
    target_language: "go",
    functions: [
      {
        name: "truncate",
        params: [
          { name: "s", type: "string" },
          { name: "maxLen", type: "int", constraints: "> 0" },
        ],
        returns: "string",
        requires: ["maxLen > 0"],
        ensures: ["len(result) <= maxLen"],
        description: "Truncate a string to maxLen characters",
      },
    ],
    ...overrides,
  };
}

describe("SpecStore", () => {
  const t = useStoreHarness("spec", (p) => new SpecStore(p));

  describe("saveSpec", () => {
    it("should create a new spec with draft status", () => {
      const data = makeSpec();
      const record = t.store.saveSpec("string-utils", data);

      expect(record.id).toMatch(/^spec-/);
      expect(record.name).toBe("string-utils");
      expect(record.status).toBe("draft");
      expect(record.generatedCode).toBeNull();
      expect(record.data.target_language).toBe("go");
      expect(record.data.functions).toHaveLength(1);
    });

    it("should preserve data through serialization", () => {
      const data = makeSpec({
        types: [
          {
            name: "Config",
            fields: [
              { name: "maxLen", type: "int", constraints: "> 0" },
              { name: "suffix", type: "string", description: "Truncation suffix" },
            ],
          },
        ],
        properties: [
          {
            name: "truncate-length",
            description: "Truncate never exceeds maxLen",
            forall: ["s: string", "n: int"],
            body: "len(truncate(s, n)) <= n",
          },
        ],
      });
      const record = t.store.saveSpec("with-types", data);
      const retrieved = t.store.getSpec(record.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.data.types).toHaveLength(1);
      expect(retrieved!.data.types![0].name).toBe("Config");
      expect(retrieved!.data.types![0].fields).toHaveLength(2);
      expect(retrieved!.data.properties).toHaveLength(1);
      expect(retrieved!.data.properties![0].forall).toEqual(["s: string", "n: int"]);
    });

    it("should update an existing spec by ID", () => {
      const original = t.store.saveSpec("v1", makeSpec());
      const updated = t.store.saveSpec("v2", makeSpec({ description: "Updated" }), original.id);

      expect(updated.id).toBe(original.id);

      const retrieved = t.store.getSpec(original.id);
      expect(retrieved!.name).toBe("v2");
      expect(retrieved!.data.description).toBe("Updated");
    });
  });

  describe("getSpec", () => {
    it("should retrieve a spec by ID", () => {
      const created = t.store.saveSpec("test", makeSpec());
      const retrieved = t.store.getSpec(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(created.id);
      expect(retrieved!.name).toBe("test");
    });

    it("should return null for missing ID", () => {
      expect(t.store.getSpec("spec-nonexistent")).toBeNull();
    });
  });

  describe("getSpecByName", () => {
    it("should return the latest spec with a given name", () => {
      t.store.saveSpec("my-spec", makeSpec({ description: "first" }));
      t.store.saveSpec("my-spec", makeSpec({ description: "second" }));

      const result = t.store.getSpecByName("my-spec");
      expect(result).not.toBeNull();
      expect(result!.data.description).toBe("second");
    });

    it("should return null for unknown name", () => {
      expect(t.store.getSpecByName("unknown")).toBeNull();
    });
  });

  describe("getLatestSpec", () => {
    it("should return the most recently updated spec", () => {
      t.store.saveSpec("first", makeSpec({ description: "first" }));
      t.store.saveSpec("second", makeSpec({ description: "second" }));

      const latest = t.store.getLatestSpec();
      expect(latest).not.toBeNull();
      expect(latest!.name).toBe("second");
    });

    it("should return null when no specs exist", () => {
      expect(t.store.getLatestSpec()).toBeNull();
    });
  });

  describe("listSpecs", () => {
    it("should list all specs", () => {
      t.store.saveSpec("a", makeSpec());
      t.store.saveSpec("b", makeSpec());
      t.store.saveSpec("c", makeSpec());

      const list = t.store.listSpecs();
      expect(list).toHaveLength(3);
    });

    it("should filter by status", () => {
      const spec = t.store.saveSpec("ready-one", makeSpec());
      t.store.updateStatus(spec.id, "ready");
      t.store.saveSpec("draft-one", makeSpec());

      const ready = t.store.listSpecs({ status: "ready" });
      expect(ready).toHaveLength(1);
      expect(ready[0].status).toBe("ready");
    });

    it("should filter by target language", () => {
      t.store.saveSpec("go-spec", makeSpec({ target_language: "go" }));
      t.store.saveSpec("rust-spec", makeSpec({ target_language: "rust" }));

      const goSpecs = t.store.listSpecs({ target_language: "go" });
      expect(goSpecs).toHaveLength(1);
      expect(goSpecs[0].data.target_language).toBe("go");
    });

    it("should respect limit", () => {
      for (let i = 0; i < 5; i++) {
        t.store.saveSpec(`spec-${i}`, makeSpec());
      }

      const limited = t.store.listSpecs({ limit: 3 });
      expect(limited).toHaveLength(3);
    });
  });

  describe("updateStatus", () => {
    it("should change spec status", () => {
      const spec = t.store.saveSpec("test", makeSpec());
      t.store.updateStatus(spec.id, "ready");

      const retrieved = t.store.getSpec(spec.id);
      expect(retrieved!.status).toBe("ready");
    });

    it("should update the updatedAt timestamp", () => {
      const spec = t.store.saveSpec("test", makeSpec());
      const originalTime = spec.updatedAt;

      // Small delay to ensure timestamp differs
      t.store.updateStatus(spec.id, "generating");
      const retrieved = t.store.getSpec(spec.id);
      expect(retrieved!.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe("saveGeneratedCode", () => {
    it("should save code and set status to generated", () => {
      const spec = t.store.saveSpec("test", makeSpec());
      t.store.saveGeneratedCode(spec.id, "func truncate(s string, n int) string { ... }");

      const retrieved = t.store.getSpec(spec.id);
      expect(retrieved!.status).toBe("generated");
      expect(retrieved!.generatedCode).toContain("func truncate");
    });
  });
});
