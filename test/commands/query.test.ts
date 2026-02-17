/**
 * Integration tests for `witness query <name>`.
 *
 * Pattern: seed DB state → dispatch query → assert output.
 */
import { describe, it, expect } from "bun:test"
import { SqlClient } from "@effect/sql"
import { Effect } from "effect"
import { makeTestLayer } from "../helpers/db.js"
import { dispatchQuery } from "../../src/commands/Query.js"

const SESSION = "query-test"

const run = <A>(effect: Effect.Effect<A, unknown, SqlClient.SqlClient>) =>
  Effect.provide(effect, makeTestLayer()).pipe(Effect.runPromise)

describe("Query: failing", () => {
  it("returns failing tests with messages", async () => {
    const output = await run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome, message)
                   VALUES (${SESSION}, 1, 'test_a', 'fail', 'timeout')`
        yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome, message)
                   VALUES (${SESSION}, 2, 'test_b', 'fail', 'assertion error')`
        yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome, message)
                   VALUES (${SESSION}, 3, 'test_c', 'pass', NULL)`
        return yield* dispatchQuery("failing", undefined, SESSION)
      })
    )

    expect(output).toContain("Failing Tests (2)")
    expect(output).toContain("`test_a`: timeout")
    expect(output).toContain("`test_b`: assertion error")
    expect(output).not.toContain("test_c")
  })

  it("returns informative message when no failures", async () => {
    const output = await run(dispatchQuery("failing", undefined, SESSION))
    expect(output).toBe("No failing tests.")
  })
})

describe("Query: passing", () => {
  it("returns passing tests", async () => {
    const output = await run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome, message)
                   VALUES (${SESSION}, 1, 'test_alpha', 'pass', NULL)`
        yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome, message)
                   VALUES (${SESSION}, 2, 'test_beta', 'pass', NULL)`
        yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome, message)
                   VALUES (${SESSION}, 3, 'test_gamma', 'fail', 'err')`
        return yield* dispatchQuery("passing", undefined, SESSION)
      })
    )

    expect(output).toContain("Passing Tests (2)")
    expect(output).toContain("`test_alpha`")
    expect(output).toContain("`test_beta`")
    expect(output).not.toContain("test_gamma")
  })

  it("returns informative message when no passing tests", async () => {
    const output = await run(dispatchQuery("passing", undefined, SESSION))
    expect(output).toBe("No passing tests.")
  })
})

describe("Query: regressions", () => {
  it("returns regressions with likely cause", async () => {
    const output = await run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome, message)
                   VALUES (${SESSION}, 1, 'test_auth', 'pass', NULL)`
        yield* sql`INSERT INTO file_events (session_id, t, event, file_path)
                   VALUES (${SESSION}, 2, 'edit', 'src/auth.ts')`
        yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome, message)
                   VALUES (${SESSION}, 3, 'test_auth', 'fail', '401 error')`
        return yield* dispatchQuery("regressions", undefined, SESSION)
      })
    )

    expect(output).toContain("Regressions (1)")
    expect(output).toContain("`test_auth`")
    expect(output).toContain("`src/auth.ts`")
    expect(output).toContain("pass@t=1")
    expect(output).toContain("edit@t=2")
    expect(output).toContain("fail@t=3")
  })

  it("returns informative message when no regressions", async () => {
    const output = await run(dispatchQuery("regressions", undefined, SESSION))
    expect(output).toBe("No regressions detected.")
  })
})

