/**
 * Integration tests for the `witness briefing` command.
 *
 * Pattern: seed DB state → generate briefing → assert output structure.
 */
import { describe, it, expect } from "bun:test"
import { SqlClient } from "@effect/sql"
import { Effect } from "effect"
import { makeTestLayer } from "../helpers/db.js"
import { generateBriefing, formatBriefing } from "../../src/commands/Briefing.js"

const SESSION = "briefing-test"

// ── Helper: seed facts into a test DB ──────────────────────────

const run = <A>(effect: Effect.Effect<A, unknown, SqlClient.SqlClient>) =>
  Effect.provide(effect, makeTestLayer()).pipe(Effect.runPromise)

describe("Briefing", () => {
  describe("empty DB", () => {
    it("produces minimal output with just session stats", async () => {
      const output = await run(generateBriefing(SESSION))

      expect(output).toContain("## Witness Briefing (t=0)")
      expect(output).toContain("### Session Stats")
      expect(output).toContain("**Clock position**: 0")
      expect(output).toContain("**Total edits**: 0")
      expect(output).toContain("**Total tool calls**: 0")

      // Empty sections should be omitted
      expect(output).not.toContain("### Tests")
      expect(output).not.toContain("### Regressions")
      expect(output).not.toContain("### Thrashing")
      expect(output).not.toContain("### Untested")
    })
  })

  describe("with failing tests", () => {
    it("shows Tests section with pass/fail counts", async () => {
      const output = await run(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome, message)
                     VALUES (${SESSION}, 1, 'test_auth', 'pass', NULL)`
          yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome, message)
                     VALUES (${SESSION}, 2, 'test_login', 'fail', 'timeout')`
          yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome, message)
                     VALUES (${SESSION}, 3, 'test_signup', 'fail', 'assertion error')`
          return yield* generateBriefing(SESSION)
        })
      )

      expect(output).toContain("### Tests")
      expect(output).toContain("**Passing**: 1")
      expect(output).toContain("**Failing**: 2")
      expect(output).toContain("`test_login`: timeout")
      expect(output).toContain("`test_signup`: assertion error")
    })

    it("shows passing-only test section", async () => {
      const output = await run(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome, message)
                     VALUES (${SESSION}, 1, 'test_auth', 'pass', NULL)`
          yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome, message)
                     VALUES (${SESSION}, 2, 'test_login', 'pass', NULL)`
          return yield* generateBriefing(SESSION)
        })
      )

      expect(output).toContain("### Tests")
      expect(output).toContain("**Passing**: 2")
      expect(output).toContain("**Failing**: 0")
      // No failing test details listed
      expect(output).not.toContain("  - `")
    })
  })

  describe("with regressions", () => {
    it("shows Regressions section", async () => {
      const output = await run(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          // Pass → edit → fail sequence
          yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome, message)
                     VALUES (${SESSION}, 1, 'test_auth', 'pass', NULL)`
          yield* sql`INSERT INTO file_events (session_id, t, event, file_path)
                     VALUES (${SESSION}, 2, 'edit', 'src/auth.ts')`
          yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome, message)
                     VALUES (${SESSION}, 3, 'test_auth', 'fail', '401 error')`
          return yield* generateBriefing(SESSION)
        })
      )

      expect(output).toContain("### Regressions")
      expect(output).toContain("`test_auth` broke after editing `src/auth.ts`")
      expect(output).toContain("401 error")
    })
  })

  describe("with thrashing", () => {
    it("shows Thrashing section", async () => {
      const output = await run(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          // 3 edits with failures persisting
          yield* sql`INSERT INTO file_events (session_id, t, event, file_path)
                     VALUES (${SESSION}, 1, 'edit', 'src/auth.ts')`
          yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome, message)
                     VALUES (${SESSION}, 2, 'test_auth', 'fail', 'err1')`
          yield* sql`INSERT INTO file_events (session_id, t, event, file_path)
                     VALUES (${SESSION}, 3, 'edit', 'src/auth.ts')`
          yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome, message)
                     VALUES (${SESSION}, 4, 'test_auth', 'fail', 'err2')`
          yield* sql`INSERT INTO file_events (session_id, t, event, file_path)
                     VALUES (${SESSION}, 5, 'edit', 'src/auth.ts')`
          yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome, message)
                     VALUES (${SESSION}, 6, 'test_auth', 'fail', 'err3')`
          return yield* generateBriefing(SESSION)
        })
      )

      expect(output).toContain("### Thrashing")
      expect(output).toContain("`src/auth.ts`")
      expect(output).toContain("edits with persistent failures")
    })
  })

  describe("with untested edits", () => {
    it("shows Untested Edits section", async () => {
      const output = await run(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          yield* sql`INSERT INTO file_events (session_id, t, event, file_path)
                     VALUES (${SESSION}, 1, 'edit', 'src/foo.ts')`
          yield* sql`INSERT INTO file_events (session_id, t, event, file_path)
                     VALUES (${SESSION}, 2, 'edit', 'src/bar.ts')`
          return yield* generateBriefing(SESSION)
        })
      )

      expect(output).toContain("### Untested Edits")
      expect(output).toContain("`src/foo.ts`")
      expect(output).toContain("`src/bar.ts`")
    })

    it("omits files that have been tested", async () => {
      const output = await run(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          yield* sql`INSERT INTO file_events (session_id, t, event, file_path)
                     VALUES (${SESSION}, 1, 'edit', 'src/foo.ts')`
          // A test run after the edit means it's "tested"
          yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome, message)
                     VALUES (${SESSION}, 2, 'test_foo', 'pass', NULL)`
          return yield* generateBriefing(SESSION)
        })
      )

      expect(output).not.toContain("### Untested Edits")
    })
  })

  describe("rich DB with all sections", () => {
    it("includes all non-empty sections", async () => {
      const output = await run(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient

          // Clock
          yield* sql`INSERT INTO clock (session_id, current_t) VALUES (${SESSION}, 10)`

          // Some passing test
          yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome, message)
                     VALUES (${SESSION}, 1, 'test_utils', 'pass', NULL)`

          // Regression sequence: pass → edit → fail
          yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome, message)
                     VALUES (${SESSION}, 2, 'test_auth', 'pass', NULL)`
          yield* sql`INSERT INTO file_events (session_id, t, event, file_path)
                     VALUES (${SESSION}, 3, 'edit', 'src/auth.ts')`
          yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome, message)
                     VALUES (${SESSION}, 4, 'test_auth', 'fail', 'broken')`

          // Thrashing: 3 edit-fail cycles
          yield* sql`INSERT INTO file_events (session_id, t, event, file_path)
                     VALUES (${SESSION}, 5, 'edit', 'src/auth.ts')`
          yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome, message)
                     VALUES (${SESSION}, 6, 'test_auth', 'fail', 'still broken')`
          yield* sql`INSERT INTO file_events (session_id, t, event, file_path)
                     VALUES (${SESSION}, 7, 'edit', 'src/auth.ts')`
          yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome, message)
                     VALUES (${SESSION}, 8, 'test_auth', 'fail', 'nope')`

          // Untested edit
          yield* sql`INSERT INTO file_events (session_id, t, event, file_path)
                     VALUES (${SESSION}, 9, 'edit', 'src/unrelated.ts')`

          // Tool calls for stats
          yield* sql`INSERT INTO tool_calls (session_id, t, tool_name, tool_input, tool_output)
                     VALUES (${SESSION}, 1, 'Edit', '{}', NULL)`
          yield* sql`INSERT INTO tool_calls (session_id, t, tool_name, tool_input, tool_output)
                     VALUES (${SESSION}, 2, 'Read', '{}', NULL)`

          return yield* generateBriefing(SESSION)
        })
      )

      expect(output).toContain("## Witness Briefing (t=10)")
      expect(output).toContain("### Tests")
      expect(output).toContain("### Regressions")
      expect(output).toContain("### Thrashing")
      expect(output).toContain("### Untested Edits")
      expect(output).toContain("### Session Stats")
    })
  })

  describe("session scoping", () => {
    it("only shows data for the specified session", async () => {
      const output = await run(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          // Insert data for a DIFFERENT session
          yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome, message)
                     VALUES ('other-session', 1, 'test_auth', 'fail', 'should not appear')`
          yield* sql`INSERT INTO file_events (session_id, t, event, file_path)
                     VALUES ('other-session', 2, 'edit', 'src/other.ts')`
          return yield* generateBriefing(SESSION)
        })
      )

      // Should be empty — no data for our session
      expect(output).not.toContain("### Tests")
      expect(output).not.toContain("should not appear")
      expect(output).not.toContain("src/other.ts")
      expect(output).toContain("**Total edits**: 0")
    })
  })

  describe("formatBriefing", () => {
    it("omits empty sections", () => {
      const output = formatBriefing({
        clockPosition: 5,
        failing: [],
        passingCount: 0,
        regressions: [],
        thrashing: [],
        untested: [],
        stats: { totalEdits: 0, totalToolCalls: 0, clockPosition: 5 },
      })

      expect(output).toContain("## Witness Briefing (t=5)")
      expect(output).toContain("### Session Stats")
      expect(output).not.toContain("### Tests")
      expect(output).not.toContain("### Regressions")
      expect(output).not.toContain("### Thrashing")
      expect(output).not.toContain("### Untested")
    })

    it("includes failing test details with messages", () => {
      const output = formatBriefing({
        clockPosition: 10,
        failing: [
          { test_name: "test_a", message: "assertion failed", t: 5 },
          { test_name: "test_b", message: null, t: 6 },
        ],
        passingCount: 3,
        regressions: [],
        thrashing: [],
        untested: [],
        stats: { totalEdits: 2, totalToolCalls: 5, clockPosition: 10 },
      })

      expect(output).toContain("**Passing**: 3")
      expect(output).toContain("**Failing**: 2")
      expect(output).toContain("`test_a`: assertion failed")
      expect(output).toContain("`test_b`")
      // test_b has no message, so no colon
      expect(output).not.toContain("`test_b`:")
    })
  })
})
