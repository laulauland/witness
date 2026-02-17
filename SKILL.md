# Witness — Behavioral Linter for AI Agents

## What It Does

Witness monitors your tool calls in real time and enforces workflow discipline:

- **Don't edit files you haven't read** — prevents blind edits
- **Run tests after making changes** — catches regressions early
- **Don't commit with failing tests** — blocks broken commits
- **Fix regressions before moving on** — keeps focus on breakage
- **Don't thrash** — stops repeated failing edits to the same file
- **Don't re-run tests without changes** — prevents wasted cycles

## Setup

Witness should already be configured as hooks in your environment. If not:

1. Run `witness init` to create the database (or it auto-creates on first use)
2. The hooks are wired automatically:
   - **PreToolUse** → `witness lint` (checks rules before each tool call)
   - **PostToolUse** → `witness record` (records facts after each tool call)

## When You See Warnings

Witness injects warnings as context messages. When you see `[witness] ⚠️`:

- **no_edit_unread** — Read the file first before editing it. Use the Read tool.
- **test_after_edits** — You've made several edits without running tests. Run your test suite.
- **fix_regressions_first** — A test broke after your edit. Fix it before editing other files.
- **no_pointless_rerun** — You're re-running tests without changing anything. Edit code first.
- **scope_check** — You're editing a file outside the scope of your current changes.

## When You See Blocks

Witness blocks tool calls with `[witness] 🛑`:

- **no_thrashing** — You've edited the same file 3+ times with failures persisting. Stop, re-read the file, check the test output, and reconsider your approach.
- **no_commit_failing** — Tests are failing. Fix them before committing.

## Situational Awareness

Run these commands when you need orientation:

### Briefing

```bash
witness briefing
```

Prints a markdown summary: failing tests, regressions, thrashing files, untested edits, blast radius, session stats. Omits empty sections.

### Named Queries

```bash
witness query failing           # Currently failing tests with messages
witness query passing           # Currently passing tests
witness query regressions       # Tests that broke after edits, with likely cause
witness query thrashing         # Files stuck in edit-fail loops
witness query history <file>    # Edit/read timeline for a file
witness query test-history <t>  # Pass/fail timeline for a test
witness query untested          # Files edited but not tested since
witness query lint              # Current lint/type errors
witness query fixes             # Edits that fixed tests
witness query clusters          # Failing tests grouped by error message
witness query timeline [n]      # Last n tool calls (default 20)
witness query stats             # Session summary
witness query blast <file>      # Files that depend on this file
witness query deps <file>       # Files this file depends on
```

## Best Practices

1. **Read before you edit.** Always Read a file before making changes.
2. **Test frequently.** Run tests after every 2-3 edits.
3. **Fix regressions immediately.** If a test breaks, fix it before moving on.
4. **If blocked by thrashing**, step back: re-read the file, check the full test output, consider a different approach.
5. **Check the briefing** when starting work or when you feel lost.
