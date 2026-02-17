/**
 * Tests for the no_thrashing rule.
 *
 * Thrashing = editing the same file repeatedly with test failures persisting
 * after each edit cycle. Defaults to BLOCK.
 */
import { SqlClient } from "@effect/sql"
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { makeTestLayer } from "../helpers/db.js"
import { NoThrashing } from "../../src/rules/NoThrashing.js"
import { lintPipeline } from "../../src/commands/Lint.js"
import type { HookInput } from "../../src/parsers/Parser.js"

const editInput = (path: string): HookInput => ({
  tool_name: "Edit",
  tool_input: { path },
})

const writeInput = (path: string): HookInput => ({
  tool_name: "Write",
  tool_input: { path },
})

describe("NoThrashing", () => {
  // ── appliesTo ─────────────────────────────────────────────

  test("appliesTo returns true for Edit", () => {
    expect(NoThrashing.appliesTo(editInput("a.ts"))).toBe(true)
  })

  test("appliesTo returns true for Write", () => {
    expect(NoThrashing.appliesTo(writeInput("a.ts"))).toBe(true)
  })

  test("appliesTo returns false for Bash", () => {
    expect(
      NoThrashing.appliesTo({ tool_name: "Bash", tool_input: { command: "ls" } })
    ).toBe(false)
  })

  test("appliesTo returns false for Read", () => {
    expect(
      NoThrashing.appliesTo({ tool_name: "Read", tool_input: { path: "a.ts" } })
    ).toBe(false)
  })

  // ── Thrashing detection: 3+ edit-fail cycles ──────────────

  test("detects thrashing after 3 edit-then-test-fail cycles", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      // Cycle 1: edit → fail
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 1, 'edit', 'src/auth.ts')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 2, 'test_auth', 'fail')`

      // Cycle 2: edit → fail
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 3, 'edit', 'src/auth.ts')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 4, 'test_auth', 'fail')`

      // Cycle 3: edit → fail
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 5, 'edit', 'src/auth.ts')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 6, 'test_auth', 'fail')`

      // Now agent tries to edit again → should detect thrashing
      return yield* NoThrashing.check(editInput("src/auth.ts"), "s1")
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).not.toBeNull()
    expect(result).toContain("src/auth.ts")
    expect(result).toContain("3 times")
    expect(result).toContain("failures persisting")
  })

  test("detects thrashing with 4+ cycles", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      for (let i = 0; i < 4; i++) {
        yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', ${i * 2 + 1}, 'edit', 'src/auth.ts')`
        yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', ${i * 2 + 2}, 'test_auth', 'fail')`
      }

      return yield* NoThrashing.check(editInput("src/auth.ts"), "s1")
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).not.toBeNull()
    expect(result).toContain("4 times")
  })

  // ── Below threshold ───────────────────────────────────────

  test("does NOT detect thrashing with only 2 edit-fail cycles", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      // Cycle 1
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 1, 'edit', 'src/auth.ts')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 2, 'test_auth', 'fail')`

      // Cycle 2
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 3, 'edit', 'src/auth.ts')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 4, 'test_auth', 'fail')`

      return yield* NoThrashing.check(editInput("src/auth.ts"), "s1")
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toBeNull()
  })

  test("does NOT detect thrashing with 1 edit-fail cycle", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 1, 'edit', 'src/auth.ts')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 2, 'test_auth', 'fail')`

      return yield* NoThrashing.check(editInput("src/auth.ts"), "s1")
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toBeNull()
  })

  // ── Reset on success ──────────────────────────────────────

  test("resets when tests pass after an edit", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      // Cycle 1: edit → fail
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 1, 'edit', 'src/auth.ts')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 2, 'test_auth', 'fail')`

      // Cycle 2: edit → PASS (resets thrashing counter)
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 3, 'edit', 'src/auth.ts')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 4, 'test_auth', 'pass')`

      // Cycle 3: edit → fail (only 1 fail since reset)
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 5, 'edit', 'src/auth.ts')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 6, 'test_auth', 'fail')`

      return yield* NoThrashing.check(editInput("src/auth.ts"), "s1")
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    // Only 1 failed cycle since the reset, below threshold of 3
    expect(result).toBeNull()
  })

  // ── Mixed test results (other tests pass, target still fails) ──

  test("detects thrashing even when other tests pass in each cycle", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      // Cycle 1: edit → test_auth fails, test_utils passes
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 1, 'edit', 'src/auth.ts')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 2, 'test_auth', 'fail')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 2, 'test_utils', 'pass')`

      // Cycle 2: edit → test_auth fails, test_utils passes
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 3, 'edit', 'src/auth.ts')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 4, 'test_auth', 'fail')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 4, 'test_utils', 'pass')`

      // Cycle 3: edit → test_auth fails, test_utils passes
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 5, 'edit', 'src/auth.ts')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 6, 'test_auth', 'fail')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 6, 'test_utils', 'pass')`

      return yield* NoThrashing.check(editInput("src/auth.ts"), "s1")
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    // Should still detect: has_failure=1 and has_pass=1 in each cycle,
    // so no cycle is a "success" (success = has_pass=1 AND has_failure=0)
    expect(result).not.toBeNull()
    expect(result).toContain("3 times")
  })

  // ── Different files don't interfere ───────────────────────

  test("thrashing is per-file", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      // 3 cycles of editing auth.ts with failures
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 1, 'edit', 'src/auth.ts')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 2, 'test_auth', 'fail')`
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 3, 'edit', 'src/auth.ts')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 4, 'test_auth', 'fail')`
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 5, 'edit', 'src/auth.ts')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 6, 'test_auth', 'fail')`

      // But editing a different file should be fine
      return yield* NoThrashing.check(editInput("src/routes.ts"), "s1")
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toBeNull()
  })

  // ── Session scoping ───────────────────────────────────────

  test("is session-scoped", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      // Thrashing in session s2
      for (let i = 0; i < 3; i++) {
        yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s2', ${i * 2 + 1}, 'edit', 'src/auth.ts')`
        yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s2', ${i * 2 + 2}, 'test_auth', 'fail')`
      }

      // Should not affect session s1
      return yield* NoThrashing.check(editInput("src/auth.ts"), "s1")
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toBeNull()
  })

  // ── No path → null ────────────────────────────────────────

  test("returns null when no path in tool_input", async () => {
    const result = await Effect.gen(function* () {
      return yield* NoThrashing.check(
        { tool_name: "Edit", tool_input: {} },
        "s1"
      )
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toBeNull()
  })

  // ── No test results → not thrashing ───────────────────────

  test("does NOT detect thrashing when no tests have been run", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      // 5 edits but no test results at all
      for (let i = 1; i <= 5; i++) {
        yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', ${i}, 'edit', 'src/auth.ts')`
      }

      return yield* NoThrashing.check(editInput("src/auth.ts"), "s1")
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    // No test results → no failing tests → thrashing view empty
    expect(result).toBeNull()
  })

  // ── Custom threshold ──────────────────────────────────────

  test("respects custom threshold option", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      // Only 2 cycles
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 1, 'edit', 'src/auth.ts')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 2, 'test_auth', 'fail')`
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 3, 'edit', 'src/auth.ts')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 4, 'test_auth', 'fail')`

      // With threshold=2, this should fire
      return yield* NoThrashing.check(editInput("src/auth.ts"), "s1", { threshold: 2 })
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).not.toBeNull()
    expect(result).toContain("2 times")
  })

  // ── Config integration: block vs warn ─────────────────────

  test("defaults to block in lint pipeline", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      // Read the file so no_edit_unread doesn't fire
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 0, 'read', 'src/auth.ts')`

      // 3 cycles of thrashing
      for (let i = 0; i < 3; i++) {
        yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', ${i * 2 + 1}, 'edit', 'src/auth.ts')`
        yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', ${i * 2 + 2}, 'test_auth', 'fail')`
      }

      return yield* lintPipeline(
        JSON.stringify({
          hook: "PreToolUse",
          tool_name: "Edit",
          tool_input: { path: "src/auth.ts" },
        }),
        "s1"
      )
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).not.toBe("")
    const parsed = JSON.parse(result)
    // no_thrashing defaults to block
    expect(parsed.hookSpecificOutput?.permissionDecision).toBe("deny")
    expect(parsed.hookSpecificOutput?.permissionDecisionReason).toContain("no_thrashing")
  })

  test("config override: set to warn → warns instead of blocks", async () => {
    const { mkdtemp, rm, writeFile } = await import("node:fs/promises")
    const { tmpdir } = await import("node:os")
    const { join } = await import("node:path")

    const tempDir = await mkdtemp(join(tmpdir(), "witness-thrash-config-"))
    await writeFile(
      join(tempDir, ".witness.json"),
      JSON.stringify({
        rules: {
          no_thrashing: "warn",
          no_edit_unread: "off",
          test_after_edits: "off",
          fix_regressions_first: "off",
        },
      })
    )

    try {
      const result = await Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient

        // 3 cycles of thrashing
        for (let i = 0; i < 3; i++) {
          yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', ${i * 2 + 1}, 'edit', 'src/auth.ts')`
          yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', ${i * 2 + 2}, 'test_auth', 'fail')`
        }

        return yield* lintPipeline(
          JSON.stringify({
            hook: "PreToolUse",
            tool_name: "Edit",
            tool_input: { path: "src/auth.ts" },
          }),
          "s1",
          tempDir
        )
      }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

      expect(result).not.toBe("")
      const parsed = JSON.parse(result)
      // Should be warn, not block
      expect(parsed.decision).toBe("approve")
      expect(parsed.additionalContext).toContain("no_thrashing")
      expect(parsed.additionalContext).toContain("⚠️")
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  test("config override: set to off → no violation", async () => {
    const { mkdtemp, rm, writeFile } = await import("node:fs/promises")
    const { tmpdir } = await import("node:os")
    const { join } = await import("node:path")

    const tempDir = await mkdtemp(join(tmpdir(), "witness-thrash-off-"))
    await writeFile(
      join(tempDir, ".witness.json"),
      JSON.stringify({
        rules: {
          no_thrashing: "off",
          no_edit_unread: "off",
          test_after_edits: "off",
          fix_regressions_first: "off",
        },
      })
    )

    try {
      const result = await Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient

        // 3 cycles of thrashing
        for (let i = 0; i < 3; i++) {
          yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', ${i * 2 + 1}, 'edit', 'src/auth.ts')`
          yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', ${i * 2 + 2}, 'test_auth', 'fail')`
        }

        return yield* lintPipeline(
          JSON.stringify({
            hook: "PreToolUse",
            tool_name: "Edit",
            tool_input: { path: "src/auth.ts" },
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
})
