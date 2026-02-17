# Design Principles

Each principle is grounded in the specific problem: linting AI agent behavior in real-time via tool call hooks.

## 1. The Linter is the Product

The memory/fact store exists to serve lint rules. SQL views exist to derive lint conditions. Briefings surface lint state. Everything serves the linter.

**Test**: For every feature, ask: "Which lint rule or query does this enable?" If the answer is "none — it's useful context," it's not a priority.

**Anti-pattern**: Building a general-purpose agent memory system, then hoping lint rules emerge from it.

## 2. Never Crash the Host

This runs as hooks on every tool call an agent makes. A crash in PostToolUse blocks the agent's workflow. A crash in PreToolUse could hang the entire session.

**Rules**:
- PostToolUse (record): Exit 0 **always**. Parse failures are logged to stderr and swallowed.
- PreToolUse (lint): Exit 0 always. DB errors result in silent allow (not a crash).
- Use Effect's typed error channels to make this structural, not hopeful:
  - `ParseError` → `Effect.catchTag("ParseError", () => Effect.void)` at the boundary
  - `SqlError` → fatal only in test/development, graceful in production hooks

**Test**: Feed garbage to stdin. The process must exit 0 with no stdout.

## 3. Deterministic Over Clever

Rules are SQL queries against indexed views. No heuristics, no LLM-in-the-loop, no probabilistic matching. If a condition is true in the DB, the rule fires. Period.

**Why this matters**: The whole thesis is that LLMs have the information to avoid mistakes but reliably don't. The fix is deterministic enforcement, not more LLM reasoning about whether to enforce.

**Test**: Given identical DB state and identical tool call input, the same rules fire with the same results. Always.

## 4. Latency is Correctness

Hooks are on the critical path of every tool call. A slow hook degrades the entire agent experience. Agent operators will disable hooks that add perceived latency.

**Budgets**:
- PreToolUse: <30ms total (including Bun cold start)
- PostToolUse: <50ms total

**Strategy**: If you can't meet budget, **degrade silently** — exit 0, no output, no lint results. A slow linter is functionally equivalent to no linter, but worse because it also wastes time.

**Test**: Benchmark in CI. Fail the build if median exceeds 2× budget.

## 5. Warn Before Block

Most rules default to `warn` (inject context into the agent's next response) not `block` (deny the tool call). The agent should have the chance to course-correct from a warning.

`block` is reserved for clearly destructive patterns:
- **Thrashing**: Editing the same file 3+ times with failures persisting. The agent is stuck.
- **Commit while failing**: Self-evidently wrong.

Everything else warns. The warning is a nudge, not a wall.

**Escalation**: Open question whether repeated warnings should auto-escalate to block. Not in v1.

## 6. Composable Rules

Each rule is a pure function:

```typescript
(input: HookInput) => Effect<string | null, SqlError, SqlClient>
```

Returns `null` if clean. Returns a reason string if violated.

**Composition**: Rules compose via `Effect.all`. Adding a rule = adding one item to an array. No rule reads another rule's output. No rule has side effects beyond reading the DB.

**Test**: Each rule is testable in isolation — seed DB, run rule, assert result.

## 7. Passive Observation

The fact store builds itself entirely from observing tool calls. The agent does not need to run special commands or annotate its actions.

- Import graphs build from file reads (regex extraction of import statements)
- Test state builds from test command output (parser extracts results)
- File event history builds from Edit/Read/Write tool tracking

The only explicit command the agent runs is `witness briefing` to read the current state.

**Test**: After a natural sequence of tool calls (read, edit, test), the DB contains the expected facts without any extra commands.

## 8. Structured Over Unstructured

Relational queries, not embeddings. SQL views, not vector search. Tagged unions, not string parsing. The domain is inherently structured:

- Tool calls have known shapes (tool_name, tool_input, tool_output)
- Test results have known fields (test_name, outcome, message)  
- File events have known types (read, edit, create, delete)
- Import statements have known patterns per language

Use the structure. Don't throw away information by embedding it into a vector.

## 9. Testability by Construction

Effect's layer system means the DB dependency is injectable. Tests swap `SqliteClient.layer` with an in-memory DB, seed known facts, run a rule or command, and assert the result.

**No mocking frameworks**. No test doubles for the database. The real SQL engine runs against real tables with controlled data.

```typescript
const TestLayer = SqliteClient.layer({ filename: ":memory:" }).pipe(
  Layer.provide(SchemaLayer) // applies DDL
)
// Seed → run → assert. That's it.
```

**Test**: Every lint rule has at least two integration tests — one that fires, one that doesn't — running against a real SQLite :memory: DB.

## 10. Session-Scoped, DB-Persistent

Each agent session gets a `session_id` (UUID). Lint rules evaluate within session scope — a file read in a previous session doesn't satisfy `no_edit_unread` in the current session.

But the DB file persists across sessions. This enables:
- Cross-session analysis: find flaky tests, recurring regressions
- Historical queries: when was this file last edited? How often does this test fail?
- Multi-agent future: different session_ids in the same DB

**Rule**: Session-scoped by default. Cross-session only in explicit queries.
