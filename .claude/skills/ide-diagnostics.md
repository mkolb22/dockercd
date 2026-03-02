---
name: IDE Diagnostics
description: Interpret and act on IDE diagnostics (TypeScript, ESLint errors) during quality review
version: 1.0.0
trigger_keywords: [diagnostics, typescript, eslint, build error, type error, lint, compiler]
author: Zen Architecture
applies_to: [quality-concept]
priority: P0
impact: critical
---

# IDE Diagnostics - Expert Skill

Catch build errors, type issues, and lint violations before code review using Claude Code's native IDE diagnostics.

## Purpose

IDE diagnostics integration provides:
- **Early error detection**: Catch TypeScript/ESLint errors before manual review
- **Automated quality gates**: Block reviews if critical diagnostics exist
- **Fast feedback**: Native IDE diagnostics are instant (no separate build step)
- **Comprehensive coverage**: All compiler and linter errors in one place

## When to Use

Use IDE diagnostics during quality review when:
- ✅ Reviewing TypeScript/JavaScript code
- ✅ Before running code review checks
- ✅ After implementation is complete
- ✅ To validate build will succeed

## Diagnostic Categories

### 1. TypeScript Compiler Errors (Blocking)

**Examples**:
```typescript
// TS2345: Argument of type 'string' is not assignable to parameter of type 'number'
function add(a: number, b: number) { return a + b; }
add("5", 10);

// TS2304: Cannot find name 'User'
const user: User = { name: "Alice" };

// TS2339: Property 'username' does not exist on type 'User'
const name = user.username;

// TS2322: Type 'null' is not assignable to type 'string'
const name: string = null;
```

**Severity**: Critical (blocking)
**Response**: Fail review, fix before proceeding

### 2. TypeScript Strict Mode Violations (Blocking)

**Examples**:
```typescript
// TS2531: Object is possibly 'null'
function getLength(str: string | null) {
  return str.length;  // Error: str might be null
}

// TS2532: Object is possibly 'undefined'
function getValue(obj?: { value: string }) {
  return obj.value;  // Error: obj might be undefined
}

// TS7006: Parameter implicitly has 'any' type
function process(data) {  // Error: no type annotation
  return data;
}
```

**Severity**: Critical (blocking)
**Response**: Fail review, fix type safety issues

### 3. ESLint Errors (Blocking)

**Examples**:
```javascript
// no-unused-vars: 'userId' is defined but never used
const userId = getUserId();

// no-undef: 'process' is not defined (missing types)
const env = process.env.NODE_ENV;

// @typescript-eslint/no-explicit-any: Unexpected any
function handle(data: any) { }

// prefer-const: 'x' is never reassigned. Use 'const' instead
let x = 5;
```

**Severity**: High (blocking)
**Response**: Fail review, fix ESLint errors

### 4. ESLint Warnings (Non-blocking)

**Examples**:
```javascript
// @typescript-eslint/no-unused-vars: '_' is defined but never used
const [first, _] = arr;

// no-console: Unexpected console statement
console.log('Debug info');

// complexity: Function has complexity of 15. Maximum allowed is 10
function complex() { /* ... */ }
```

**Severity**: Medium (warning)
**Response**: Include in review notes, don't block

### 5. Import/Export Errors (Blocking)

**Examples**:
```typescript
// TS2307: Cannot find module './missing'
import { foo } from './missing';

// TS2305: Module has no exported member 'Bar'
import { Bar } from './types';

// TS1208: All files must be modules when '--isolatedModules' is enabled
const x = 5;  // File with no imports/exports
```

**Severity**: Critical (blocking)
**Response**: Fail review, fix import errors

## Using mcp__ide__getDiagnostics

### Call Pattern

```typescript
// Get diagnostics for all files (use during review)
const allDiagnostics = await mcp__ide__getDiagnostics();

// Get diagnostics for specific file
const fileDiagnostics = await mcp__ide__getDiagnostics({
  uri: 'file:///path/to/file.ts'
});
```

### Response Format

```json
{
  "diagnostics": [
    {
      "uri": "file:///Users/kolb/project/src/user.service.ts",
      "range": {
        "start": { "line": 45, "character": 10 },
        "end": { "line": 45, "character": 20 }
      },
      "severity": 1,  // 1=Error, 2=Warning, 3=Info, 4=Hint
      "code": "TS2345",
      "source": "ts",
      "message": "Argument of type 'string' is not assignable to parameter of type 'number'"
    },
    {
      "uri": "file:///Users/kolb/project/src/auth.controller.ts",
      "range": {
        "start": { "line": 23, "character": 5 },
        "end": { "line": 23, "character": 15 }
      },
      "severity": 1,
      "code": "no-unused-vars",
      "source": "eslint",
      "message": "'userToken' is defined but never used."
    }
  ]
}
```

