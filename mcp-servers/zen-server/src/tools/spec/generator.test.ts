/**
 * Generator Tests
 * Tests for spec→prompt transformation and type mapping
 */

import { describe, it, expect } from "vitest";
import { generateSpecPrompt, mapType, getLangConfig } from "./generator.js";
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
        errors: ["maxLen <= 0"],
        effects: [{ type: "none" }],
        description: "Truncate a string to maxLen characters",
      },
    ],
    ...overrides,
  };
}

describe("mapType", () => {
  describe("primitives", () => {
    it("should map string types per language", () => {
      expect(mapType("string", "go")).toBe("string");
      expect(mapType("string", "swift")).toBe("String");
      expect(mapType("string", "rust")).toBe("String");
      expect(mapType("string", "typescript")).toBe("string");
      expect(mapType("string", "python")).toBe("str");
    });

    it("should map int types per language", () => {
      expect(mapType("int", "go")).toBe("int");
      expect(mapType("int", "swift")).toBe("Int");
      expect(mapType("int", "rust")).toBe("i64");
      expect(mapType("int", "typescript")).toBe("number");
      expect(mapType("int", "python")).toBe("int");
    });

    it("should map bool types per language", () => {
      expect(mapType("bool", "go")).toBe("bool");
      expect(mapType("bool", "swift")).toBe("Bool");
      expect(mapType("bool", "rust")).toBe("bool");
      expect(mapType("bool", "typescript")).toBe("boolean");
      expect(mapType("bool", "python")).toBe("bool");
    });
  });

  describe("compound types", () => {
    it("should map list types", () => {
      expect(mapType("[]string", "go")).toBe("[]string");
      expect(mapType("[]string", "swift")).toBe("[String]");
      expect(mapType("[]string", "rust")).toBe("Vec<String>");
      expect(mapType("[]string", "typescript")).toBe("string[]");
      expect(mapType("[]string", "python")).toBe("list[str]");
    });

    it("should map optional types", () => {
      expect(mapType("?string", "go")).toBe("*string");
      expect(mapType("?string", "swift")).toBe("String?");
      expect(mapType("?string", "rust")).toBe("Option<String>");
      expect(mapType("?string", "typescript")).toBe("string | undefined");
      expect(mapType("?string", "python")).toBe("Optional[str]");
    });

    it("should map map types", () => {
      expect(mapType("map[string]int", "go")).toBe("map[string]int");
      expect(mapType("map[string]int", "swift")).toBe("[String: Int]");
      expect(mapType("map[string]int", "rust")).toBe("HashMap<String, i64>");
      expect(mapType("map[string]int", "typescript")).toBe("Record<string, number>");
      expect(mapType("map[string]int", "python")).toBe("dict[str, int]");
    });

    it("should pass through custom types", () => {
      expect(mapType("Config", "go")).toBe("Config");
      expect(mapType("UserProfile", "typescript")).toBe("UserProfile");
    });

    it("should handle nested compound types", () => {
      expect(mapType("[]?int", "swift")).toBe("[Int?]");
      expect(mapType("?[]string", "rust")).toBe("Option<Vec<String>>");
    });
  });
});

