/**
 * Code Chunker
 * Splits source files into semantic chunks for embedding
 */

import * as path from "path";
import type { CodeChunk, SupportedLanguage } from "../../core/types.js";
import { LANGUAGES, getAllExtensions, detectLanguage } from "../../utils/languages.js";
import { readFileSafe, getFileHash, findFiles } from "../../utils/project.js";

interface ChunkOptions {
  paths?: string[];
  languages?: SupportedLanguage[];
  incremental?: boolean;
  previousHashes?: Record<string, string>;
}

// Config file extensions handled separately
const CONFIG_EXTENSIONS = [".json", ".yaml", ".yml", ".toml"];

export class CodeChunker {
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  async chunkProject(options: ChunkOptions = {}): Promise<CodeChunk[]> {
    const chunks: CodeChunk[] = [];

    // Get extensions for requested languages plus config files
    const extensions = options.languages
      ? options.languages.flatMap((l) => LANGUAGES[l]?.extensions || [])
      : getAllExtensions();
    extensions.push(...CONFIG_EXTENSIONS);

    // Build glob patterns
    const patterns = extensions.map((ext) => `**/*${ext}`);
    const searchPaths =
      options.paths && options.paths.length > 0
        ? options.paths
        : [this.projectRoot];

    // Find files
    let files: string[] = [];
    for (const searchPath of searchPaths) {
      const fullPath = path.isAbsolute(searchPath)
        ? searchPath
        : path.join(this.projectRoot, searchPath);

      const found = await findFiles(patterns, fullPath, [
        "**/node_modules/**",
        "**/dist/**",
        "**/build/**",
        "**/.git/**",
        "**/vendor/**",
        "**/__pycache__/**",
      ]);

      files.push(...found);
    }

    // Filter changed files if incremental
    if (options.incremental && options.previousHashes) {
      const changedFiles: string[] = [];
      for (const file of files) {
        const hash = await getFileHash(file);
        const relPath = path.relative(this.projectRoot, file);
        if (options.previousHashes[relPath] !== hash) {
          changedFiles.push(file);
        }
      }
      files = changedFiles;
    }

    // Chunk each file
    for (const file of files) {
      try {
        const fileChunks = await this.chunkFile(file);
        chunks.push(...fileChunks);
      } catch (error) {
        console.error(`Error chunking ${file}:`, error);
      }
    }

    return chunks;
  }

  async chunkFile(filePath: string): Promise<CodeChunk[]> {
    const content = await readFileSafe(filePath);
    if (!content) return [];

    const ext = path.extname(filePath).toLowerCase();
    const relativePath = path.relative(this.projectRoot, filePath);
    const language = detectLanguage(filePath) || "unknown";

    // Config files - keep as single chunk
    if (CONFIG_EXTENSIONS.includes(ext)) {
      return [
        {
          id: `${relativePath}:0`,
          content,
          metadata: {
            file: relativePath,
            language: "config",
            kind: "config",
            name: path.basename(filePath),
            startLine: 1,
            endLine: content.split("\n").length,
          },
          hash: this.hashContent(content),
        },
      ];
    }

    // Code files - chunk by functions/classes
    return this.chunkCodeFile(content, relativePath, language);
  }

  private chunkCodeFile(
    content: string,
    relativePath: string,
    language: string
  ): CodeChunk[] {
    const lines = content.split("\n");
    const chunks: CodeChunk[] = [];
    const patterns = this.getPatterns(language);

    let currentChunk: {
      startLine: number;
      kind: CodeChunk["metadata"]["kind"];
      name: string;
      content: string[];
      parentClass?: string;
    } | null = null;

    let braceDepth = 0;
    let inClass: string | null = null;
    let classStartBrace = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Track brace depth
      const openBraces = (line.match(/{/g) || []).length;
      const closeBraces = (line.match(/}/g) || []).length;

      // Check for class definition
      const classMatch = line.match(patterns.class);
      if (classMatch) {
        inClass = classMatch[1];
        classStartBrace = braceDepth + openBraces;

        if (currentChunk) {
          chunks.push(this.createChunk(currentChunk, relativePath, language));
        }
        currentChunk = {
          startLine: lineNum,
          kind: "class",
          name: inClass,
          content: [line],
        };
      }
      // Check for function/method definition
      else if (patterns.function.test(line)) {
        const funcMatch = line.match(patterns.function);
        if (funcMatch) {
          if (currentChunk && currentChunk.kind !== "class") {
            chunks.push(this.createChunk(currentChunk, relativePath, language));
          }

          currentChunk = {
            startLine: lineNum,
            kind: inClass ? "method" : "function",
            name: funcMatch[1],
            content: [line],
            parentClass: inClass || undefined,
          };
        }
      }
      // Continue current chunk
      else if (currentChunk) {
        currentChunk.content.push(line);
      }

      // Update brace depth
      braceDepth += openBraces - closeBraces;

      // Check if we've closed the class
      if (inClass && braceDepth < classStartBrace) {
        if (currentChunk) {
          chunks.push(this.createChunk(currentChunk, relativePath, language));
          currentChunk = null;
        }
        inClass = null;
      }
    }

    // Save last chunk
    if (currentChunk) {
      chunks.push(this.createChunk(currentChunk, relativePath, language));
    }

    // If no chunks found, treat entire file as one chunk
    if (chunks.length === 0) {
      chunks.push({
        id: `${relativePath}:0`,
        content,
        metadata: {
          file: relativePath,
          language,
          kind: "module",
          name: path.basename(relativePath),
          startLine: 1,
          endLine: lines.length,
        },
        hash: this.hashContent(content),
      });
    }

    return chunks;
  }

  private createChunk(
    chunk: {
      startLine: number;
      kind: CodeChunk["metadata"]["kind"];
      name: string;
      content: string[];
      parentClass?: string;
    },
    relativePath: string,
    language: string
  ): CodeChunk {
    const content = chunk.content.join("\n");
    return {
      id: `${relativePath}:${chunk.startLine}`,
      content,
      metadata: {
        file: relativePath,
        language,
        kind: chunk.kind,
        name: chunk.name,
        startLine: chunk.startLine,
        endLine: chunk.startLine + chunk.content.length - 1,
        parentClass: chunk.parentClass,
      },
      hash: this.hashContent(content),
    };
  }

  private getPatterns(language: string): { function: RegExp; class: RegExp } {
    switch (language) {
      case "typescript":
      case "javascript":
        return {
          function: /(?:function|const|let|var)\s+(\w+)\s*(?:=\s*(?:async\s*)?\(|[(<])/,
          class: /class\s+(\w+)/,
        };
      case "python":
        return {
          function: /def\s+(\w+)\s*\(/,
          class: /class\s+(\w+)/,
        };
      case "go":
        return {
          function: /func\s+(?:\([^)]+\)\s+)?(\w+)\s*\(/,
          class: /type\s+(\w+)\s+struct/,
        };
      case "rust":
        return {
          function: /(?:pub\s+)?fn\s+(\w+)/,
          class: /(?:pub\s+)?struct\s+(\w+)/,
        };
      case "java":
        return {
          function: /(?:public|private|protected)?\s*(?:static\s+)?(?:\w+\s+)+(\w+)\s*\(/,
          class: /class\s+(\w+)/,
        };
      case "swift":
        return {
          function: /(?:(?:private|public|internal|open|fileprivate|override)\s+)*func\s+(\w+)\s*[(<]/,
          class: /(?:class|struct|enum|protocol)\s+(\w+)/,
        };
      default:
        return {
          function: /function\s+(\w+)/,
          class: /class\s+(\w+)/,
        };
    }
  }

  private hashContent(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }
}