## Diagnostic Processing Workflow

### 1. Fetch Diagnostics

```yaml
step: fetch_diagnostics
when: "At start of quality review"
action: |
  # Get diagnostics for all changed files
  diagnostics = await mcp__ide__getDiagnostics()

  # Filter to files in current implementation
  relevant_diagnostics = filter_by_files(
    diagnostics,
    impl.files_created + impl.files_modified
  )
```

### 2. Categorize by Severity

```yaml
step: categorize
process: |
  categorized = {
    errors: [],      # severity=1, blocking
    warnings: [],    # severity=2, note in review
    info: [],        # severity=3-4, ignore
  }

  for diagnostic in relevant_diagnostics:
    if diagnostic.severity == 1:
      categorized.errors.append(diagnostic)
    elif diagnostic.severity == 2:
      categorized.warnings.append(diagnostic)
    else:
      categorized.info.append(diagnostic)
```

### 3. Apply Blocking Policy

```yaml
step: apply_policy
blocking_conditions:
  # Block review if any errors exist
  - "errors.count > 0"

  # Block if too many warnings (code smell)
  - "warnings.count > 10"

non_blocking:
  # Warnings < threshold: include in review notes
  - "warnings.count <= 10"

  # Info/hints: log but don't report
  - "info.count > 0"
```

### 4. Generate Report

```yaml
step: generate_report
format: |
  diagnostics:
    status: "failed"  # or "passed" if no blocking issues
    summary:
      errors: 3
      warnings: 7
      files_affected: 2

    blocking_issues:
      - file: "src/user.service.ts"
        line: 45
        code: "TS2345"
        severity: "error"
        source: "TypeScript"
        message: "Argument of type 'string' is not assignable to parameter of type 'number'"
        suggestion: "Check function signature and fix argument type"

      - file: "src/auth.controller.ts"
        line: 23
        code: "no-unused-vars"
        severity: "error"
        source: "ESLint"
        message: "'userToken' is defined but never used"
        suggestion: "Remove unused variable or use it"

    warnings:
      - file: "src/utils/helper.ts"
        line: 12
        code: "complexity"
        severity: "warning"
        source: "ESLint"
        message: "Function has complexity of 12. Maximum allowed is 10"
        suggestion: "Refactor function to reduce complexity"
```

## Integration with Quality Concept

### Modified Review Workflow

```yaml
quality_review_workflow:
  steps:
    # NEW STEP 1: IDE Diagnostics (before code review)
    - name: "IDE Diagnostics Check"
      tool: "mcp__ide__getDiagnostics"
      blocking: true
      policy:
        block_on_errors: true
        block_on_warnings_threshold: 10
        ignore_info: true

    # STEP 2: Security Scan (if diagnostics pass)
    - name: "Security Vulnerability Scan"
      tool: "security-scanner"
      requires: "diagnostics.status == 'passed'"

    # STEP 3: Code Review (if security pass)
    - name: "Code Quality Review"
      tool: "code-review"
      requires: "security.status == 'passed'"

  short_circuit:
    - "diagnostics.errors > 0 → fail review immediately"
    - "security.critical > 0 → fail review immediately"
```

### Review State Output

```yaml
# koan/reviews/review-{id}.yaml

review_id: "review-001"
impl_id: "impl-001"
status: "needs_changes"  # Blocked by diagnostics

diagnostics:
  status: "failed"
  errors: 3
  warnings: 7
  files_affected: 2

  summary: "3 TypeScript errors, 7 ESLint warnings"

  blocking_issues:
    - "TS2345: Type error in user.service.ts:45"
    - "no-unused-vars: Unused variable in auth.controller.ts:23"
    - "TS2531: Possible null reference in utils.ts:89"

  action_required: "Fix all errors before review can proceed"

security_scan:
  status: "not_run"
  reason: "Blocked by diagnostics failures"

code_review:
  status: "not_run"
  reason: "Blocked by diagnostics failures"
```

## Common Diagnostic Patterns and Fixes

### TypeScript Type Errors

