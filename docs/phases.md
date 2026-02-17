# Implementation Phases

Each phase is independently testable and delivers concrete, usable functionality. Phases build on each other but each one should leave the project in a working state.

---

## Phase 0: Project Bootstrap

**Goal**: A runnable CLI skeleton with all dependencies.

**Work**:
- Initialize Bun project: `bun init`
- Install dependencies:
  - `effect`, `@effect/cli`, `@effect/schema`
  - `@effect/sql`, `@effect/sql-sqlite-bun`
  - `@effect/platform`, `@effect/platform-bun`
- Configure `tsconfig.json` (strict, ESM, Bun types, path aliases)
- Create CLI skeleton in `src/main.ts` with `@effect/cli`:
  - Root command `witness` with `--help`
  - Stub subcommands: `init`, `record`, `lint`, `briefing`, `query`
- Set up test runner (`bun:test`)
- Add a basic test that imports the CLI module

**Deliverable**: `bun run src/main.ts --help` prints subcommand list.

**Acceptance**:
- All subcommands listed in help output
- `bun test` passes
- TypeScript compiles clean

**Tests**:
- CLI help output contains expected subcommands

---

## Phase 1: Storage Foundation

**Goal**: A working database with schema, clock, and typed facts.

**Work**:
- `Db.ts`: `SqliteClient.layer` configuration
  - DB path from `WITNESS_DB` env var or `--db` flag
  - Default: `.witness/witness.db` in project root
- `Schema.ts`: DDL for all 6 tables with indexes
  - `tool_calls`, `file_events`, `test_results`, `lint_results`, `type_errors`, `imports`
  - Indexes on `session_id`, `t`, `file_path`, `test_name`
- `Clock.ts`: Monotonic logical clock
  - Session-scoped counter in a `clock` table
  - `tick()` → `UPDATE clock SET t = t + 1 ... RETURNING t`
- `Facts.ts`: Tagged union types for all fact kinds
  - `FileEvent`, `TestResult`, `LintResult`, `TypeError`, `Import`, `ToolCall`
- `commands/Init.ts`: Create DB directory + apply schema
  - Idempotent: `CREATE TABLE IF NOT EXISTS`

**Deliverable**: `witness init` creates a working DB with all tables.

