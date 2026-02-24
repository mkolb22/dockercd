/**
 * Language configuration - single source of truth
 * Used by AST indexing, test generation, and code execution
 */

import type { LanguageConfig, SupportedLanguage } from "../core/types.js";

/**
 * Language configurations with extensions, WASM names, and patterns
 */
export const LANGUAGES: Record<SupportedLanguage, LanguageConfig> = {
  typescript: {
    extensions: [".ts", ".tsx"],
    wasmName: "tree-sitter-typescript",
    testFrameworks: ["vitest", "jest", "mocha"],
    commentPatterns: {
      line: "//",
      blockStart: "/*",
      blockEnd: "*/",
    },
  },
  javascript: {
    extensions: [".js", ".jsx", ".mjs", ".cjs"],
    wasmName: "tree-sitter-javascript",
    testFrameworks: ["vitest", "jest", "mocha"],
    commentPatterns: {
      line: "//",
      blockStart: "/*",
      blockEnd: "*/",
    },
  },
  python: {
    extensions: [".py"],
    wasmName: "tree-sitter-python",
    testFrameworks: ["pytest", "unittest"],
    commentPatterns: {
      line: "#",
      blockStart: '"""',
      blockEnd: '"""',
    },
  },
  go: {
    extensions: [".go"],
    wasmName: "tree-sitter-go",
    testFrameworks: ["go-test"],
    commentPatterns: {
      line: "//",
      blockStart: "/*",
      blockEnd: "*/",
    },
  },
  rust: {
    extensions: [".rs"],
    wasmName: "tree-sitter-rust",
    testFrameworks: ["cargo-test"],
    commentPatterns: {
      line: "//",
      blockStart: "/*",
      blockEnd: "*/",
    },
  },
  java: {
    extensions: [".java"],
    wasmName: "tree-sitter-java",
    testFrameworks: ["junit"],
    commentPatterns: {
      line: "//",
      blockStart: "/*",
      blockEnd: "*/",
    },
  },
  c: {
    extensions: [".c", ".h", ".cpp", ".hpp"],
    wasmName: "tree-sitter-c",
    testFrameworks: [],
    commentPatterns: {
      line: "//",
      blockStart: "/*",
      blockEnd: "*/",
    },
  },
  bash: {
    extensions: [".sh", ".bash"],
    testFrameworks: [],
    commentPatterns: {
      line: "#",
    },
  },
  swift: {
    extensions: [".swift"],
    wasmName: "tree-sitter-swift",
    testFrameworks: ["xctest"],
    commentPatterns: {
      line: "//",
      blockStart: "/*",
      blockEnd: "*/",
    },
  },
};

/**
 * Get all file extensions for supported languages
 */
export function getAllExtensions(): string[] {
  const extensions: string[] = [];
  for (const config of Object.values(LANGUAGES)) {
    extensions.push(...config.extensions);
  }
  return extensions;
}

/**
 * Get extensions for specific languages
 */
export function getExtensionsForLanguages(languages: SupportedLanguage[]): string[] {
  const extensions: string[] = [];
  for (const lang of languages) {
    const config = LANGUAGES[lang];
    if (config) {
      extensions.push(...config.extensions);
    }
  }
  return extensions;
}

/**
 * Detect language from file extension
 */
export function detectLanguage(filePath: string): SupportedLanguage | null {
  const ext = filePath.toLowerCase().slice(filePath.lastIndexOf("."));

  for (const [lang, config] of Object.entries(LANGUAGES)) {
    if (config.extensions.includes(ext)) {
      return lang as SupportedLanguage;
    }
  }

  return null;
}

/**
 * Get WASM path for a language (for tree-sitter)
 */
export function getWasmName(language: SupportedLanguage): string | undefined {
  return LANGUAGES[language]?.wasmName;
}

/**
 * Check if a language is supported
 */
export function isSupported(language: string): language is SupportedLanguage {
  return language in LANGUAGES;
}

/**
 * Get glob patterns for finding source files
 */
export function getSourceGlobs(languages?: SupportedLanguage[]): string[] {
  const extensions = languages
    ? getExtensionsForLanguages(languages)
    : getAllExtensions();

  return extensions.map((ext) => `**/*${ext}`);
}
