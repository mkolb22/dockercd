---
name: Schema Validation
description: Validate concept outputs against JSON schemas for early error detection
version: 1.0.0
trigger_keywords: [schema, validation, validate, format, output, json schema]
author: Zen Architecture
---

# Schema Validation - Expert Skill

Validate concept outputs against JSON schemas to catch format errors early and ensure data quality.

## Purpose

Schema validation provides:
- **Early error detection**: Catch format errors immediately after concept execution
- **Clear error messages**: Specific, actionable feedback on what's wrong
- **Fail-fast behavior**: Stop workflow before bad data propagates
- **Documentation**: Schemas serve as formal output format specifications

## When to Use

Use schema validation:
- ✅ After every concept generates output (story, architecture, implementation, etc.)
- ✅ Before saving final concept output
- ✅ As part of quality checks in workflows
- ✅ When debugging format issues

## Available Schemas

| Concept | Schema File | Key Validations |
|---------|-------------|-----------------|
| Story | `story.schema.json` | ID pattern, status enum, acceptance_criteria |
| Architecture | `architecture.schema.json` | ID pattern, risk level, decisions, technical_spec |
| Implementation | `implementation.schema.json` | ID pattern, status, files_changed, blockers |
| Quality Review | `quality-review.schema.json` | ID pattern, security_check, issues |
| Quality Test | `quality-test.schema.json` | ID pattern, results, coverage |
| Version | `version.schema.json` | Branch/tag format, commit SHA |

## Validation Process

### 1. Generate Concept Output

Create the YAML output as usual:

```yaml
# koan/stories/story-001.yaml
story_id: "story-001"
status: "ready"
summary: "Add OAuth - ready, 5 criteria, 0 ambiguities"

details:
  created_at: "2025-11-10T19:00:00Z"
  description: "..."
  acceptance_criteria:
    - "Users can sign in with Google"
    - "Users can sign in with GitHub"
```

### 2. Run Validation

Use the validation script:

```bash
./scripts/validate-concept-output.sh story koan/stories/story-001.yaml
```

### 3. Handle Results

**If validation passes** (exit code 0):
```
✓ Validation passed
✓ story-001.yaml conforms to story schema
```
→ Continue workflow

**If validation fails** (exit code 1):
```
✗ Error: data.story_id must match pattern "^story-[0-9]{3,}$"
✗ Error: data.status must be one of: draft, ready, needs_clarification
✗ Validation failed
```
→ Fix errors and retry

## Common Validation Rules

### ID Patterns

All concept IDs must follow specific patterns:

```yaml
story_id: "story-001"      # ✓ Valid
story_id: "story-1"        # ✗ Invalid (need 3+ digits)
story_id: "STORY-001"      # ✗ Invalid (lowercase only)

architecture_id: "arch-042"  # ✓ Valid
implementation_id: "impl-015" # ✓ Valid
review_id: "review-003"      # ✓ Valid
```

### Status Enums

Status values must match exactly (case-sensitive):

```yaml
# Story
status: "ready"              # ✓ Valid
status: "draft"              # ✓ Valid
status: "Ready"              # ✗ Invalid (wrong case)
status: "in_progress"        # ✗ Invalid (not in enum)

# Architecture
estimated_risk: "low"        # ✓ Valid
estimated_risk: "high"       # ✓ Valid
estimated_risk: "critical"   # ✗ Invalid (not in enum)
```

### Required Fields

Summary section (always required):
```yaml
{concept}_id: "..."    # Required
status: "..."          # Required
summary: "..."         # Required (min 10 chars)
```

Details section (conditionally required):
```yaml
details:
  created_at: "..."    # Required in details
  # Other fields vary by concept
```

### String Lengths

```yaml
# Story title
title: "Add OAuth"                    # ✓ Valid (5-100 chars)
title: "Auth"                         # ✗ Invalid (too short)

# Summary
summary: "OAuth - ready, 5 criteria"  # ✓ Valid (min 10 chars)
summary: "Done"                       # ✗ Invalid (too short)
```

### Timestamps

Use ISO 8601 format:

```yaml
created_at: "2025-11-10T19:00:00Z"    # ✓ Valid
created_at: "2025-11-10 19:00:00"     # ✗ Invalid (wrong format)
created_at: "11/10/2025"              # ✗ Invalid (wrong format)
```

