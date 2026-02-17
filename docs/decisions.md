# Decisions & Open Questions

## Decided

### D1: Linter-first framing over memory-first

- **Context**: Previous iteration framed this as "Datalog memory layer for agent reasoning"
- **Decision**: Reframe as behavioral linter. Memory exists to serve the linter.
- **Rationale**: The actual value is intercepting bad patterns deterministically. The memory layer is an implementation detail. Framing it as memory leads to building a general-purpose event store; framing it as a linter keeps focus on the rules and the enforcement.
- **Trade-off**: Limits extensibility as a general-purpose agent memory. Worth it for focus.

### D2: Effect over plain TypeScript

- **Context**: Effect adds learning curve and bundle size
- **Decision**: Use Effect throughout for error channels, resource management, composability, and testability
- **Rationale**: The problem has specific properties Effect addresses:
  1. **Two error channels**: `ParseError` (recoverable, log and continue) vs `SqlError` (fatal). Makes the never-crash guarantee structural.
  2. **Scoped resources**: DB connection opens on hook entry, closes on exit. No dangling connections on timeout.
  3. **Rule composition**: Each rule is `Effect<string | null, SqlError, SqlClient>`. Compose with `Effect.all`.
  4. **Testability**: Swap `SqliteClient.layer` with `:memory:` DB. No mocking.
- **Trade-off**: Contributors need Effect knowledge. Mitigated by consistent patterns and clear examples in codebase.

### D3: SQLite with file persistence over in-memory-only

- **Context**: Could use pure in-memory data structures for maximum speed
- **Decision**: SQLite with file persistence, using Bun's native binding
- **Rationale**:
  - SQL views as derived state — views update automatically on INSERT, no manual bookkeeping
  - Recursive CTEs for dependency graph traversal
  - Cross-session analysis (flaky test detection, recurring patterns)
  - WAL mode for concurrent read/write
  - Bun's native SQLite is fast enough for the latency budget
- **Trade-off**: ~5ms added per query vs in-memory. Acceptable within budget.

### D4: Bun-only runtime

- **Context**: Could target Node.js for wider compatibility
- **Decision**: Bun-only
- **Rationale**: Cold start time is the critical constraint. Bun starts in ~15ms vs Node ~50-100ms. This matters because hooks fire on *every* tool call. Bun also provides native SQLite binding without additional dependencies.
- **Trade-off**: Requires Bun installation. Acceptable for developer tooling targeting developers.

### D5: Regex-based import parsing over AST parsing

- **Context**: Could use tree-sitter or language-specific AST parsers for accurate import extraction
- **Decision**: Regex-based, approximate import extraction
- **Rationale**: The import graph is used for blast radius and scope check — both fuzzy concepts where approximate is good enough. Full AST parsing would blow the latency budget on file reads and add heavy dependencies.
- **Trade-off**: May miss dynamic imports, complex re-exports, conditional imports. Acceptable because the scope_check rule is off by default and the data is advisory.

### D6: stdin/stdout JSON protocol

- **Context**: Could use IPC, HTTP, gRPC, or filesystem-based communication
- **Decision**: stdin JSON → stdout JSON, matching Claude Code's hook protocol
- **Rationale**: Universal, no server process to manage, no port conflicts, works in any environment. Compatible with any agent framework that has pre/post tool hooks via process spawning.
- **Status**: This is the protocol Claude Code uses for hooks. If other frameworks use different protocols, adapters can wrap the same binary.

### D7: Session-scoped rules, persistent DB

- **Context**: Could scope everything to a single session (ephemeral DB) or make everything cross-session
- **Decision**: Rules evaluate within session scope. DB persists across sessions.
- **Rationale**: A file read in yesterday's session shouldn't satisfy today's `no_edit_unread`. But the DB should persist so that cross-session queries work (flaky test detection, historical analysis). The `session_id` column enables both.

---

## Open Questions

### Q1: Per-project vs per-task configuration

Should rule configuration be per-project (`.witness.json`) or injectable per-task (env var, CLI arg)?

| Option | Pro | Con |
|--------|-----|-----|
| Per-project only | Simple, version-controllable | Same strictness for exploration and focused work |
| Per-task via env var | Different strictness per task | Config sprawl, harder to reason about |
| Both (env overrides file) | Flexible | Complexity |

**Current stance**: Start per-project. Add `WITNESS_RULES_<name>=warn|block|off` env var override if needed.

### Q2: Warn deduplication

Should `warn` fire on every violation, or only on first occurrence?

| Option | Pro | Con |
|--------|-----|-----|
| Every time | Agent always sees it | Noise if ignored |
| First only | Less noise | Agent forgets |
| First N times | Compromise | Magic number |
| With cooldown | Time-based suppression | Complexity |

**Current stance**: Every time. The agent has no persistent memory across turns — if we suppress, it may never learn. Revisit if it causes agent confusion or prompt pollution.

### Q3: Severity escalation

Should a rule that fires as `warn` N times auto-escalate to `block`?

**Argument for**: Prevents agent from ignoring warnings indefinitely. A warning that fires 5 times clearly isn't working as a nudge.

**Argument against**: Adds complexity. May be overly aggressive for rules where the agent has legitimate reasons to override (e.g., scope_check during exploration).

**Current stance**: Not in v1. Track warn counts in the DB. Add escalation as a configurable option if warn-ignoring is observed in practice.

### Q4: LLM reasoning tracking

Currently only tool calls are tracked. If agent frameworks expose thinking/planning hooks, should we lint reasoning patterns?

**Potential rules**: "You planned to do X but are now doing Y" (plan drift), "You acknowledged a regression but haven't addressed it" (cognitive dissonance).

**Blockers**: Reasoning is unstructured text. Much harder to lint deterministically. Would require NLP or another LLM call, violating the "deterministic over clever" principle.

**Current stance**: Out of scope. Revisit when hook protocols mature and if there's a deterministic way to extract intent.

### Q5: Import graph cost/benefit

Is the regex-based import graph worth the parse cost?

The import graph is only used by:
- `scope_check` rule (default off)
- `blast` and `deps` queries

If scope_check is off and nobody runs blast/deps queries, the parsing is wasted work.

**Options**:
1. Always parse imports on file read (current plan)
2. Only parse when scope_check is enabled
3. Parse lazily on first blast/deps query

**Current stance**: Parse always. The cost is small (regex on file content already in memory), and having the data available for queries is worth it even if scope_check is off.

### Q6: Multi-agent coordination

Multiple agents sharing the same DB with different `session_id` values.

**Potential rules**:
- "Another agent is currently editing this file" (contention detection)
- "Agent B already fixed this test" (duplicate work detection)

**Requirements**: SQLite WAL mode for concurrent writes. Cross-session queries that respect different session scopes.

**Current stance**: Design for it (session_id column exists), don't implement multi-agent rules in v1. The single-agent case needs to work well first.

### Q7: Custom rule API

Should third parties be able to add rules without forking?

**Options**:
1. Plugin directory with dynamic imports
2. Config file pointing to rule modules
3. Fork-and-add only

**Current stance**: Fork-and-add for v1 (add `.ts` file to `rules/`, import in `rules/index.ts`). Consider a plugin system later if there's demand.