describe("generateSpecPrompt", () => {
  it("should include spec name and description", () => {
    const prompt = generateSpecPrompt(makeSpec());
    expect(prompt).toContain("string-utils");
    expect(prompt).toContain("String utility functions");
  });

  it("should include target language", () => {
    const prompt = generateSpecPrompt(makeSpec());
    expect(prompt).toContain("Target: go");
    expect(prompt).toContain("testing");
  });

  it("should include function signatures with mapped types", () => {
    const prompt = generateSpecPrompt(makeSpec());
    expect(prompt).toContain("func truncate");
    expect(prompt).toContain("s: string");
    expect(prompt).toContain("maxLen: int");
    expect(prompt).toContain("-> string");
  });

  it("should include preconditions", () => {
    const prompt = generateSpecPrompt(makeSpec());
    expect(prompt).toContain("Preconditions:");
    expect(prompt).toContain("maxLen > 0");
  });

  it("should include postconditions", () => {
    const prompt = generateSpecPrompt(makeSpec());
    expect(prompt).toContain("Postconditions:");
    expect(prompt).toContain("len(result) <= maxLen");
  });

  it("should include errors", () => {
    const prompt = generateSpecPrompt(makeSpec());
    expect(prompt).toContain("Errors:");
    expect(prompt).toContain("maxLen <= 0");
  });

  it("should include effects", () => {
    const prompt = generateSpecPrompt(makeSpec());
    expect(prompt).toContain("Effects:");
    expect(prompt).toContain("none");
  });

  it("should include parameter constraints", () => {
    const prompt = generateSpecPrompt(makeSpec());
    expect(prompt).toContain("Parameter constraints:");
    expect(prompt).toContain("maxLen: > 0");
  });

  it("should include type definitions when present", () => {
    const prompt = generateSpecPrompt(
      makeSpec({
        types: [
          {
            name: "TruncConfig",
            fields: [
              { name: "maxLen", type: "int" },
              { name: "suffix", type: "string", description: "Appended when truncated" },
            ],
            description: "Configuration for truncation",
          },
        ],
      }),
    );
    expect(prompt).toContain("Type Definitions");
    expect(prompt).toContain("TruncConfig");
    expect(prompt).toContain("Configuration for truncation");
    expect(prompt).toContain("Appended when truncated");
  });

  it("should include properties when present", () => {
    const prompt = generateSpecPrompt(
      makeSpec({
        properties: [
          {
            name: "truncate-length",
            description: "Truncate never exceeds maxLen",
            forall: ["s: string", "n: int"],
            body: "len(truncate(s, n)) <= n",
          },
        ],
      }),
    );
    expect(prompt).toContain("Properties");
    expect(prompt).toContain("rapid");
    expect(prompt).toContain("truncate-length");
    expect(prompt).toContain("forall s: string, n: int");
    expect(prompt).toContain("len(truncate(s, n)) <= n");
  });

  it("should include verification checklist", () => {
    const prompt = generateSpecPrompt(makeSpec());
    expect(prompt).toContain("Verification Checklist");
    expect(prompt).toContain("Preconditions to enforce: 1");
    expect(prompt).toContain("Postconditions to verify: 1");
    expect(prompt).toContain("Error cases to handle: 1");
  });

  it("should include instructions section", () => {
    const prompt = generateSpecPrompt(makeSpec());
    expect(prompt).toContain("Instructions");
    expect(prompt).toContain("idiomatic go");
    expect(prompt).toContain("Enforce all preconditions");
    expect(prompt).toContain("rapid");
  });

  it("should use correct comment prefix per language", () => {
    const goPrompt = generateSpecPrompt(makeSpec({ target_language: "go" }));
    expect(goPrompt).toContain("// ===");

    const pyPrompt = generateSpecPrompt(makeSpec({ target_language: "python" }));
    expect(pyPrompt).toContain("# ===");
  });

  it("should map types for different target languages", () => {
    const swiftPrompt = generateSpecPrompt(makeSpec({ target_language: "swift" }));
    expect(swiftPrompt).toContain("s: String");
    expect(swiftPrompt).toContain("maxLen: Int");
    expect(swiftPrompt).toContain("-> String");
    expect(swiftPrompt).toContain("XCTest");

    const rustPrompt = generateSpecPrompt(makeSpec({ target_language: "rust" }));
    expect(rustPrompt).toContain("s: String");
    expect(rustPrompt).toContain("maxLen: i64");
    expect(rustPrompt).toContain("-> String");
    expect(rustPrompt).toContain("proptest");
  });
});

describe("getLangConfig", () => {
  it("should return config for each language", () => {
    for (const lang of ["go", "swift", "rust", "typescript", "python"] as const) {
      const cfg = getLangConfig(lang);
      expect(cfg.typeMap).toBeDefined();
      expect(cfg.commentPrefix).toBeDefined();
      expect(cfg.testFramework).toBeDefined();
      expect(cfg.propertyTestLib).toBeDefined();
    }
  });
});
