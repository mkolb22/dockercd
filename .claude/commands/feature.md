Create a new feature using the Story concept, then automatically evaluate synchronizations.

When the user runs this command, you should:

1. **Recall Relevant Memories** (automatic, fast)
   - Extract keywords from the feature description
   - Use `memory_recall` to search for relevant memories:
     - Architecture patterns that match keywords
     - Conventions related to the feature area
     - Past patterns from similar features
   - Display relevant memories (if any) before proceeding:
     ```
     📚 Relevant memories found:
     - [architecture] "Authentication uses JWT with RS256" (high confidence)
     - [patterns] "API endpoints follow /api/v1/{resource} convention"
     ```
   - If no relevant memories, proceed silently

2. **Invoke Story Concept**
   - Extract title from user input
   - Use the Task tool with subagent_type matching the story concept
   - Explicitly request model="opus" for cost efficiency
   - Include relevant memories as context for the story concept
   - The concept will prompt for additional details if needed

3. **Read Story Output**
   - Use `dragonfly_story_get` with the story ID to retrieve the story
   - Check the status field

4. **Evaluate Synchronizations Automatically**
   - Read `.claude/synchronizations/feature-development.yaml`
   - Check `story-to-arch` rule:
     - when: story.create completed
     - where: story.status == 'ready' AND criteria.length > 0
     - then: architecture.design

5. **Continue Workflow**
   - If rule matches, automatically invoke Architecture concept
   - Show progress to user
   - Offer to continue full workflow

## Usage

```
/feature "Add dark mode support"
```

## Process Flow

```
User provides feature description
  ↓
Recall relevant memories (fast, ~5ms cached)
  ↓
Display relevant context (if any)
  ↓
Invoke Story concept (Opus) with memory context
  ↓
Story saved via dragonfly_story_save
  ↓
Read story output and sync rules
  ↓
Evaluate story-to-arch rule
  ↓ (if matched)
Ask user: Continue with architecture? (y/n)
  ↓ (if yes)
Invoke Architecture concept (Opus)
  ↓
Auto-remember architecture decisions
  ↓
Evaluate arch-to-impl rule
  ↓
Continue automatically...
```

## Example: Automatic Workflow

```
User: /feature "Add user authentication"

You: I'll create a new feature story for user authentication.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Recalling Relevant Memories
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📚 Found 2 relevant memories:
- [architecture] "API uses JWT tokens with 24h expiry" (high)
- [conventions] "Auth middleware at src/middleware/auth.ts" (medium)

These will be included as context for story capture.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Phase 1: Story Capture
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[Invoke Task tool → story concept → model: opus]

✓ Story created: story-042
  Status: ready
  Acceptance criteria: 5 defined
  Memory context: 2 items applied
  Cost: $0.000175

Evaluating synchronizations...

✓ Matched rule: story-to-arch
  Condition: status=='ready' AND criteria.length>0
  Next step: architecture.design (Opus, ~$0.015)

Continue with architecture design? (y/n)

User: y

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Phase 2: Architecture Design
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[Invoke Task tool → architecture concept → model: opus]

✓ Architecture created: arch-042
  Approach: OAuth2 with Passport.js
  Decisions: 4 documented
  Risks: 2 (both mitigated)
  Cost: $0.015

💾 Auto-remembered 2 architecture decisions:
- "OAuth2 with Passport.js for authentication"
- "Session tokens stored in httpOnly cookies"

Evaluating synchronizations...

✓ Matched rule: arch-to-impl
  Next step: implementation.generate (Opus, ~$0.000175)

Continue with implementation? (y/n)

User: y

[Workflow continues...]

Total workflow cost: $0.0165
Use /trace story-042 to see complete flow.
```

## Example: Story Only (No Auto-Continue)

```
User: /feature "Add dark mode support"

You: I'll create a new feature story.

[Invoke Task tool → story concept → model: opus]

✓ Story created: story-001
  Status: ready
  Acceptance criteria: 4 defined
  Cost: $0.000175

Evaluating synchronizations...

✓ Matched rule: story-to-arch
  Next step: architecture.design (Opus, ~$0.015)

Continue with architecture design? (y/n)

User: n

Story created. You can continue later with:
- /sync --execute (continue workflow)
- /workflow "story-001" (run full workflow)
- /trace story-001 (see current state)
```

## User Control

After story creation, you can:
- **Continue automatically**: Say "yes" when prompted
- **Stop and review**: Say "no" to pause workflow
- **Resume later**: Use `/sync --execute`
- **Full automation**: Use `/workflow` instead of `/feature`

## Options

The `/feature` command has different modes:

**Interactive (default)**:
```
/feature "Add OAuth"
# Prompts after each step
```

**Automatic**:
```
/feature "Add OAuth" --auto
# Runs complete workflow without prompts
```

**Story only**:
```
/feature "Add OAuth" --story-only
# Creates story, stops (no sync evaluation)
```

## Remember

- The Story concept captures requirements (the "what" and "why")
- Story does NOT design or implement (that's Architecture and Implementation)
- Synchronizations orchestrate the workflow automatically
- User maintains control with prompts

## Related Commands

- `/workflow` - Full automatic workflow (no prompts)
- `/sync` - Manual sync evaluation
- `/trace` - See workflow progress
