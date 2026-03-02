Run a competitive evaluation comparing Zen-assisted vs vanilla Claude Code generation.

When the user runs this command, you should:

1. **Resolve the spec**
   - If the user provides a spec ID directly, use it
   - If they provide a spec name, use `zen_spec_get` with `name` to find the ID
   - If no argument, use `zen_spec_get` with `latest: true`

2. **Start the competition**
   - Call `compete_start` with the spec_id
   - Display the session ID and configuration
   - Show the evaluation dimensions and weights

3. **Run rounds in parallel**
   For each round (1 to N):
   - Launch a **control arm** subagent (worktree, model: sonnet) with the control_prompt
     - The control agent generates code from the spec with NO MCP tools
   - Launch a **treatment arm** subagent (worktree, model: sonnet) with the treatment_prompt
     - The treatment agent uses full zen MCP tools
   - Both run in parallel via Task tool with `isolation: "worktree"`

4. **Evaluate each arm**
   After both arms complete for a round:
   - Use the evaluation_instructions to score each output
   - Call `compete_submit` for each arm with the 6-dimension scores
   - Display round results as they complete

5. **Report results**
   - After all rounds, display the CompeteSummary:
     - Overall winner
     - Per-dimension p-values and effect sizes
     - Composite statistics
   - If treatment wins, offer to run ablation testing

6. **Optional: Ablation testing**
   If the user agrees to ablation:
   - Call `compete_ablate_start` to get per-category prompts
   - For each category × rounds, launch subagents with ablation prompts
   - Call `compete_ablate_submit` for each run
   - Display the minimal effective toolset

## Usage

```
/compete <spec-id>              # Run with specific spec
/compete string-utils           # Run with spec by name
/compete                        # Run with latest spec
/compete <spec-id> --rounds 10  # Override round count
```

## What It Measures

| Dimension | Weight | Go Command |
|-----------|--------|------------|
| correctness | 0.30 | `go test -race -count=1 ./...` |
| contracts | 0.20 | `go test -run TestProperty ./...` |
| security | 0.20 | `gosec ./...` |
| performance | 0.10 | `go test -bench=. -benchmem ./...` |
| complexity | 0.10 | `gocyclo -avg .` |
| lint | 0.10 | `go vet ./... && staticcheck ./...` |

## Statistical Methods

- **Welch's t-test**: Unequal variance comparison between arms
- **Cohen's d**: Effect size measurement (small=0.2, medium=0.5, large=0.8)
- **Significance level**: Default α=0.05 (configurable)

## Example Output

```
Competition Complete: 5 rounds

Overall Winner: treatment (p=0.003, d=1.42)

Dimension Analysis:
  correctness:  treatment wins (p=0.01, d=1.1)
  contracts:    treatment wins (p=0.02, d=0.9)
  security:     inconclusive  (p=0.15, d=0.4)
  performance:  inconclusive  (p=0.08, d=0.5)
  complexity:   treatment wins (p=0.04, d=0.8)
  lint:         inconclusive  (p=0.22, d=0.3)

Run ablation testing? (y/n)
```

## Related Commands

- `/spec` - Define specifications for evaluation
- `/feature` - Start a new feature workflow
