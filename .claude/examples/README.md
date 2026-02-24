# Zen Examples Library

This directory contains curated examples for few-shot learning. When concepts are invoked, relevant examples can be included in the prompt to improve output quality.

## Structure

```
examples/
├── architecture/           # Architecture design examples
│   ├── oauth-authentication.yaml
│   ├── api-design.yaml
│   └── caching-strategy.yaml
├── implementation/         # Code implementation examples
│   ├── crud-operations.yaml
│   ├── error-handling.yaml
│   └── testing-patterns.yaml
└── quality/               # Review and testing examples
    ├── security-review.yaml
    └── performance-review.yaml
```

## Example Format

Each example file contains:

```yaml
example_id: "unique-identifier"
category: "architecture|implementation|quality"
domain: "what area this covers"
complexity: "simple|moderate|complex"
tags: ["searchable", "tags"]

input:
  # The input that would be provided
  story_id: "..."
  title: "..."

output:
  # The expected output
  arch_id: "..."
  ...

teaching_notes:
  key_patterns:
    - pattern: "Pattern name"
      explanation: "Why this pattern is used"
  common_mistakes:
    - mistake: "What to avoid"
      better: "What to do instead"
```

## Usage

Examples are used by:

1. **Prompt Templates**: Include relevant examples in prompts
2. **Learning**: Study patterns for consistent outputs
3. **Validation**: Compare outputs against examples

## Adding Examples

When adding new examples:

1. Use real scenarios you've encountered
2. Include both input and expected output
3. Add teaching notes explaining key decisions
4. Tag appropriately for searchability
5. Keep examples focused (one concept per file)

## Example Selection

When selecting examples for a prompt:

1. Match by domain (auth, api, database, etc.)
2. Match by complexity level
3. Prefer examples with similar constraints
4. Include 1-2 examples maximum (token efficiency)
