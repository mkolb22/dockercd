/**
 * AST Indexer
 * Parses source code using tree-sitter and extracts symbols, references, and calls
 */

import Parser from "web-tree-sitter";
import * as path from "path";
import { fileURLToPath } from "url";
import { IndexStore } from "./store.js";
import type { Symbol, Reference, CallRelation, SupportedLanguage } from "../../core/types.js";
import { LANGUAGES, detectLanguage, getExtensionsForLanguages } from "../../utils/languages.js";
import { readFileSafe, getFileHash, findFiles } from "../../utils/project.js";

/**
 * Tree-sitter query patterns for each language
 */
const LANGUAGE_QUERIES: Record<
  string,
  {
    functions: string;
    classes: string;
    methods: string;
    variables: string;
    constants?: string;
    imports: string;
    calls: string;
  }
> = {
  typescript: {
    functions: "(function_declaration name: (identifier) @name) @def",
    classes: "(class_declaration name: (type_identifier) @name) @def",
    methods: "(method_definition name: (property_identifier) @name) @def",
    variables: "(variable_declarator name: (identifier) @name) @def",
    imports: "(import_statement) @import",
    calls: "(call_expression function: (identifier) @callee) @call",
  },
  tsx: {
    functions: "(function_declaration name: (identifier) @name) @def",
    classes: "(class_declaration name: (type_identifier) @name) @def",
    methods: "(method_definition name: (property_identifier) @name) @def",
    variables: "(variable_declarator name: (identifier) @name) @def",
    imports: "(import_statement) @import",
    calls: "(call_expression function: (identifier) @callee) @call",
  },
  javascript: {
    functions: "(function_declaration name: (identifier) @name) @def",
    classes: "(class_declaration name: (identifier) @name) @def",
    methods: "(method_definition name: (property_identifier) @name) @def",
    variables: "(variable_declarator name: (identifier) @name) @def",
    imports: "(import_statement) @import",
    calls: "(call_expression function: (identifier) @callee) @call",
  },
  python: {
    functions: "(function_definition name: (identifier) @name) @def",
    classes: "(class_definition name: (identifier) @name) @def",
    methods: "(function_definition name: (identifier) @name) @def",
    variables: "(assignment left: (identifier) @name) @def",
    imports: "(import_statement) @import",
    calls: "(call function: (identifier) @callee) @call",
  },
  go: {
    functions: "(function_declaration name: (identifier) @name) @def",
    classes: "(type_declaration (type_spec name: (type_identifier) @name)) @def",
    methods: "(method_declaration name: (field_identifier) @name) @def",
    variables: "(var_declaration (var_spec name: (identifier) @name)) @def",
    constants: "(const_declaration (const_spec name: (identifier) @name)) @def",
    imports: "(import_declaration) @import",
    calls: "(call_expression function: [(identifier) (selector_expression)] @callee) @call",
  },
  rust: {
    functions: "(function_item name: (identifier) @name) @def",
    classes: "(struct_item name: (type_identifier) @name) @def",
    methods: "(impl_item (function_item name: (identifier) @name)) @def",
    variables: "(let_declaration pattern: (identifier) @name) @def",
    imports: "(use_declaration) @import",
    calls: "(call_expression function: (identifier) @callee) @call",
  },
  java: {
    functions: "(method_declaration name: (identifier) @name) @def",
    classes: "(class_declaration name: (identifier) @name) @def",
    methods: "(method_declaration name: (identifier) @name) @def",
    variables: "(variable_declarator name: (identifier) @name) @def",
    imports: "(import_declaration) @import",
    calls: "(method_invocation name: (identifier) @callee) @call",
  },
  c: {
    functions:
      "(function_definition declarator: (function_declarator declarator: (identifier) @name)) @def",
    classes: "(struct_specifier name: (type_identifier) @name) @def",
    methods: "",
    variables: "(declaration declarator: (identifier) @name) @def",
    imports: "(preproc_include) @import",
    calls: "(call_expression function: (identifier) @callee) @call",
  },
  swift: {
    functions: "(function_declaration name: (simple_identifier) @name) @def",
    classes: "(class_declaration name: (type_identifier) @name) @def",
    methods: "(function_declaration name: (simple_identifier) @name) @def",
    variables: "(property_declaration (pattern) @name) @def",
    imports: "(import_declaration) @import",
    calls: "(call_expression) @call",
  },
};

