/**
 * Content Loader
 * Reads and caches .claude/ directory content for dynamic serving
 */

import * as fs from "fs";
import * as path from "path";
import type {
  ContentCategory,
  ContentItem,
  ContentFrontmatter,
  FrameworkStatus,
} from "./types.js";

/** Map category to subdirectory name */
const CATEGORY_DIRS: Record<ContentCategory, string> = {
  concept: "concepts",
  command: "commands",
  agent: "agents",
  skill: "skills",
};

/**
 * Parse YAML frontmatter from a markdown file.
 * Minimal parser handling the bounded patterns in zen templates:
 * key-value pairs, block arrays (- item), one-level nesting.
 * No js-yaml dependency needed.
 */
function parseFrontmatter(raw: string): { frontmatter: ContentFrontmatter; body: string } {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith("---")) {
    return { frontmatter: {}, body: raw };
  }

  const endIndex = trimmed.indexOf("\n---", 3);
  if (endIndex === -1) {
    return { frontmatter: {}, body: raw };
  }

  const yamlBlock = trimmed.slice(4, endIndex); // skip opening "---\n"
  const body = trimmed.slice(endIndex + 4).trimStart(); // skip closing "---\n"
  const frontmatter: Record<string, unknown> = {};

  let currentKey: string | null = null;
  let currentArray: string[] | null = null;

  for (const line of yamlBlock.split("\n")) {
    const trimmedLine = line.trimEnd();

    // Skip empty lines and comments
    if (!trimmedLine || trimmedLine.startsWith("#")) {
      // If we were collecting an array, a blank line ends it
      if (currentKey && currentArray) {
        frontmatter[currentKey] = currentArray;
        currentKey = null;
        currentArray = null;
      }
      continue;
    }

    // Array item (indented "- value")
    const arrayMatch = trimmedLine.match(/^\s+-\s+(.+)/);
    if (arrayMatch && currentKey) {
      if (!currentArray) {
        currentArray = [];
      }
      // Strip inline comments
      const val = arrayMatch[1].replace(/\s+#.*$/, "").trim();
      currentArray.push(val);
      continue;
    }

    // Key-value pair at top level
    const kvMatch = trimmedLine.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)/);
    if (kvMatch) {
      // Flush previous array if any
      if (currentKey && currentArray) {
        frontmatter[currentKey] = currentArray;
        currentArray = null;
      }

      const key = kvMatch[1];
      let value: unknown = kvMatch[2].trim();

      if (value === "" || value === undefined) {
        // Could be start of a block array or nested object
        currentKey = key;
        currentArray = null;
        continue;
      }

      // Strip surrounding quotes
      if (
        typeof value === "string" &&
        ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'")))
      ) {
        value = (value as string).slice(1, -1);
      }

      // Parse booleans and numbers
      if (value === "true") value = true;
      else if (value === "false") value = false;
      else if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) {
        value = parseFloat(value as string);
      }

      // Inline array: [a, b, c]
      if (typeof value === "string" && value.startsWith("[") && value.endsWith("]")) {
        value = value
          .slice(1, -1)
          .split(",")
          .map((s) => s.trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean);
      }

      frontmatter[key] = value;
      currentKey = key;
      currentArray = null;
    }
  }

  // Flush trailing array
  if (currentKey && currentArray) {
    frontmatter[currentKey] = currentArray;
  }

  return { frontmatter: frontmatter as ContentFrontmatter, body };
}

/**
 * ContentLoader reads and caches .claude/ content
 */
export class ContentLoader {
  private contentRoot: string;
  private cache: Map<ContentCategory, ContentItem[]> = new Map();
  private loadedAt: Date | null = null;

  constructor(contentRoot: string) {
    this.contentRoot = contentRoot;
  }

  /**
   * Get a single content item by category and name
   */
  get(category: ContentCategory, name: string): ContentItem | null {
    this.ensureLoaded();
    const items = this.cache.get(category) || [];
    const normalized = name.toLowerCase().replace(/\s+/g, "-");
    return items.find((item) => item.name.toLowerCase() === normalized) || null;
  }

  /**
   * Get all content items in a category
   */
  getAll(category: ContentCategory): ContentItem[] {
    this.ensureLoaded();
    return this.cache.get(category) || [];
  }

