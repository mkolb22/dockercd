---
name: Accessibility Checking
description: WCAG compliance checking and accessibility improvement recommendations
version: 1.0.0
author: Dragonfly Framework
applies_to:
  - quality-concept
trigger_keywords:
  - accessibility
  - a11y
  - wcag
  - screen reader
  - aria
  - keyboard
priority: P3
impact: medium
---

# Accessibility Checking Skill

## Purpose

Enable the Quality Concept agent to verify WCAG compliance and recommend accessibility improvements.

## WCAG Guidelines Framework

### 1. WCAG Principles (POUR)

```yaml
wcag_principles:
  perceivable:
    description: "Information must be presentable to users"
    guidelines:
      - text_alternatives
      - time_based_media
      - adaptable
      - distinguishable
      
  operable:
    description: "Interface must be operable"
    guidelines:
      - keyboard_accessible
      - enough_time
      - seizures_and_physical
      - navigable
      - input_modalities
      
  understandable:
    description: "Information must be understandable"
    guidelines:
      - readable
      - predictable
      - input_assistance
      
  robust:
    description: "Content must be robust for assistive technologies"
    guidelines:
      - compatible
```

### 2. Compliance Levels

```yaml
compliance_levels:
  level_a:
    description: "Minimum accessibility"
    required_for: "Basic accessibility"
    examples:
      - non_text_content_alternatives
      - keyboard_accessible
      - no_keyboard_trap
      - page_titled
      
  level_aa:
    description: "Standard accessibility"
    required_for: "Most legal requirements"
    examples:
      - color_contrast_4.5:1
      - resize_text_200%
      - multiple_ways_to_find_pages
      - headings_and_labels
      
  level_aaa:
    description: "Enhanced accessibility"
    required_for: "Maximum accessibility"
    examples:
      - color_contrast_7:1
      - sign_language_for_media
      - extended_audio_description
```

### 3. Common Accessibility Checks

```yaml
automated_checks:
  images:
    rule: "All images must have alt text"
    check: |
      <img> elements must have alt attribute
      Decorative images: alt=""
      Informative images: descriptive alt text
    code_pattern: |
      // Bad
      <img src="logo.png">
      
      // Good
      <img src="logo.png" alt="Company Logo">
      <img src="decoration.png" alt="" role="presentation">
      
  forms:
    rule: "Form inputs must have labels"
    check: |
      Every input must have associated label
      Use <label for="id"> or aria-label/aria-labelledby
    code_pattern: |
      // Bad
      <input type="email">
      
      // Good
      <label for="email">Email</label>
      <input id="email" type="email">
      
      // Or
      <input type="email" aria-label="Email address">
      
  color_contrast:
    rule: "Sufficient color contrast"
    check: |
      Normal text: 4.5:1 ratio (AA)
      Large text: 3:1 ratio (AA)
    tools: ["axe", "lighthouse", "wave"]
    
  keyboard_navigation:
    rule: "All interactive elements keyboard accessible"
    check: |
      Tab order logical
      Focus visible
      No keyboard traps
      Skip links available
    code_pattern: |
      // Ensure focusable
      <button>Submit</button>  // Good
      <div onclick="submit()">Submit</div>  // Bad
      
      // Focus indicator
      :focus {
        outline: 2px solid blue;
      }
```

### 4. ARIA Best Practices

```yaml
aria_guidelines:
  rule_1:
    name: "Use native HTML when possible"
    bad: '<div role="button" tabindex="0">'
    good: "<button>"
    
  rule_2:
    name: "Don't change native semantics"
    bad: '<h1 role="button">'
    good: '<h1><button>Click me</button></h1>'
    
  rule_3:
    name: "Interactive elements must be keyboard accessible"
    requirement: "role='button' needs keyboard handler"
    
  rule_4:
    name: "Don't hide focusable elements"
    bad: '<button aria-hidden="true">Click</button>'
    
  rule_5:
    name: "Interactive elements need accessible names"
    methods:
      - "visible label"
      - "aria-label"
      - "aria-labelledby"

common_aria_patterns:
  modal_dialog:
    pattern: |
      <div role="dialog" 
           aria-modal="true" 
           aria-labelledby="dialog-title">
        <h2 id="dialog-title">Dialog Title</h2>
        <p>Dialog content</p>
        <button>Close</button>
      </div>
      
  tabs:
    pattern: |
      <div role="tablist">
        <button role="tab" aria-selected="true" aria-controls="panel-1">Tab 1</button>
        <button role="tab" aria-selected="false" aria-controls="panel-2">Tab 2</button>
      </div>
      <div role="tabpanel" id="panel-1">Panel 1 content</div>
      <div role="tabpanel" id="panel-2" hidden>Panel 2 content</div>
      
  live_region:
    pattern: |
      <div aria-live="polite" aria-atomic="true">
        <!-- Dynamic content announced to screen readers -->
      </div>
```