describe("Query: thrashing", () => {
  it("returns thrashing files", async () => {
    const output = await run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        // 3 edit-fail cycles
        yield* sql`INSERT INTO file_events (session_id, t, event, file_path)
                   VALUES (${SESSION}, 1, 'edit', 'src/broken.ts')`
        yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome, message)
                   VALUES (${SESSION}, 2, 'test_x', 'fail', 'err')`
        yield* sql`INSERT INTO file_events (session_id, t, event, file_path)
                   VALUES (${SESSION}, 3, 'edit', 'src/broken.ts')`
        yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome, message)
                   VALUES (${SESSION}, 4, 'test_x', 'fail', 'err')`
        yield* sql`INSERT INTO file_events (session_id, t, event, file_path)
                   VALUES (${SESSION}, 5, 'edit', 'src/broken.ts')`
        yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome, message)
                   VALUES (${SESSION}, 6, 'test_x', 'fail', 'err')`
        return yield* dispatchQuery("thrashing", undefined, SESSION)
      })
    )

    expect(output).toContain("Thrashing Files (1)")
    expect(output).toContain("`src/broken.ts`")
    expect(output).toContain("edits with persistent failures")
  })

  it("returns informative message when no thrashing", async () => {
    const output = await run(dispatchQuery("thrashing", undefined, SESSION))
    expect(output).toBe("No thrashing files.")
  })
})

describe("Query: history", () => {
  it("returns edit timeline for a file", async () => {
    const output = await run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`INSERT INTO file_events (session_id, t, event, file_path)
                   VALUES (${SESSION}, 1, 'read', 'src/foo.ts')`
        yield* sql`INSERT INTO file_events (session_id, t, event, file_path)
                   VALUES (${SESSION}, 2, 'edit', 'src/foo.ts')`
        yield* sql`INSERT INTO file_events (session_id, t, event, file_path)
                   VALUES (${SESSION}, 3, 'edit', 'src/foo.ts')`
        return yield* dispatchQuery("history", "src/foo.ts", SESSION)
      })
    )

    expect(output).toContain("History for `src/foo.ts`")
    expect(output).toContain("t=1 **read**")
    expect(output).toContain("t=2 **edit**")
    expect(output).toContain("t=3 **edit**")
  })

  it("returns informative message for unknown file", async () => {
    const output = await run(dispatchQuery("history", "nonexistent.ts", SESSION))
    expect(output).toContain("No history for `nonexistent.ts`")
  })

  it("shows usage when no file argument", async () => {
    const output = await run(dispatchQuery("history", undefined, SESSION))
    expect(output).toContain("Usage:")
  })
})

describe("Query: test-history", () => {
  it("returns pass/fail timeline for a test", async () => {
    const output = await run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome, message)
                   VALUES (${SESSION}, 1, 'test_auth', 'pass', NULL)`
        yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome, message)
                   VALUES (${SESSION}, 2, 'test_auth', 'fail', 'broke')`
        yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome, message)
                   VALUES (${SESSION}, 3, 'test_auth', 'pass', NULL)`
        return yield* dispatchQuery("test-history", "test_auth", SESSION)
      })
    )

    expect(output).toContain("Test History for `test_auth`")
    expect(output).toContain("t=1 ✅ **pass**")
    expect(output).toContain("t=2 ❌ **fail** — broke")
    expect(output).toContain("t=3 ✅ **pass**")
  })

  it("returns informative message for unknown test", async () => {
    const output = await run(dispatchQuery("test-history", "nonexistent", SESSION))
    expect(output).toContain("No test history for `nonexistent`")
  })

  it("shows usage when no test argument", async () => {
    const output = await run(dispatchQuery("test-history", undefined, SESSION))
    expect(output).toContain("Usage:")
  })
})