## Integration with Concepts

### In Concept Templates

Add validation step to all concept templates:

```markdown
## After Generating Output

1. **Save to temporary file**
   ```yaml
   temp_file = "koan/stories/.story-001.tmp.yaml"
   ```

2. **Validate output**
   ```bash
   if ! ./scripts/validate-concept-output.sh story "$temp_file"; then
       echo "❌ Output validation failed"
       echo "Review errors above and regenerate output"
       exit 1
   fi
   ```

3. **Move to final location**
   ```bash
   mv "$temp_file" "koan/stories/story-001.yaml"
   echo "✅ Story created and validated: story-001"
   ```
```

### Error Handling

When validation fails:

```yaml
# Set concept status to blocked
status: "blocked"

# Document the validation error
blocker:
  type: "validation_error"
  message: "Output does not conform to schema"
  errors:
    - "story_id must match pattern ^story-[0-9]{3,}$"
    - "acceptance_criteria must have at least 1 item"
  resolution: "Fix format errors and regenerate output"
```

## Validation Examples

### Valid Story Output

```yaml
story_id: "story-001"
status: "ready"
title: "Add OAuth authentication"
summary: "OAuth support - ready, 5 criteria, 0 ambiguities, Google+GitHub"

details:
  created_at: "2025-11-10T19:00:00Z"
  description: |
    Users need the ability to sign in with OAuth providers
    instead of traditional username/password.
  acceptance_criteria:
    - "Users can sign in with Google"
    - "Users can sign in with GitHub"
    - "OAuth tokens are securely stored"
    - "Token refresh works automatically"
    - "Users can disconnect OAuth providers"
  ambiguities: []
  technical_notes: "Use passport.js for OAuth strategy management"
```

**Validation**: ✅ Passes all checks

### Invalid Story Output (Multiple Errors)

```yaml
story_id: "story-1"        # ✗ Wrong pattern (need 3 digits)
status: "In Progress"      # ✗ Not in enum (wrong case)
summary: "OAuth"           # ✗ Too short (min 10 chars)

details:
  created_at: "2025-11-10" # ✗ Wrong format (needs time)
  description: "OAuth"     # ✗ Too short (min 10 chars)
  acceptance_criteria: []  # ✗ Empty array (need at least 1)
```

**Validation**: ❌ Fails with 6 errors

## Performance Impact

### Validation Cost

- **Time**: 50-100ms per file
- **Context**: 0 tokens (runs locally)
- **When**: After concept execution, before workflow continues

### Benefits

- **Catch 90% of format errors** immediately
- **Prevent workflow failures** from bad data
- **Clear error messages** instead of cryptic failures
- **Fail-fast** stops wasted computation

## Troubleshooting

### Common Issues

**Issue**: `yq not found`
```bash
brew install yq
```

**Issue**: `ajv not found`
```bash
npm install -g ajv-cli
```

**Issue**: Pattern validation fails
- Check ID format: `concept-###` (3+ digits)
- Ensure lowercase
- No spaces or special characters

**Issue**: Enum validation fails
- Check exact spelling (case-sensitive)
- Review schema for valid enum values
- Use `jq` or `yq` to inspect YAML structure

**Issue**: Required field missing
- Verify summary section has all required fields
- Check progressive disclosure format
- Ensure `details` object exists if referencing detail fields

## Best Practices

1. **Always validate before saving**
   - Run validation on temporary file first
   - Only save if validation passes

2. **Handle errors gracefully**
   - Log specific validation errors
   - Set concept status to "blocked"
   - Provide clear resolution guidance

3. **Use schemas as documentation**
   - Reference schemas when writing concept outputs
   - Keep schemas updated with concept changes

4. **Test schema changes**
   - Validate existing outputs after schema updates
   - Create test cases for new validations

5. **Fail fast**
   - Stop workflow immediately on validation failure
   - Don't propagate invalid data downstream

## Related Documents

- **schemas/README.md** - Complete schema documentation
- **ZEN_IMPLEMENTATION_PHASES.md** - Day 6-7 implementation
- **ZEN_IMPROVEMENT_PROPOSALS.md** - Proposal #6

---

**Use this skill when**: Validating concept outputs, debugging format issues, ensuring data quality, or implementing new concepts.