| Error Code | Pattern | Fix |
|------------|---------|-----|
| **TS2345** | Argument type mismatch | Add type conversion or fix signature |
| **TS2339** | Property doesn't exist | Add property to type or check spelling |
| **TS2531** | Object possibly null | Add null check or use optional chaining |
| **TS2532** | Object possibly undefined | Add undefined check or use default value |
| **TS7006** | Implicit any | Add explicit type annotation |
| **TS2322** | Type assignment error | Fix type or use type assertion |

### ESLint Errors

| Rule | Pattern | Fix |
|------|---------|-----|
| **no-unused-vars** | Variable defined but not used | Remove variable or use it |
| **@typescript-eslint/no-explicit-any** | Using `any` type | Replace with specific type |
| **prefer-const** | `let` never reassigned | Change to `const` |
| **no-undef** | Undefined variable | Import or define variable |
| **@typescript-eslint/no-non-null-assertion** | Using `!` operator | Use optional chaining instead |

### Import Errors

| Error Code | Pattern | Fix |
|------------|---------|-----|
| **TS2307** | Cannot find module | Check path, add file, or install package |
| **TS2305** | No exported member | Export member or fix import name |
| **TS1208** | File not a module | Add import/export to file |

## Auto-Fix Suggestions

### Generate Fix Recommendations

```yaml
fix_recommendation_engine:
  TS2345:  # Type mismatch
    suggestion: |
      The argument type doesn't match the parameter type.

      Fix options:
      1. Convert the argument: Number(argName)
      2. Change parameter type to accept both
      3. Update the argument to correct type

  no-unused-vars:  # Unused variable
    suggestion: |
      Variable is defined but never used.

      Fix options:
      1. Remove the variable declaration
      2. Use the variable in the code
      3. Prefix with _ if intentionally unused: const _unusedVar

  TS2531:  # Possibly null
    suggestion: |
      Object is possibly null.

      Fix options:
      1. Add null check: if (obj) { obj.method() }
      2. Use optional chaining: obj?.method()
      3. Use nullish coalescing: obj ?? defaultValue
      4. Add type guard to narrow type
```

## Metrics and SLOs

```yaml
diagnostics_slo:
  target_check_time: "< 2 seconds"
  max_check_time: "< 5 seconds"

  blocking_policy:
    errors: "always_block"
    warnings: "block_if > 10"
    info: "never_block"

  metrics_to_track:
    - "diagnostic_check_duration_ms"
    - "errors_per_review"
    - "warnings_per_review"
    - "files_with_errors"
    - "most_common_error_codes"
    - "time_to_fix_diagnostics"
```

## Best Practices

1. ✅ **Run diagnostics first** - Before manual code review
2. ✅ **Block on all errors** - TypeScript and ESLint errors are critical
3. ✅ **Warn on many warnings** - > 10 warnings indicates code smell
4. ✅ **Provide fix suggestions** - Include remediation in report
5. ✅ **Filter to changed files** - Only check files in current implementation
6. ✅ **Include in provenance** - Track diagnostic failures
7. ✅ **Fast feedback** - IDE diagnostics are instant, use them

## Example: Full Diagnostic Check

```typescript
async function checkDiagnostics(implementation) {
  // 1. Fetch diagnostics
  const allDiagnostics = await mcp__ide__getDiagnostics();

  // 2. Filter to implementation files
  const changedFiles = [
    ...implementation.files_created,
    ...implementation.files_modified
  ].map(f => f.path);

  const relevant = allDiagnostics.diagnostics.filter(d =>
    changedFiles.some(f => d.uri.includes(f))
  );

  // 3. Categorize
  const errors = relevant.filter(d => d.severity === 1);
  const warnings = relevant.filter(d => d.severity === 2);

  // 4. Check blocking conditions
  const blocked = errors.length > 0 || warnings.length > 10;

  // 5. Generate report
  return {
    status: blocked ? 'failed' : 'passed',
    errors: errors.length,
    warnings: warnings.length,
    blocking_issues: errors.map(e => ({
      file: extractFileName(e.uri),
      line: e.range.start.line + 1,
      code: e.code,
      source: e.source,
      message: e.message,
      suggestion: getSuggestion(e.code)
    })),
    action_required: blocked ?
      "Fix all errors before review can proceed" :
      "No blocking issues"
  };
}
```

---

**Use this skill when**: Beginning quality review for TypeScript/JavaScript code. IDE diagnostics provide instant, comprehensive error detection before manual review.
