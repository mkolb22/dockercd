---
name: Documentation Generation
description: Auto-generate documentation from code, comments, and types
version: 1.0.0
author: Dragonfly Framework
applies_to:
  - implementation-concept
trigger_keywords:
  - documentation
  - docs
  - readme
  - api docs
  - jsdoc
  - typedoc
priority: P3
impact: medium
---

# Documentation Generation Skill

## Purpose

Enable the Implementation Concept agent to generate comprehensive documentation from code analysis, including API references, usage examples, and architectural diagrams.

## Documentation Types

### 1. API Reference Documentation

```yaml
api_documentation:
  extraction_sources:
    - jsdoc_comments
    - typescript_types
    - function_signatures
    - class_definitions
    
  template: |
    ## {functionName}
    
    {description}
    
    ### Signature
    ```typescript
    {signature}
    ```
    
    ### Parameters
    {parameters_table}
    
    ### Returns
    {return_description}
    
    ### Example
    ```typescript
    {example_code}
    ```
    
    ### Throws
    {exceptions}
    
    ### See Also
    {related_functions}

parameters_table_format: |
  | Name | Type | Required | Default | Description |
  |------|------|----------|---------|-------------|
  | {name} | `{type}` | {required} | {default} | {description} |
```

### 2. README Generation

```yaml
readme_template:
  sections:
    header:
      content: |
        # {project_name}
        
        {badges}
        
        {short_description}
        
    features:
      content: |
        ## Features
        
        {feature_list}
        
    installation:
      content: |
        ## Installation
        
        ```bash
        {install_command}
        ```
        
    quick_start:
      content: |
        ## Quick Start
        
        ```{language}
        {minimal_example}
        ```
        
    usage:
      content: |
        ## Usage
        
        {detailed_examples}
        
    api:
      content: |
        ## API Reference
        
        {api_summary_or_link}
        
    configuration:
      content: |
        ## Configuration
        
        {config_options}
        
    contributing:
      content: |
        ## Contributing
        
        {contribution_guidelines}
        
    license:
      content: |
        ## License
        
        {license_type}
```

### 3. Code Comments Standards

```yaml
comment_standards:
  function_documentation:
    typescript: |
      /**
       * Brief description of what the function does.
       *
       * @param paramName - Description of the parameter
       * @returns Description of return value
       * @throws {ErrorType} Description of when error is thrown
       *
       * @example
       * ```ts
       * const result = functionName(arg);
       * ```
       */
       
  class_documentation:
    typescript: |
      /**
       * Brief description of the class.
       *
       * @remarks
       * Additional details about the class behavior.
       *
       * @example
       * ```ts
       * const instance = new ClassName();
       * instance.method();
       * ```
       */
       
  interface_documentation:
    typescript: |
      /**
       * Description of what this interface represents.
       *
       * @property propertyName - Description of the property
       */
```

### 4. Architecture Documentation

```yaml
architecture_docs:
  system_overview:
    template: |
      # System Architecture
      
      ## Overview
      {high_level_description}
      
      ## Components
      {component_descriptions}
      
      ## Data Flow
      {data_flow_description}
      
      ## Diagrams
      {mermaid_diagrams}
      
  component_diagram:
    mermaid: |
      ```mermaid
      graph TB
        subgraph Frontend
          UI[User Interface]
          State[State Management]
        end
        
        subgraph Backend
          API[API Gateway]
          Service[Business Logic]
          DB[(Database)]
        end
        
        UI --> API
        API --> Service
        Service --> DB
      ```
      
  sequence_diagram:
    mermaid: |
      ```mermaid
      sequenceDiagram
        participant U as User
        participant F as Frontend
        participant A as API
        participant D as Database
        
        U->>F: Click Submit
        F->>A: POST /orders
        A->>D: INSERT order
        D-->>A: Success
        A-->>F: 201 Created
        F-->>U: Show Confirmation
      ```
```

### 5. Changelog Generation

```yaml
changelog_format:
  keep_a_changelog:
    template: |
      # Changelog
      
      All notable changes to this project will be documented in this file.
      
      ## [Unreleased]
      
      ### Added
      - New features
      
      ### Changed
      - Changes in existing functionality
      
      ### Deprecated
      - Soon-to-be removed features
      
      ### Removed
      - Removed features
      
      ### Fixed
      - Bug fixes
      
      ### Security
      - Vulnerability fixes
      
      ## [{version}] - {date}
      
      {changes}
```

### 6. OpenAPI/Swagger Generation

```yaml
openapi_generation:
  from_code:
    decorators:
      - "@ApiOperation"
      - "@ApiResponse"
      - "@ApiParam"
      
  template:
    openapi: "3.1.0"
    info:
      title: "{api_title}"
      version: "{version}"
      description: "{description}"
      
    paths:
      "/endpoint":
        get:
          summary: "{summary}"
          description: "{description}"
          parameters: "{extracted_params}"
          responses:
            "200":
              description: "Success"
              content:
                application/json:
                  schema:
                    "$ref": "#/components/schemas/Response"
```

### 7. Documentation Quality Checklist

```yaml
quality_checklist:
  completeness:
    - [ ] All public APIs documented
    - [ ] All parameters described
    - [ ] Return values explained
    - [ ] Exceptions documented
    - [ ] Examples provided
    
  clarity:
    - [ ] No jargon without explanation
    - [ ] Consistent terminology
    - [ ] Clear, concise sentences
    - [ ] Proper formatting
    
  accuracy:
    - [ ] Matches actual code behavior
    - [ ] Examples are runnable
    - [ ] Types are correct
    - [ ] No outdated information
    
  maintainability:
    - [ ] Generated from source where possible
    - [ ] Single source of truth
    - [ ] Version controlled
    - [ ] CI/CD integration
```

### 8. Documentation Tools Integration

```yaml
tool_configurations:
  typedoc:
    config: |
      {
        "entryPoints": ["src/index.ts"],
        "out": "docs/api",
        "plugin": ["typedoc-plugin-markdown"],
        "excludePrivate": true,
        "excludeInternal": true
      }
    command: "npx typedoc"
    
  jsdoc:
    config: |
      {
        "source": {
          "include": ["src"],
          "includePattern": ".js$"
        },
        "opts": {
          "destination": "docs/api"
        }
      }
    command: "npx jsdoc -c jsdoc.json"
    
  swagger_autogen:
    config: |
      const doc = {
        info: {
          title: 'My API',
          description: 'API Documentation'
        },
        host: 'localhost:3000',
        basePath: '/'
      };
      
      const outputFile = './swagger-output.json';
      const endpointsFiles = ['./src/routes/*.js'];
      
      swaggerAutogen()(outputFile, endpointsFiles, doc);
```

## Output Format

```yaml
documentation_output:
  generated_files:
    - path: "docs/api/README.md"
      type: "API reference"
      
    - path: "docs/architecture/overview.md"
      type: "Architecture overview"
      
    - path: "README.md"
      type: "Project README"
      
  coverage:
    functions_documented: "45/50 (90%)"
    classes_documented: "12/12 (100%)"
    missing_documentation:
      - "src/utils/helpers.ts: formatDate()"
      - "src/services/cache.ts: invalidate()"
      
  quality_score:
    completeness: 90
    examples_present: 85
    types_documented: 100
    
  recommendations:
    - "Add examples to UserService.create()"
    - "Document error cases for PaymentService"
    - "Update outdated API endpoint descriptions"
```
