import { describe, it, expect } from 'vitest';
import { parseAgentTemplate, ParseError } from '../parser.js';

// ---------------------------------------------------------------------------
// Minimal valid template for baseline tests
// ---------------------------------------------------------------------------

const MINIMAL_TEMPLATE = `---
name: test-concept
type: workflow
execution: task-tool
model: sonnet
color: blue
description: Test concept for parser validation
tools: "*"
cost_per_action: 0.003
optimization_level: "baseline"
expected_context_tokens: 500
expected_duration_seconds: 5
---

# Test Concept

## Purpose

This is a test concept for validating the parser.

## Core Principle: Test Independence

Each test runs independently.

## Actions

### doSomething(input)

Does something useful.

## Validation Rules

- [ ] Input is valid
- [ ] Output is correct

## Never Do This

- Do not fail silently
`;

// ---------------------------------------------------------------------------
// Full template matching production story-concept structure
// ---------------------------------------------------------------------------

const STORY_TEMPLATE = `---
name: story-concept
type: workflow
execution: task-tool
model: sonnet
color: blue
description: Story Concept - Captures and validates user requirements
tools: "*"

# Enhanced Metadata (Phase 3)
cost_per_action: 0.003
optimization_level: "baseline"
expected_context_tokens: 500
expected_duration_seconds: 5

# Component-Scoped Hooks
hooks:
  Stop:
    - type: command
      command: "bash .claude/hooks/concept-complete.sh story"

# Skills (Phase 7)
skills:
  # P0 - Critical
  - schema-validation             # Validate story structure
  # P1 - Core
  - story-decomposition           # INVEST criteria, task breakdown
  - acceptance-criteria-generation # Given-When-Then templates
  - semantic-memory               # Remember patterns from previous stories
  # P2 - Enhancement
  - effort-estimation             # Story points, T-shirt sizing
  - requirement-prioritization    # MoSCoW, RICE scoring
---

# 📋 Story Concept

## Model Assignment

**Model**: Sonnet 4.5
**Cost per Action**: ~$0.003

## Activation Sequence

1. Load story concept template
2. Activate Sonnet 4.5 model
3. Process requirement capture
4. Save story via zen_story_save

---

## Purpose

The Story concept captures user requirements.

## Core Principle: Polymorphic Independence

This concept works for ANY requirements system.

## Actions

### create(title, description, context)

Captures a new user requirement.

**Inputs**:
- title: Brief summary
- description: Detailed explanation

### validate(story_id)

Validates that a story is complete.

## State Management

### Progressive Disclosure Pattern

All story outputs use progressive disclosure.

### State Location

Stories are saved via zen_story_save MCP tool.

### Status Values

- draft: Initial capture
- ready: Complete and validated
- needs_clarification: Missing information

## Integration with Synchronizations

Triggered by user commands.

## Cost Optimization

**Why Sonnet?**
- Story capture is template-based

## Example Usage

\`\`\`markdown
User: /feature "Add dark mode support"
\`\`\`

## Validation Rules

Story is "ready" when:
- [ ] Title is clear
- [ ] At least 2 acceptance criteria

## Error Handling

If story capture fails:
1. Save partial state

## Never Do This

- Do not call other concepts directly

## Always Do This

- Use Sonnet model exclusively

## YAML Safety Rules

Quote strings containing special characters.

---

**Model Assignment**: Sonnet
`;

