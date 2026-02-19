# Witness — Agent Behavior Linter

## What This Is

Witness is a real-time behavioral linter for AI coding agents. It hooks into tool calls (PreToolUse / PostToolUse) and enforces workflow discipline: don't edit files you haven't read, don't commit with failing tests, don't thrash on the same file, run tests after making changes.

**The linter is the product.** The SQLite fact store, SQL views, and briefing system all exist to serve the lint rules. This is not a general-purpose agent memory system.

## Reading the Docs

Read in this order:

1. **[docs/principles.md](docs/principles.md)** — Design principles. Read first. Every implementation decision should be traceable to a principle. Key ones: never crash the host, deterministic over clever, latency is correctness.

2. **[docs/architecture.md](docs/architecture.md)** — System overview, component diagram, data flow (PreToolUse lint path and PostToolUse record path), storage schema (tables + derived views), hook protocol (stdin/stdout JSON format), performance constraints, directory structure.

3. **[docs/rules.md](docs/rules.md)** — Complete reference for all 7 lint rules. Each rule: trigger conditions, SQL view it queries, rationale, examples of fire vs clean, configuration options. Also covers the configuration file format.

4. **[docs/phases.md](docs/phases.md)** — Implementation broken into 10 phases (0–9). Each phase has: goal, specific work items, deliverable, acceptance criteria, and tests. Phases are ordered by dependency. **Start with Phase 0 and work sequentially.**

5. **[docs/decisions.md](docs/decisions.md)** — Architectural decisions (with rationale and trade-offs) and open questions. Check open questions before making design choices — some are intentionally deferred.

6. **[docs/testing.md](docs/testing.md)** — Testing strategy: integration tests with real SQLite `:memory:` DBs, Effect layer swapping, fixture-based parser tests, CLI integration via process spawning, performance benchmarks.

## Tech Stack

| | |
|---|---|
| Runtime | Bun |
| Language | TypeScript (strict) |
| Effects | Effect |
| SQL | `@effect/sql-sqlite-bun` (tagged template queries) |
| CLI | `@effect/cli` (subcommands) |
| Platform | `@effect/platform-bun` (stdin, fs) |
| Tests | `bun:test` |
| VCS | jj (Jujutsu) |

## Key Invariants

These must never be violated:

1. **PostToolUse (record) exits 0 on any input.** Including garbage, empty stdin, binary data. Parse failures log to stderr and are swallowed.
2. **PreToolUse (lint) exits 0 on any input.** Block/warn are expressed in stdout JSON, not exit codes.
3. **Latency budgets**: lint <30ms, record <50ms. If exceeded, degrade silently (exit 0, no output).
4. **Rules are deterministic.** Same DB state + same input = same result. No randomness, no LLM calls in rules.
5. **Session scoping.** Rules evaluate within the current `session_id`. Cross-session data is only for explicit queries.

## Commands

```
witness init              # Create DB + schema
witness record            # Parse stdin, insert facts (PostToolUse hook)
witness lint              # Evaluate rules against stdin (PreToolUse hook)
witness briefing          # Print situational summary
witness query <name>      # Named queries (failing, regressions, thrashing, etc.)
```

## Working on This Project

- **Before implementing a feature**, check which phase it belongs to in `docs/phases.md` and verify prerequisites are done.
- **Before making a design choice**, check `docs/decisions.md` for prior decisions and open questions.
- **When adding a lint rule**, follow the `LintRule` interface pattern and add integration tests (seed DB → run rule → assert).
- **When adding a parser**, add fixture files with real tool output and never-crash tests with garbage input.
- **When editing any hook path code**, verify it meets the latency budget and the never-crash invariant.
- **Tests are integration tests.** Use real SQLite `:memory:` DBs via Effect layers, not mocks.

## Project Structure

```
witness/
├── .claude-plugin/
│   └── plugin.json        # Plugin manifest
├── docs/
│   ├── architecture.md    # System design, data flow, components
│   ├── principles.md      # Design principles
│   ├── rules.md           # Lint rules reference
│   ├── phases.md          # Implementation phases
│   ├── decisions.md       # ADRs + open questions
│   └── testing.md         # Testing strategy
├── hooks/
│   └── hooks.json         # Claude Code hook definitions
├── skills/
│   └── witness/
│       └── SKILL.md       # Agent-facing usage guide
├── src/
│   ├── main.ts            # CLI entrypoint
│   ├── Db.ts              # SQLite layer
│   ├── Schema.ts          # DDL + views
│   ├── Facts.ts           # Fact types
│   ├── Clock.ts           # Monotonic clock
│   ├── commands/          # Subcommand implementations
│   ├── rules/             # Lint rule implementations
│   └── parsers/           # Tool output parsers
├── test/                  # Integration tests
└── fixtures/              # Sample tool outputs
```
