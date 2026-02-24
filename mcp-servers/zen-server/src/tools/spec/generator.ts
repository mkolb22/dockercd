/**
 * Spec→Prompt Generator
 * Transforms a SpecData definition into a structured code generation prompt.
 * Contains per-language type mappings and prompt construction logic.
 */

import type { SpecData, SpecTargetLanguage, SpecFunction, SpecType, SpecParam } from "./types.js";

// ─── Language Configuration ─────────────────────────────

interface LangConfig {
  typeMap: Record<string, string>;
  optionalType: (t: string) => string;
  listType: (t: string) => string;
  mapType: (k: string, v: string) => string;
  errorType: string;
  commentPrefix: string;
  testFramework: string;
  propertyTestLib: string;
}

const LANG_CONFIG: Record<SpecTargetLanguage, LangConfig> = {
  go: {
    typeMap: {
      string: "string",
      int: "int",
      float: "float64",
      bool: "bool",
      bytes: "[]byte",
      any: "interface{}",
    },
    optionalType: (t) => `*${t}`,
    listType: (t) => `[]${t}`,
    mapType: (k, v) => `map[${k}]${v}`,
    errorType: "error",
    commentPrefix: "//",
    testFramework: "testing",
    propertyTestLib: "rapid",
  },
  swift: {
    typeMap: {
      string: "String",
      int: "Int",
      float: "Double",
      bool: "Bool",
      bytes: "Data",
      any: "Any",
    },
    optionalType: (t) => `${t}?`,
    listType: (t) => `[${t}]`,
    mapType: (k, v) => `[${k}: ${v}]`,
    errorType: "Error",
    commentPrefix: "//",
    testFramework: "XCTest",
    propertyTestLib: "SwiftCheck",
  },
  rust: {
    typeMap: {
      string: "String",
      int: "i64",
      float: "f64",
      bool: "bool",
      bytes: "Vec<u8>",
      any: "Box<dyn Any>",
    },
    optionalType: (t) => `Option<${t}>`,
    listType: (t) => `Vec<${t}>`,
    mapType: (k, v) => `HashMap<${k}, ${v}>`,
    errorType: "Result<T, E>",
    commentPrefix: "//",
    testFramework: "cargo test",
    propertyTestLib: "proptest",
  },
  typescript: {
    typeMap: {
      string: "string",
      int: "number",
      float: "number",
      bool: "boolean",
      bytes: "Uint8Array",
      any: "unknown",
    },
    optionalType: (t) => `${t} | undefined`,
    listType: (t) => `${t}[]`,
    mapType: (k, v) => `Record<${k}, ${v}>`,
    errorType: "Error",
    commentPrefix: "//",
    testFramework: "vitest",
    propertyTestLib: "fast-check",
  },
  python: {
    typeMap: {
      string: "str",
      int: "int",
      float: "float",
      bool: "bool",
      bytes: "bytes",
      any: "Any",
    },
    optionalType: (t) => `Optional[${t}]`,
    listType: (t) => `list[${t}]`,
    mapType: (k, v) => `dict[${k}, ${v}]`,
    errorType: "Exception",
    commentPrefix: "#",
    testFramework: "pytest",
    propertyTestLib: "hypothesis",
  },
};

// ─── Type Mapping ───────────────────────────────────────

/**
 * Map a spec type string to the target language type.
 * Handles primitives, lists ([]T), optionals (?T), and maps (map[K]V).
 */
export function mapType(specType: string, lang: SpecTargetLanguage): string {
  const cfg = LANG_CONFIG[lang];

  // Optional: ?T
  if (specType.startsWith("?")) {
    return cfg.optionalType(mapType(specType.slice(1), lang));
  }

  // List: []T
  if (specType.startsWith("[]")) {
    return cfg.listType(mapType(specType.slice(2), lang));
  }

  // Map: map[K]V
  const mapMatch = specType.match(/^map\[(\w+)\](.+)$/);
  if (mapMatch) {
    return cfg.mapType(
      mapType(mapMatch[1], lang),
      mapType(mapMatch[2], lang),
    );
  }

  // Primitive or custom type (pass through if not in map)
  return cfg.typeMap[specType] ?? specType;
}

// ─── Prompt Generation ──────────────────────────────────