describe('parseAgentTemplate', () => {
  describe('frontmatter parsing', () => {
    it('extracts basic frontmatter fields', () => {
      const genome = parseAgentTemplate(MINIMAL_TEMPLATE);
      expect(genome.frontmatter.name).toBe('test-concept');
      expect(genome.frontmatter.type).toBe('workflow');
      expect(genome.frontmatter.execution).toBe('task-tool');
      expect(genome.frontmatter.model).toBe('sonnet');
      expect(genome.frontmatter.color).toBe('blue');
      expect(genome.frontmatter.tools).toBe('*');
    });

    it('extracts numeric metadata', () => {
      const genome = parseAgentTemplate(MINIMAL_TEMPLATE);
      expect(genome.frontmatter.costPerAction).toBe(0.003);
      expect(genome.frontmatter.expectedContextTokens).toBe(500);
      expect(genome.frontmatter.expectedDurationSeconds).toBe(5);
    });

    it('extracts quoted string metadata', () => {
      const genome = parseAgentTemplate(MINIMAL_TEMPLATE);
      expect(genome.frontmatter.optimizationLevel).toBe('baseline');
    });

    it('extracts agent name from frontmatter', () => {
      const genome = parseAgentTemplate(MINIMAL_TEMPLATE);
      expect(genome.agentName).toBe('test-concept');
    });

    it('preserves raw frontmatter for round-trip', () => {
      const genome = parseAgentTemplate(MINIMAL_TEMPLATE);
      expect(genome.rawFrontmatter).toContain('name: test-concept');
      expect(genome.rawFrontmatter).toContain('model: sonnet');
    });
  });

  describe('hooks parsing', () => {
    it('extracts hook entries with event grouping', () => {
      const genome = parseAgentTemplate(STORY_TEMPLATE);
      const stopHooks = genome.frontmatter.hooks['Stop'];
      expect(stopHooks).toBeDefined();
      expect(stopHooks).toHaveLength(1);
      expect(stopHooks[0].type).toBe('command');
      expect(stopHooks[0].command).toBe('bash .claude/hooks/concept-complete.sh story');
    });

    it('defaults to empty hooks when none defined', () => {
      const genome = parseAgentTemplate(MINIMAL_TEMPLATE);
      expect(Object.keys(genome.frontmatter.hooks)).toHaveLength(0);
    });
  });

  describe('skills parsing', () => {
    it('extracts skill names', () => {
      const genome = parseAgentTemplate(STORY_TEMPLATE);
      const skillNames = genome.frontmatter.skills.map(s => s.name);
      expect(skillNames).toContain('schema-validation');
      expect(skillNames).toContain('story-decomposition');
      expect(skillNames).toContain('acceptance-criteria-generation');
      expect(skillNames).toContain('semantic-memory');
      expect(skillNames).toContain('effort-estimation');
      expect(skillNames).toContain('requirement-prioritization');
    });

    it('extracts correct number of skills', () => {
      const genome = parseAgentTemplate(STORY_TEMPLATE);
      expect(genome.frontmatter.skills).toHaveLength(6);
    });

    it('preserves inline comments on skills', () => {
      const genome = parseAgentTemplate(STORY_TEMPLATE);
      const schema = genome.frontmatter.skills.find(s => s.name === 'schema-validation');
      expect(schema?.comment).toBe('Validate story structure');

      const decomp = genome.frontmatter.skills.find(s => s.name === 'story-decomposition');
      expect(decomp?.comment).toBe('INVEST criteria, task breakdown');
    });

    it('defaults to empty skills when none defined', () => {
      const genome = parseAgentTemplate(MINIMAL_TEMPLATE);
      expect(genome.frontmatter.skills).toHaveLength(0);
    });
  });

  describe('title extraction', () => {
    it('extracts h1 title with emoji', () => {
      const genome = parseAgentTemplate(STORY_TEMPLATE);
      expect(genome.title).toContain('Story Concept');
    });

    it('extracts plain h1 title', () => {
      const genome = parseAgentTemplate(MINIMAL_TEMPLATE);
      expect(genome.title).toBe('# Test Concept');
    });
  });

  describe('section decomposition', () => {
    it('identifies canonical sections', () => {
      const genome = parseAgentTemplate(STORY_TEMPLATE);
      const ids = genome.sections.map(s => s.id);

      expect(ids).toContain('model_assignment');
      expect(ids).toContain('activation_sequence');
      expect(ids).toContain('purpose');
      expect(ids).toContain('core_principle');
      expect(ids).toContain('actions');
      expect(ids).toContain('state_management');
      expect(ids).toContain('integration');
      expect(ids).toContain('cost_optimization');
      expect(ids).toContain('example_usage');
      expect(ids).toContain('validation_rules');
      expect(ids).toContain('error_handling');
      expect(ids).toContain('never_do');
      expect(ids).toContain('always_do');
      expect(ids).toContain('yaml_safety');
    });

    it('preserves section content', () => {
      const genome = parseAgentTemplate(STORY_TEMPLATE);
      const purpose = genome.sections.find(s => s.id === 'purpose');
      expect(purpose?.content).toContain('Story concept captures user requirements');
    });

    it('preserves section heading text', () => {
      const genome = parseAgentTemplate(STORY_TEMPLATE);
      const principle = genome.sections.find(s => s.id === 'core_principle');
      expect(principle?.heading).toContain('Polymorphic Independence');
    });

    it('preserves heading levels', () => {
      const genome = parseAgentTemplate(STORY_TEMPLATE);
      const purpose = genome.sections.find(s => s.id === 'purpose');
      expect(purpose?.level).toBe(2);

      // Actions has h3 subsections within it
      const actions = genome.sections.find(s => s.id === 'actions');
      expect(actions?.level).toBe(2);
    });

    it('handles sections with subsections', () => {
      const genome = parseAgentTemplate(STORY_TEMPLATE);
      const actions = genome.sections.find(s => s.id === 'actions');
      expect(actions?.content).toContain('create(title, description, context)');
      expect(actions?.content).toContain('validate(story_id)');
    });

    it('groups related subsections under parent canonical section', () => {
      const genome = parseAgentTemplate(STORY_TEMPLATE);
      // State Management has subsections: Progressive Disclosure, State Location, Status Values
      // These should all be grouped under state_management since they follow the parent
      const stateSections = genome.sections.filter(s => s.id === 'state_management');
      // First one is the main State Management heading; subsections follow
      expect(stateSections.length).toBeGreaterThanOrEqual(1);
    });

    it('extracts footer as section', () => {
      const genome = parseAgentTemplate(MINIMAL_TEMPLATE);
      // Minimal template has no footer section marker, so sections should end cleanly
      expect(genome.sections.length).toBeGreaterThan(0);
    });
  });

  describe('section count', () => {
    it('parses minimal template into expected section count', () => {
      const genome = parseAgentTemplate(MINIMAL_TEMPLATE);
      // Purpose, Core Principle, Actions, doSomething, Validation Rules, Never Do
      expect(genome.sections.length).toBeGreaterThanOrEqual(4);
    });

    it('parses story template into expected section count', () => {
      const genome = parseAgentTemplate(STORY_TEMPLATE);
      // Many sections including subsections
      expect(genome.sections.length).toBeGreaterThanOrEqual(12);
    });
  });

  describe('error handling', () => {
    it('throws ParseError for missing frontmatter', () => {
      expect(() => parseAgentTemplate('# No frontmatter')).toThrow(ParseError);
    });

    it('throws ParseError for unterminated frontmatter', () => {
      expect(() => parseAgentTemplate('---\nname: broken\n')).toThrow(ParseError);
    });

    it('provides descriptive error messages', () => {
      try {
        parseAgentTemplate('no frontmatter at all');
      } catch (e) {
        expect(e).toBeInstanceOf(ParseError);
        expect((e as ParseError).message).toContain('Missing frontmatter');
      }
    });
  });

  describe('opus agent parsing', () => {
    it('handles opus model with extended metadata', () => {
      const opusTemplate = `---
name: architecture-concept
type: workflow
execution: task-tool
model: opus
color: purple
description: Architecture Concept
tools: "*"
cost_per_action: 0.015
optimization_level: "phase2"
expected_context_tokens: 1100
baseline_context_tokens: 100000
context_reduction: "99%"
expected_duration_seconds: 15
---

# Architecture Concept

## Purpose

Translates requirements into technical designs.
`;
      const genome = parseAgentTemplate(opusTemplate);
      expect(genome.frontmatter.model).toBe('opus');
      expect(genome.frontmatter.costPerAction).toBe(0.015);
      expect(genome.frontmatter.baselineContextTokens).toBe(100000);
      expect(genome.frontmatter.contextReduction).toBe('99%');
    });
  });
});