  /**
   * Search content by query string across name, frontmatter, and body
   */
  search(query: string, category?: ContentCategory): ContentItem[] {
    this.ensureLoaded();
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const categories = category ? [category] : (Object.keys(CATEGORY_DIRS) as ContentCategory[]);

    const results: ContentItem[] = [];
    for (const cat of categories) {
      const items = this.cache.get(cat) || [];
      for (const item of items) {
        const searchable = [
          item.name,
          item.frontmatter.name || "",
          item.frontmatter.description || "",
          item.frontmatter.purpose || "",
          item.body.slice(0, 500), // Search first 500 chars of body
        ]
          .join(" ")
          .toLowerCase();

        if (terms.every((term) => searchable.includes(term))) {
          results.push(item);
        }
      }
    }
    return results;
  }

  /**
   * Get skills associated with an agent (by frontmatter.applies_to or agent skills list)
   */
  getSkillsForAgent(agentName: string): ContentItem[] {
    this.ensureLoaded();

    // First check the agent's skills list in its frontmatter
    const agent = this.get("agent", agentName);
    const agentSkillNames = agent?.frontmatter.skills || [];

    const allSkills = this.cache.get("skill") || [];
    const matched: ContentItem[] = [];

    for (const skill of allSkills) {
      // Match by agent's skill list
      if (
        Array.isArray(agentSkillNames) &&
        agentSkillNames.some(
          (s) => typeof s === "string" && skill.name.toLowerCase().includes(s.toLowerCase()),
        )
      ) {
        matched.push(skill);
        continue;
      }

      // Match by skill's applies_to
      const appliesTo = skill.frontmatter.applies_to;
      if (Array.isArray(appliesTo)) {
        const normalizedAgent = agentName.toLowerCase();
        if (appliesTo.some((a) => a.toLowerCase().includes(normalizedAgent))) {
          matched.push(skill);
        }
      }
    }
    return matched;
  }

  /**
   * Get framework status summary
   */
  getStatus(): FrameworkStatus {
    this.ensureLoaded();
    const counts = {} as Record<ContentCategory, number>;
    const items = {} as Record<ContentCategory, string[]>;

    for (const category of Object.keys(CATEGORY_DIRS) as ContentCategory[]) {
      const categoryItems = this.cache.get(category) || [];
      counts[category] = categoryItems.length;
      items[category] = categoryItems.map((item) => item.name);
    }

    return {
      contentRoot: this.contentRoot,
      loaded: this.loadedAt !== null,
      loadedAt: this.loadedAt?.toISOString() || null,
      counts,
      items,
    };
  }

  /**
   * Force reload all content from disk
   */
  reload(): void {
    this.cache.clear();
    this.loadedAt = null;
    this.ensureLoaded();
  }

  /**
   * Lazy initialization: load content on first access
   */
  private ensureLoaded(): void {
    if (this.loadedAt) return;

    for (const [category, dirName] of Object.entries(CATEGORY_DIRS) as Array<
      [ContentCategory, string]
    >) {
      const dirPath = path.join(this.contentRoot, dirName);
      const items: ContentItem[] = [];

      if (fs.existsSync(dirPath)) {
        const files = fs.readdirSync(dirPath).filter((f) => f.endsWith(".md") || f.endsWith(".md.template"));
        for (const file of files) {
          const filePath = path.join(dirPath, file);
          try {
            const raw = fs.readFileSync(filePath, "utf-8");
            const { frontmatter, body } = parseFrontmatter(raw);
            items.push({
              name: file.replace(/\.md(\.template)?$/, ""),
              category,
              frontmatter,
              body,
              raw,
              filePath,
            });
          } catch {
            // Skip files that can't be read
          }
        }
      }

      this.cache.set(category, items);
    }

    this.loadedAt = new Date();
  }
}

/**
 * Factory for lazy initialization (matches project patterns)
 */
import { createResettableLazyLoader } from "../../utils/lazy.js";
import { config } from "../../core/config.js";

const contentLoaderInstance = createResettableLazyLoader(
  () => new ContentLoader(config().frameworkContentRoot),
);
export const getContentLoader = contentLoaderInstance.get;
export const resetContentLoader = contentLoaderInstance.reset;
