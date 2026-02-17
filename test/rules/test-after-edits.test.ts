import { SqlClient } from "@effect/sql"
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { makeTestLayer } from "../helpers/db.js"
import { TestAfterEdits } from "../../src/rules/TestAfterEdits.js"
import type { HookInput } from "../../src/parsers/Parser.js"

const editInput: HookInput = {
  tool_name: "Edit",
  tool_input: { path: "src/foo.ts" },
}

describe("TestAfterEdits", () => {
  test("appliesTo returns true for Edit tools", () => {
    expect(TestAfterEdits.appliesTo(editInput)).toBe(true)
    expect(
      TestAfterEdits.appliesTo({ tool_name: "Write", tool_input: { path: "a.ts" } })
    ).toBe(true)
    expect(
      TestAfterEdits.appliesTo({ tool_name: "str_replace_editor", tool_input: { path: "a.ts" } })
    ).toBe(true)
  })

  test("appliesTo returns false for non-edit tools", () => {
    expect(
      TestAfterEdits.appliesTo({ tool_name: "Bash", tool_input: { command: "ls" } })
    ).toBe(false)
    expect(
      TestAfterEdits.appliesTo({ tool_name: "Read", tool_input: { path: "a.ts" } })
    ).toBe(false)
  })

  test("fires when edits >= threshold (default 3)", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      // 3 edits, no test run
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 1, 'edit', 'a.ts')`
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 2, 'edit', 'b.ts')`
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 3, 'edit', 'c.ts')`

      return yield* TestAfterEdits.check(editInput, "s1")
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).not.toBeNull()
    expect(result).toContain("3 edits since last test run")
  })

  test("passes when edits < threshold", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      // Only 2 edits
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 1, 'edit', 'a.ts')`
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 2, 'edit', 'b.ts')`

      return yield* TestAfterEdits.check(editInput, "s1")
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toBeNull()
  })

  test("passes when no edits", async () => {
    const result = await Effect.gen(function* () {
      return yield* TestAfterEdits.check(editInput, "s1")
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toBeNull()
  })

  test("resets after test run", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      // 3 edits, then a test, then 1 more edit
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 1, 'edit', 'a.ts')`
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 2, 'edit', 'b.ts')`
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 3, 'edit', 'c.ts')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 4, 'test_x', 'pass')`
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 5, 'edit', 'd.ts')`

      return yield* TestAfterEdits.check(editInput, "s1")
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    // Only 1 edit since last test — below threshold
    expect(result).toBeNull()
  })

  test("fires with custom threshold", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      // Only 1 edit
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 1, 'edit', 'a.ts')`

      return yield* TestAfterEdits.check(editInput, "s1", { threshold: 1 })
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).not.toBeNull()
    expect(result).toContain("1 edits since last test run")
  })

  test("passes below custom threshold", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 1, 'edit', 'a.ts')`
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 2, 'edit', 'b.ts')`
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 3, 'edit', 'c.ts')`
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 4, 'edit', 'd.ts')`

      return yield* TestAfterEdits.check(editInput, "s1", { threshold: 5 })
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toBeNull()
  })

  test("counts edits across different files", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      // 4 edits to 4 different files
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 1, 'edit', 'a.ts')`
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 2, 'edit', 'b.ts')`
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 3, 'edit', 'c.ts')`
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 4, 'edit', 'd.ts')`

      return yield* TestAfterEdits.check(editInput, "s1")
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).not.toBeNull()
    expect(result).toContain("4 edits since last test run")
  })

  test("is session-scoped", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      // 3 edits in session s2 — should not affect s1
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s2', 1, 'edit', 'a.ts')`
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s2', 2, 'edit', 'b.ts')`
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s2', 3, 'edit', 'c.ts')`

      return yield* TestAfterEdits.check(editInput, "s1")
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toBeNull()
  })
})
