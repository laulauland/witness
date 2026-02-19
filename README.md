# Witness

A real-time behavioral linter for AI coding agents. Witness hooks into tool calls to intercept bad workflow patterns — editing without reading, thrashing on a file, committing with failing tests, making changes without testing them.

**The linter is the product.** Witness observes every tool call, builds a fact store in SQLite, and evaluates deterministic lint rules against derived SQL views. No heuristics, no LLM-in-the-loop — just structured enforcement of good engineering practices.

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
- **PreToolUse** → `witness lint` (checks rules before each tool call)
- **PostToolUse** → `witness record` (records facts after each tool call)
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

Witness runs as two hooks on every AI agent tool call:

1. **PreToolUse** (`witness lint`): Before a tool runs, evaluate lint rules. May warn or block.
2. **PostToolUse** (`witness record`): After a tool runs, record facts into the DB.

Both hooks read JSON from stdin and exit 0 always. They never crash the agent, even on malformed input.

```
Agent tool call → PreToolUse (lint) → [allow / warn / block]
                → tool executes
                → PostToolUse (record) → facts inserted into SQLite
```

## Lint Rules

| Rule | Default | Fires when |
|------|---------|------------|
| `no_edit_unread` | warn | Editing a file you haven't read this session |
| `test_after_edits` | warn | 3+ edits without running tests |
| `fix_regressions_first` | warn | Editing new files while regressions exist |
| `no_pointless_rerun` | warn | Re-running tests with no edits since last run |
| `no_thrashing` | block | 3+ edits to the same file with failures persisting |
| `no_commit_failing` | block | Committing while tests are failing |
| `scope_check` | off | Editing files outside the blast radius of current work |

## Configuration

Create `.witness.json` in your project root to override defaults:

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

Each rule can be `"warn"`, `"block"`, `"off"`, or `["action", { options }]`.

## Commands

### `witness briefing`

Print a markdown situational summary: failing tests, regressions, thrashing files, untested edits, blast radius, session stats. Empty sections are omitted.

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

## Design Principles

1. **Never crash the host** — Hooks exit 0 always, even on garbage input
2. **Deterministic over clever** — Rules are SQL queries, not heuristics
3. **Latency is correctness** — <30ms lint, <50ms record
4. **Warn before block** — Most rules warn; block is reserved for destructive patterns
5. **Passive observation** — Facts build from observing tool calls, no extra commands needed

## License

MIT
