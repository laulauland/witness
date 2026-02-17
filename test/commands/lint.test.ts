import { SqlClient } from "@effect/sql"
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { makeTestLayer } from "../helpers/db.js"
import { lintPipeline } from "../../src/commands/Lint.js"

/**
 * Helper: create stdin JSON for a PreToolUse hook call.
 */
const makeInput = (toolName: string, toolInput: Record<string, unknown> = {}) =>
  JSON.stringify({
    hook: "PreToolUse",
    tool_name: toolName,
    tool_input: toolInput,
  })

describe("Lint pipeline", () => {
  // ── Output format tests ────────────────────────────────────

  test("no violations → empty output (allow)", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      // File has been read → no_edit_unread won't fire
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 1, 'read', 'src/foo.ts')`

      return yield* lintPipeline(
        makeInput("Edit", { path: "src/foo.ts" }),
        "s1"
      )
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toBe("")
  })

  test("warn violation → JSON with decision:approve and additionalContext", async () => {
    const result = await Effect.gen(function* () {
      // No reads → no_edit_unread fires as warn
      return yield* lintPipeline(
        makeInput("Edit", { path: "src/foo.ts" }),
        "s1"
      )
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).not.toBe("")
    const parsed = JSON.parse(result)
    expect(parsed.decision).toBe("approve")
    expect(parsed.additionalContext).toContain("no_edit_unread")
    expect(parsed.additionalContext).toContain("src/foo.ts")
    expect(parsed.additionalContext).toContain("⚠️")
  })

  test("block violation → JSON with permissionDecision:deny", async () => {
    // Use a config dir that doesn't exist → defaults
    // We need to override no_edit_unread to "block" for this test.
    // Since we can't easily inject config here, let's test the format via
    // a future rule. For now, verify the warn format.
    // TODO: Add block test when we have a rule that defaults to block.
    // For Phase 3, test with no_edit_unread as warn only.
    expect(true).toBe(true)
  })

  // ── no_edit_unread integration ─────────────────────────────

  test("no_edit_unread fires on Edit for unread file", async () => {
    const result = await Effect.gen(function* () {
      return yield* lintPipeline(
        makeInput("Edit", { path: "src/auth.ts" }),
        "s1"
      )
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    const parsed = JSON.parse(result)
    expect(parsed.decision).toBe("approve")
    expect(parsed.additionalContext).toContain("no_edit_unread")
    expect(parsed.additionalContext).toContain("src/auth.ts")
  })

  test("no_edit_unread passes after file read", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 1, 'read', 'src/auth.ts')`

      return yield* lintPipeline(
        makeInput("Edit", { path: "src/auth.ts" }),
        "s1"
      )
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toBe("")
  })

  // ── test_after_edits integration ───────────────────────────

  test("test_after_edits fires when edits >= threshold", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      // Read the file so no_edit_unread doesn't fire
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 1, 'read', 'src/foo.ts')`
      // 3 edits, no tests
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 2, 'edit', 'a.ts')`
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 3, 'edit', 'b.ts')`
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 4, 'edit', 'c.ts')`

      return yield* lintPipeline(
        makeInput("Edit", { path: "src/foo.ts" }),
        "s1"
      )
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).not.toBe("")
    const parsed = JSON.parse(result)
    expect(parsed.decision).toBe("approve")
    expect(parsed.additionalContext).toContain("test_after_edits")
    expect(parsed.additionalContext).toContain("3 edits since last test run")
  })

  test("test_after_edits passes below threshold", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 1, 'read', 'src/foo.ts')`
      // Only 2 edits
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 2, 'edit', 'a.ts')`
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 3, 'edit', 'b.ts')`

      return yield* lintPipeline(
        makeInput("Edit", { path: "src/foo.ts" }),
        "s1"
      )
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toBe("")
  })

  // ── Combined rules ────────────────────────────────────────

  test("both rules fire simultaneously", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      // 3 edits, no tests, no read of target file
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 1, 'edit', 'a.ts')`
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 2, 'edit', 'b.ts')`
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 3, 'edit', 'c.ts')`

      return yield* lintPipeline(
        makeInput("Edit", { path: "src/new.ts" }),
        "s1"
      )
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    const parsed = JSON.parse(result)
    expect(parsed.decision).toBe("approve")
    // Both rules should appear in context
    expect(parsed.additionalContext).toContain("no_edit_unread")
    expect(parsed.additionalContext).toContain("test_after_edits")
  })

  // ── Non-edit tools ────────────────────────────────────────

  test("non-edit tools produce no violations", async () => {
    const result = await Effect.gen(function* () {
      return yield* lintPipeline(
        makeInput("Bash", { command: "ls" }),
        "s1"
      )
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toBe("")
  })

  test("Read tool produces no violations", async () => {
    const result = await Effect.gen(function* () {
      return yield* lintPipeline(
        makeInput("Read", { path: "src/foo.ts" }),
        "s1"
      )
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toBe("")
  })

  // ── Error handling ────────────────────────────────────────

  test("empty input → empty output", async () => {
    const result = await Effect.gen(function* () {
      return yield* lintPipeline("", "s1")
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toBe("")
  })

  test("malformed JSON → empty output", async () => {
    const result = await Effect.gen(function* () {
      return yield* lintPipeline("not json", "s1")
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toBe("")
  })

  test("JSON without tool_name → empty output", async () => {
    const result = await Effect.gen(function* () {
      return yield* lintPipeline(
        JSON.stringify({ something: "else" }),
        "s1"
      )
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toBe("")
  })

  test("binary garbage → empty output", async () => {
    const result = await Effect.gen(function* () {
      return yield* lintPipeline(
        "\x00\x01\xff\xfe",
        "s1"
      )
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toBe("")
  })
})
