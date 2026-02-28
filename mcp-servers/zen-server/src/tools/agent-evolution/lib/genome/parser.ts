/**
 * Parser: decomposes agent markdown templates into AgentGenome structures.
 *
 * Handles:
 * - YAML frontmatter extraction (between --- delimiters)
 * - Structured frontmatter field parsing with type coercion
 * - Markdown heading-based section splitting
 * - Canonical section identification via heading pattern matching
 * - Skill entry parsing with inline comment preservation
 *
 * Design constraints:
 * - Zero external dependencies (no YAML library — frontmatter is simple enough)
 * - Lossless round-trip: parse(assemble(genome)) ≡ genome
 * - Fails fast on malformed input with descriptive errors
 */

import {
  type AgentFrontmatter,
  type AgentGenome,
  type AgentHooks,
  type AgentType,
  type CanonicalSectionId,
  type ExecutionType,
  type GenomeSection,
  type HookEntry,
  type MemoryScope,
  type ModelTierOrInherit,
  type PermissionMode,
  type SkillEntry,
  HEADING_TO_SECTION,
} from './schema.js';

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class ParseError extends Error {
  constructor(
    message: string,
    public readonly line?: number,
  ) {
    super(line !== undefined ? `Line ${line}: ${message}` : message);
    this.name = 'ParseError';
  }
}

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

/** Extracts raw frontmatter string and body from markdown content. */
function splitFrontmatter(content: string): { raw: string; body: string } {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith('---')) {
    throw new ParseError('Missing frontmatter: file must start with ---');
  }

  const closingIndex = trimmed.indexOf('\n---', 3);
  if (closingIndex === -1) {
    throw new ParseError('Unterminated frontmatter: missing closing ---');
  }

  const raw = trimmed.slice(4, closingIndex).trim();
  const body = trimmed.slice(closingIndex + 4).trimStart();
  return { raw, body };
}

/**
 * Parses a simple YAML value string into a typed JS value.
 * Handles: strings (quoted/unquoted), numbers, booleans.
 */
function parseYamlValue(value: string): string | number | boolean {
  const trimmed = value.trim();

  // Quoted strings
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }

  // Booleans
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;

  // Numbers
  const num = Number(trimmed);
  if (trimmed !== '' && !Number.isNaN(num)) return num;

  return trimmed;
}

