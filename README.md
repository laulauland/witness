# Witness

A real-time behavioral linter for AI coding agents. Witness hooks into an agent's tool call lifecycle to intercept bad workflow patterns — editing without reading, thrashing on a file, committing with failing tests, making changes without testing them.

**The linter is the product.** Witness observes every tool call, builds a fact store in SQLite, and evaluates deterministic lint rules against derived SQL views. No heuristics, no LLM-in-the-loop — just structured enforcement of good engineering practices.

## Prerequisites

- [Bun](https://bun.sh) v1.0+

## Installation

```bash
# Clone the repository
git clone https://github.com/your-org/witness.git
cd witness

# Install dependencies
bun install

# Verify it works
bun run src/main.ts --help
```

### Optional: Add to PATH

```bash
# Create a wrapper script
echo '#!/bin/bash\nbun run /path/to/witness/src/main.ts "$@"' > ~/.local/bin/witness
chmod +x ~/.local/bin/witness
```

## Quick Start

```bash
# 1. Initialize the database
witness init

# 2. Wire up hooks (see "Hook Integration" below)

# 3. Start working — witness runs automatically on every tool call
```

## How It Works

Witness runs as two hooks on every AI agent tool call:

1. **PreToolUse** (`witness lint`): Before a tool runs, evaluate lint rules. May warn or block.
2. **PostToolUse** (`witness record`): After a tool runs, record facts into the DB.

Both hooks read JSON from stdin and exit 0 always. They never crash the agent, even on malformed input.

```
Agent tool call → PreToolUse (lint) → [allow / warn / block]
                → tool executes
                → PostToolUse (record) → facts inserted into SQLite
```

## Hook Integration with Claude Code

Add the following to your Claude Code settings (`.claude/settings.json` or project settings):

```json
{
  "hooks": {
    "PreToolUse": [
      { "type": "command", "command": "witness lint" }
    ],
    "PostToolUse": [
      { "type": "command", "command": "witness record" }
    ],
    "SessionStart": [
      { "type": "command", "command": "witness init" }
    ]
  }
}
```

A ready-to-use snippet is provided in [`settings-snippet.json`](settings-snippet.json).

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `WITNESS_DB` | `.witness/witness.db` | Path to the SQLite database |
| `WITNESS_SESSION` | `default` | Session ID for scoping facts and rules |

## Commands

### `witness init`

Create the database directory and apply the schema. Idempotent — safe to run multiple times.

```bash
witness init
# witness: initialized database at /path/to/.witness/witness.db
```

### `witness record`

PostToolUse hook handler. Reads JSON from stdin, records facts into the DB. **Exits 0 always.**

```bash
echo '{"tool_name":"Edit","tool_input":{"path":"src/foo.ts"},"tool_output":"done"}' | witness record
```

### `witness lint`

PreToolUse hook handler. Reads JSON from stdin, evaluates lint rules, outputs allow/warn/block JSON. **Exits 0 always.**

```bash
echo '{"tool_name":"Edit","tool_input":{"path":"src/foo.ts"}}' | witness lint
```

Output (when a rule fires):
```json
{
  "decision": "approve",
  "additionalContext": "[witness] ⚠️ no_edit_unread: src/foo.ts has not been read this session. Read it first to understand the current state."
}
```

### `witness briefing`

Print a markdown situational summary. Sections are omitted when empty.

```bash
witness briefing
```

Sections: Tests, Regressions, Thrashing, Untested Edits, Blast Radius, Session Stats.

### `witness query <name> [arg]`

Run a named query.

| Query | Description | Argument |
|-------|-------------|----------|
| `failing` | Currently failing tests | — |
| `passing` | Currently passing tests | — |
| `regressions` | Tests that broke after edits | — |
| `thrashing` | Files in edit-fail loops | — |
| `history` | Edit timeline for a file | `<file>` |
| `test-history` | Pass/fail timeline for a test | `<test>` |
| `untested` | Files edited but not tested | — |
| `lint` | Current lint/type errors | — |
| `fixes` | Edits that fixed tests | — |
| `clusters` | Error clusters (same message) | — |
| `timeline` | Last N tool calls | `[n]` (default 20) |
| `stats` | Session summary | — |
| `blast` | Reverse dependencies | `<file>` |
| `deps` | Forward dependencies | `<file>` |

## Configuration

Create `.witness.json` in your project root:

```json
{
  "rules": {
    "no_edit_unread": "warn",
    "fix_regressions_first": "warn",
    "test_after_edits": ["warn", { "threshold": 3 }],
    "no_thrashing": ["block", { "threshold": 3 }],
    "no_commit_failing": "block",
    "no_pointless_rerun": "warn",
    "scope_check": "off"
  }
}
```

Each rule can be:
- `"warn"` — Allow the tool call but inject a context message
- `"block"` — Deny the tool call
- `"off"` — Disable the rule
- `["action", { options }]` — Action with rule-specific options

If no config file exists, sensible defaults apply.

## Lint Rules

### `no_edit_unread` (default: warn)

Don't edit files you haven't read. Fires when editing a file that has no prior `read` event in the current session.

### `fix_regressions_first` (default: warn)

Fix what you broke before moving on. Fires when editing file B while regressions exist from editing file A.

### `test_after_edits` (default: warn, threshold: 3)

Don't make many changes without checking if they work. Fires when the number of edits since the last test run exceeds the threshold.

### `no_thrashing` (default: block, threshold: 3)

If you've tried 3 times and it's still broken, stop and think. Fires when a file has been edited N+ times with test failures persisting after each edit.

### `no_commit_failing` (default: block)

Never commit broken code. Blocks `git commit` when any tests are currently failing.

### `no_pointless_rerun` (default: warn)

Don't re-run tests expecting different results. Fires when running tests with no edits since the last test run.

### `scope_check` (default: off)

Stay focused on what you're working on. Fires when editing a file outside the blast radius of previously edited files and not previously read.

## Parsers

Witness automatically parses output from common tools:

- **File tools**: Edit, Write, Read, str_replace_editor, file_create, view
- **Test runners**: jest, vitest, mocha, pytest, go test, cargo test, bun test
- **Linters**: eslint, flake8, ruff
- **Type checkers**: tsc, mypy, pyright

## Architecture

```
stdin JSON → Parser Router → Fact[] → SQLite tables → SQL views → Lint rules → stdout JSON
```

- **Facts**: Append-only rows in SQLite tables (tool_calls, file_events, test_results, etc.)
- **Views**: Derived state (failing_tests, regressions, thrashing, blast_radius, etc.)
- **Rules**: Pure functions that query views and return violations
- **Clock**: Monotonic logical clock per session for causal ordering

## Development

```bash
# Run tests
bun test

# Type check
bunx tsc --noEmit

# Run a specific test
bun test test/rules/no-edit-unread.test.ts
```

## Design Principles

1. **Never crash the host** — Hooks exit 0 always, even on garbage input
2. **Deterministic over clever** — Rules are SQL queries, not heuristics
3. **Latency is correctness** — <30ms lint, <50ms record
4. **Warn before block** — Most rules warn; block is reserved for destructive patterns
5. **Passive observation** — Facts build from observing tool calls, no extra commands needed
6. **Session-scoped rules, persistent DB** — Rules evaluate within session; DB persists across sessions

## License

MIT
