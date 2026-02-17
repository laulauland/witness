/**
 * Tests for the fix_regressions_first rule.
 */
import { SqlClient } from "@effect/sql"
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { makeTestLayer } from "../helpers/db.js"
import { FixRegressionsFirst } from "../../src/rules/FixRegressionsFirst.js"
import type { HookInput } from "../../src/parsers/Parser.js"

const editInput = (path: string): HookInput => ({
  tool_name: "Edit",
  tool_input: { path },
})

describe("FixRegressionsFirst", () => {
  // ── appliesTo ─────────────────────────────────────────────

  test("appliesTo returns true for Edit tools", () => {
    expect(FixRegressionsFirst.appliesTo(editInput("a.ts"))).toBe(true)
    expect(
      FixRegressionsFirst.appliesTo({ tool_name: "Write", tool_input: { path: "a.ts" } })
    ).toBe(true)
  })

  test("appliesTo returns false for non-edit tools", () => {
    expect(
      FixRegressionsFirst.appliesTo({ tool_name: "Bash", tool_input: { command: "ls" } })
    ).toBe(false)
    expect(
      FixRegressionsFirst.appliesTo({ tool_name: "Read", tool_input: { path: "a.ts" } })
    ).toBe(false)
  })

  // ── Regression detection ──────────────────────────────────

  test("fires when regression exists for OTHER file", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      // Scenario: test passes, then file A edited, then test fails → regression on A
      // Agent now tries to edit file B → should fire
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 1, 'test_token_refresh', 'pass')`
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 2, 'edit', 'src/auth.ts')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 3, 'test_token_refresh', 'fail')`

      // Now agent tries to edit src/routes.ts (different file)
      return yield* FixRegressionsFirst.check(editInput("src/routes.ts"), "s1")
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).not.toBeNull()
    expect(result).toContain("regression")
    expect(result).toContain("test_token_refresh")
    expect(result).toContain("src/auth.ts")
  })

  test("does NOT fire when editing the file that caused the regression", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      // Same regression scenario, but agent edits src/auth.ts (the cause)
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 1, 'test_token_refresh', 'pass')`
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 2, 'edit', 'src/auth.ts')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 3, 'test_token_refresh', 'fail')`

      // Agent edits src/auth.ts (presumably fixing the regression)
      return yield* FixRegressionsFirst.check(editInput("src/auth.ts"), "s1")
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toBeNull()
  })

  test("does NOT fire when no regressions exist", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      // All tests passing
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 1, 'test_a', 'pass')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 2, 'test_b', 'pass')`

      return yield* FixRegressionsFirst.check(editInput("src/foo.ts"), "s1")
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toBeNull()
  })

  test("does NOT fire for test that was already failing (not a regression)", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      // test_a was already failing before any edits
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 1, 'test_a', 'fail')`
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 2, 'edit', 'src/auth.ts')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 3, 'test_a', 'fail')`

      return yield* FixRegressionsFirst.check(editInput("src/routes.ts"), "s1")
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    // This is NOT a regression — the test was already failing
    // The regressions view requires a pass → edit → fail sequence
    expect(result).toBeNull()
  })

  test("does NOT fire when test is no longer failing (regression fixed)", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      // Regression occurred but was then fixed
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 1, 'test_a', 'pass')`
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 2, 'edit', 'src/auth.ts')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 3, 'test_a', 'fail')`
      // Fixed:
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 4, 'test_a', 'pass')`

      return yield* FixRegressionsFirst.check(editInput("src/routes.ts"), "s1")
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    // The regressions view only includes tests whose LATEST outcome is fail
    expect(result).toBeNull()
  })

  test("handles multiple regressions", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      // Two regressions caused by editing auth.ts
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 1, 'test_a', 'pass')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 2, 'test_b', 'pass')`
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 3, 'edit', 'src/auth.ts')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 4, 'test_a', 'fail')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 5, 'test_b', 'fail')`

      return yield* FixRegressionsFirst.check(editInput("src/routes.ts"), "s1")
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).not.toBeNull()
    expect(result).toContain("2 regressions")
  })

  test("is session-scoped", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      // Regression in session s2
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s2', 1, 'test_a', 'pass')`
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s2', 2, 'edit', 'src/auth.ts')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s2', 3, 'test_a', 'fail')`

      // Should not affect session s1
      return yield* FixRegressionsFirst.check(editInput("src/routes.ts"), "s1")
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toBeNull()
  })

  test("returns null when no path in tool_input", async () => {
    const result = await Effect.gen(function* () {
      // If we can't extract a path, we can't filter by file, so query all regressions
      // With no regressions in the DB, this should be null
      return yield* FixRegressionsFirst.check(
        { tool_name: "Edit", tool_input: {} },
        "s1"
      )
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toBeNull()
  })
})
