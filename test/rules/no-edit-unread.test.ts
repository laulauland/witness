import { SqlClient } from "@effect/sql"
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { makeTestLayer } from "../helpers/db.js"
import { NoEditUnread } from "../../src/rules/NoEditUnread.js"
import type { HookInput } from "../../src/parsers/Parser.js"

const editInput = (path: string): HookInput => ({
  tool_name: "Edit",
  tool_input: { path, old_text: "x", new_text: "y" },
})

const writeInput = (path: string): HookInput => ({
  tool_name: "Write",
  tool_input: { path, content: "..." },
})

describe("NoEditUnread", () => {
  test("appliesTo returns true for Edit tools", () => {
    expect(NoEditUnread.appliesTo(editInput("a.ts"))).toBe(true)
    expect(
      NoEditUnread.appliesTo({ tool_name: "str_replace_editor", tool_input: { path: "a.ts" } })
    ).toBe(true)
    expect(NoEditUnread.appliesTo(writeInput("a.ts"))).toBe(true)
  })

  test("appliesTo returns false for non-edit tools", () => {
    expect(
      NoEditUnread.appliesTo({ tool_name: "Bash", tool_input: { command: "ls" } })
    ).toBe(false)
    expect(
      NoEditUnread.appliesTo({ tool_name: "Read", tool_input: { path: "a.ts" } })
    ).toBe(false)
  })

  test("fires when editing a file not read this session", async () => {
    const result = await Effect.gen(function* () {
      // No file_events at all — file has never been read
      return yield* NoEditUnread.check(editInput("src/auth.ts"), "s1")
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).not.toBeNull()
    expect(result).toContain("src/auth.ts")
    expect(result).toContain("has not been read")
  })

  test("passes when file was read before edit", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 1, 'read', 'src/auth.ts')`

      return yield* NoEditUnread.check(editInput("src/auth.ts"), "s1")
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toBeNull()
  })

  test("fires when file was read in a different session", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      // Read in session s2, editing in session s1
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s2', 1, 'read', 'src/auth.ts')`

      return yield* NoEditUnread.check(editInput("src/auth.ts"), "s1")
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).not.toBeNull()
    expect(result).toContain("src/auth.ts")
  })

  test("passes when file was read even if other files were not", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 1, 'read', 'src/auth.ts')`
      // b.ts was never read, but we're editing auth.ts
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 2, 'edit', 'src/b.ts')`

      return yield* NoEditUnread.check(editInput("src/auth.ts"), "s1")
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toBeNull()
  })

  test("returns null when tool_input has no path", async () => {
    const result = await Effect.gen(function* () {
      return yield* NoEditUnread.check(
        { tool_name: "Edit", tool_input: {} },
        "s1"
      )
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toBeNull()
  })

  test("fires for Write tool (overwrite scenario)", async () => {
    const result = await Effect.gen(function* () {
      return yield* NoEditUnread.check(writeInput("src/auth.ts"), "s1")
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).not.toBeNull()
    expect(result).toContain("src/auth.ts")
  })

  test("handles file_path field name in tool_input", async () => {
    const result = await Effect.gen(function* () {
      return yield* NoEditUnread.check(
        { tool_name: "Edit", tool_input: { file_path: "src/foo.ts" } },
        "s1"
      )
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).not.toBeNull()
    expect(result).toContain("src/foo.ts")
  })
})
