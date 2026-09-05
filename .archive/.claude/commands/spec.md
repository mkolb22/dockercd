---
name: spec
description: "Define a specification and generate type-safe code"
---

# /spec Command

Define structured specifications with types, contracts (pre/post conditions), effects, and properties. Then generate idiomatic code in any target language (Go, Swift, Rust, TypeScript, Python).

## Usage

```
/spec "string utilities in Go"         # Create a new spec interactively
/spec generate <id>                     # Generate code from a saved spec
/spec list                              # List saved specs
/spec get <id>                          # View a spec
/spec export <id> "path/to/file.json"  # Export spec to portable JSON
/spec import "path/to/file.json"       # Import specs from JSON file
```

## Workflow

### 1. Parse user intent

Determine the action from the arguments:
- If args contain "generate": go to step 4
- If args contain "list": go to step 5
- If args contain "get": go to step 6
- If args contain "export": go to step 7
- If args contain "import": go to step 8
- Otherwise: create a new spec (step 2)

### 2. Define the specification interactively

Work with the user to build the spec:

a) **Identify the module**: Name, description, target language
b) **Define types**: Custom types with fields and constraints
c) **Define functions**: For each function, capture:
   - Name, parameters (with types and constraints), return type
   - Preconditions (`requires`): What must be true before calling
   - Postconditions (`ensures`): What must be true after returning
   - Effects: IO, network, database, filesystem, or none
   - Error cases: What can go wrong
d) **Define properties**: Invariants that should hold for all inputs
   - Use `forall` for universally quantified variables
   - Express as boolean expressions

### 3. Save the specification

Call `zen_spec_save` with the assembled SpecData:

```
zen_spec_save({
  name: "string-utils",
  data: {
    name: "string-utils",
    description: "String utility functions with safe truncation",
    target_language: "go",
    types: [...],
    functions: [
      {
        name: "truncate",
        params: [
          { name: "s", type: "string" },
          { name: "maxLen", type: "int", constraints: "> 0" }
        ],
        returns: "string",
        requires: ["maxLen > 0"],
        ensures: ["len(result) <= maxLen"],
        errors: ["maxLen <= 0"],
        effects: [{ type: "none" }],
        description: "Truncate string to maxLen characters"
      }
    ],
    properties: [
      {
        name: "truncate-bounded",
        description: "Truncated string never exceeds maxLen",
        forall: ["s: string", "n: int"],
        body: "len(truncate(s, n)) <= n"
      }
    ]
  }
})
```

Show the user a summary of the saved spec.

### 4. Generate code prompt

Call `zen_spec_generate` with the spec ID:

```
zen_spec_generate({ id: "<spec-id>" })
```

The returned `prompt` field contains a structured code generation prompt with:
- Type definitions mapped to the target language
- Function signatures with contracts as comments
- Property-based test specifications
- A verification checklist

Use this prompt to generate the actual code. After generating:
- Review the code against the verification checklist
- Ensure all preconditions are enforced
- Ensure all postconditions hold
- Write property-based tests

### 5. List specs

Call `zen_spec_list` with optional filters:
- `status`: draft, ready, generating, generated, verified
- `target_language`: go, swift, rust, typescript, python
- `limit`: max results (default 20)

### 6. Get a spec

Call `zen_spec_get` with:
- `id`: specific spec ID
- `name`: latest spec with that name
- `latest: true`: most recent spec

Display the full spec with types, functions, properties, and status.

### 7. Export specs

Call `zen_spec_export` with:
- `id`: export a single spec by ID
- `name`: export a single spec by name
- `all: true`: export all specs
- `file_path`: output path (e.g., `specs/my-specs.zenspec.json`)

The exported file uses a portable JSON format (array of specs) that strips internal fields like `id` and timestamps. Share the file across projects or check it into version control.

### 8. Import specs

Call `zen_spec_import` with:
- `file_path`: path to the `.zenspec.json` file
- `overwrite`: set to `true` to replace existing specs with the same name (default: skip)

New IDs are generated for each imported spec. Reports imported count, skipped count, and any validation errors.

## Spec Language Reference

### Type Notation
- Primitives: `string`, `int`, `float`, `bool`, `bytes`, `any`
- Lists: `[]string`, `[]int`
- Optionals: `?string`, `?int`
- Maps: `map[string]int`
- Custom: Any identifier (e.g., `Config`, `UserProfile`)

Types are automatically mapped to the target language:
| Spec    | Go        | Swift     | Rust         | TypeScript | Python       |
|---------|-----------|-----------|--------------|------------|--------------|
| string  | string    | String    | String       | string     | str          |
| int     | int       | Int       | i64          | number     | int          |
| []T     | []T       | [T]       | Vec\<T\>     | T[]        | list[T]      |
| ?T      | *T        | T?        | Option\<T\>  | T\|undef   | Optional[T]  |

## Related Commands

- `/feature` - Full feature workflow (story → architecture → implementation)
- `/checkpoint` - Save session state
