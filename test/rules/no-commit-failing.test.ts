/**
 * Tests for the no_commit_failing rule.
 */
import { SqlClient } from "@effect/sql"
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { makeTestLayer } from "../helpers/db.js"
import { NoCommitFailing } from "../../src/rules/NoCommitFailing.js"
import type { HookInput } from "../../src/parsers/Parser.js"

const commitInput: HookInput = {
  tool_name: "Bash",
  tool_input: { command: "git commit -m 'feat: add auth'" },
}

const jjDescribeInput: HookInput = {
  tool_name: "Bash",
  tool_input: { command: 'jj describe -m "fix stuff"' },
}

const nonCommitInput: HookInput = {
  tool_name: "Bash",
  tool_input: { command: "ls -la" },
}

const editInput: HookInput = {
  tool_name: "Edit",
  tool_input: { path: "src/foo.ts" },
}

describe("NoCommitFailing", () => {
  // ── appliesTo ─────────────────────────────────────────────

  test("appliesTo returns true for git commit", () => {
    expect(NoCommitFailing.appliesTo(commitInput)).toBe(true)
  })

  test("appliesTo returns true for jj describe", () => {
    expect(NoCommitFailing.appliesTo(jjDescribeInput)).toBe(true)
  })

  test("appliesTo returns false for non-commit Bash", () => {
    expect(NoCommitFailing.appliesTo(nonCommitInput)).toBe(false)
  })

  test("appliesTo returns false for Edit", () => {
    expect(NoCommitFailing.appliesTo(editInput)).toBe(false)
  })

  test("appliesTo returns false for git push", () => {
    expect(
      NoCommitFailing.appliesTo({
        tool_name: "Bash",
        tool_input: { command: "git push origin main" },
      })
    ).toBe(false)
  })

  // ── check ─────────────────────────────────────────────────

  test("blocks commit when tests are failing", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 1, 'test_auth', 'fail')`

      return yield* NoCommitFailing.check(commitInput, "s1")
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).not.toBeNull()
    expect(result).toContain("1 test currently failing")
    expect(result).toContain("test_auth")
    expect(result).toContain("Fix tests before committing")
  })

  test("blocks commit when multiple tests are failing", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 1, 'test_auth', 'fail')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 2, 'test_utils', 'fail')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 3, 'test_routes', 'pass')`

      return yield* NoCommitFailing.check(commitInput, "s1")
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).not.toBeNull()
    expect(result).toContain("2 tests currently failing")
  })

  test("allows commit when no tests are failing", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 1, 'test_auth', 'pass')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 2, 'test_utils', 'pass')`

      return yield* NoCommitFailing.check(commitInput, "s1")
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toBeNull()
  })

  test("allows commit when no tests have been run", async () => {
    const result = await Effect.gen(function* () {
      // Empty DB — no test results at all
      return yield* NoCommitFailing.check(commitInput, "s1")
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toBeNull()
  })

  test("considers latest test state (test that was failing then passed)", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      // test_auth: fail at t=1, pass at t=3 → current state is pass
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 1, 'test_auth', 'fail')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 2, 'test_utils', 'pass')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s1', 3, 'test_auth', 'pass')`

      return yield* NoCommitFailing.check(commitInput, "s1")
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toBeNull()
  })

  test("is session-scoped (failures in other session don't block)", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      // Failure in session s2, committing in s1
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome) VALUES ('s2', 1, 'test_auth', 'fail')`

      return yield* NoCommitFailing.check(commitInput, "s1")
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toBeNull()
  })
})
