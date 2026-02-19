# Witness — Agent Observer

## What It Does

Witness passively records every tool call you make into a SQLite fact store — file edits, test results, lint output, type errors, import graphs. You can query this state at any time for situational awareness.

If lint rules are enabled in the project's `.witness.json`, witness may also warn or block tool calls that match bad patterns.

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

## When You See Warnings

If lint rules are enabled, witness injects warnings as context messages. When you see `[witness]`:

- **no_edit_unread** — Read the file first before editing it.
- **test_after_edits** — You've made several edits without running tests. Run your test suite.
- **fix_regressions_first** — A test broke after your edit. Fix it before editing other files.
- **no_pointless_rerun** — You're re-running tests without changing anything. Edit code first.
- **scope_check** — You're editing a file outside the scope of your current changes.
- **no_thrashing** — You've edited the same file multiple times with failures persisting. Stop, re-read the file, and reconsider your approach.
- **no_commit_failing** — Tests are failing. Fix them before committing.

## Best Practices

1. **Check the briefing** when starting work or when you feel lost.
2. **Read before you edit.** Always Read a file before making changes.
3. **Test frequently.** Run tests after every 2-3 edits.
4. **Fix regressions immediately.** If a test breaks, fix it before moving on.
