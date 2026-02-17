/**
 * Tests for scope_check rule.
 *
 * scope_check is OFF by default, but when enabled it should fire when
 * editing a file that is both unread and outside blast radius.
 */
import { SqlClient } from "@effect/sql"
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { lintPipeline } from "../../src/commands/Lint.js"
import { ScopeCheck } from "../../src/rules/ScopeCheck.js"
import type { HookInput } from "../../src/parsers/Parser.js"
import { makeTestLayer } from "../helpers/db.js"

const editInput = (path: string): HookInput => ({
  tool_name: "Edit",
  tool_input: { path },
})

describe("ScopeCheck", () => {
  test("appliesTo returns true for Edit", () => {
    expect(ScopeCheck.appliesTo(editInput("src/a.ts"))).toBe(true)
  })

  test("appliesTo returns true for Write", () => {
    expect(ScopeCheck.appliesTo({ tool_name: "Write", tool_input: { path: "src/a.ts" } })).toBe(true)
  })

  test("appliesTo returns false for Bash", () => {
    expect(
      ScopeCheck.appliesTo({ tool_name: "Bash", tool_input: { command: "ls" } })
    ).toBe(false)
  })

  test("appliesTo returns false for Read", () => {
    expect(
      ScopeCheck.appliesTo({ tool_name: "Read", tool_input: { path: "src/a.ts" } })
    ).toBe(false)
  })

  test("fires when file is unread and outside blast radius", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      // Seed "current work" on auth.ts
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 1, 'edit', 'src/auth.ts')`

      // imports: app.ts depends on auth.ts, so app.ts is in blast radius
      yield* sql`INSERT INTO imports (session_id, t, source_file, imported_module) VALUES ('s1', 2, 'src/app.ts', 'src/auth.ts')`

      // db.ts is neither read nor in blast radius => should fire
      return yield* ScopeCheck.check(editInput("src/db.ts"), "s1")
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).not.toBeNull()
    expect(result).toContain("src/db.ts")
  })

  test("does not fire when file is in blast radius (direct)", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 1, 'edit', 'src/auth.ts')`
      yield* sql`INSERT INTO imports (session_id, t, source_file, imported_module) VALUES ('s1', 2, 'src/app.ts', 'src/auth.ts')`

      return yield* ScopeCheck.check(editInput("src/app.ts"), "s1")
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toBeNull()
  })

  test("does not fire when file is in blast radius (transitive)", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      // A imports B imports C; edit C → A is in blast radius
      yield* sql`INSERT INTO imports (session_id, t, source_file, imported_module) VALUES ('s1', 1, 'src/a.ts', 'src/b.ts')`
      yield* sql`INSERT INTO imports (session_id, t, source_file, imported_module) VALUES ('s1', 2, 'src/b.ts', 'src/c.ts')`
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 3, 'edit', 'src/c.ts')`

      // Editing src/a.ts should be fine — it's in blast radius of C edit
      return yield* ScopeCheck.check(editInput("src/a.ts"), "s1")
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toBeNull()
  })

  test("does not fire when file was read", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 1, 'read', 'src/db.ts')`

      return yield* ScopeCheck.check(editInput("src/db.ts"), "s1")
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toBeNull()
  })

  test("does not fire when file was previously edited", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 1, 'edit', 'src/db.ts')`

      return yield* ScopeCheck.check(editInput("src/db.ts"), "s1")
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toBeNull()
  })

  test("is session-scoped", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      // scope only in s2
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s2', 1, 'edit', 'src/auth.ts')`
      yield* sql`INSERT INTO imports (session_id, t, source_file, imported_module) VALUES ('s2', 2, 'src/app.ts', 'src/auth.ts')`

      return yield* ScopeCheck.check(editInput("src/app.ts"), "s1")
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).not.toBeNull()
  })

  test("fires when no imports and no reads exist for target file", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      // Some activity in the session, but nothing related to target
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 1, 'edit', 'src/auth.ts')`

      return yield* ScopeCheck.check(editInput("src/unrelated.ts"), "s1")
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).not.toBeNull()
    expect(result).toContain("src/unrelated.ts")
  })

  test("scope_check remains off unless explicitly enabled", async () => {
    const { mkdtemp, rm, writeFile } = await import("node:fs/promises")
    const { tmpdir } = await import("node:os")
    const { join } = await import("node:path")

    const tempDir = await mkdtemp(join(tmpdir(), "witness-scope-off-"))
    await writeFile(
      join(tempDir, ".witness.json"),
      JSON.stringify({
        rules: {
          // Keep scope_check omitted so default (off) is used.
          no_edit_unread: "off",
          test_after_edits: "off",
          fix_regressions_first: "off",
          no_thrashing: "off",
        },
      })
    )

    try {
      const result = await Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient

        yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 1, 'edit', 'src/auth.ts')`
        yield* sql`INSERT INTO imports (session_id, t, source_file, imported_module) VALUES ('s1', 2, 'src/app.ts', 'src/auth.ts')`

        return yield* lintPipeline(
          JSON.stringify({
            hook: "PreToolUse",
            tool_name: "Edit",
            tool_input: { path: "src/db.ts" },
          }),
          "s1",
          tempDir
        )
      }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

      expect(result).toBe("")
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  test("respects warn config", async () => {
    const { mkdtemp, rm, writeFile } = await import("node:fs/promises")
    const { tmpdir } = await import("node:os")
    const { join } = await import("node:path")

    const tempDir = await mkdtemp(join(tmpdir(), "witness-scope-warn-"))
    await writeFile(
      join(tempDir, ".witness.json"),
      JSON.stringify({
        rules: {
          scope_check: "warn",
          no_edit_unread: "off",
          test_after_edits: "off",
          fix_regressions_first: "off",
          no_thrashing: "off",
        },
      })
    )

    try {
      const result = await Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient

        yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 1, 'edit', 'src/auth.ts')`
        yield* sql`INSERT INTO imports (session_id, t, source_file, imported_module) VALUES ('s1', 2, 'src/app.ts', 'src/auth.ts')`

        return yield* lintPipeline(
          JSON.stringify({
            hook: "PreToolUse",
            tool_name: "Edit",
            tool_input: { path: "src/db.ts" },
          }),
          "s1",
          tempDir
        )
      }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

      const parsed = JSON.parse(result)
      expect(parsed.decision).toBe("approve")
      expect(parsed.additionalContext).toContain("scope_check")
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  test("respects block config", async () => {
    const { mkdtemp, rm, writeFile } = await import("node:fs/promises")
    const { tmpdir } = await import("node:os")
    const { join } = await import("node:path")

    const tempDir = await mkdtemp(join(tmpdir(), "witness-scope-block-"))
    await writeFile(
      join(tempDir, ".witness.json"),
      JSON.stringify({
        rules: {
          scope_check: "block",
          no_edit_unread: "off",
          test_after_edits: "off",
          fix_regressions_first: "off",
          no_thrashing: "off",
        },
      })
    )

    try {
      const result = await Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient

        yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 1, 'edit', 'src/auth.ts')`
        yield* sql`INSERT INTO imports (session_id, t, source_file, imported_module) VALUES ('s1', 2, 'src/app.ts', 'src/auth.ts')`

        return yield* lintPipeline(
          JSON.stringify({
            hook: "PreToolUse",
            tool_name: "Edit",
            tool_input: { path: "src/db.ts" },
          }),
          "s1",
          tempDir
        )
      }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

      const parsed = JSON.parse(result)
      expect(parsed.hookSpecificOutput?.permissionDecision).toBe("deny")
      expect(parsed.hookSpecificOutput?.permissionDecisionReason).toContain("scope_check")
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})
