# Witness

Witness observes every tool call an AI coding agent makes, records structured facts into SQLite, and derives useful state from them — which tests are failing, what files were edited, what broke after a change, what depends on what.

Out of the box it's a passive observer: it records facts and lets you query them. Optionally, you can enable lint rules that warn or block the agent when it falls into bad patterns (editing without reading, committing with failing tests, thrashing on a file).

## Prerequisites

- [Bun](https://bun.sh) v1.0+

## Installation

### As a Claude Code plugin

```bash
# From the plugin directory
claude plugin install --path /path/to/witness

# Or during development
claude --plugin-dir /path/to/witness
```

After installing, run `bun install` inside the plugin directory if you haven't already.

The plugin automatically wires up all three hooks:
- **PostToolUse** → `witness record` (records facts after each tool call)
- **PreToolUse** → `witness lint` (evaluates rules, if any are enabled)
- **SessionStart** → `witness init` (creates the DB if needed)

### Manual hook setup

If you prefer to configure hooks yourself, add this to your `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bun run /path/to/witness/src/main.ts lint"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bun run /path/to/witness/src/main.ts record"
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bun run /path/to/witness/src/main.ts init"
          }
        ]
      }
    ]
  }
}
```

## How It Works

Witness runs as two hooks on every tool call:

1. **PostToolUse** (`witness record`): After a tool runs, parse the output and insert structured facts into SQLite.
2. **PreToolUse** (`witness lint`): Before a tool runs, evaluate any enabled lint rules against the DB state.

Both hooks read JSON from stdin and exit 0 always. They never crash the agent, even on malformed input.

## Queries

The primary interface. Witness records facts passively — you query them when you need situational awareness.

### `witness briefing`

Markdown summary of the current session: failing tests, regressions, thrashing files, untested edits, blast radius, session stats. Empty sections are omitted.

### `witness query <name> [arg]`

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

## Lint Rules

All rules are **off by default**. Enable them in `.witness.json` in your project root:

```json
{
  "rules": {
    "no_edit_unread": "warn",
    "no_commit_failing": "block"
  }
}
```

Each rule can be `"warn"`, `"block"`, `"off"`, or `["action", { options }]`.

| Rule | Fires when |
|------|------------|
| `no_edit_unread` | Editing a file you haven't read this session |
| `test_after_edits` | N+ edits without running tests (default threshold: 3) |
| `fix_regressions_first` | Editing new files while regressions exist |
| `no_pointless_rerun` | Re-running tests with no edits since last run |
| `no_thrashing` | N+ edits to the same file with failures persisting (default threshold: 3) |
| `no_commit_failing` | Committing while tests are failing |
| `scope_check` | Editing files outside the blast radius of current work |

## Parsers

Witness automatically parses output from these tools:

- **File operations**: Edit, Write, Read, str_replace_editor, file_create, view
- **Test runners**: jest, vitest, mocha, pytest, go test, cargo test, bun test
- **Linters**: eslint, biome, flake8, ruff
- **Type checkers**: tsc, mypy, pyright

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `WITNESS_DB` | `.witness/witness.db` | Path to the SQLite database |
| `WITNESS_SESSION` | `default` | Session ID for scoping facts and rules |

## Architecture

```
stdin JSON → Parser Router → Fact[] → SQLite tables → SQL views → Lint rules → stdout JSON
```

- **Facts**: Append-only rows (tool_calls, file_events, test_results, lint_results, type_errors, imports)
- **Views**: Derived state (failing_tests, regressions, thrashing, blast_radius, etc.)
- **Rules**: Pure functions that query views and return violations
- **Clock**: Monotonic logical clock per session for causal ordering

## Development

```bash
bun install
bun test
bunx tsc --noEmit
```

## License

MIT
