---
name: Test Generation Strategy
description: Intelligent test generation with coverage optimization and edge case detection
version: 1.0.0
author: Zen Framework
applies_to:
  - implementation-concept
trigger_keywords:
  - test
  - testing
  - coverage
  - unit test
  - integration test
  - edge case
priority: P1
impact: high
---

# Test Generation Strategy Skill

## Purpose

Guide the Implementation Concept agent in generating comprehensive, maintainable tests that maximize coverage while minimizing redundancy.

## Test Type Selection Matrix

| Code Type | Primary Tests | Secondary Tests | Optional |
|-----------|---------------|-----------------|----------|
| Pure functions | Unit tests | Property-based | Fuzz |
| API endpoints | Integration | Contract | Load |
| UI components | Component | E2E | Visual regression |
| Data transforms | Unit + snapshot | Integration | - |
| Event handlers | Unit + mocks | Integration | - |
| State management | Unit | Integration | E2E |

## Coverage Strategy

### 1. Code Path Analysis

```yaml
coverage_targets:
  minimum_line: 80%
  minimum_branch: 75%
  minimum_function: 90%
  
priority_paths:
  critical:
    - authentication flows
    - payment processing
    - data validation
    - error handlers
  high:
    - business logic
    - API endpoints
    - state transitions
  medium:
    - utility functions
    - formatters
    - helpers
```

### 2. Edge Case Detection

Automatically identify edge cases based on:

```yaml
edge_case_patterns:
  numeric:
    - zero
    - negative
    - MAX_VALUE / MIN_VALUE
    - NaN / Infinity
    - floating point precision
    
  string:
    - empty string
    - whitespace only
    - unicode characters
    - very long strings
    - special characters
    - null bytes
    
  collection:
    - empty array/object
    - single element
    - large collections
    - nested structures
    - circular references
    
  temporal:
    - midnight
    - DST transitions
    - timezone boundaries
    - leap years
    - epoch edge cases
    
  boundary:
    - off-by-one
    - array bounds
    - pagination limits
    - rate limits
```

### 3. Test Structure Template

```typescript
// Template for comprehensive test structure
describe('[ComponentName]', () => {
  // Setup and teardown
  beforeAll(() => { /* one-time setup */ });
  afterAll(() => { /* cleanup */ });
  beforeEach(() => { /* per-test setup */ });
  afterEach(() => { /* per-test cleanup */ });

  describe('[MethodName]', () => {
    // Happy path tests
    describe('when valid input provided', () => {
      it('should [expected behavior]', () => {});
    });

    // Edge cases
    describe('edge cases', () => {
      it('should handle empty input', () => {});
      it('should handle boundary values', () => {});
    });

    // Error cases
    describe('error handling', () => {
      it('should throw [ErrorType] when [condition]', () => {});
      it('should return error result when [condition]', () => {});
    });

    // Integration points
    describe('integration', () => {
      it('should interact correctly with [dependency]', () => {});
    });
  });
});
```

## Test Quality Checklist

### Naming Convention
- [ ] Test names describe behavior, not implementation
- [ ] Names follow pattern: `should [behavior] when [condition]`
- [ ] Describe blocks group related tests logically

### Assertions
- [ ] One logical assertion per test (multiple asserts OK if testing one concept)
- [ ] Assertions are specific (not just "truthy")
- [ ] Error messages are descriptive
- [ ] Async assertions properly awaited

### Isolation
- [ ] Tests don't depend on execution order
- [ ] No shared mutable state between tests
- [ ] External dependencies mocked appropriately
- [ ] Database/file state cleaned up

### Maintainability
- [ ] No magic numbers (use constants)
- [ ] Test data factories for complex objects
- [ ] Helper functions for repeated patterns
- [ ] Comments explain non-obvious test logic

## Mock Strategy

```yaml
mock_guidelines:
  always_mock:
    - external APIs
    - file system (unless integration test)
    - network requests
    - time/date (when testing temporal logic)
    - random number generation
    
  never_mock:
    - the code under test
    - simple data structures
    - pure utility functions
    
  mock_sparingly:
    - database (prefer test database)
    - internal services (prefer integration)
    - framework internals
```

## Test Data Management

### Factory Pattern

```typescript
// Use factories for test data
const createUser = (overrides = {}) => ({
  id: faker.string.uuid(),
  email: faker.internet.email(),
  name: faker.person.fullName(),
  createdAt: new Date(),
  ...overrides,
});

// Usage
const adminUser = createUser({ role: 'admin' });
const newUser = createUser({ createdAt: new Date() });
```

### Fixtures

```yaml
fixture_organization:
  location: __fixtures__/ or test/fixtures/
  naming: [entity].[scenario].json
  examples:
    - user.valid.json
    - user.invalid-email.json
    - order.large.json
    - response.error-500.json
```

## Performance Considerations

```yaml
test_performance:
  unit_tests:
    target: < 100ms per test
    total_suite: < 30 seconds
    
  integration_tests:
    target: < 1 second per test
    total_suite: < 5 minutes
    
  optimizations:
    - parallel execution where safe
    - shared setup for read-only fixtures
    - lazy initialization of heavy resources
    - test database pooling
```

## Output Format

When generating tests, provide:

1. **Test file location** following project conventions
2. **Complete test code** with all imports
3. **Coverage report** showing paths tested
4. **Edge cases covered** as checklist
5. **Suggested manual tests** for non-automatable scenarios
