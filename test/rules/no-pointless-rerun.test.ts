/**
 * Tests for the no_pointless_rerun rule.
 *
 * Fires when re-running tests without any intervening edits.
 * Defaults to WARN.
 */
import { SqlClient } from "@effect/sql"
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { makeTestLayer } from "../helpers/db.js"
import { NoPointlessRerun } from "../../src/rules/NoPointlessRerun.js"
import { lintPipeline } from "../../src/commands/Lint.js"
import type { HookInput } from "../../src/parsers/Parser.js"

const testInput = (command: string): HookInput => ({
  tool_name: "Bash",
  tool_input: { command },
})

describe("NoPointlessRerun", () => {
  // ── appliesTo ─────────────────────────────────────────────

  test("appliesTo returns true for bun test", () => {
    expect(NoPointlessRerun.appliesTo(testInput("bun test"))).toBe(true)
  })

  test("appliesTo returns true for jest", () => {
    expect(NoPointlessRerun.appliesTo(testInput("npx jest"))).toBe(true)
  })

  test("appliesTo returns true for vitest", () => {
    expect(NoPointlessRerun.appliesTo(testInput("vitest run"))).toBe(true)
  })

  test("appliesTo returns true for pytest", () => {
    expect(NoPointlessRerun.appliesTo(testInput("pytest tests/"))).toBe(true)
  })

  test("appliesTo returns true for go test", () => {
    expect(NoPointlessRerun.appliesTo(testInput("go test ./..."))).toBe(true)
  })

  test("appliesTo returns true for cargo test", () => {
    expect(NoPointlessRerun.appliesTo(testInput("cargo test"))).toBe(true)
  })

  test("appliesTo returns true for npm test", () => {
    expect(NoPointlessRerun.appliesTo(testInput("npm test"))).toBe(true)
  })

  test("appliesTo returns false for non-test Bash", () => {
    expect(NoPointlessRerun.appliesTo(testInput("ls -la"))).toBe(false)
  })

  test("appliesTo returns false for git commands", () => {
    expect(NoPointlessRerun.appliesTo(testInput("git commit -m 'fix'"))).toBe(false)
  })

  test("appliesTo returns false for Edit", () => {
    expect(
      NoPointlessRerun.appliesTo({ tool_name: "Edit", tool_input: { path: "a.ts" } })
    ).toBe(false)
  })

  // ── Fires when no edits since last test ───────────────────

  test("fires when no edits since last test run", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      // A previous test run exists
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 1, 'test_a', 'fail')`

      // No edits between t=1 and now → pointless rerun
      return yield* NoPointlessRerun.check(testInput("bun test"), "s1")
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).not.toBeNull()
    expect(result).toContain("No edits since last test run")
  })

  test("fires when multiple prior test results but no edits", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 1, 'test_a', 'pass')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 2, 'test_b', 'fail')`

      return yield* NoPointlessRerun.check(testInput("pytest"), "s1")
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).not.toBeNull()
    expect(result).toContain("No edits since last test run")
  })

  // ── Does NOT fire when edits exist since last test ────────

  test("does NOT fire when there are edits since the last test", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      // Test run at t=1
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 1, 'test_a', 'fail')`

      // Edit at t=2 (after test)
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 2, 'edit', 'src/auth.ts')`

      return yield* NoPointlessRerun.check(testInput("bun test"), "s1")
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toBeNull()
  })

  test("does NOT fire when multiple edits since last test", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 1, 'test_a', 'fail')`
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 2, 'edit', 'src/a.ts')`
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 3, 'edit', 'src/b.ts')`

      return yield* NoPointlessRerun.check(testInput("bun test"), "s1")
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toBeNull()
  })

  // ── First test run of the session → always passes ─────────

  test("allows first test run of the session (no prior results)", async () => {
    const result = await Effect.gen(function* () {
      // Empty DB — no test results at all
      return yield* NoPointlessRerun.check(testInput("bun test"), "s1")
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toBeNull()
  })

  test("allows first test run even without edits", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      // File events exist but no test results
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 1, 'read', 'src/auth.ts')`

      return yield* NoPointlessRerun.check(testInput("bun test"), "s1")
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toBeNull()
  })

  // ── Session scoping ───────────────────────────────────────

  test("is session-scoped", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      // Test results in session s2 (different session)
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s2', 1, 'test_a', 'fail')`

      // Session s1 has no test results → first run → allow
      return yield* NoPointlessRerun.check(testInput("bun test"), "s1")
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toBeNull()
  })

  // ── Read events don't count as edits ──────────────────────

  test("read events don't prevent the rule from firing", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 1, 'test_a', 'fail')`
      // Only a read event, not an edit
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 2, 'read', 'src/auth.ts')`

      return yield* NoPointlessRerun.check(testInput("bun test"), "s1")
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    // Read is not an edit → still no edits since last test → fires
    expect(result).not.toBeNull()
    expect(result).toContain("No edits since last test run")
  })

  // ── Config integration ────────────────────────────────────

  test("respects off config", async () => {
    const { mkdtemp, rm, writeFile } = await import("node:fs/promises")
    const { tmpdir } = await import("node:os")
    const { join } = await import("node:path")

    const tempDir = await mkdtemp(join(tmpdir(), "witness-rerun-off-"))
    await writeFile(
      join(tempDir, ".witness.json"),
      JSON.stringify({
        rules: {
          no_pointless_rerun: "off",
        },
      })
    )

    try {
      const result = await Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient

        yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 1, 'test_a', 'fail')`

        return yield* lintPipeline(
          JSON.stringify({
            hook: "PreToolUse",
            tool_name: "Bash",
            tool_input: { command: "bun test" },
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

  test("warns through lint pipeline by default", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 1, 'test_a', 'fail')`

      return yield* lintPipeline(
        JSON.stringify({
          hook: "PreToolUse",
          tool_name: "Bash",
          tool_input: { command: "bun test" },
        }),
        "s1"
      )
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).not.toBe("")
    const parsed = JSON.parse(result)
    expect(parsed.decision).toBe("approve")
    expect(parsed.additionalContext).toContain("no_pointless_rerun")
    expect(parsed.additionalContext).toContain("⚠️")
  })
})
