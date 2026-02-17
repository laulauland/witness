# Testing Strategy

## Philosophy

- **Integration tests are primary.** Test the behavior through the real pipeline, not isolated internals.
- **Real SQLite, not mocks.** Use `:memory:` databases with the real schema applied. No mock frameworks.
- **Effect layers make this trivial.** Swap `SqliteClient.layer` with an in-memory variant. Same code, different wiring.
- **Every test follows the pattern**: seed facts → run command/rule → assert output or DB state.

## Test Infrastructure

### DB Test Layer

Every test gets a fresh in-memory database with the full schema applied:

```typescript
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { Effect, Layer } from "effect"
import { SchemaLive } from "../src/Schema"

// Fresh DB per test
const makeTestLayer = () =>
  SqliteClient.layer({ filename: ":memory:" }).pipe(
    Layer.tap(() => SchemaLive) // apply DDL
  )
```

Usage in tests:

```typescript
import { describe, it, expect } from "bun:test"

describe("NoEditUnread rule", () => {
  it("fires when file edited without prior read", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      
      // Seed: an edit event with no prior read
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path)
                  VALUES ('test-session', 1, 'edit', 'src/foo.ts')`
      
      // Run rule
      const input = { tool_name: "Edit", tool_input: { path: "src/foo.ts" } }
      return yield* NoEditUnread.check(input)
    }).pipe(
      Effect.provide(makeTestLayer()),
      Effect.runPromise
    )
    
    expect(result).not.toBeNull()
    expect(result).toContain("src/foo.ts")
  })

  it("passes when file was read before edit", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      
      // Seed: read then edit
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path)
                  VALUES ('test-session', 1, 'read', 'src/foo.ts')`
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path)
                  VALUES ('test-session', 2, 'edit', 'src/foo.ts')`
      
      const input = { tool_name: "Edit", tool_input: { path: "src/foo.ts" } }
      return yield* NoEditUnread.check(input)
    }).pipe(
      Effect.provide(makeTestLayer()),
      Effect.runPromise
    )
    
    expect(result).toBeNull() // clean pass
  })
})
```

### Seed Helpers

Create `test/helpers/seed.ts` with common scenario setups:

```typescript
// Seed a file read event
export const seedRead = (sql: SqlClient, session: string, t: number, path: string) =>
  sql`INSERT INTO file_events (session_id, t, event, file_path)
      VALUES (${session}, ${t}, 'read', ${path})`

// Seed a file edit event
export const seedEdit = (sql: SqlClient, session: string, t: number, path: string) =>
  sql`INSERT INTO file_events (session_id, t, event, file_path)
      VALUES (${session}, ${t}, 'edit', ${path})`

// Seed a test result
export const seedTestResult = (sql: SqlClient, session: string, t: number, name: string, outcome: "pass" | "fail", message?: string) =>
  sql`INSERT INTO test_results (session_id, t, test_name, outcome, message)
      VALUES (${session}, ${t}, ${name}, ${outcome}, ${message ?? null})`

// Seed a regression scenario: test passes, file edit, test fails
export const seedRegression = (sql: SqlClient, session: string, file: string, test: string) =>
  Effect.all([
    seedTestResult(sql, session, 1, test, "pass"),
    seedEdit(sql, session, 2, file),
    seedTestResult(sql, session, 3, test, "fail", "broke after edit"),
  ])
```

### Fixtures

`fixtures/` directory contains real tool output samples:

```
fixtures/
├── hook-inputs/
│   ├── edit-file.json          # PreToolUse Edit input
│   ├── read-file.json          # PreToolUse Read input
│   ├── bash-pytest.json        # PreToolUse Bash with pytest
│   ├── bash-git-commit.json    # PreToolUse Bash with git commit
│   └── malformed.json          # Garbage input
├── tool-outputs/
│   ├── jest-pass.json          # jest --json output (all passing)
│   ├── jest-fail.json          # jest --json output (some failing)
│   ├── jest-text.txt           # jest text output
│   ├── vitest-pass.json        
│   ├── pytest-pass.json        # pytest --json output
│   ├── pytest-fail.json        
│   ├── pytest-text.txt         
│   ├── go-test-pass.txt        
│   ├── go-test-fail.txt        
│   ├── cargo-test-pass.txt     
│   ├── cargo-test-fail.txt     
│   ├── eslint-json.json        
│   ├── tsc-errors.txt          
│   ├── mypy-errors.txt         
│   └── ruff-errors.txt         
└── import-samples/
    ├── typescript.ts            # Various TS import styles
    ├── python.py                # Various Python import styles
    ├── rust.rs                  # use/mod statements
    └── go.go                    # Go import block