**Acceptance**:
- Init is idempotent (running twice doesn't error)
- Schema matches spec (all tables, all columns, all indexes)
- Clock increments correctly (t=1, t=2, t=3...)
- Fact types construct correctly

**Tests**:
- Schema creation and idempotency (in-memory DB)
- Clock monotonicity across multiple ticks
- Fact type construction and validation

---

## Phase 2: Record Pipeline

**Goal**: PostToolUse hook records file events into the DB.

**Work**:
- `parsers/Parser.ts`: Router interface — `(tool_name, command?) → parser function`
- `parsers/file.ts`: Extract file events from tool calls
  - `Edit`, `str_replace_editor` → `FileEvent(edit, path)`
  - `Write`, `file_create` → `FileEvent(create, path)`
  - `Read`, `view` → `FileEvent(read, path)`
- `parsers/index.ts`: Router implementation — match tool_name, dispatch to parser
- `commands/Record.ts`: Read stdin JSON → route to parser → INSERT facts
  - Parse stdin as HookInput
  - Always record a `tool_calls` row (raw log)
  - Route to specific parser for structured facts
  - Exit 0 always, even on parse failure

**Deliverable**: `echo '{"tool_name":"Edit","tool_input":{"path":"src/foo.ts"}}' | witness record`

**Acceptance**:
- PostToolUse contract: never crashes, always exit 0
- `tool_calls` row inserted for every input
- `file_events` row inserted for Edit/Read/Write
- Malformed stdin → exit 0, stderr log, no facts inserted

**Tests**:
- Parser routing: correct parser selected per tool_name
- File event extraction: Edit → edit event, Read → read event, Write → create event
- Graceful parse failure: garbage in → no crash
- Full pipeline: stdin JSON → DB contains expected rows
- Path extraction from various tool input formats

**Note**: Only file parser in this phase. Test/lint parsers come in Phase 4+.

---

## Phase 3: First Lint Rules

**Goal**: Two working lint rules with end-to-end hook integration.

**Work**:
- SQL views:
  - `edited_but_unread` — files with edit events but no read event in session
  - `edits_since_last_test` — count of file edits since last test command
- `rules/Rule.ts`: `LintRule` interface
  ```typescript
  interface LintRule {
    name: string
    appliesTo: (input: HookInput) => boolean
    check: (input: HookInput) => Effect<string | null, SqlError, SqlClient>
  }
  ```
- `rules/NoEditUnread.ts`: Warn when editing a file not read this session
- `rules/TestAfterEdits.ts`: Warn when edit count since last test ≥ threshold
- `rules/index.ts`: All rules array
- `commands/Lint.ts`: PreToolUse handler
  - Read stdin JSON
  - Load rule configuration
  - Filter applicable rules
  - Evaluate all applicable rules
  - Format output per hook protocol (allow / warn / block)
- Rule configuration:
  - `.witness.json` in project root
  - Default config embedded in code
  - Format: `{ "rules": { "no_edit_unread": "warn", ... } }`

**Deliverable**: Two working lint rules, correct hook output format.

**Acceptance**:
- PreToolUse contract: correct JSON format for allow/warn/block
- `no_edit_unread` fires when editing unread file, passes when file was read
- `test_after_edits` fires at threshold, passes below threshold
- Configuration loading works (file + defaults)

**Tests**:
- Seed DB with file_events → assert `no_edit_unread` fires/doesn't fire
- Seed DB with varying edit counts → assert `test_after_edits` threshold behavior
- Test rule configuration loading and merging
- Test hook output JSON format for allow, warn, block cases
- View correctness: `edited_but_unread` returns expected files

---

## Phase 4: Test Result Tracking

**Goal**: Parse test runner output, detect regressions, enforce test discipline.

**Work**:
- `parsers/jest.ts`: Parse jest/vitest output (JSON mode + text fallback)
- `parsers/pytest.ts`: Parse pytest output (JSON mode + text fallback)
- Parser router: add patterns for `jest|vitest|mocha`, `pytest`
- SQL views:
  - `current_test_state` — latest outcome per test_name
  - `failing_tests` — tests where latest outcome = fail
  - `regressions` — tests passing before a file edit, failing after
- `rules/NoCommitFailing.ts`: Block git commit when failing_tests non-empty
- `rules/FixRegressionsFirst.ts`: Warn when editing file X while regressions exist for file Y

**Deliverable**: Test runs are tracked, regressions detected, commit discipline enforced.

**Acceptance**:
- Jest/Vitest JSON and text output correctly parsed into test_results
- Pytest JSON and text output correctly parsed into test_results
- `current_test_state` picks latest result per test
- `regressions` detected: test passes at t=10, file edit at t=11, test fails at t=12
- `no_commit_failing` blocks git commit when tests failing
- `fix_regressions_first` fires when editing unrelated file with active regressions

**Tests**:
- Feed real jest/vitest output (fixtures) → assert test_results correct
- Feed real pytest output (fixtures) → assert test_results correct
- Regression scenario: seed pass → edit → fail sequence → assert regression detected
- No false regressions: test that was already failing before edit is not a regression
- NoCommitFailing: seed failing test → assert blocks commit; no failures → allows
- FixRegressionsFirst: seed regression for file A → edit file B → fires; edit file A → doesn't fire

---

## Phase 5: Thrashing Detection + Remaining Rules

**Goal**: Complete the core rule set.

**Work**:
- SQL views:
  - `thrashing` — files edited N+ times where test failures persist after each edit
- `rules/NoThrashing.ts`: Block edits to files in thrashing state
- `rules/NoPointlessRerun.ts`: Warn when re-running tests without intervening edits

**Deliverable**: All 7 core lint rules implemented.

**Acceptance**:
- Thrashing detected after 3+ edits with persistent failures
- NoThrashing blocks (not just warns) by default
- NoPointlessRerun fires when edits_since_last_test = 0 with prior results
- All rules respect configuration (block/warn/off)

**Tests**:
- Thrashing scenario: seed 3+ edits interleaved with test failures → assert detected
- Below threshold: 2 edits → not thrashing
- Pointless rerun: seed test results, no edits → assert fires; seed edit → doesn't fire
- Configuration override: set `no_thrashing` to `warn` → assert warns instead of blocks

---

## Phase 6: Briefing + Queries

**Goal**: Agent-readable output for situational awareness and targeted queries.

**Work**:
- `commands/Briefing.ts`: Generate markdown summary
  - Sections: Tests, Regressions, Thrashing, Untested, Blast Radius, Session Stats
  - Omit sections when empty
  - Include logical clock position
- `commands/Query.ts`: Named query dispatcher
  - `failing` — currently failing tests with messages
  - `passing` — currently passing tests
  - `regressions` — with likely cause file
  - `thrashing` — files in thrashing state
  - `history <file>` — edit timeline
  - `test-history <test>` — pass/fail timeline
  - `untested` — edited but not tested files
  - `lint` — current lint/type errors
  - `fixes` — edits that fixed tests
  - `clusters` — error clusters
  - `timeline [n]` — last n tool calls
  - `stats` — session summary

**Deliverable**: `witness briefing` and `witness query <name>` produce useful output.

**Acceptance**:
- Briefing omits empty sections
- Briefing includes all non-empty sections with correct data
- Each named query returns expected format and correct data
- Output is readable markdown/text

**Tests**:
- Seed various DB states → assert briefing output structure
- Empty DB → minimal briefing (just session stats)
- Rich DB → all sections present
- Each named query: seed data → assert results
- Edge cases: query with no matching data returns empty/informative message

---

## Phase 7: Import Graph + Scope Rules

**Goal**: Passive dependency graph building and blast radius analysis.

**Work**:
- Import extraction in file parser (on Read events):
  - Regex patterns for: JS/TS (`import`/`require`), Python (`import`/`from`), Rust (`use`/`mod`), Go (`import`)
  - Insert into `imports` table
- SQL views:
  - `depends_on` — transitive import closure (recursive CTE)
  - `blast_radius` — reverse transitive dependencies of recently edited files
- `rules/ScopeCheck.ts`: Warn when editing file outside blast radius and unread
- Named queries: `blast <file>`, `deps <file>`

**Deliverable**: Import graph builds passively from file reads. Blast radius queries work.

**Acceptance**:
- Import statements extracted on file read for JS/TS/Python/Rust/Go
- Recursive CTE resolves transitive dependencies
- Blast radius includes indirect dependents
- ScopeCheck fires for out-of-scope edits (when enabled)
- `blast` and `deps` queries return correct transitive closures

**Tests**:
- Regex parsers: sample import statements per language → correct imports extracted
- Transitive closure: A imports B imports C → deps(A) includes C
- Blast radius: edit C → blast includes A and B
- ScopeCheck: seed imports + edits → assert fires for out-of-scope file
- ScopeCheck: file in blast radius → doesn't fire
- ScopeCheck: file previously read → doesn't fire

---

## Phase 8: Additional Parsers

**Goal**: Multi-language test runner and linter support.

**Work**:
- `parsers/go.ts`: Parse `go test` output
- `parsers/cargo.ts`: Parse `cargo test` output
- `parsers/eslint.ts`: Parse eslint JSON/text output
- `parsers/flake8.ts`: Parse flake8/ruff output
- `parsers/tsc.ts`: Parse TypeScript compiler errors
- `parsers/mypy.ts`: Parse mypy/pyright output
- Router additions for each new pattern

**Deliverable**: Witness understands test/lint output from Go, Rust, and additional linters.

**Acceptance**:
- Each parser correctly extracts structured facts from real output
- Parsers handle both JSON and text output modes
- Parsers never crash on malformed input

**Tests**:
- Fixture-based: real output samples per tool → assert parsed facts
- Error cases: truncated output, non-standard formatting
- Integration: full record pipeline with each new parser

---

## Phase 9: Polish + Distribution

**Goal**: Ready for real-world use.

**Work**:
- `SKILL.md`: Claude Code skill file for witness integration
- `settings-snippet.json`: Hook configuration for Claude Code settings
- Performance benchmarking:
  - Verify <30ms PreToolUse, <50ms PostToolUse
  - Identify and fix hotspots
  - Add timeout-based degradation if needed
- README with installation + configuration guide
- Error messages: helpful, not cryptic
- Edge case hardening from real-world testing

**Deliverable**: Installable, documented, performant.

**Acceptance**:
- Performance budgets met in benchmarks
- SKILL.md correctly integrates with Claude Code
- README covers install, configure, verify workflow
- No crashes on any fuzzed input

**Tests**:
- Performance benchmarks (CI with relaxed thresholds at 2× budget)
- End-to-end: hook integration smoke test
- Fuzz: random stdin → never crashes

---

## Cross-Cutting Concerns

These apply to every phase:

1. **Never-crash invariant**: PostToolUse must exit 0 on any input, including garbage. Test this in every phase.
2. **Latency budget**: Measure and track. Don't let it creep.
3. **Integration tests**: Every feature tested via the real pipeline (seed DB → run command → assert), not isolated unit tests.
4. **Typed errors**: ParseError (recoverable) vs SqlError (fatal) distinction maintained everywhere.
5. **Session scoping**: All queries and rules filter by `session_id` unless explicitly cross-session.