/**
 * Map from file extension to tree-sitter language name
 */
const EXT_TO_TREESITTER: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".c": "c",
  ".h": "c",
  ".cpp": "c",
  ".hpp": "c",
  ".swift": "swift",
};

export interface IndexOptions {
  paths?: string[];
  languages?: SupportedLanguage[];
  incremental?: boolean;
}

export interface IndexResult {
  filesIndexed: number;
  symbolsFound: number;
  referencesFound: number;
  callsFound: number;
  duration: number;
  errors: string[];
}

export class ASTIndexer {
  private projectRoot: string;
  private store: IndexStore;
  private parser: Parser | null = null;
  private languages: Map<string, Parser.Language> = new Map();
  private initialized = false;

  constructor(projectRoot: string, store: IndexStore) {
    this.projectRoot = projectRoot;
    this.store = store;
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return;

    await Parser.init();
    this.parser = new Parser();
    this.initialized = true;
  }

  private async loadLanguage(langName: string): Promise<Parser.Language | null> {
    if (this.languages.has(langName)) {
      return this.languages.get(langName)!;
    }

    // Get wasm name from our language config if available
    const supportedLang = Object.keys(LANGUAGES).find(
      (l) => l === langName || (langName === "tsx" && l === "typescript")
    ) as SupportedLanguage | undefined;

    const wasmName = supportedLang
      ? LANGUAGES[supportedLang]?.wasmName
      : `tree-sitter-${langName}`;

    if (!wasmName) return null;

    try {
      // Resolve relative to the server's own install location (not cwd or projectRoot)
      const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
      const wasmPaths = [
        `${serverRoot}/node_modules/tree-sitter-wasms/out/${wasmName}.wasm`,
        `${serverRoot}/node_modules/${wasmName}/${wasmName}.wasm`,
        `${this.projectRoot}/node_modules/tree-sitter-wasms/out/${wasmName}.wasm`,
        `${this.projectRoot}/node_modules/${wasmName}/${wasmName}.wasm`,
      ];

      for (const wasmPath of wasmPaths) {
        try {
          const resolvedPath = path.resolve(wasmPath);
          const language = await Parser.Language.load(resolvedPath);
          this.languages.set(langName, language);
          return language;
        } catch {
          // Try next path
        }
      }

      // CDN fallback
      const cdnUrl = `https://cdn.jsdelivr.net/npm/${wasmName}@latest/${wasmName}.wasm`;
      const language = await Parser.Language.load(cdnUrl);
      this.languages.set(langName, language);
      return language;
    } catch (error) {
      console.error(`Failed to load language ${langName}:`, error);
      return null;
    }
  }

  /**
   * Detect which languages are actually present in the project
   * by scanning for source files, filtering to languages with WASM support.
   */
  private async detectProjectLanguages(): Promise<SupportedLanguage[]> {
    const allExts = Object.values(LANGUAGES).flatMap((c) => c.extensions);
    const patterns = allExts.map((ext) => `**/*${ext}`);
    const files = await findFiles(patterns, this.projectRoot);

    const detected = new Set<SupportedLanguage>();
    for (const file of files.slice(0, 100)) {
      const lang = detectLanguage(file);
      if (lang && LANGUAGES[lang]?.wasmName) {
        detected.add(lang);
      }
    }
    return Array.from(detected);
  }