### 5. Testing Checklist

```yaml
manual_testing_checklist:
  keyboard_navigation:
    - [ ] Can reach all interactive elements with Tab
    - [ ] Tab order is logical
    - [ ] Focus indicator visible
    - [ ] Can activate with Enter/Space
    - [ ] Can escape modals with Esc
    - [ ] Skip link to main content works
    
  screen_reader:
    - [ ] Page has proper heading hierarchy
    - [ ] Images have meaningful alt text
    - [ ] Forms have proper labels
    - [ ] Error messages announced
    - [ ] Dynamic content announced
    - [ ] Tables have proper headers
    
  visual:
    - [ ] Content readable at 200% zoom
    - [ ] Color contrast sufficient
    - [ ] No color-only information
    - [ ] Focus indicators visible
    - [ ] Text resizable without breaking layout
    
  cognitive:
    - [ ] Instructions clear
    - [ ] Error messages helpful
    - [ ] Consistent navigation
    - [ ] No time limits or warnings provided
```

### 6. Automated Testing Tools

```yaml
testing_tools:
  axe_core:
    integration: "Browser extension, CLI, CI"
    usage: |
      // In tests
      import { axe, toHaveNoViolations } from 'jest-axe';
      
      test('component is accessible', async () => {
        const { container } = render(<Component />);
        const results = await axe(container);
        expect(results).toHaveNoViolations();
      });
      
  lighthouse:
    integration: "Chrome DevTools, CLI, CI"
    command: "lighthouse --only-categories=accessibility"
    
  eslint_jsx_a11y:
    integration: "ESLint plugin"
    config: |
      {
        "extends": ["plugin:jsx-a11y/recommended"]
      }
      
  pa11y:
    integration: "CLI, CI"
    command: "pa11y https://example.com"
```

### 7. Common Issues and Fixes

```yaml
common_issues:
  missing_alt_text:
    issue: "Images without alt attribute"
    impact: "Screen readers can't describe image"
    fix: "Add descriptive alt text"
    
  low_contrast:
    issue: "Text doesn't meet contrast ratio"
    impact: "Hard to read for low vision users"
    fix: "Increase contrast to 4.5:1 minimum"
    
  missing_form_labels:
    issue: "Inputs without labels"
    impact: "Users don't know what to enter"
    fix: "Add <label> or aria-label"
    
  no_focus_indicator:
    issue: "Focus state not visible"
    impact: "Keyboard users can't see position"
    fix: "Add visible :focus styles"
    
  non_semantic_html:
    issue: "Using divs for everything"
    impact: "Screen readers lose context"
    fix: "Use semantic HTML elements"
```

## Output Format

```yaml
accessibility_report:
  page: "https://example.com/checkout"
  compliance_target: "WCAG 2.1 AA"
  
  summary:
    violations: 12
    warnings: 8
    passes: 45
    
  critical_issues:
    - rule: "color-contrast"
      impact: "serious"
      count: 5
      elements: ["#submit-btn", ".error-text"]
      fix: "Increase contrast to 4.5:1"
      
    - rule: "label"
      impact: "critical"
      count: 3
      elements: ["input[name=email]"]
      fix: "Add <label for='email'>"
      
  warnings:
    - rule: "heading-order"
      impact: "moderate"
      description: "Heading levels skip from h1 to h3"
      
  recommendations:
    - priority: "high"
      issue: "Add skip link to main content"
      effort: "15 minutes"
      
    - priority: "medium"
      issue: "Add aria-live for cart updates"
      effort: "30 minutes"
```