/** Parses skill entries from frontmatter lines, preserving inline comments. */
function parseSkills(lines: readonly string[], startIndex: number): { skills: SkillEntry[]; endIndex: number } {
  const skills: SkillEntry[] = [];
  let i = startIndex;

  while (i < lines.length) {
    const line = lines[i];

    // End of skills block: non-indented line that isn't blank or a comment
    if (line.length > 0 && !line.startsWith(' ') && !line.startsWith('\t') && !line.startsWith('#')) {
      break;
    }

    const trimmed = line.trim();

    // Skip blank lines and standalone comments (like "# P0 - Critical")
    if (trimmed === '' || (trimmed.startsWith('#') && !trimmed.startsWith('- '))) {
      i++;
      continue;
    }

    // Match skill entries: "  - skill-name  # comment"
    const skillMatch = trimmed.match(/^-\s+(\S+)\s*(?:#\s*(.*))?$/);
    if (skillMatch) {
      skills.push({
        name: skillMatch[1],
        comment: skillMatch[2]?.trim() ?? '',
      });
    }

    i++;
  }

  return { skills, endIndex: i };
}

/** Parses hook entries from frontmatter lines. */
function parseHooks(lines: readonly string[], startIndex: number): { hooks: AgentHooks; endIndex: number } {
  const hooks: Record<string, HookEntry[]> = {};
  let i = startIndex;
  let currentEvent: string | null = null;

  while (i < lines.length) {
    const line = lines[i];

    // End of hooks block: non-indented, non-blank line
    if (line.length > 0 && !line.startsWith(' ') && !line.startsWith('\t')) {
      break;
    }

    const trimmed = line.trim();
    if (trimmed === '') { i++; continue; }

    // Event name (e.g., "Stop:")
    const eventMatch = trimmed.match(/^(\w+):$/);
    if (eventMatch && !trimmed.startsWith('-')) {
      currentEvent = eventMatch[1];
      hooks[currentEvent] = hooks[currentEvent] ?? [];
      i++;
      continue;
    }

    // Hook type (e.g., "- type: command")
    if (trimmed.startsWith('- type:') && currentEvent) {
      const typeValue = trimmed.slice('- type:'.length).trim();
      // Next line should be command
      const nextLine = i + 1 < lines.length ? lines[i + 1].trim() : '';
      const cmdMatch = nextLine.match(/^command:\s*"(.+)"$/);
      if (cmdMatch) {
        hooks[currentEvent].push({ type: typeValue, command: cmdMatch[1] });
        i += 2;
        continue;
      }
    }

    i++;
  }

  return { hooks, endIndex: i };
}

/**
 * Parses structured frontmatter from raw YAML text.
 *
 * Uses line-by-line parsing rather than a YAML library to:
 * 1. Avoid external dependencies
 * 2. Handle the specific frontmatter format precisely
 * 3. Preserve inline comments on skill entries
 */
/**
 * Parses a simple YAML list (lines starting with "- ") into string array.
 * Used for disallowedTools, mcpServers, and inline tools arrays.
 */
function parseSimpleList(lines: readonly string[], startIndex: number): { items: string[]; endIndex: number } {
  const items: string[] = [];
  let i = startIndex;

  while (i < lines.length) {
    const line = lines[i];
    if (line.length > 0 && !line.startsWith(' ') && !line.startsWith('\t')) break;

    const trimmed = line.trim();
    if (trimmed === '') { i++; continue; }

    const itemMatch = trimmed.match(/^-\s+(.+)$/);
    if (itemMatch) {
      items.push(parseYamlValue(itemMatch[1]).toString());
    } else {
      break;
    }
    i++;
  }

  return { items, endIndex: i };
}

function parseFrontmatter(raw: string): AgentFrontmatter {
  const lines = raw.split('\n');
  const fields: Record<string, string | number | boolean> = {};
  let hooks: AgentHooks = {};
  let skills: SkillEntry[] = [];
  let disallowedTools: string[] = [];
  let mcpServers: string[] = [];
  let toolsList: string[] | null = null;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip blank lines and standalone comments
    if (trimmed === '' || (trimmed.startsWith('#') && !trimmed.includes(':'))) {
      i++;
      continue;
    }

    // Hooks block
    if (trimmed === 'hooks:') {
      const result = parseHooks(lines, i + 1);
      hooks = result.hooks;
      i = result.endIndex;
      continue;
    }

    // Skills block
    if (trimmed === 'skills:') {
      const result = parseSkills(lines, i + 1);
      skills = result.skills;
      i = result.endIndex;
      continue;
    }

    // disallowedTools list block
    if (trimmed === 'disallowedTools:') {
      const result = parseSimpleList(lines, i + 1);
      disallowedTools = result.items;
      i = result.endIndex;
      continue;
    }

    // mcpServers list block
    if (trimmed === 'mcpServers:') {
      const result = parseSimpleList(lines, i + 1);
      mcpServers = result.items;
      i = result.endIndex;
      continue;
    }

    // tools as list block (alternative to scalar)
    if (trimmed === 'tools:') {
      const nextLine = i + 1 < lines.length ? lines[i + 1] : '';
      if (nextLine.trimStart().startsWith('-')) {
        const result = parseSimpleList(lines, i + 1);
        toolsList = result.items;
        i = result.endIndex;
        continue;
      }
    }

    // Key-value pair at root level
    const kvMatch = trimmed.match(/^([\w_]+):\s*(.*)$/);
    if (kvMatch && !line.startsWith(' ') && !line.startsWith('\t')) {
      fields[kvMatch[1]] = parseYamlValue(kvMatch[2]);
    }

    i++;
  }

  // Resolve tools: list form takes precedence over scalar
  const toolsValue: string | readonly string[] = toolsList ?? String(fields['tools'] ?? '*');

  return {
    // Claude Code native: required
    name: String(fields['name'] ?? ''),
    description: String(fields['description'] ?? ''),

    // Claude Code native: optional
    model: String(fields['model'] ?? 'sonnet') as ModelTierOrInherit,
    tools: toolsValue,
    disallowedTools,
    permissionMode: fields['permissionMode'] !== undefined
      ? String(fields['permissionMode']) as PermissionMode : undefined,
    maxTurns: fields['maxTurns'] !== undefined
      ? Number(fields['maxTurns']) : undefined,
    mcpServers,
    memory: fields['memory'] !== undefined
      ? String(fields['memory']) as MemoryScope : undefined,
    background: fields['background'] !== undefined
      ? Boolean(fields['background']) : undefined,
    isolation: fields['isolation'] === 'worktree' ? 'worktree' : undefined,
    color: String(fields['color'] ?? ''),

    // Claude Code native: component configuration
    hooks,
    skills,

    // Zen-specific metadata
    type: String(fields['type'] ?? 'workflow') as AgentType,
    execution: String(fields['execution'] ?? 'task-tool') as ExecutionType,
    costPerAction: Number(fields['cost_per_action'] ?? 0),
    optimizationLevel: String(fields['optimization_level'] ?? 'baseline'),
    expectedContextTokens: Number(fields['expected_context_tokens'] ?? 0),
    expectedDurationSeconds: Number(fields['expected_duration_seconds'] ?? 0),
    baselineContextTokens: fields['baseline_context_tokens'] !== undefined
      ? Number(fields['baseline_context_tokens']) : undefined,
    contextReduction: fields['context_reduction'] !== undefined
      ? String(fields['context_reduction']) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Section parsing
// ---------------------------------------------------------------------------

/** Regex matching markdown headings: captures level (# count), emoji+text. */
const HEADING_RE = /^(#{1,6})\s+(.+)$/;

/**
 * Normalizes heading text for canonical section matching.
 * Strips emoji, extra whitespace, and trailing punctuation.
 */
function normalizeHeading(text: string): string {
  return text
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '')
    .replace(/[:\-–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Identifies the canonical section ID for a heading, if any.
 * Checks exact match first, then prefix match for headings with subtitles
 * (e.g., "Core Principle: Polymorphic Independence" → core_principle).
 */
function classifyHeading(heading: string): CanonicalSectionId | 'custom' {
  const normalized = normalizeHeading(heading);

  // Exact match
  const exact = HEADING_TO_SECTION.get(normalized);
  if (exact) return exact;

  // Prefix match: try progressively shorter prefixes
  for (const [pattern, id] of HEADING_TO_SECTION) {
    if (normalized.startsWith(pattern)) return id;
  }

  return 'custom';
}

/**
 * Splits markdown body into sections at heading boundaries.
 *
 * Subsection nesting: headings deeper than the current section level
 * are included as content of the parent section (e.g., ### create()
 * under ## Actions becomes part of the actions section content).
 * A new top-level section is only started when a heading at the same
 * or shallower level is encountered.
 */
function splitSections(body: string): GenomeSection[] {
  const lines = body.split('\n');
  const sections: GenomeSection[] = [];
  let currentHeading: string | null = null;
  let currentLevel = 0;
  let currentId: CanonicalSectionId | 'custom' = 'custom';
  const contentLines: string[] = [];

  function flushSection(): void {
    if (currentHeading !== null) {
      sections.push({
        id: currentId,
        heading: currentHeading,
        level: currentLevel,
        content: contentLines.join('\n').trim(),
      });
    }
    contentLines.length = 0;
  }

  for (const line of lines) {
    const match = HEADING_RE.exec(line);
    if (match) {
      const level = match[1].length;
      const headingText = match[2];

      // Subsection: deeper than current → include as content of parent
      if (currentHeading !== null && level > currentLevel) {
        contentLines.push(line);
        continue;
      }

      // Same or shallower level → start a new section
      flushSection();
      currentHeading = headingText;
      currentLevel = level;
      currentId = classifyHeading(headingText);
    } else {
      contentLines.push(line);
    }
  }

  // Flush final section
  flushSection();

  return sections;
}

// ---------------------------------------------------------------------------
// Title extraction
// ---------------------------------------------------------------------------

/**
 * Extracts the title line (e.g., "# 📋 Story Concept") from the body.
 * Returns the title and the remaining body after the title.
 */
function extractTitle(body: string): { title: string; rest: string } {
  const lines = body.split('\n');
  let titleLine = '';
  let restStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === '' || trimmed === '---') continue;

    const match = HEADING_RE.exec(trimmed);
    if (match && match[1].length === 1) {
      titleLine = trimmed;
      restStart = i + 1;
      break;
    }

    // If first non-blank line isn't an h1, there's no title
    break;
  }

  if (!titleLine) {
    return { title: '', rest: body };
  }

  return {
    title: titleLine,
    rest: lines.slice(restStart).join('\n'),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parses an agent markdown template into an AgentGenome.
 *
 * @param content - Full markdown file content (frontmatter + body)
 * @returns Parsed AgentGenome
 * @throws ParseError on malformed input
 */
export function parseAgentTemplate(content: string): AgentGenome {
  const { raw, body } = splitFrontmatter(content);
  const frontmatter = parseFrontmatter(raw);
  const { title, rest } = extractTitle(body);
  const sections = splitSections(rest);

  return {
    agentName: frontmatter.name,
    frontmatter,
    rawFrontmatter: raw,
    title,
    sections,
  };
}

/**
 * Parses an agent markdown file from disk.
 *
 * @param filePath - Absolute path to the .md template
 * @returns Parsed AgentGenome
 * @throws ParseError on malformed input or read failure
 */
export async function parseAgentFile(filePath: string): Promise<AgentGenome> {
  const { readFile } = await import('node:fs/promises');
  const content = await readFile(filePath, 'utf-8');
  return parseAgentTemplate(content);
}
