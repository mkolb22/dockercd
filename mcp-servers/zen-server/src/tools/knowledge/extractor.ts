/**
 * Entity Extractor
 * Pattern-based extraction of entities and relations from text
 */

import type { EntityType, RelationType, ExtractedEntity, ExtractedRelation, ExtractionResult } from "./types.js";

/**
 * Patterns for entity extraction
 */
const ENTITY_PATTERNS: Array<{ pattern: RegExp; type: EntityType }> = [
  // Functions
  { pattern: /function\s+(\w+)\s*\(/g, type: "function" },
  { pattern: /def\s+(\w+)\s*\(/g, type: "function" },
  { pattern: /func\s+(\w+)\s*\(/g, type: "function" },
  { pattern: /fn\s+(\w+)\s*[(<]/g, type: "function" },
  { pattern: /const\s+(\w+)\s*=\s*(?:async\s*)?\(/g, type: "function" },
  { pattern: /(\w+)\s*:\s*\([^)]*\)\s*=>/g, type: "function" },

  // Types/Classes
  { pattern: /class\s+(\w+)/g, type: "type" },
  { pattern: /interface\s+(\w+)/g, type: "type" },
  { pattern: /type\s+(\w+)\s*=/g, type: "type" },
  { pattern: /struct\s+(\w+)/g, type: "type" },
  { pattern: /enum\s+(\w+)/g, type: "type" },

  // Packages/Modules
  { pattern: /package\s+(\w+)/g, type: "package" },
  { pattern: /module\s+(\w+)/g, type: "package" },
  { pattern: /namespace\s+(\w+)/g, type: "package" },

  // Concepts (from prose)
  { pattern: /\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g, type: "concept" }, // PascalCase
  { pattern: /the\s+(\w+)\s+pattern/gi, type: "pattern" },
  { pattern: /(\w+)\s+architecture/gi, type: "pattern" },
];

/**
 * Patterns for relation extraction
 */
const RELATION_PATTERNS: Array<{
  pattern: RegExp;
  type: RelationType;
  sourceGroup: number;
  targetGroup: number;
}> = [
  // Imports
  { pattern: /import\s+(?:\{[^}]+\}|[\w*]+)\s+from\s+['"]([^'"]+)['"]/g, type: "imports", sourceGroup: 0, targetGroup: 1 },
  { pattern: /from\s+(\w+)\s+import\s+(\w+)/g, type: "imports", sourceGroup: 2, targetGroup: 1 },
  { pattern: /require\(['"]([^'"]+)['"]\)/g, type: "imports", sourceGroup: 0, targetGroup: 1 },

  // Calls
  { pattern: /(\w+)\s*\.\s*(\w+)\s*\(/g, type: "calls", sourceGroup: 0, targetGroup: 2 },
  { pattern: /(\w+)\s*\(\s*(\w+)\s*\)/g, type: "calls", sourceGroup: 1, targetGroup: 2 },

  // Implements/Extends
  { pattern: /class\s+(\w+)\s+extends\s+(\w+)/g, type: "implements", sourceGroup: 1, targetGroup: 2 },
  { pattern: /class\s+(\w+)\s+implements\s+(\w+)/g, type: "implements", sourceGroup: 1, targetGroup: 2 },
  { pattern: /(\w+)\s*:\s*(\w+)/g, type: "implements", sourceGroup: 1, targetGroup: 2 },

  // Dependencies
  { pattern: /(\w+)\s+depends\s+on\s+(\w+)/gi, type: "depends_on", sourceGroup: 1, targetGroup: 2 },
  { pattern: /(\w+)\s+uses\s+(\w+)/gi, type: "depends_on", sourceGroup: 1, targetGroup: 2 },
  { pattern: /(\w+)\s+requires\s+(\w+)/gi, type: "depends_on", sourceGroup: 1, targetGroup: 2 },
];

/**
 * Common words to filter out
 */
const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "must", "shall", "can", "need", "dare",
  "this", "that", "these", "those", "i", "you", "he", "she", "it",
  "we", "they", "what", "which", "who", "whom", "whose", "where",
  "when", "why", "how", "all", "each", "every", "both", "few", "more",
  "most", "other", "some", "such", "no", "nor", "not", "only", "own",
  "same", "so", "than", "too", "very", "just", "but", "and", "or",
  "if", "then", "else", "for", "with", "as", "by", "from", "to", "of",
  "in", "on", "at", "up", "out", "off", "over", "under", "again",
  "function", "class", "type", "interface", "const", "let", "var",
  "return", "new", "null", "undefined", "true", "false", "string",
  "number", "boolean", "object", "array", "any", "void", "never",
]);

/**
 * Extract entities from text
 */
export function extractEntities(text: string): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];
  const seen = new Set<string>();

  for (const { pattern, type } of ENTITY_PATTERNS) {
    // Reset regex state
    pattern.lastIndex = 0;

    let match;
    while ((match = pattern.exec(text)) !== null) {
      const name = match[1];

      // Filter
      if (!name || name.length < 2 || name.length > 50) continue;
      if (STOP_WORDS.has(name.toLowerCase())) continue;
      if (/^\d+$/.test(name)) continue; // Pure numbers

      const key = `${name}:${type}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // Extract context (surrounding text)
      const start = Math.max(0, match.index - 30);
      const end = Math.min(text.length, match.index + match[0].length + 30);
      const context = text.slice(start, end).replace(/\s+/g, " ").trim();

      entities.push({ name, entityType: type, context });
    }
  }

  return entities;
}

/**
 * Extract relations from text
 */
export function extractRelations(text: string, knownEntities: Set<string>): ExtractedRelation[] {
  const relations: ExtractedRelation[] = [];
  const seen = new Set<string>();

  for (const { pattern, type, sourceGroup, targetGroup } of RELATION_PATTERNS) {
    // Reset regex state
    pattern.lastIndex = 0;

    let match;
    while ((match = pattern.exec(text)) !== null) {
      const sourceName = sourceGroup === 0 ? "current" : match[sourceGroup];
      const targetName = match[targetGroup];

      if (!sourceName || !targetName) continue;
      if (sourceName.length < 2 || targetName.length < 2) continue;
      if (STOP_WORDS.has(sourceName.toLowerCase()) || STOP_WORDS.has(targetName.toLowerCase())) continue;

      // Only create relations between known entities (or imports)
      if (type !== "imports" && !knownEntities.has(sourceName) && !knownEntities.has(targetName)) {
        continue;
      }

      const key = `${sourceName}:${targetName}:${type}`;
      if (seen.has(key)) continue;
      seen.add(key);

      relations.push({
        sourceName,
        targetName,
        relationType: type,
      });
    }
  }

  return relations;
}

/**
 * Full extraction pipeline
 */
export function extractFromText(text: string): ExtractionResult {
  const entities = extractEntities(text);
  const entityNames = new Set(entities.map(e => e.name));
  const relations = extractRelations(text, entityNames);

  return { entities, relations };
}

/**
 * Extract from code with language hints
 */
export function extractFromCode(code: string, language?: string): ExtractionResult {
  // For now, use the same extraction logic
  // Could be enhanced with language-specific patterns
  return extractFromText(code);
}
