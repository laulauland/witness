import { SqlClient } from "@effect/sql"
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { makeTestLayer } from "./helpers/db.js"

describe("Views", () => {
  test("current_test_state picks latest result per test", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 1, 'test_a', 'pass')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 2, 'test_a', 'fail')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 3, 'test_b', 'pass')`

      return yield* sql<{ test_name: string; outcome: string }>`
        SELECT test_name, outcome FROM current_test_state WHERE session_id = 's1' ORDER BY test_name
      `
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual(expect.objectContaining({ test_name: "test_a", outcome: "fail" }))
    expect(result[1]).toEqual(expect.objectContaining({ test_name: "test_b", outcome: "pass" }))
  })

  test("failing_tests shows only currently failing tests", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 1, 'test_a', 'fail')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 2, 'test_b', 'pass')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 3, 'test_c', 'fail')`

      return yield* sql<{ test_name: string }>`
        SELECT test_name FROM failing_tests WHERE session_id = 's1' ORDER BY test_name
      `
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toHaveLength(2)
    expect(result.map((r) => r.test_name)).toEqual(["test_a", "test_c"])
  })

  test("edited_but_unread shows files edited without prior read", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      // file_a: read then edit — should NOT appear
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 1, 'read', 'a.ts')`
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 2, 'edit', 'a.ts')`
      // file_b: edit without read — should appear
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 3, 'edit', 'b.ts')`

      return yield* sql<{ file_path: string }>`
        SELECT file_path FROM edited_but_unread WHERE session_id = 's1'
      `
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toHaveLength(1)
    expect(result[0]!.file_path).toBe("b.ts")
  })

  test("edits_since_last_test counts edits after last test run", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 1, 'test_x', 'pass')`
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 2, 'edit', 'a.ts')`
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 3, 'edit', 'b.ts')`
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 4, 'edit', 'c.ts')`

      return yield* sql<{ edit_count: number; last_test_t: number }>`
        SELECT edit_count, last_test_t FROM edits_since_last_test WHERE session_id = 's1'
      `
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toHaveLength(1)
    expect(result[0]!.edit_count).toBe(3)
    expect(result[0]!.last_test_t).toBe(1)
  })

  test("edits_since_last_test with no test results counts all edits", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 1, 'edit', 'a.ts')`
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 2, 'edit', 'b.ts')`

      return yield* sql<{ edit_count: number; last_test_t: number }>`
        SELECT edit_count, last_test_t FROM edits_since_last_test WHERE session_id = 's1'
      `
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toHaveLength(1)
    expect(result[0]!.edit_count).toBe(2)
    expect(result[0]!.last_test_t).toBe(0)
  })

  test("untested_edits shows files edited but not tested since", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      // a.ts edited, then tested — should NOT appear
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 1, 'edit', 'a.ts')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 2, 'test_a', 'pass')`
      // b.ts edited after test — should appear
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 3, 'edit', 'b.ts')`

      return yield* sql<{ file_path: string }>`
        SELECT file_path FROM untested_edits WHERE session_id = 's1'
      `
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toHaveLength(1)
    expect(result[0]!.file_path).toBe("b.ts")
  })

  test("thrashing detects files with 3+ edit-then-fail cycles", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      // a.ts: 3 interleaved edit→fail cycles
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 1, 'edit', 'a.ts')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 2, 'test_x', 'fail')`
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 3, 'edit', 'a.ts')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 4, 'test_x', 'fail')`
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 5, 'edit', 'a.ts')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 6, 'test_x', 'fail')`

      return yield* sql<{ file_path: string; edit_count: number }>`
        SELECT file_path, edit_count FROM thrashing WHERE session_id = 's1'
      `
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toHaveLength(1)
    expect(result[0]!.file_path).toBe("a.ts")
    expect(result[0]!.edit_count).toBe(3)
  })

  test("thrashing reports edit_count for 2 edit-fail cycles", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 1, 'edit', 'a.ts')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 2, 'test_x', 'fail')`
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 3, 'edit', 'a.ts')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 4, 'test_x', 'fail')`

      return yield* sql<{ file_path: string; edit_count: number }>`
        SELECT file_path, edit_count FROM thrashing WHERE session_id = 's1'
      `
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    // View returns the count; rule applies threshold
    expect(result).toHaveLength(1)
    expect(result[0]!.edit_count).toBe(2)
  })

  test("thrashing resets when an edit cycle succeeds (tests pass)", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      // 2 failed cycles
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 1, 'edit', 'a.ts')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 2, 'test_x', 'fail')`
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 3, 'edit', 'a.ts')`
      // Success! Tests pass → resets counter
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 4, 'test_x', 'pass')`
      // 1 more failed cycle after reset
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 5, 'edit', 'a.ts')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 6, 'test_x', 'fail')`

      return yield* sql<{ file_path: string; edit_count: number }>`
        SELECT file_path, edit_count FROM thrashing WHERE session_id = 's1'
      `
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    // Only 1 failed cycle since the reset
    expect(result).toHaveLength(1)
    expect(result[0]!.edit_count).toBe(1)
  })

  test("views are session-scoped", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      // Session s1: edit without read
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 1, 'edit', 'a.ts')`
      // Session s2: read then edit
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s2', 1, 'read', 'a.ts')`
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s2', 2, 'edit', 'a.ts')`

      const s1 = yield* sql<{ file_path: string }>`
        SELECT file_path FROM edited_but_unread WHERE session_id = 's1'
      `
      const s2 = yield* sql<{ file_path: string }>`
        SELECT file_path FROM edited_but_unread WHERE session_id = 's2'
      `
      return { s1, s2 }
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result.s1).toHaveLength(1)
    expect(result.s2).toHaveLength(0)
  })
})