  async indexProject(options: IndexOptions = {}): Promise<IndexResult> {
    await this.initialize();

    const startTime = Date.now();
    const errors: string[] = [];
    let filesIndexed = 0;
    let symbolsFound = 0;
    let referencesFound = 0;
    let callsFound = 0;

    // Auto-detect languages if none specified, filtering to those with WASM support
    const effectiveLanguages = options.languages?.length
      ? options.languages
      : await this.detectProjectLanguages();

    const extensions = effectiveLanguages.length
      ? getExtensionsForLanguages(effectiveLanguages)
      : Object.values(LANGUAGES).flatMap((c) => c.extensions);

    const patterns = extensions.map((ext) => `**/*${ext}`);
    const searchPaths = options.paths || [this.projectRoot];

    // Find all files
    let files: string[] = [];
    for (const searchPath of searchPaths) {
      const fullPath = path.isAbsolute(searchPath)
        ? searchPath
        : path.join(this.projectRoot, searchPath);

      const found = await findFiles(patterns, fullPath);
      files.push(...found);
    }

    // Incremental: only index changed files
    // Non-incremental: clear old index first to remove stale entries
    if (options.incremental) {
      const metadata = this.store.getMetadata();
      files = await this.getChangedFiles(files, metadata.fileHashes || {});
    } else {
      this.store.clearIndex();
    }

    // Index each file
    for (const file of files) {
      try {
        const result = await this.indexFile(file);
        filesIndexed++;
        symbolsFound += result.symbols;
        referencesFound += result.references;
        callsFound += result.calls;
      } catch (error) {
        errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Update metadata
    const fileHashes: Record<string, string> = {};
    for (const file of files) {
      fileHashes[file] = await getFileHash(file);
    }
    this.store.updateMetadata({
      lastUpdate: new Date().toISOString(),
      fileHashes,
      totalFiles: filesIndexed,
      totalSymbols: symbolsFound,
    });

    return {
      filesIndexed,
      symbolsFound,
      referencesFound,
      callsFound,
      duration: Date.now() - startTime,
      errors,
    };
  }

  private async indexFile(filePath: string): Promise<{
    symbols: number;
    references: number;
    calls: number;
  }> {
    if (!this.parser) throw new Error("Parser not initialized");

    const content = await readFileSafe(filePath);
    if (!content) throw new Error(`Could not read file: ${filePath}`);

    const ext = path.extname(filePath).toLowerCase();
    const langName = EXT_TO_TREESITTER[ext];

    if (!langName) {
      throw new Error(`Unsupported file extension: ${ext}`);
    }

    const language = await this.loadLanguage(langName);
    if (!language) {
      throw new Error(`Failed to load language: ${langName}`);
    }

    this.parser.setLanguage(language);
    const tree = this.parser.parse(content);

    const relativePath = path.relative(this.projectRoot, filePath);
    const symbols: Symbol[] = [];
    const references: Reference[] = [];
    const calls: CallRelation[] = [];

    // Extract symbols
    const extractSymbols = (
      node: Parser.SyntaxNode,
      kind: string,
      parentSymbol?: string
    ): Symbol | null => {
      const nameNode = node.childForFieldName("name");
      if (nameNode) {
        const symbol: Symbol = {
          id: `${relativePath}:${nameNode.text}:${node.startPosition.row}`,
          name: nameNode.text,
          kind,
          file: relativePath,
          line: node.startPosition.row + 1,
          column: node.startPosition.column,
          endLine: node.endPosition.row + 1,
          endColumn: node.endPosition.column,
          parent: parentSymbol,
        };

        if (kind === "function" || kind === "method") {
          symbol.signature = this.extractSignature(node);
        }

        symbols.push(symbol);
        return symbol;
      }
      return null;
    };

    // Walk tree
    const walk = (node: Parser.SyntaxNode, parent?: string) => {
      if (node.type === "function_declaration" || node.type === "function_definition") {
        const sym = extractSymbols(node, "function", parent);
        if (sym) {
          this.extractCalls(node, relativePath, sym.name, calls);
        }
      }

      if (node.type === "class_declaration" || node.type === "class_definition" || node.type === "abstract_class_declaration") {
        const sym = extractSymbols(node, "class", parent);
        if (sym) {
          for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (child) walk(child, sym.name);
          }
          return;
        }
      }

      // Go: type declarations (structs, interfaces)
      if (node.type === "type_declaration") {
        // Go wraps in type_spec — extract name from inner node
        const typeSpec = node.children.find((c) => c.type === "type_spec");
        if (typeSpec) {
          const nameNode = typeSpec.childForFieldName("name");
          if (nameNode) {
            // Determine if it's an interface or a type (struct/alias)
            const typeBody = typeSpec.childForFieldName("type");
            const kind = typeBody?.type === "interface_type" ? "interface" : "class";
            const symbol: Symbol = {
              id: `${relativePath}:${nameNode.text}:${typeSpec.startPosition.row}`,
              name: nameNode.text,
              kind,
              file: relativePath,
              line: typeSpec.startPosition.row + 1,
              column: typeSpec.startPosition.column,
              endLine: typeSpec.endPosition.row + 1,
              endColumn: typeSpec.endPosition.column,
              parent,
            };
            symbols.push(symbol);
            // Walk children for method specs inside interfaces
            for (let i = 0; i < node.childCount; i++) {
              const child = node.child(i);
              if (child) walk(child, symbol.name);
            }
            return;
          }
        }
      }

      // Go: const declarations (including const groups with iota)
      if (node.type === "const_declaration") {
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (child?.type === "const_spec") {
            const nameNode = child.childForFieldName("name");
            if (nameNode) {
              symbols.push({
                id: `${relativePath}:${nameNode.text}:${child.startPosition.row}`,
                name: nameNode.text,
                kind: "constant",
                file: relativePath,
                line: child.startPosition.row + 1,
                column: child.startPosition.column,
                endLine: child.endPosition.row + 1,
                endColumn: child.endPosition.column,
                parent,
              });
            }
          }
        }
        return;
      }

      // Go: var declarations (package-level and block)
      if (node.type === "var_declaration") {
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (child?.type === "var_spec") {
            const nameNode = child.childForFieldName("name");
            if (nameNode) {
              symbols.push({
                id: `${relativePath}:${nameNode.text}:${child.startPosition.row}`,
                name: nameNode.text,
                kind: "variable",
                file: relativePath,
                line: child.startPosition.row + 1,
                column: child.startPosition.column,
                endLine: child.endPosition.row + 1,
                endColumn: child.endPosition.column,
                parent,
              });
            }
          }
        }
        return;
      }

      // Go: interface method specs (field_identifier inside method_spec)
      if (node.type === "method_spec") {
        const nameNode = node.childForFieldName("name");
        if (nameNode) {
          symbols.push({
            id: `${relativePath}:${nameNode.text}:${node.startPosition.row}`,
            name: nameNode.text,
            kind: "method",
            file: relativePath,
            line: node.startPosition.row + 1,
            column: node.startPosition.column,
            endLine: node.endPosition.row + 1,
            endColumn: node.endPosition.column,
            parent,
          });
        }
      }

      // Rust: struct and enum items
      if (node.type === "struct_item" || node.type === "enum_item") {
        const sym = extractSymbols(node, "class", parent);
        if (sym) {
          for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (child) walk(child, sym.name);
          }
          return;
        }
      }

