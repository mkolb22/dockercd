/**
 * Assembler: reconstructs agent markdown templates from AgentGenome structures.
 *
 * Guarantees lossless round-trip: for any valid agent template,
 * assemble(parse(template)) produces semantically equivalent output.
 *
 * Uses rawFrontmatter for exact frontmatter reproduction. Sections are
 * reassembled with their original heading text and level.
 */

import type { AgentGenome, GenomeSection } from './schema.js';
import { serializeFrontmatter } from '../mutation/serializer.js';

// ---------------------------------------------------------------------------
// Section rendering
// ---------------------------------------------------------------------------

/** Renders a heading prefix for the given level. */
function headingPrefix(level: number): string {
  return '#'.repeat(level);
}

/** Renders a single section back to markdown. */
function renderSection(section: GenomeSection): string {
  const heading = `${headingPrefix(section.level)} ${section.heading}`;
  if (section.content.length === 0) {
    return heading;
  }
  return `${heading}\n\n${section.content}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Assembles an AgentGenome back into a complete markdown template.
 *
 * @param genome - The genome to assemble
 * @returns Complete markdown string ready for file output
 */
export function assembleGenome(genome: AgentGenome): string {
  const parts: string[] = [];

  // Frontmatter — use rawFrontmatter for lossless round-trip, fall back to
  // serializer when rawFrontmatter is empty (e.g., genome constructed without it)
  parts.push('---');
  const fm = genome.rawFrontmatter?.trim()
    ? genome.rawFrontmatter
    : serializeFrontmatter(genome.frontmatter);
  parts.push(fm);
  parts.push('---');

  // Title
  if (genome.title) {
    parts.push('');
    parts.push(genome.title);
  }

  // Sections
  for (const section of genome.sections) {
    parts.push('');
    parts.push(renderSection(section));
  }

  // Trailing newline
  return parts.join('\n') + '\n';
}

/**
 * Assembles a genome and writes it to disk.
 *
 * @param genome - The genome to write
 * @param filePath - Absolute output path
 */
export async function writeGenomeFile(genome: AgentGenome, filePath: string): Promise<void> {
  const { writeFile } = await import('node:fs/promises');
  const content = assembleGenome(genome);
  await writeFile(filePath, content, 'utf-8');
}
