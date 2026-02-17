/**
 * Tests for the regressions view and related test result views.
 */
import { SqlClient } from "@effect/sql"
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { makeTestLayer } from "./helpers/db.js"

describe("Regressions view", () => {
  test("detects regression: test passes → file edit → test fails", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 10, 'test_auth', 'pass')`
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 11, 'edit', 'src/auth.ts')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 12, 'test_auth', 'fail')`

      return yield* sql<{
        test_name: string
        likely_cause: string
        pass_t: number
        edit_t: number
        fail_t: number
      }>`
        SELECT test_name, likely_cause, pass_t, edit_t, fail_t
        FROM regressions WHERE session_id = 's1'
      `
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toHaveLength(1)
    expect(result[0]!.test_name).toBe("test_auth")
    expect(result[0]!.likely_cause).toBe("src/auth.ts")
    expect(result[0]!.pass_t).toBe(10)
    expect(result[0]!.edit_t).toBe(11)
    expect(result[0]!.fail_t).toBe(12)
  })

  test("no false regression: test was already failing before edit", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      // Test was already failing — edit doesn't create a regression
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 1, 'test_auth', 'fail')`
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 2, 'edit', 'src/auth.ts')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 3, 'test_auth', 'fail')`

      return yield* sql<{ test_name: string }>`
        SELECT test_name FROM regressions WHERE session_id = 's1'
      `
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toHaveLength(0)
  })

  test("no false regression when test failed before edit even with older pass", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      // test_auth passed once, then failed; edit happens while already failing.
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 1, 'test_auth', 'pass')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 2, 'test_auth', 'fail')`
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 3, 'edit', 'src/auth.ts')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 4, 'test_auth', 'fail')`

      return yield* sql<{ test_name: string }>`
        SELECT test_name FROM regressions WHERE session_id = 's1'
      `
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toHaveLength(0)
  })

  test("no regression when test is later fixed", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      // Regression occurs but is then fixed
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 1, 'test_auth', 'pass')`
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 2, 'edit', 'src/auth.ts')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 3, 'test_auth', 'fail')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 4, 'test_auth', 'pass')`

      return yield* sql<{ test_name: string }>`
        SELECT test_name FROM regressions WHERE session_id = 's1'
      `
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    // Latest outcome is pass, so the regression view should not show it
    expect(result).toHaveLength(0)
  })

  test("multiple regressions from same edit", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 1, 'test_a', 'pass')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 2, 'test_b', 'pass')`
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 3, 'edit', 'src/shared.ts')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 4, 'test_a', 'fail')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 5, 'test_b', 'fail')`

      return yield* sql<{ test_name: string; likely_cause: string }>`
        SELECT test_name, likely_cause FROM regressions
        WHERE session_id = 's1'
        ORDER BY test_name
      `
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toHaveLength(2)
    expect(result[0]!.test_name).toBe("test_a")
    expect(result[0]!.likely_cause).toBe("src/shared.ts")
    expect(result[1]!.test_name).toBe("test_b")
    expect(result[1]!.likely_cause).toBe("src/shared.ts")
  })

  test("regression is session-scoped", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      // Regression in session s2
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s2', 1, 'test_a', 'pass')`
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s2', 2, 'edit', 'src/auth.ts')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s2', 3, 'test_a', 'fail')`

      const s1 = yield* sql<{ test_name: string }>`
        SELECT test_name FROM regressions WHERE session_id = 's1'
      `
      const s2 = yield* sql<{ test_name: string }>`
        SELECT test_name FROM regressions WHERE session_id = 's2'
      `
      return { s1, s2 }
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result.s1).toHaveLength(0)
    expect(result.s2).toHaveLength(1)
  })

  test("identifies correct likely cause among multiple edits", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      // test passes, then two files edited, then test fails
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 1, 'test_a', 'pass')`
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 2, 'edit', 'src/auth.ts')`
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 3, 'edit', 'src/utils.ts')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 4, 'test_a', 'fail')`

      return yield* sql<{ test_name: string; likely_cause: string }>`
        SELECT test_name, likely_cause FROM regressions
        WHERE session_id = 's1'
        ORDER BY likely_cause
      `
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    // Both edits are between pass and fail, so both are "likely causes"
    expect(result.length).toBeGreaterThanOrEqual(1)
    const causes = result.map((r) => r.likely_cause)
    expect(causes).toContain("src/auth.ts")
    // The view may list both files as likely causes
  })
})