```

## Test Categories

### 1. Parser Tests

Test that parsers extract correct facts from tool output.

```typescript
describe("jest parser", () => {
  it("extracts test results from JSON output", async () => {
    const output = await Bun.file("fixtures/tool-outputs/jest-fail.json").text()
    const facts = parseJest(output)
    
    expect(facts).toContainEqual(
      expect.objectContaining({ test_name: "auth > validates token", outcome: "fail" })
    )
    expect(facts).toContainEqual(
      expect.objectContaining({ test_name: "auth > refreshes token", outcome: "pass" })
    )
  })

  it("handles text output fallback", async () => {
    const output = await Bun.file("fixtures/tool-outputs/jest-text.txt").text()
    const facts = parseJest(output)
    expect(facts.length).toBeGreaterThan(0)
  })

  it("returns empty array on malformed input", () => {
    const facts = parseJest("this is not test output")
    expect(facts).toEqual([])
  })
})
```

**Critical invariant**: Parsers never throw. Wrap every parser test category with a garbage-in test.

### 2. Rule Tests

Seed DB → run rule → assert.

For each rule, test:
- **Fires when it should** (violation scenario)
- **Doesn't fire when it shouldn't** (clean scenario)  
- **Boundary conditions** (threshold edges)
- **Session scoping** (events from other sessions don't affect)

| Rule | Fire scenario | Clean scenario | Edge cases |
|------|---------------|----------------|------------|
| `no_edit_unread` | Edit without read | Read then edit | Create (not edit) without read → should it fire? |
| `fix_regressions_first` | Regression on file A, editing file B | Regression on file A, editing file A | No regressions → clean |
| `test_after_edits` | 3+ edits, no test | 2 edits (below threshold) | Exactly at threshold |
| `no_thrashing` | 3+ edits, failures persist | 3 edits, tests now pass | 2 edits with failures (below threshold) |
| `no_commit_failing` | git commit with failing test | git commit with all passing | No test results at all → clean |
| `no_pointless_rerun` | Test command, no edits since last | Test command after edit | First test run of session → clean |
| `scope_check` | Edit file outside blast radius + unread | Edit file in blast radius | Edit file that was read but not in blast radius → clean |

### 3. View Tests

Verify SQL views compute correct derived state:

```typescript
describe("regressions view", () => {
  it("detects test that passed before edit then failed after", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      
      yield* seedTestResult(sql, "s1", 1, "test_auth", "pass")
      yield* seedEdit(sql, "s1", 2, "src/auth.ts")
      yield* seedTestResult(sql, "s1", 3, "test_auth", "fail", "401 error")
      
      return yield* sql`SELECT * FROM regressions WHERE session_id = 's1'`
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)
    
    expect(result).toHaveLength(1)
    expect(result[0].test_name).toBe("test_auth")
  })

  it("does not flag test that was already failing", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      
      yield* seedTestResult(sql, "s1", 1, "test_auth", "fail")
      yield* seedEdit(sql, "s1", 2, "src/auth.ts")
      yield* seedTestResult(sql, "s1", 3, "test_auth", "fail")
      
      return yield* sql`SELECT * FROM regressions WHERE session_id = 's1'`
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)
    
    expect(result).toHaveLength(0)
  })
})
```

### 4. Command Integration Tests

Test the full CLI pipeline by spawning the actual process:

```typescript
describe("record command", () => {
  it("records file edit from stdin", async () => {
    const dbPath = tmpdir() + "/test-" + randomUUID() + ".db"
    
    // Init DB
    const init = Bun.spawn(["bun", "run", "src/main.ts", "init", "--db", dbPath])
    await init.exited
    
    // Record an edit
    const input = JSON.stringify({
      tool_name: "Edit",
      tool_input: { path: "src/foo.ts", old_text: "a", new_text: "b" },
      tool_output: "File edited",
      tool_exit_code: 0
    })
    
    const record = Bun.spawn(["bun", "run", "src/main.ts", "record", "--db", dbPath], {
      stdin: new TextEncoder().encode(input)
    })
    const exitCode = await record.exited
    
    expect(exitCode).toBe(0)
    
    // Verify DB state
    // ... open DB and check file_events table
  })

  it("exits 0 on malformed input", async () => {
    const record = Bun.spawn(["bun", "run", "src/main.ts", "record", "--db", dbPath], {
      stdin: new TextEncoder().encode("not json at all")
    })
    const exitCode = await record.exited
    expect(exitCode).toBe(0) // never crash
  })
})
```

### 5. Performance Tests

```typescript
describe("performance", () => {
  it("lint command completes within 30ms", async () => {
    const dbPath = await setupPopulatedDb() // DB with realistic data
    const input = JSON.stringify({
      tool_name: "Edit",
      tool_input: { path: "src/foo.ts" }
    })
    
    const times: number[] = []
    for (let i = 0; i < 10; i++) {
      const start = performance.now()
      const proc = Bun.spawn(["bun", "run", "src/main.ts", "lint", "--db", dbPath], {
        stdin: new TextEncoder().encode(input)
      })
      await proc.exited
      times.push(performance.now() - start)
    }
    
    const median = times.sort()[Math.floor(times.length / 2)]
    // CI gets 2x budget
    const budget = process.env.CI ? 60 : 30
    expect(median).toBeLessThan(budget)
  })

  it("record command completes within 50ms", async () => {
    // Similar pattern
  })
})
```

### 6. Error Resilience Tests

```typescript
describe("error resilience", () => {
  it("record handles empty stdin", async () => { /* exit 0 */ })
  it("record handles binary garbage stdin", async () => { /* exit 0 */ })
  it("record handles extremely large tool output", async () => { /* exit 0, maybe truncate */ })
  it("lint handles missing DB file", async () => { /* exit 0, allow by default */ })
  it("lint handles corrupt DB", async () => { /* exit 0, allow by default */ })
  it("record handles concurrent writes", async () => { /* WAL mode, no corruption */ })
})
```

## Test Organization

```
test/
├── helpers/
│   ├── db.ts              # makeTestLayer(), DB setup utilities
│   ├── seed.ts            # Seed helpers for common scenarios
│   └── fixtures.ts        # Fixture loaders
├── parsers/
│   ├── file.test.ts
│   ├── jest.test.ts
│   ├── pytest.test.ts
│   └── imports.test.ts
├── rules/
│   ├── no-edit-unread.test.ts
│   ├── fix-regressions-first.test.ts
│   ├── test-after-edits.test.ts
│   ├── no-thrashing.test.ts
│   ├── no-commit-failing.test.ts
│   ├── no-pointless-rerun.test.ts
│   └── scope-check.test.ts
├── views/
│   ├── current-test-state.test.ts
│   ├── regressions.test.ts
│   ├── thrashing.test.ts
│   └── blast-radius.test.ts
├── commands/
│   ├── init.test.ts
│   ├── record.test.ts
│   ├── lint.test.ts
│   ├── briefing.test.ts
│   └── query.test.ts
└── performance/
    └── benchmarks.test.ts
```

## Naming Convention

```typescript
describe("ComponentName", () => {
  it("does X when Y", ...)       // positive case
  it("does not do X when Z", ...) // negative case
  it("handles edge case W", ...)  // boundary
})
```

## CI

- `bun test` runs all tests
- Performance tests run with `CI=true` env (relaxed thresholds at 2× budget)
- All tests must pass before merge
- Single runtime target: Bun only