function generateTypeSection(types: SpecType[], lang: SpecTargetLanguage, cfg: LangConfig): string {
  if (types.length === 0) return "";

  const lines = [`${cfg.commentPrefix} === Type Definitions ===`, ""];

  for (const t of types) {
    if (t.description) {
      lines.push(`${cfg.commentPrefix} ${t.description}`);
    }
    lines.push(`${cfg.commentPrefix} Type: ${t.name}`);
    for (const f of t.fields) {
      const mapped = mapType(f.type, lang);
      const desc = f.description ? ` ${cfg.commentPrefix} ${f.description}` : "";
      const constraint = f.constraints ? ` ${cfg.commentPrefix} constraint: ${f.constraints}` : "";
      lines.push(`${cfg.commentPrefix}   ${f.name}: ${mapped}${desc}${constraint}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function generateFunctionSection(fns: SpecFunction[], lang: SpecTargetLanguage, cfg: LangConfig): string {
  const lines = [`${cfg.commentPrefix} === Function Specifications ===`, ""];

  for (const fn of fns) {
    if (fn.description) {
      lines.push(`${cfg.commentPrefix} ${fn.description}`);
    }

    // Signature
    const params = fn.params
      .map((p) => `${p.name}: ${mapType(p.type, lang)}`)
      .join(", ");
    const returns = mapType(fn.returns, lang);
    lines.push(`${cfg.commentPrefix} func ${fn.name}(${params}) -> ${returns}`);

    // Preconditions
    if (fn.requires?.length) {
      lines.push(`${cfg.commentPrefix}`);
      lines.push(`${cfg.commentPrefix} Preconditions:`);
      for (const req of fn.requires) {
        lines.push(`${cfg.commentPrefix}   - ${req}`);
      }
    }

    // Postconditions
    if (fn.ensures?.length) {
      lines.push(`${cfg.commentPrefix}`);
      lines.push(`${cfg.commentPrefix} Postconditions:`);
      for (const ens of fn.ensures) {
        lines.push(`${cfg.commentPrefix}   - ${ens}`);
      }
    }

    // Effects
    if (fn.effects?.length) {
      lines.push(`${cfg.commentPrefix}`);
      lines.push(`${cfg.commentPrefix} Effects:`);
      for (const eff of fn.effects) {
        const desc = eff.description ? ` — ${eff.description}` : "";
        lines.push(`${cfg.commentPrefix}   - ${eff.type}${desc}`);
      }
    }

    // Errors
    if (fn.errors?.length) {
      lines.push(`${cfg.commentPrefix}`);
      lines.push(`${cfg.commentPrefix} Errors:`);
      for (const err of fn.errors) {
        lines.push(`${cfg.commentPrefix}   - ${err}`);
      }
    }

    // Parameter constraints
    const constrained = fn.params.filter((p) => p.constraints);
    if (constrained.length > 0) {
      lines.push(`${cfg.commentPrefix}`);
      lines.push(`${cfg.commentPrefix} Parameter constraints:`);
      for (const p of constrained) {
        lines.push(`${cfg.commentPrefix}   - ${p.name}: ${p.constraints}`);
      }
    }

    lines.push("");
  }

  return lines.join("\n");
}

function generatePropertySection(
  properties: SpecData["properties"],
  lang: SpecTargetLanguage,
  cfg: LangConfig,
): string {
  if (!properties?.length) return "";

  const lines = [
    `${cfg.commentPrefix} === Properties (verify with ${cfg.propertyTestLib}) ===`,
    "",
  ];

  for (const prop of properties) {
    lines.push(`${cfg.commentPrefix} Property: ${prop.name}`);
    lines.push(`${cfg.commentPrefix}   ${prop.description}`);
    if (prop.forall?.length) {
      lines.push(`${cfg.commentPrefix}   forall ${prop.forall.join(", ")}:`);
    }
    lines.push(`${cfg.commentPrefix}   ${prop.body}`);
    lines.push("");
  }

  return lines.join("\n");
}

function generateVerificationChecklist(spec: SpecData, cfg: LangConfig): string {
  const lines = [
    `${cfg.commentPrefix} === Verification Checklist ===`,
    "",
  ];

  // Collect all effects
  const allEffects = new Set<string>();
  for (const fn of spec.functions) {
    for (const eff of fn.effects ?? []) {
      allEffects.add(eff.type);
    }
  }

  if (allEffects.size > 0) {
    lines.push(`${cfg.commentPrefix} Effects to handle: ${Array.from(allEffects).join(", ")}`);
  }

  // Count contracts
  const preCount = spec.functions.reduce((n, fn) => n + (fn.requires?.length ?? 0), 0);
  const postCount = spec.functions.reduce((n, fn) => n + (fn.ensures?.length ?? 0), 0);
  const errorCount = spec.functions.reduce((n, fn) => n + (fn.errors?.length ?? 0), 0);

  if (preCount > 0) lines.push(`${cfg.commentPrefix} Preconditions to enforce: ${preCount}`);
  if (postCount > 0) lines.push(`${cfg.commentPrefix} Postconditions to verify: ${postCount}`);
  if (errorCount > 0) lines.push(`${cfg.commentPrefix} Error cases to handle: ${errorCount}`);
  if (spec.properties?.length) {
    lines.push(`${cfg.commentPrefix} Properties to test: ${spec.properties.length}`);
  }

  lines.push("");
  return lines.join("\n");
}

// ─── Main Export ────────────────────────────────────────

/**
 * Transform a SpecData into a structured code generation prompt.
 * Returns a prompt string that Claude uses directly.
 */
export function generateSpecPrompt(spec: SpecData): string {
  const lang = spec.target_language;
  const cfg = LANG_CONFIG[lang];

  const sections = [
    `Generate ${lang} code implementing the following specification.`,
    `Follow all contracts (preconditions, postconditions) exactly.`,
    `Handle all listed error cases. Respect effect annotations.`,
    "",
    `# Specification: ${spec.name}`,
    `# ${spec.description}`,
    `# Target: ${lang} (test with ${cfg.testFramework})`,
    "",
  ];

  if (spec.types?.length) {
    sections.push(generateTypeSection(spec.types, lang, cfg));
  }

  sections.push(generateFunctionSection(spec.functions, lang, cfg));

  if (spec.properties?.length) {
    sections.push(generatePropertySection(spec.properties, lang, cfg));
  }

  sections.push(generateVerificationChecklist(spec, cfg));

  sections.push(
    `${cfg.commentPrefix} === Instructions ===`,
    `${cfg.commentPrefix} 1. Implement all types and functions above in idiomatic ${lang}`,
    `${cfg.commentPrefix} 2. Enforce all preconditions (return errors / throw for violations)`,
    `${cfg.commentPrefix} 3. Ensure all postconditions hold on every return path`,
    `${cfg.commentPrefix} 4. Handle all listed error cases explicitly`,
    `${cfg.commentPrefix} 5. Write property-based tests using ${cfg.propertyTestLib}`,
    "",
  );

  return sections.join("\n");
}

/**
 * Get language configuration for external use (e.g., tool responses).
 */
export function getLangConfig(lang: SpecTargetLanguage): LangConfig {
  return LANG_CONFIG[lang];
}
