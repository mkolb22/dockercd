---
name: Code Style Enforcement
description: Ensure consistent code style with project-aware formatting and linting
version: 1.0.0
author: Dragonfly Framework
applies_to:
  - implementation-concept
trigger_keywords:
  - style
  - formatting
  - lint
  - code style
  - consistent
  - prettier
  - eslint
priority: P3
impact: medium
---

# Code Style Enforcement Skill

## Purpose

Enable the Implementation Concept agent to generate code that matches project conventions and passes all linting/formatting checks.

## Style Detection Framework

### 1. Project Convention Detection

```yaml
detection_sources:
  configuration_files:
    eslint:
      files: [".eslintrc", ".eslintrc.js", ".eslintrc.json", "eslint.config.js"]
      priority: 1
      
    prettier:
      files: [".prettierrc", ".prettierrc.js", "prettier.config.js"]
      priority: 1
      
    typescript:
      files: ["tsconfig.json"]
      priority: 1
      
    editorconfig:
      files: [".editorconfig"]
      priority: 2
      
  existing_code:
    method: "Pattern analysis of existing files"
    sample_size: "10-20 files"
    priority: 3
```

### 2. Common Style Rules

```yaml
style_dimensions:
  indentation:
    options: ["2 spaces", "4 spaces", "tabs"]
    detect_from: [".editorconfig", "prettier", "existing code"]
    
  quotes:
    options: ["single", "double"]
    detect_from: ["eslint", "prettier", "existing code"]
    
  semicolons:
    options: [true, false]
    detect_from: ["eslint", "prettier", "existing code"]
    
  trailing_commas:
    options: ["none", "es5", "all"]
    detect_from: ["prettier", "existing code"]
    
  line_length:
    common_values: [80, 100, 120]
    detect_from: ["prettier", "eslint", ".editorconfig"]
    
  bracket_spacing:
    options: [true, false]
    example_true: "{ foo: bar }"
    example_false: "{foo: bar}"
    
  arrow_function_parens:
    options: ["always", "avoid"]
    example_always: "(x) => x"
    example_avoid: "x => x"
```

### 3. Language-Specific Conventions

```yaml
typescript_conventions:
  type_annotations:
    explicit_return_types: "Required for exported functions"
    parameter_types: "Always required"
    inference: "Allow for local variables"
    
  naming:
    interfaces: "PascalCase, no 'I' prefix"
    types: "PascalCase"
    enums: "PascalCase"
    enum_members: "SCREAMING_SNAKE_CASE or PascalCase"
    
  imports:
    order: ["builtin", "external", "internal", "parent", "sibling", "index"]
    group_separation: "blank line between groups"
    type_imports: "Use 'import type' when possible"
    
  null_handling:
    prefer: "undefined over null"
    optional_chaining: "Use ?. instead of && chains"
    nullish_coalescing: "Use ?? instead of || for defaults"

javascript_conventions:
  variable_declaration:
    prefer: "const over let"
    avoid: "var"
    
  functions:
    prefer: "arrow functions for callbacks"
    named: "function declarations for hoisting"
    
  objects:
    shorthand: "Use property shorthand"
    computed: "Use computed properties when needed"
    spread: "Prefer spread over Object.assign"
```

### 4. Code Organization Patterns

```yaml
file_organization:
  imports_order:
    1: "React/framework imports"
    2: "Third-party libraries"
    3: "Internal absolute imports"
    4: "Relative imports"
    5: "Style imports"
    6: "Type imports"
    
  component_structure:
    1: "Type definitions"
    2: "Constants"
    3: "Helpers (if small)"
    4: "Component definition"
    5: "Styled components (if colocated)"
    
  class_structure:
    1: "Static properties"
    2: "Instance properties"
    3: "Constructor"
    4: "Lifecycle methods"
    5: "Public methods"
    6: "Private methods"
    
  function_structure:
    1: "Parameter validation"
    2: "Early returns"
    3: "Main logic"
    4: "Return statement"
```

### 5. Documentation Style

```yaml
documentation_conventions:
  jsdoc:
    when_required:
      - exported_functions
      - public_class_methods
      - complex_logic
    format: |
      /**
       * Brief description.
       * 
       * @param paramName - Parameter description
       * @returns Description of return value
       * @throws {ErrorType} When error occurs
       * @example
       * ```ts
       * functionName(arg);
       * ```
       */
       
  inline_comments:
    when_needed:
      - non_obvious_logic
      - workarounds
      - todo_items
    format:
      single_line: "// Comment"
      todo: "// TODO: Description"
      fixme: "// FIXME: Description"
      
  tsdoc:
    prefer_over_jsdoc: true
    tags: ["@param", "@returns", "@throws", "@example", "@remarks"]
```

### 6. Naming Conventions

```yaml
naming_rules:
  variables:
    style: "camelCase"
    boolean_prefix: ["is", "has", "should", "can", "will"]
    array_suffix: "Avoid 'List', prefer plural"
    
  functions:
    style: "camelCase"
    verb_prefix: ["get", "set", "create", "update", "delete", "fetch", "handle"]
    event_handlers: "handle{Event}" or "on{Event}"
    
  classes:
    style: "PascalCase"
    suffix_by_type:
      services: "Service"
      controllers: "Controller"
      repositories: "Repository"
      factories: "Factory"
      
  constants:
    exported: "SCREAMING_SNAKE_CASE"
    local: "camelCase"
    
  files:
    components: "PascalCase.tsx"
    utilities: "camelCase.ts"
    tests: "{name}.test.ts or {name}.spec.ts"
    styles: "{ComponentName}.styles.ts or {component}.module.css"
```

### 7. Style Enforcement Checklist

```yaml
pre_generation_checklist:
  - detect_project_style: "Analyze existing code and configs"
  - identify_linter_rules: "Parse ESLint/Prettier config"
  - note_naming_patterns: "Observe existing names"
  - check_import_style: "Absolute vs relative preferences"
  
post_generation_validation:
  - consistent_indentation: "Match project standard"
  - correct_quotes: "Match quote style"
  - proper_semicolons: "Match semicolon style"
  - sorted_imports: "Match import order"
  - naming_conventions: "Match existing patterns"
  - documentation_format: "Match JSDoc style"
```

### 8. Auto-Fix Integration

```yaml
auto_fix_tools:
  prettier:
    command: "npx prettier --write {file}"
    formats: ["ts", "tsx", "js", "jsx", "json", "md", "css"]
    
  eslint:
    command: "npx eslint --fix {file}"
    fixes: "Auto-fixable rule violations"
    
  import_sort:
    command: "npx eslint --fix --rule 'import/order: error'"
    alternatives: ["eslint-plugin-import", "prettier-plugin-organize-imports"]
```

## Output Format

When generating code, apply detected styles:

```yaml
style_report:
  detected_conventions:
    indentation: "2 spaces"
    quotes: "single"
    semicolons: false
    trailing_commas: "es5"
    line_length: 100
    
  applied_patterns:
    naming:
      functions: "camelCase"
      components: "PascalCase"
    imports:
      order: "framework → external → internal"
      type_imports: "separate"
      
  validation:
    eslint_passed: true
    prettier_formatted: true
    type_check_passed: true
```