      // C: struct specifiers
      if (node.type === "struct_specifier") {
        const sym = extractSymbols(node, "class", parent);
        if (sym) {
          for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (child) walk(child, sym.name);
          }
          return;
        }
      }

      // Swift: struct and enum declarations as classes
      if (node.type === "struct_declaration" || node.type === "enum_declaration") {
        const sym = extractSymbols(node, "class", parent);
        if (sym) {
          for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (child) walk(child, sym.name);
          }
          return;
        }
      }

      // Swift: protocol declarations as interfaces
      if (node.type === "protocol_declaration") {
        const sym = extractSymbols(node, "interface", parent);
        if (sym) {
          for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (child) walk(child, sym.name);
          }
          return;
        }
      }

      // Swift: protocol function declarations as methods
      if (node.type === "protocol_function_declaration") {
        extractSymbols(node, "method", parent);
      }

      if (node.type === "method_definition" || node.type === "method_declaration") {
        const sym = extractSymbols(node, "method", parent);
        if (sym) {
          this.extractCalls(node, relativePath, sym.name, calls);
        }
      }

      if (node.type === "variable_declarator" || node.type === "assignment") {
        extractSymbols(node, "variable", parent);
      }

      // TypeScript/JavaScript: interface declarations
      if (node.type === "interface_declaration") {
        extractSymbols(node, "interface", parent);
      }

      // TypeScript: type alias declarations
      if (node.type === "type_alias_declaration") {
        extractSymbols(node, "type", parent);
      }

      // TypeScript/JavaScript: enum declarations
      if (node.type === "enum_declaration") {
        extractSymbols(node, "type", parent);
      }

      // Swift: property declarations
      if (node.type === "property_declaration") {
        const patternNode = node.children.find((c) => c.type === "pattern");
        if (patternNode) {
          const symbol: Symbol = {
            id: `${relativePath}:${patternNode.text}:${node.startPosition.row}`,
            name: patternNode.text,
            kind: "variable",
            file: relativePath,
            line: node.startPosition.row + 1,
            column: node.startPosition.column,
            endLine: node.endPosition.row + 1,
            endColumn: node.endPosition.column,
            parent,
          };
          symbols.push(symbol);
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) walk(child, parent);
      }
    };

    walk(tree.rootNode);

    // Extract references
    this.extractReferences(tree.rootNode, relativePath, symbols, references, content);

    // Store results
    this.store.addSymbols(symbols);
    this.store.addReferences(references);
    this.store.addCalls(calls);

    return {
      symbols: symbols.length,
      references: references.length,
      calls: calls.length,
    };
  }

  private extractSignature(node: Parser.SyntaxNode): string {
    const paramsNode = node.childForFieldName("parameters");
    return paramsNode?.text || "";
  }

  private extractCalls(
    node: Parser.SyntaxNode,
    file: string,
    callerName: string,
    calls: CallRelation[]
  ): void {
    const walk = (n: Parser.SyntaxNode) => {
      if (n.type === "call_expression" || n.type === "method_invocation") {
        const funcNode = n.childForFieldName("function") || n.childForFieldName("name");
        if (funcNode) {
          // Go/JS: selector_expression (obj.Method) — extract the method name (field)
          if (funcNode.type === "selector_expression") {
            const fieldNode = funcNode.childForFieldName("field");
            if (fieldNode) {
              calls.push({
                caller: callerName,
                callerFile: file,
                callee: funcNode.text, // full "obj.Method" for context
                line: n.startPosition.row + 1,
                column: n.startPosition.column,
              });
            } else {
              calls.push({
                caller: callerName,
                callerFile: file,
                callee: funcNode.text,
                line: n.startPosition.row + 1,
                column: n.startPosition.column,
              });
            }
          } else {
            calls.push({
              caller: callerName,
              callerFile: file,
              callee: funcNode.text,
              line: n.startPosition.row + 1,
              column: n.startPosition.column,
            });
          }
        } else {
          // Swift: call_expression has no "function" field — callee is the first child
          const firstChild = n.child(0);
          if (firstChild && (firstChild.type === "simple_identifier" || firstChild.type === "navigation_expression")) {
            calls.push({
              caller: callerName,
              callerFile: file,
              callee: firstChild.text,
              line: n.startPosition.row + 1,
              column: n.startPosition.column,
            });
          }
        }
      }

      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i);
        if (child) walk(child);
      }
    };

    walk(node);
  }

  private extractReferences(
    root: Parser.SyntaxNode,
    file: string,
    symbols: Symbol[],
    references: Reference[],
    content: string
  ): void {
    const symbolNames = new Set(symbols.map((s) => s.name));
    const lines = content.split("\n");

    const walk = (node: Parser.SyntaxNode) => {
      if (node.type === "identifier" || node.type === "type_identifier" || node.type === "simple_identifier") {
        if (symbolNames.has(node.text)) {
          references.push({
            symbolName: node.text,
            file,
            line: node.startPosition.row + 1,
            column: node.startPosition.column,
            context: lines[node.startPosition.row]?.trim() || "",
          });
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) walk(child);
      }
    };

    walk(root);
  }

  private async getChangedFiles(
    files: string[],
    previousHashes: Record<string, string>
  ): Promise<string[]> {
    const changed: string[] = [];

    for (const file of files) {
      const hash = await getFileHash(file);
      if (previousHashes[file] !== hash) {
        changed.push(file);
      }
    }

    return changed;
  }
}