describe("Query: untested", () => {
  it("returns untested edited files", async () => {
    const output = await run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`INSERT INTO file_events (session_id, t, event, file_path)
                   VALUES (${SESSION}, 1, 'edit', 'src/a.ts')`
        yield* sql`INSERT INTO file_events (session_id, t, event, file_path)
                   VALUES (${SESSION}, 2, 'edit', 'src/b.ts')`
        return yield* dispatchQuery("untested", undefined, SESSION)
      })
    )

    expect(output).toContain("Untested Edits (2)")
    expect(output).toContain("`src/a.ts`")
    expect(output).toContain("`src/b.ts`")
  })

  it("excludes files with test runs after edit", async () => {
    const output = await run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`INSERT INTO file_events (session_id, t, event, file_path)
                   VALUES (${SESSION}, 1, 'edit', 'src/a.ts')`
        yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome, message)
                   VALUES (${SESSION}, 2, 'test_a', 'pass', NULL)`
        return yield* dispatchQuery("untested", undefined, SESSION)
      })
    )

    expect(output).toBe("No untested edits.")
  })
})

describe("Query: lint", () => {
  it("returns lint and type errors", async () => {
    const output = await run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`INSERT INTO lint_results (session_id, t, file_path, line, rule, severity)
                   VALUES (${SESSION}, 1, 'src/a.ts', 10, 'no-unused-vars', 'error')`
        yield* sql`INSERT INTO type_errors (session_id, t, file_path, line, message)
                   VALUES (${SESSION}, 2, 'src/b.ts', 5, 'Type string not assignable to number')`
        return yield* dispatchQuery("lint", undefined, SESSION)
      })
    )

    expect(output).toContain("Lint Errors (1)")
    expect(output).toContain("`src/a.ts:10`")
    expect(output).toContain("no-unused-vars")
    expect(output).toContain("Type Errors (1)")
    expect(output).toContain("`src/b.ts:5`")
    expect(output).toContain("Type string not assignable to number")
  })

  it("returns informative message when no errors", async () => {
    const output = await run(dispatchQuery("lint", undefined, SESSION))
    expect(output).toBe("No lint or type errors.")
  })
})

describe("Query: fixes", () => {
  it("returns likely fixes", async () => {
    const output = await run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        // fail at t=1, edit at t=2, pass at t=3
        yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome, message)
                   VALUES (${SESSION}, 1, 'test_auth', 'fail', 'broke')`
        yield* sql`INSERT INTO file_events (session_id, t, event, file_path)
                   VALUES (${SESSION}, 2, 'edit', 'src/auth.ts')`
        yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome, message)
                   VALUES (${SESSION}, 3, 'test_auth', 'pass', NULL)`
        return yield* dispatchQuery("fixes", undefined, SESSION)
      })
    )

    expect(output).toContain("Likely Fixes (1)")
    expect(output).toContain("`src/auth.ts`")
    expect(output).toContain("`test_auth`")
    expect(output).toContain("edit@t=2")
    expect(output).toContain("fix@t=3")
  })

  it("returns informative message when no fixes", async () => {
    const output = await run(dispatchQuery("fixes", undefined, SESSION))
    expect(output).toBe("No fixes detected.")
  })
})

describe("Query: clusters", () => {
  it("returns error clusters", async () => {
    const output = await run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        // Two tests with the same error message
        yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome, message)
                   VALUES (${SESSION}, 1, 'test_a', 'fail', 'connection refused')`
        yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome, message)
                   VALUES (${SESSION}, 2, 'test_b', 'fail', 'connection refused')`
        return yield* dispatchQuery("clusters", undefined, SESSION)
      })
    )

    expect(output).toContain("Error Clusters (1)")
    expect(output).toContain("2 tests")
    expect(output).toContain("connection refused")
    expect(output).toContain("test_a")
    expect(output).toContain("test_b")
  })

  it("returns informative message when no clusters", async () => {
    const output = await run(dispatchQuery("clusters", undefined, SESSION))
    expect(output).toBe("No error clusters.")
  })
})

describe("Query: timeline", () => {
  it("returns last n tool calls", async () => {
    const output = await run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`INSERT INTO tool_calls (session_id, t, tool_name, tool_input, tool_output)
                   VALUES (${SESSION}, 1, 'Read', '{"path":"src/a.ts"}', NULL)`
        yield* sql`INSERT INTO tool_calls (session_id, t, tool_name, tool_input, tool_output)
                   VALUES (${SESSION}, 2, 'Edit', '{"path":"src/a.ts"}', NULL)`
        yield* sql`INSERT INTO tool_calls (session_id, t, tool_name, tool_input, tool_output)
                   VALUES (${SESSION}, 3, 'Bash', '{"command":"bun test"}', NULL)`
        return yield* dispatchQuery("timeline", "2", SESSION)
      })
    )

    expect(output).toContain("Timeline (last 2)")
    // Should return the last 2 (most recent first)
    expect(output).toContain("t=3")
    expect(output).toContain("Bash")
    expect(output).toContain("t=2")
    expect(output).toContain("Edit")
    // t=1 should be excluded (limit 2)
    expect(output).not.toContain("t=1")
  })

  it("defaults to 20 when no limit given", async () => {
    const output = await run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`INSERT INTO tool_calls (session_id, t, tool_name, tool_input, tool_output)
                   VALUES (${SESSION}, 1, 'Read', '{}', NULL)`
        return yield* dispatchQuery("timeline", undefined, SESSION)
      })
    )

    expect(output).toContain("Timeline (last 20)")
  })

  it("extracts path from tool_input", async () => {
    const output = await run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`INSERT INTO tool_calls (session_id, t, tool_name, tool_input, tool_output)
                   VALUES (${SESSION}, 1, 'Edit', '{"path":"src/foo.ts"}', NULL)`
        return yield* dispatchQuery("timeline", undefined, SESSION)
      })
    )

    expect(output).toContain("Edit src/foo.ts")
  })

  it("extracts command from Bash tool_input", async () => {
    const output = await run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`INSERT INTO tool_calls (session_id, t, tool_name, tool_input, tool_output)
                   VALUES (${SESSION}, 1, 'Bash', '{"command":"bun test"}', NULL)`
        return yield* dispatchQuery("timeline", undefined, SESSION)
      })
    )

    expect(output).toContain("Bash `bun test`")
  })

  it("returns informative message when no tool calls", async () => {
    const output = await run(dispatchQuery("timeline", undefined, SESSION))
    expect(output).toBe("No tool calls recorded.")
  })
})

describe("Query: stats", () => {
  it("returns session summary", async () => {
    const output = await run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`INSERT INTO clock (session_id, current_t) VALUES (${SESSION}, 15)`
        yield* sql`INSERT INTO tool_calls (session_id, t, tool_name, tool_input, tool_output)
                   VALUES (${SESSION}, 1, 'Read', '{}', NULL)`
        yield* sql`INSERT INTO tool_calls (session_id, t, tool_name, tool_input, tool_output)
                   VALUES (${SESSION}, 2, 'Edit', '{}', NULL)`
        yield* sql`INSERT INTO file_events (session_id, t, event, file_path)
                   VALUES (${SESSION}, 1, 'read', 'src/a.ts')`
        yield* sql`INSERT INTO file_events (session_id, t, event, file_path)
                   VALUES (${SESSION}, 2, 'edit', 'src/a.ts')`
        yield* sql`INSERT INTO file_events (session_id, t, event, file_path)
                   VALUES (${SESSION}, 3, 'edit', 'src/b.ts')`
        yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome, message)
                   VALUES (${SESSION}, 4, 'test_a', 'pass', NULL)`
        yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome, message)
                   VALUES (${SESSION}, 5, 'test_b', 'fail', 'err')`
        return yield* dispatchQuery("stats", undefined, SESSION)
      })
    )

    expect(output).toContain("**Session Stats**")
    expect(output).toContain("**Clock position**: 15")
    expect(output).toContain("**Tool calls**: 2")
    expect(output).toContain("**File edits**: 2")
    expect(output).toContain("**File reads**: 1")
    expect(output).toContain("**Unique files**: 2")
    expect(output).toContain("**Tests passing**: 1")
    expect(output).toContain("**Tests failing**: 1")
  })

  it("returns zeros for empty session", async () => {
    const output = await run(dispatchQuery("stats", undefined, SESSION))

    expect(output).toContain("**Session Stats**")
    expect(output).toContain("**Clock position**: 0")
    expect(output).toContain("**Tool calls**: 0")
    expect(output).toContain("**File edits**: 0")
  })
})

describe("Query: blast", () => {
  it("shows usage when no file argument", async () => {
    const output = await run(dispatchQuery("blast", undefined, SESSION))
    expect(output).toContain("Usage:")
  })

  it("returns informative message when no dependents", async () => {
    const output = await run(dispatchQuery("blast", "src/leaf.ts", SESSION))
    expect(output).toContain("No files depend on")
  })
})

describe("Query: deps", () => {
  it("shows usage when no file argument", async () => {
    const output = await run(dispatchQuery("deps", undefined, SESSION))
    expect(output).toContain("Usage:")
  })

  it("returns informative message when no deps", async () => {
    const output = await run(dispatchQuery("deps", "src/leaf.ts", SESSION))
    expect(output).toContain("has no known dependencies")
  })
})

describe("Query: unknown", () => {
  it("returns helpful error for unknown query name", async () => {
    const output = await run(dispatchQuery("bogus", undefined, SESSION))
    expect(output).toContain('Unknown query: "bogus"')
    expect(output).toContain("failing")
    expect(output).toContain("regressions")
    expect(output).toContain("timeline")
  })
})
