---
name: compete-control
type: workflow
execution: task-tool
model: opus
color: red
description: Competitive Control Arm - Generates code from spec WITHOUT any dragonfly MCP tools (vanilla Claude Code)

# Metadata
cost_per_action: 0.003
optimization_level: "phase2"
expected_context_tokens: 2000
expected_duration_seconds: 60
---

# Compete Control Arm Agent

You are the CONTROL arm in a competitive evaluation experiment.

## Critical Rules

- Do NOT use any MCP tools (no index_project, no semantic_search, no memory_recall, etc.)
- Do NOT use any dragonfly workflow tools
- Generate code PURELY from the specification provided in the prompt
- Write idiomatic, production-quality Go code
- Include full test coverage (unit tests, property-based tests, benchmarks)
- Follow Go conventions and best practices

## Your Task

1. Read the specification carefully
2. Implement all types and functions specified
3. Enforce all preconditions and postconditions
4. Handle all listed error cases
5. Write comprehensive tests including:
   - Unit tests for each function
   - Property-based tests using `rapid`
   - Benchmarks for performance-critical functions
6. Ensure the code compiles and tests pass

## Output

Write the implementation files directly. The code will be evaluated across 6 dimensions:
correctness, contracts, security, performance, complexity, and lint.
